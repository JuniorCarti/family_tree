const express = require('express');
const db = require('./db');

const PAYMENT_AMOUNT_KES = Number(process.env.ACCOUNT_UNLOCK_FEE_KES || 500);
const PAYMENT_PHONE = String(process.env.MPESA_PAYMENT_PHONE || '254113245740').replace(/\D/g, '');
const VALID_ACCOUNT_STATUSES = new Set(['pending', 'payment_submitted', 'approved', 'rejected']);

if (!Number.isInteger(PAYMENT_AMOUNT_KES) || PAYMENT_AMOUNT_KES <= 0) {
  throw new Error('ACCOUNT_UNLOCK_FEE_KES must be a positive whole number');
}
if (!/^254[17]\d{8}$/.test(PAYMENT_PHONE)) {
  throw new Error('MPESA_PAYMENT_PHONE must be a Kenyan number in 254XXXXXXXXX format');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function bootstrapSuperadminEmails() {
  return String(process.env.SUPERADMIN_EMAILS || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
}

function isBootstrapSuperadminEmail(email) {
  return bootstrapSuperadminEmails().includes(normalizeEmail(email));
}

async function initializePlatformAccess() {
  await db.ready;
  const client = await db.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('lineage_platform_access_v1'))");
    await client.query('BEGIN');

    // The first ADD uses approved so accounts that existed before this feature are
    // grandfathered. The default is immediately changed so every future signup is pending.
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(30) NOT NULL DEFAULT 'approved'");
    await client.query("ALTER TABLE users ALTER COLUMN account_status SET DEFAULT 'pending'");
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT false');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_reason TEXT');

    await client.query(`
      CREATE TABLE IF NOT EXISTS account_payment_submissions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount_kes INTEGER NOT NULL DEFAULT 500 CHECK (amount_kes > 0),
        payment_phone VARCHAR(30) NOT NULL,
        payer_phone VARCHAR(30),
        mpesa_reference VARCHAR(30) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'submitted'
          CHECK (status IN ('submitted', 'approved', 'rejected')),
        review_note TEXT,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_reference_unique ON account_payment_submissions(upper(mpesa_reference))');
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_one_submitted_per_user ON account_payment_submissions(user_id) WHERE status = 'submitted'");
    await client.query('CREATE INDEX IF NOT EXISTS idx_payment_user_created ON account_payment_submissions(user_id, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status)');

    const superadminEmails = bootstrapSuperadminEmails();
    if (superadminEmails.length) {
      await client.query(`
        UPDATE users
        SET is_superadmin = true,
            account_status = 'approved',
            approved_at = COALESCE(approved_at, now()),
            rejection_reason = NULL
        WHERE lower(email) = ANY($1::text[])
      `, [superadminEmails]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('lineage_platform_access_v1'))").catch(() => {});
    client.release();
  }
}

const ready = initializePlatformAccess().catch((error) => {
  console.error('Platform access schema initialization failed:', error);
  throw error;
});

async function applyBootstrapAccess(userId, email, client = db) {
  await ready;
  if (!isBootstrapSuperadminEmail(email)) return false;
  await client.query(`
    UPDATE users
    SET is_superadmin = true,
        account_status = 'approved',
        approved_at = COALESCE(approved_at, now()),
        rejection_reason = NULL
    WHERE id = $1
  `, [userId]);
  return true;
}

async function getAccountAccess(userId, client = db) {
  await ready;
  const result = await client.query(`
    SELECT u.id, u.email, u.account_status, u.is_superadmin, u.approved_at,
           u.rejection_reason,
           payment.id AS payment_id,
           payment.amount_kes,
           payment.payer_phone,
           payment.mpesa_reference,
           payment.status AS payment_status,
           payment.review_note,
           payment.reviewed_at,
           payment.created_at AS payment_submitted_at
    FROM users u
    LEFT JOIN LATERAL (
      SELECT aps.*
      FROM account_payment_submissions aps
      WHERE aps.user_id = u.id
      ORDER BY aps.created_at DESC, aps.id DESC
      LIMIT 1
    ) payment ON true
    WHERE u.id = $1
  `, [userId]);
  if (!result.rows[0]) return null;
  return {
    ...result.rows[0],
    unlock_fee_kes: PAYMENT_AMOUNT_KES,
    payment_phone: PAYMENT_PHONE,
    payment_method: 'M-Pesa Send Money'
  };
}

function requireSession(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

async function requireApproved(req, res, next) {
  try {
    const access = await getAccountAccess(req.session.userId);
    if (!access) return res.status(401).json({ error: 'Account not found' });
    if (access.account_status !== 'approved') {
      return res.status(403).json({
        error: 'Account approval and payment verification are required',
        code: 'ACCOUNT_LOCKED',
        account_status: access.account_status
      });
    }
    req.platformAccess = access;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireSuperadmin(req, res, next) {
  try {
    const access = await getAccountAccess(req.session.userId);
    if (!access || access.account_status !== 'approved' || !access.is_superadmin) {
      return res.status(403).json({ error: 'Superadmin access is required' });
    }
    req.platformAccess = access;
    next();
  } catch (error) {
    next(error);
  }
}

function normalizePayerPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  return digits;
}

function registerRoutes(app) {
  const router = express.Router();

  router.get('/account/access', requireSession, async (req, res, next) => {
    try {
      const access = await getAccountAccess(req.session.userId);
      if (!access) return res.status(404).json({ error: 'Account not found' });
      res.json({ access });
    } catch (error) {
      next(error);
    }
  });

  router.post('/account/payment-submissions', requireSession, async (req, res, next) => {
    const client = await db.pool.connect();
    try {
      const reference = String(req.body.mpesa_reference || '').trim().toUpperCase();
      const payerPhone = normalizePayerPhone(req.body.payer_phone);
      if (!/^[A-Z0-9]{10,20}$/.test(reference)) {
        return res.status(400).json({ error: 'Enter the 10-20 character M-Pesa transaction code' });
      }
      if (payerPhone && !/^254[17]\d{8}$/.test(payerPhone)) {
        return res.status(400).json({ error: 'Enter a valid Kenyan phone number, for example 254712345678' });
      }

      await client.query('BEGIN');
      const userResult = await client.query(
        'SELECT account_status FROM users WHERE id = $1 FOR UPDATE',
        [req.session.userId]
      );
      if (!userResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Account not found' });
      }
      if (userResult.rows[0].account_status === 'approved') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This account is already approved' });
      }

      const payment = await client.query(`
        INSERT INTO account_payment_submissions
          (user_id, amount_kes, payment_phone, payer_phone, mpesa_reference)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, amount_kes, payer_phone, mpesa_reference, status, created_at
      `, [req.session.userId, PAYMENT_AMOUNT_KES, PAYMENT_PHONE, payerPhone, reference]);
      await client.query(`
        UPDATE users
        SET account_status = 'payment_submitted', rejection_reason = NULL
        WHERE id = $1
      `, [req.session.userId]);
      await client.query('COMMIT');
      res.status(201).json({ payment: payment.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That M-Pesa code is already submitted, or this account already has a pending review' });
      }
      next(error);
    } finally {
      client.release();
    }
  });

  router.use('/superadmin', requireSession, requireSuperadmin);

  router.get('/superadmin/accounts', async (req, res, next) => {
    try {
      const requestedStatus = String(req.query.status || 'actionable');
      const params = [];
      let statusClause = "u.account_status IN ('pending', 'payment_submitted', 'rejected')";
      if (requestedStatus !== 'actionable') {
        if (!VALID_ACCOUNT_STATUSES.has(requestedStatus)) {
          return res.status(400).json({ error: 'Invalid account status filter' });
        }
        params.push(requestedStatus);
        statusClause = `u.account_status = $${params.length}`;
      }
      const result = await db.query(`
        SELECT u.id, u.email, u.family_name, u.account_status, u.is_superadmin,
               u.created_at, u.approved_at, u.rejection_reason,
               payment.id AS payment_id,
               payment.amount_kes,
               payment.payer_phone,
               payment.mpesa_reference,
               payment.status AS payment_status,
               payment.created_at AS payment_submitted_at
        FROM users u
        LEFT JOIN LATERAL (
          SELECT aps.* FROM account_payment_submissions aps
          WHERE aps.user_id = u.id
          ORDER BY aps.created_at DESC, aps.id DESC
          LIMIT 1
        ) payment ON true
        WHERE ${statusClause}
        ORDER BY CASE u.account_status
          WHEN 'payment_submitted' THEN 1 WHEN 'pending' THEN 2
          WHEN 'rejected' THEN 3 ELSE 4 END,
          COALESCE(payment.created_at, u.created_at), u.id
      `, params);
      res.json({ accounts: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/superadmin/accounts/:userId/approve', async (req, res, next) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query(
        'SELECT id, account_status FROM users WHERE id = $1 FOR UPDATE',
        [req.params.userId]
      );
      if (!target.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Account not found' });
      }
      const payment = await client.query(`
        SELECT id FROM account_payment_submissions
        WHERE user_id = $1 AND status = 'submitted'
        ORDER BY created_at DESC, id DESC
        LIMIT 1 FOR UPDATE
      `, [req.params.userId]);
      if (!payment.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'A submitted payment reference is required before approval' });
      }
      await client.query(`
        UPDATE account_payment_submissions
        SET status = 'approved', reviewed_by = $1, reviewed_at = now(), review_note = NULL
        WHERE id = $2
      `, [req.session.userId, payment.rows[0].id]);
      await client.query(`
        UPDATE users
        SET account_status = 'approved', approved_at = now(), approved_by = $1,
            rejection_reason = NULL
        WHERE id = $2
      `, [req.session.userId, req.params.userId]);
      await client.query('COMMIT');
      res.json({ success: true, account_status: 'approved' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  });

  router.patch('/superadmin/accounts/:userId/reject', async (req, res, next) => {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3 || reason.length > 500) {
      return res.status(400).json({ error: 'Provide a rejection reason between 3 and 500 characters' });
    }
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query(
        'SELECT id, account_status, is_superadmin FROM users WHERE id = $1 FOR UPDATE',
        [req.params.userId]
      );
      if (!target.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Account not found' });
      }
      if (target.rows[0].account_status === 'approved' || target.rows[0].is_superadmin) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Approved accounts and superadmins cannot be rejected through payment review' });
      }
      const payment = await client.query(`
        SELECT id FROM account_payment_submissions
        WHERE user_id = $1 AND status = 'submitted'
        ORDER BY created_at DESC, id DESC
        LIMIT 1 FOR UPDATE
      `, [req.params.userId]);
      if (payment.rows.length) {
        await client.query(`
          UPDATE account_payment_submissions
          SET status = 'rejected', reviewed_by = $1, reviewed_at = now(), review_note = $2
          WHERE id = $3
        `, [req.session.userId, reason, payment.rows[0].id]);
      }
      await client.query(`
        UPDATE users
        SET account_status = 'rejected', rejection_reason = $1,
            approved_at = NULL, approved_by = NULL
        WHERE id = $2
      `, [reason, req.params.userId]);
      await client.query('COMMIT');
      res.json({ success: true, account_status: 'rejected' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  });

  app.use('/api', router);
}

module.exports = {
  PAYMENT_AMOUNT_KES,
  PAYMENT_PHONE,
  ready,
  applyBootstrapAccess,
  getAccountAccess,
  requireSession,
  requireApproved,
  requireSuperadmin,
  registerRoutes
};