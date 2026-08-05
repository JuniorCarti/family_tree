require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const ExcelJS = require('exceljs');
const db = require('./db');
const familyAccess = require('./family-access');
const platformAccess = require('./platform-access');

const app = express();
const PORT = process.env.PORT || 4000;

// Firebase Hosting forwards requests through a proxy before they reach
// Cloud Run. Trust that proxy so secure session cookies are set correctly.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  name: '__session',
  store: new pgSession({ pool: db.pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'a-very-secure-secret-key-12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ---------------------------------------------------------------------------
// Photo uploads
// ---------------------------------------------------------------------------
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `photo_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image uploads are allowed'));
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getPerson(id, familyId) {
  const result = await db.query('SELECT * FROM persons WHERE id = $1 AND family_id = $2', [id, familyId]);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Auth Routes
// ---------------------------------------------------------------------------
app.get('/api/auth/me', async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  try {
    const context = await familyAccess.userContext(req.session.userId, req.session.activeFamilyId);
    if (!context) return res.status(404).json({ error: 'User not found' });
    req.session.activeFamilyId = context.active_family_id;
    res.json(context);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/signup', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const familyName = String(req.body.family_name || '').trim();
  const inviteToken = String(req.body.invite_token || '').trim();

  if (!email || !password || (!familyName && !inviteToken)) {
    return res.status(400).json({ error: 'Email, password, and a family name or invitation are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const client = await db.pool.connect();
  try {
    await Promise.all([familyAccess.ready, platformAccess.ready]);
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 10);
    const result = await client.query(
      'INSERT INTO users (email, password_hash, family_name) VALUES ($1, $2, $3) RETURNING id, email, family_name',
      [email, hash, familyName || 'Invited family member']
    );
    const user = result.rows[0];
    await platformAccess.applyBootstrapAccess(user.id, user.email, client);

    let activeFamily;
    if (inviteToken) {
      activeFamily = await familyAccess.acceptInvitation({ token: inviteToken, userId: user.id, email, client });
    } else {
      activeFamily = await familyAccess.createFamily(user.id, familyName, client);
    }

    await client.query('COMMIT');
    req.session.userId = user.id;
    req.session.activeFamilyId = activeFamily.id;
    const context = await familyAccess.userContext(user.id, activeFamily.id);
    res.status(201).json(context);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  try {
    await Promise.all([familyAccess.ready, platformAccess.ready]);
    const result = await db.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const context = await familyAccess.userContext(user.id, req.session.activeFamilyId);
    req.session.userId = user.id;
    req.session.activeFamilyId = context.active_family_id;
    res.json(context);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('__session');
    res.json({ success: true });
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  res.status(501).json({ error: 'Password recovery is unavailable until verified email delivery is configured' });
});

const requireAuth = familyAccess.requireAuth;
const requireApproved = platformAccess.requireApproved;
const requireFamily = familyAccess.requireFamily;
const requireRole = familyAccess.requireRole;

platformAccess.registerRoutes(app);

// The invitation acceptance endpoint remains available while an account is
// locked. All family listing, administration, and data routes require approval.
app.use('/api/families', requireAuth, requireApproved);
app.use('/api/family', requireAuth, requireApproved);
familyAccess.registerRoutes(app);

app.use('/api/persons', requireAuth, requireApproved, requireFamily);
app.use('/api/relationships', requireAuth, requireApproved, requireFamily);
app.use('/api/tree', requireAuth, requireApproved, requireFamily);
app.use('/api/export', requireAuth, requireApproved, requireFamily);
app.use('/api/merge', requireAuth, requireApproved, requireFamily);
app.use('/api/duplicates', requireAuth, requireApproved, requireFamily);

app.post('/api/upload', requireAuth, requireApproved, requireFamily, requireRole('contributor'), upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
});
// ---------------------------------------------------------------------------
// Persons CRUD
// ---------------------------------------------------------------------------
app.get('/api/persons', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM persons WHERE family_id = $1 ORDER BY last_name, first_name', [req.family.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/persons/:id', async (req, res) => {
  try {
    const person = await getPerson(req.params.id, req.family.id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    res.json(person);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/persons', requireRole('contributor'), async (req, res) => {
  const {
    first_name, last_name = '', maiden_name = '', gender = 'unknown',
    birth_date = null, death_date = null, birth_place = null,
    photo_url = null, notes = null
  } = req.body;

  if (!first_name || !first_name.trim()) {
    return res.status(400).json({ error: 'first_name is required' });
  }

  try {
    const result = await db.query(`
      INSERT INTO persons (first_name, last_name, maiden_name, gender, birth_date, death_date, birth_place, photo_url, notes, user_id, family_id, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [first_name, last_name, maiden_name, gender, birth_date, death_date, birth_place, photo_url, notes, req.session.userId, req.family.id, req.session.userId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/persons/:id', requireRole('contributor'), async (req, res) => {
  try {
    const existing = await getPerson(req.params.id, req.family.id);
    if (!existing) return res.status(404).json({ error: 'Person not found' });

    const merged = { ...existing, ...req.body };
    const result = await db.query(`
      UPDATE persons SET
        first_name = $1, last_name = $2, maiden_name = $3,
        gender = $4, birth_date = $5, death_date = $6,
        birth_place = $7, photo_url = $8, notes = $9,
        updated_at = now()
      WHERE id = $10 AND family_id = $11
      RETURNING *
    `, [
      merged.first_name, merged.last_name, merged.maiden_name,
      merged.gender, merged.birth_date, merged.death_date,
      merged.birth_place, merged.photo_url, merged.notes,
      existing.id, req.family.id
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/persons/:id', requireRole('contributor'), async (req, res) => {
  try {
    const existing = await getPerson(req.params.id, req.family.id);
    if (!existing) return res.status(404).json({ error: 'Person not found' });

    await db.query('DELETE FROM persons WHERE id = $1 AND family_id = $2', [req.params.id, req.family.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Relationships CRUD
// ---------------------------------------------------------------------------
app.get('/api/relationships', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM relationships WHERE family_id = $1', [req.family.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/relationships', requireRole('contributor'), async (req, res) => {
  const { type, person1_id, person2_id, label = null, status = 'married', start_date = null, end_date = null } = req.body;

  const validTypes = ['parent', 'spouse', 'relative', 'sibling', 'grandparent', 'grandchild', 'aunt_uncle', 'niece_nephew', 'cousin'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }
  if (!person1_id || !person2_id || person1_id === person2_id) {
    return res.status(400).json({ error: 'person1_id and person2_id are required and must differ' });
  }

  try {
    const p1 = await getPerson(person1_id, req.family.id);
    const p2 = await getPerson(person2_id, req.family.id);
    if (!p1 || !p2) {
      return res.status(404).json({ error: 'One or both persons not found' });
    }

    const result = await db.query(`
      INSERT INTO relationships (type, person1_id, person2_id, label, status, start_date, end_date, user_id, family_id, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [type, person1_id, person2_id, label, status, start_date, end_date, req.session.userId, req.family.id, req.session.userId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (String(err).includes('unique constraint') || String(err).includes('UNIQUE')) {
      return res.status(409).json({ error: 'This relationship already exists' });
    }
    res.status(500).json({ error: 'Could not create relationship' });
  }
});

app.delete('/api/relationships/:id', requireRole('contributor'), async (req, res) => {
  try {
    await db.query('DELETE FROM relationships WHERE id = $1 AND family_id = $2', [req.params.id, req.family.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Duplicates / Merge
// ---------------------------------------------------------------------------
app.get('/api/duplicates', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT lower(first_name) as fname, lower(last_name) as lname, array_agg(id) as ids, count(*) as count
      FROM persons
      WHERE family_id = $1
      GROUP BY lower(first_name), lower(last_name)
      HAVING count(*) > 1
    `, [req.family.id]);

    const duplicates = [];
    for (const row of result.rows) {
      const peopleReq = await db.query('SELECT * FROM persons WHERE id = ANY($1)', [row.ids]);
      duplicates.push({ group: `${row.fname || ''} ${row.lname || ''}`.trim(), persons: peopleReq.rows });
    }
    res.json(duplicates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/merge', requireRole('contributor'), async (req, res) => {
  const { keepId, mergeIds } = req.body;
  if (!keepId || !mergeIds || !Array.isArray(mergeIds) || mergeIds.length === 0) {
    return res.status(400).json({ error: 'Missing keepId or mergeIds' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Check ownership
    const checkUser = await client.query('SELECT id FROM persons WHERE id = ANY($1) AND family_id = $2', [[keepId, ...mergeIds], req.family.id]);
    if (checkUser.rows.length !== mergeIds.length + 1) {
      throw new Error('Not all persons found or owned by user');
    }

    // Update person1_id where it's safe (no conflict, no self-referencing)
    await client.query(`
      UPDATE relationships r1
      SET person1_id = $1
      WHERE person1_id = ANY($2) AND family_id = $3
        AND r1.person2_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM relationships r2
          WHERE r2.type = r1.type 
            AND r2.person1_id = $1 
            AND r2.person2_id = r1.person2_id
            AND r2.family_id = $3
        )
    `, [keepId, mergeIds, req.family.id]);

    // Update person2_id where it's safe
    await client.query(`
      UPDATE relationships r1
      SET person2_id = $1
      WHERE person2_id = ANY($2) AND family_id = $3
        AND r1.person1_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM relationships r2
          WHERE r2.type = r1.type 
            AND r2.person1_id = r1.person1_id 
            AND r2.person2_id = $1
            AND r2.family_id = $3
        )
    `, [keepId, mergeIds, req.family.id]);

    // Delete any relations left pointing to mergeIds (which means they would have conflicted)
    await client.query(`
      DELETE FROM relationships 
      WHERE (person1_id = ANY($1) OR person2_id = ANY($1)) AND family_id = $2
    `, [mergeIds, req.family.id]);

    // Finally delete the persons
    await client.query(`
      DELETE FROM persons
      WHERE id = ANY($1) AND family_id = $2
    `, [mergeIds, req.family.id]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Full tree payload
// ---------------------------------------------------------------------------
app.get('/api/tree', async (req, res) => {
  try {
    const pResult = await db.query('SELECT * FROM persons WHERE family_id = $1 ORDER BY last_name, first_name', [req.family.id]);
    const rResult = await db.query('SELECT * FROM relationships WHERE family_id = $1', [req.family.id]);
    res.json({
      tree: { id: req.family.id, name: req.family.name, role: req.family.role },
      persons: pResult.rows,
      relationships: rResult.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tree', requireRole('admin'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Family name is required' });
  try {
    const result = await db.query(
      'UPDATE families SET name = $1, updated_at = now() WHERE id = $2 RETURNING id, name',
      [name, req.family.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
app.get('/api/export/excel', async (req, res) => {
  try {
    const family_name = req.family.name || 'My Family Tree';

    const pResult = await db.query('SELECT * FROM persons WHERE family_id = $1', [req.family.id]);
    const persons = pResult.rows;

    const rResult = await db.query('SELECT * FROM relationships WHERE family_id = $1', [req.family.id]);
    const storedRels = rResult.rows;

    const parentsOf = new Map();
    const childrenOf = new Map();
    const spousesOf = new Map();
    const siblingsOf = new Map();
    const grandparentsOf = new Map();
    const grandchildrenOf = new Map();
    const auntUnclesOf = new Map();
    const nieceNephewsOf = new Map();
    const cousinsOf = new Map();
    const relativesOf = new Map();

    const pMap = new Map();

    for (const p of persons) {
      pMap.set(p.id, p);
      parentsOf.set(p.id, []);
      childrenOf.set(p.id, []);
      spousesOf.set(p.id, []);
      siblingsOf.set(p.id, []);
      grandparentsOf.set(p.id, []);
      grandchildrenOf.set(p.id, []);
      auntUnclesOf.set(p.id, []);
      nieceNephewsOf.set(p.id, []);
      cousinsOf.set(p.id, []);
      relativesOf.set(p.id, []);
    }

    const finalRels = new Set();
    function addRel(p1Id, p2Id, typeString) {
      if (p1Id === p2Id) return;
      finalRels.add(`${p1Id}|${p2Id}|${typeString}`);
    }

    for (const r of storedRels) {
      if (r.type === 'parent') {
        childrenOf.get(r.person1_id)?.push(r.person2_id);
        parentsOf.get(r.person2_id)?.push(r.person1_id);
        addRel(r.person1_id, r.person2_id, 'Parent of');
        addRel(r.person2_id, r.person1_id, 'Child of');
      } else if (r.type === 'spouse') {
        spousesOf.get(r.person1_id)?.push(r.person2_id);
        spousesOf.get(r.person2_id)?.push(r.person1_id);
        addRel(r.person1_id, r.person2_id, 'Spouse of');
        addRel(r.person2_id, r.person1_id, 'Spouse of');
      } else if (r.type === 'sibling') {
        siblingsOf.get(r.person1_id)?.push(r.person2_id);
        siblingsOf.get(r.person2_id)?.push(r.person1_id);
        addRel(r.person1_id, r.person2_id, 'Sibling of');
        addRel(r.person2_id, r.person1_id, 'Sibling of');
      } else if (r.type === 'grandparent') {
        grandparentsOf.get(r.person2_id)?.push(r.person1_id);
        grandchildrenOf.get(r.person1_id)?.push(r.person2_id);
        addRel(r.person1_id, r.person2_id, 'Grandparent of');
        addRel(r.person2_id, r.person1_id, 'Grandchild of');
      } else if (r.type === 'grandchild') {
        grandchildrenOf.get(r.person2_id)?.push(r.person1_id);
        grandparentsOf.get(r.person1_id)?.push(r.person2_id);
        addRel(r.person1_id, r.person2_id, 'Grandchild of');
        addRel(r.person2_id, r.person1_id, 'Grandparent of');
      } else if (r.type === 'aunt_uncle') {
        auntUnclesOf.get(r.person2_id)?.push(r.person1_id);
        nieceNephewsOf.get(r.person1_id)?.push(r.person2_id);
        addRel(r.person1_id, r.person2_id, 'Aunt/Uncle of');
        addRel(r.person2_id, r.person1_id, 'Niece/Nephew of');
      } else if (r.type === 'niece_nephew') {
        nieceNephewsOf.get(r.person2_id)?.push(r.person1_id);
        auntUnclesOf.get(r.person1_id)?.push(r.person2_id);
        addRel(r.person1_id, r.person2_id, 'Niece/Nephew of');
        addRel(r.person2_id, r.person1_id, 'Aunt/Uncle of');
      } else if (r.type === 'cousin') {
        cousinsOf.get(r.person1_id)?.push(r.person2_id);
        cousinsOf.get(r.person2_id)?.push(r.person1_id);
        addRel(r.person1_id, r.person2_id, 'Cousin of');
        addRel(r.person2_id, r.person1_id, 'Cousin of');
      } else if (r.type === 'relative') {
        relativesOf.get(r.person1_id)?.push(r.person2_id);
        relativesOf.get(r.person2_id)?.push(r.person1_id);
        const label = r.label ? r.label : 'Other Relative';
        addRel(r.person1_id, r.person2_id, label);
        addRel(r.person2_id, r.person1_id, label);
      }
    }

    for (const p of persons) {
      const parents = parentsOf.get(p.id) || [];
      for (const parentId of parents) {
        const kids = childrenOf.get(parentId) || [];
        for (const kidId of kids) {
          if (kidId !== p.id && !(siblingsOf.get(p.id) || []).includes(kidId)) {
            siblingsOf.get(p.id).push(kidId);
            addRel(p.id, kidId, 'Sibling of');
          }
        }
      }
    }

    for (const p of persons) {
      const parents = parentsOf.get(p.id) || [];
      for (const parentId of parents) {
        const gparents = parentsOf.get(parentId) || [];
        for (const gpId of gparents) {
          if (!(grandparentsOf.get(p.id) || []).includes(gpId)) {
            grandparentsOf.get(p.id).push(gpId);
            addRel(p.id, gpId, 'Grandchild of');
            addRel(gpId, p.id, 'Grandparent of');
          }
        }
      }
    }

    for (const p of persons) {
      const children = childrenOf.get(p.id) || [];
      for (const childId of children) {
        const gchildren = childrenOf.get(childId) || [];
        for (const gcId of gchildren) {
          if (!(grandchildrenOf.get(p.id) || []).includes(gcId)) {
            grandchildrenOf.get(p.id).push(gcId);
            addRel(p.id, gcId, 'Grandparent of');
            addRel(gcId, p.id, 'Grandchild of');
          }
        }
      }
    }

    for (const p of persons) {
      const parents = parentsOf.get(p.id) || [];
      for (const parentId of parents) {
        const siblings = siblingsOf.get(parentId) || [];
        for (const sibId of siblings) {
          if (!(auntUnclesOf.get(p.id) || []).includes(sibId)) {
            auntUnclesOf.get(p.id).push(sibId);
            addRel(p.id, sibId, 'Niece/Nephew of');
            addRel(sibId, p.id, 'Aunt/Uncle of');
          }
        }
      }
    }

    for (const p of persons) {
      const siblings = siblingsOf.get(p.id) || [];
      for (const sibId of siblings) {
        const kids = childrenOf.get(sibId) || [];
        for (const kidId of kids) {
          if (!(nieceNephewsOf.get(p.id) || []).includes(kidId)) {
            nieceNephewsOf.get(p.id).push(kidId);
            addRel(p.id, kidId, 'Aunt/Uncle of');
            addRel(kidId, p.id, 'Niece/Nephew of');
          }
        }
      }
    }

    for (const p of persons) {
      const parents = parentsOf.get(p.id) || [];
      for (const parentId of parents) {
        const siblings = siblingsOf.get(parentId) || [];
        for (const sibId of siblings) {
          const kids = childrenOf.get(sibId) || [];
          for (const kidId of kids) {
            if (kidId !== p.id && !(cousinsOf.get(p.id) || []).includes(kidId)) {
              cousinsOf.get(p.id).push(kidId);
              addRel(p.id, kidId, 'Cousin of');
              addRel(kidId, p.id, 'Cousin of');
            }
          }
        }
      }
    }

    const workbook = new ExcelJS.Workbook();

    const sheet1 = workbook.addWorksheet('People');
    sheet1.columns = [
      { header: 'Family Name', key: 'family', width: 22 },
      { header: 'First Name', key: 'first', width: 18 },
      { header: 'Last Name', key: 'last', width: 18 },
      { header: 'Maiden Name', key: 'maiden', width: 18 },
      { header: 'Gender', key: 'gender', width: 12 },
      { header: 'Birth Date', key: 'birth_date', width: 15 },
      { header: 'Death Date', key: 'death_date', width: 15 },
      { header: 'Birth Place', key: 'birth_place', width: 25 },
      { header: 'Notes', key: 'notes', width: 40 }
    ];

    for (const p of persons) {
      sheet1.addRow({
        family: family_name,
        first: p.first_name,
        last: p.last_name,
        maiden: p.maiden_name,
        gender: p.gender,
        birth_date: p.birth_date,
        death_date: p.death_date,
        birth_place: p.birth_place,
        notes: p.notes
      });
    }
    sheet1.getRow(1).font = { bold: true };

    const sheet2 = workbook.addWorksheet('Relationships');
    sheet2.columns = [
      { header: 'Family Name', key: 'family', width: 22 },
      { header: 'Person', key: 'person', width: 25 },
      { header: 'Relationship', key: 'relationship', width: 20 },
      { header: 'Related To', key: 'related_to', width: 25 }
    ];

    for (const item of finalRels) {
      const parts = item.split('|');
      const p1Id = Number(parts[0]);
      const p2Id = Number(parts[1]);
      const typeStr = parts[2];
      const p1 = pMap.get(p1Id);
      const p2 = pMap.get(p2Id);

      if (p1 && p2) {
        const p1Name = [p1.first_name, p1.last_name].filter(Boolean).join(' ');
        const p2Name = [p2.first_name, p2.last_name].filter(Boolean).join(' ');
        sheet2.addRow({
          family: family_name,
          person: p1Name,
          relationship: typeStr,
          related_to: p2Name
        });
      }
    }
    sheet2.getRow(1).font = { bold: true };

    const safeFamilyName = family_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFamilyName}_family_tree.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

if (require.main === module) {
  Promise.all([db.ready, familyAccess.ready, platformAccess.ready])
    .then(() => {
      app.listen(PORT, () => {
        console.log('Family tree server running at http://localhost:' + PORT);
      });
    })
    .catch((error) => {
      console.error('Server startup failed:', error);
      process.exitCode = 1;
    });
}

module.exports = { app };
