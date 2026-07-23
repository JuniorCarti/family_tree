require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
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

app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getPerson(id, userId) {
  const result = await db.query('SELECT * FROM persons WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Auth Routes
// ---------------------------------------------------------------------------
app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  try {
    const r = await db.query('SELECT id, email, family_name FROM users WHERE id = $1', [req.session.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, family_name } = req.body;

  if (!email || !password || !family_name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (email, password_hash, family_name) VALUES ($1, $2, $3) RETURNING id, email, family_name',
      [email, hash, family_name]
    );
    const user = result.rows[0];
    req.session.userId = user.id;
    res.status(201).json(user);
  } catch (err) {
    if (String(err).includes('unique constraint') || String(err).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create user' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    res.json({ id: user.id, email: user.email, family_name: user.family_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Middleware to protect API routes
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use('/api/persons', requireAuth);
app.use('/api/relationships', requireAuth);
app.use('/api/tree', requireAuth);

// ---------------------------------------------------------------------------
// Persons CRUD
// ---------------------------------------------------------------------------
app.get('/api/persons', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM persons WHERE user_id = $1 ORDER BY last_name, first_name', [req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/persons/:id', async (req, res) => {
  try {
    const person = await getPerson(req.params.id, req.session.userId);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    res.json(person);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/persons', async (req, res) => {
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
      INSERT INTO persons (first_name, last_name, maiden_name, gender, birth_date, death_date, birth_place, photo_url, notes, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [first_name, last_name, maiden_name, gender, birth_date, death_date, birth_place, photo_url, notes, req.session.userId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/persons/:id', async (req, res) => {
  try {
    const existing = await getPerson(req.params.id, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Person not found' });

    const merged = { ...existing, ...req.body };
    const result = await db.query(`
      UPDATE persons SET
        first_name = $1, last_name = $2, maiden_name = $3,
        gender = $4, birth_date = $5, death_date = $6,
        birth_place = $7, photo_url = $8, notes = $9,
        updated_at = now()
      WHERE id = $10 AND user_id = $11
      RETURNING *
    `, [
      merged.first_name, merged.last_name, merged.maiden_name,
      merged.gender, merged.birth_date, merged.death_date,
      merged.birth_place, merged.photo_url, merged.notes,
      existing.id, req.session.userId
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/persons/:id', async (req, res) => {
  try {
    const existing = await getPerson(req.params.id, req.session.userId);
    if (!existing) return res.status(404).json({ error: 'Person not found' });

    await db.query('DELETE FROM persons WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
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
    const result = await db.query('SELECT * FROM relationships WHERE user_id = $1', [req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/relationships', async (req, res) => {
  const { type, person1_id, person2_id, label = null, status = 'married', start_date = null, end_date = null } = req.body;

  const validTypes = ['parent', 'spouse', 'relative', 'sibling', 'grandparent', 'grandchild', 'aunt_uncle', 'niece_nephew', 'cousin'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }
  if (!person1_id || !person2_id || person1_id === person2_id) {
    return res.status(400).json({ error: 'person1_id and person2_id are required and must differ' });
  }

  try {
    const p1 = await getPerson(person1_id, req.session.userId);
    const p2 = await getPerson(person2_id, req.session.userId);
    if (!p1 || !p2) {
      return res.status(404).json({ error: 'One or both persons not found' });
    }

    const result = await db.query(`
      INSERT INTO relationships (type, person1_id, person2_id, label, status, start_date, end_date, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [type, person1_id, person2_id, label, status, start_date, end_date, req.session.userId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (String(err).includes('unique constraint') || String(err).includes('UNIQUE')) {
      return res.status(409).json({ error: 'This relationship already exists' });
    }
    res.status(500).json({ error: 'Could not create relationship' });
  }
});

app.delete('/api/relationships/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM relationships WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
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
      WHERE user_id = $1
      GROUP BY lower(first_name), lower(last_name)
      HAVING count(*) > 1
    `, [req.session.userId]);

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

app.post('/api/merge', async (req, res) => {
  const { keepId, mergeIds } = req.body;
  if (!keepId || !mergeIds || !Array.isArray(mergeIds) || mergeIds.length === 0) {
    return res.status(400).json({ error: 'Missing keepId or mergeIds' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Check ownership
    const checkUser = await client.query('SELECT id FROM persons WHERE id = ANY($1) AND user_id = $2', [[keepId, ...mergeIds], req.session.userId]);
    if (checkUser.rows.length !== mergeIds.length + 1) {
      throw new Error('Not all persons found or owned by user');
    }

    // Update person1_id where it's safe (no conflict, no self-referencing)
    await client.query(`
      UPDATE relationships r1
      SET person1_id = $1
      WHERE person1_id = ANY($2) AND user_id = $3
        AND r1.person2_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM relationships r2
          WHERE r2.type = r1.type 
            AND r2.person1_id = $1 
            AND r2.person2_id = r1.person2_id
            AND r2.user_id = $3
        )
    `, [keepId, mergeIds, req.session.userId]);

    // Update person2_id where it's safe
    await client.query(`
      UPDATE relationships r1
      SET person2_id = $1
      WHERE person2_id = ANY($2) AND user_id = $3
        AND r1.person1_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM relationships r2
          WHERE r2.type = r1.type 
            AND r2.person1_id = r1.person1_id 
            AND r2.person2_id = $1
            AND r2.user_id = $3
        )
    `, [keepId, mergeIds, req.session.userId]);

    // Delete any relations left pointing to mergeIds (which means they would have conflicted)
    await client.query(`
      DELETE FROM relationships 
      WHERE (person1_id = ANY($1) OR person2_id = ANY($1)) AND user_id = $2
    `, [mergeIds, req.session.userId]);

    // Finally delete the persons
    await client.query(`
      DELETE FROM persons
      WHERE id = ANY($1) AND user_id = $2
    `, [mergeIds, req.session.userId]);

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
    // Instead of a trees table, we simulate it via the user info
    const userResult = await db.query('SELECT family_name FROM users WHERE id = $1', [req.session.userId]);
    const family_name = userResult.rows[0] ? userResult.rows[0].family_name : 'My Family Tree';

    const pResult = await db.query('SELECT * FROM persons WHERE user_id = $1', [req.session.userId]);
    const rResult = await db.query('SELECT * FROM relationships WHERE user_id = $1', [req.session.userId]);

    res.json({
      tree: { name: family_name },
      persons: pResult.rows,
      relationships: rResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tree', async (req, res) => {
  const { name } = req.body; // Using name to update user's family_name
  try {
    if (name) {
      await db.query('UPDATE users SET family_name = $1 WHERE id = $2', [name, req.session.userId]);
    }
    const userResult = await db.query('SELECT family_name FROM users WHERE id = $1', [req.session.userId]);
    res.json({ name: userResult.rows[0].family_name });
  } catch (err) {
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

app.listen(PORT, () => {
  console.log('Family tree server running at http://localhost:' + PORT);
});
