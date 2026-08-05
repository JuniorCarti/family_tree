const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const db = require('./db');
const familyAccess = require('./family-access');
const platformAccess = require('./platform-access');

const TOKEN_TTL = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000
};

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function initializeTrustAccess() {
  await Promise.all([db.ready, familyAccess.ready, platformAccess.ready]);
  const client = await db.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('lineage_trust_access_v1'))");
    await client.query('BEGIN');
    // Existing accounts are grandfathered as verified. New accounts receive NULL.
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP DEFAULT now()');
    await client.query('ALTER TABLE users ALTER COLUMN email_verified_at DROP DEFAULT');
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
        token_hash CHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_purpose ON auth_tokens(user_id, purpose, created_at DESC)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        family_id INTEGER,
        actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(80) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id VARCHAR(80),
        before_data JSONB,
        after_data JSONB,
        ip_address VARCHAR(80),
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_audit_family_created ON audit_logs(family_id, created_at DESC)');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('lineage_trust_access_v1'))").catch(() => {});
    client.release();
  }
}

const ready = initializeTrustAccess();

function publicBaseUrl(req) {
  return String(process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function mailTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined
  });
}

async function sendMail({ to, subject, text }) {
  const transport = mailTransport();
  if (!transport) {
    if (process.env.NODE_ENV !== 'test') console.warn(`Email delivery is not configured; skipped email to ${to}: ${subject}`);
    return { delivered: false };
  }
  await transport.sendMail({ from: process.env.EMAIL_FROM || 'Lineage <no-reply@localhost>', to, subject, text });
  return { delivered: true };
}

async function createToken(userId, purpose, client = db) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = TOKEN_TTL[purpose];
  if (!ttl) throw new Error('Unsupported token purpose');
  await client.query('UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose]);
  await client.query(
    'INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, now() + ($4 * interval \'1 millisecond\'))',
    [userId, purpose, hashToken(token), ttl]
  );
  return token;
}

async function issueVerification(user, req, client = db) {
  const token = await createToken(user.id, 'verify_email', client);
  const url = `${publicBaseUrl(req)}/?verify=${encodeURIComponent(token)}`;
  let delivery;
  try {
    delivery = await sendMail({
      to: user.email,
      subject: 'Verify your Lineage email',
      text: `Verify your email address to secure your Lineage account: ${url}\n\nThis link expires in 24 hours.`
    });
  } catch (error) {
    console.error('Verification email delivery failed:', error.message);
    delivery = { delivered: false };
  }
  return { token, ...delivery };
}

async function audit(req, action, entityType, entityId, beforeData, afterData, client = db) {
  await ready;
  await client.query(`
    INSERT INTO audit_logs (family_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [req.family?.id || null, req.session?.userId || null, action, entityType, entityId == null ? null : String(entityId), beforeData || null, afterData || null, req.ip || null]);
}

function registerRoutes(app, authLimiter) {
  app.post('/api/auth/verify-email', authLimiter, async (req, res, next) => {
    const client = await db.pool.connect();
    try {
      await ready;
      await client.query('BEGIN');
      const token = await client.query(`
        SELECT id, user_id FROM auth_tokens
        WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now()
        FOR UPDATE
      `, [hashToken(String(req.body.token || ''))]);
      if (!token.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'This verification link is invalid or has expired' });
      }
      await client.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [token.rows[0].user_id]);
      await client.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [token.rows[0].id]);
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally { client.release(); }
  });

  app.post('/api/auth/resend-verification', authLimiter, async (req, res, next) => {
    try {
      await ready;
      const email = String(req.body.email || '').trim().toLowerCase();
      const result = await db.query('SELECT id, email, email_verified_at FROM users WHERE lower(email) = $1', [email]);
      if (result.rows[0] && !result.rows[0].email_verified_at) await issueVerification(result.rows[0], req);
      res.json({ message: 'If that account needs verification, a new link has been sent.' });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/request-password-reset', authLimiter, async (req, res, next) => {
    try {
      await ready;
      const email = String(req.body.email || '').trim().toLowerCase();
      const result = await db.query('SELECT id, email FROM users WHERE lower(email) = $1', [email]);
      let testToken;
      if (result.rows[0]) {
        const token = await createToken(result.rows[0].id, 'reset_password');
        testToken = token;
        const url = `${publicBaseUrl(req)}/?reset=${encodeURIComponent(token)}`;
        await sendMail({ to: result.rows[0].email, subject: 'Reset your Lineage password', text: `Reset your password: ${url}\n\nThis single-use link expires in one hour.` })
          .catch((error) => console.error('Password reset email delivery failed:', error.message));
      }
      const response = { message: 'If an account exists for that email, a password reset link has been sent.' };
      if (process.env.NODE_ENV === 'test' && testToken) response.test_token = testToken;
      res.json(response);
    } catch (error) { next(error); }
  });

  app.post('/api/auth/reset-password', authLimiter, async (req, res, next) => {
    const password = String(req.body.new_password || '');
    if (password.length < 12) return res.status(400).json({ error: 'Password must be at least 12 characters' });
    const client = await db.pool.connect();
    try {
      await ready;
      await client.query('BEGIN');
      const token = await client.query(`
        SELECT id, user_id FROM auth_tokens
        WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > now()
        FOR UPDATE
      `, [hashToken(String(req.body.token || ''))]);
      if (!token.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'This password reset link is invalid or has expired' });
      }
      const hash = await bcrypt.hash(password, 12);
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, token.rows[0].user_id]);
      await client.query('UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [token.rows[0].user_id]);
      await client.query("DELETE FROM session WHERE (sess::jsonb ->> 'userId')::integer = $1", [token.rows[0].user_id]).catch(() => {});
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally { client.release(); }
  });
}

module.exports = { ready, registerRoutes, issueVerification, audit };
