const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const db = require('./db');
const trustAccess = require('./trust-access');

const bucketName = process.env.MEDIA_BUCKET || '';
const storage = bucketName ? new Storage() : null;
const localDir = process.env.MEDIA_LOCAL_DIR || path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(localDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype))
});

async function initializeMedia() {
  await Promise.all([db.ready, trustAccess.ready]);
  await db.query(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id UUID PRIMARY KEY,
      family_id INTEGER NOT NULL,
      uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      object_name TEXT NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_media_family ON media_assets(family_id, created_at DESC)');
}
const ready = initializeMedia();

async function save(req, file) {
  await ready;
  const id = crypto.randomUUID();
  const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype];
  const objectName = `families/${req.family.id}/${id}${extension}`;
  const cloudFile = storage ? storage.bucket(bucketName).file(objectName) : null;
  const localPath = path.join(localDir, `${id}${extension}`);
  try {
    if (cloudFile) {
      await cloudFile.save(file.buffer, { contentType: file.mimetype, resumable: false, metadata: { cacheControl: 'private, max-age=86400' } });
    } else {
      fs.writeFileSync(localPath, file.buffer);
    }
    await db.query('INSERT INTO media_assets (id, family_id, uploaded_by, object_name, mime_type, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)', [id, req.family.id, req.session.userId, objectName, file.mimetype, file.size]);
  } catch (error) {
    if (cloudFile) await cloudFile.delete({ ignoreNotFound: true }).catch(() => {});
    else fs.rmSync(localPath, { force: true });
    throw error;
  }
  return { id, url: `/api/media/${id}` };
}

async function stream(req, res) {
  await ready;
  const result = await db.query('SELECT * FROM media_assets WHERE id = $1 AND family_id = $2', [req.params.id, req.family.id]);
  const asset = result.rows[0];
  if (!asset) return res.status(404).json({ error: 'Media not found' });
  res.type(asset.mime_type).set('Cache-Control', 'private, max-age=86400');
  if (storage) return storage.bucket(bucketName).file(asset.object_name).createReadStream().on('error', () => res.destroy()).pipe(res);
  const extension = path.extname(asset.object_name);
  return fs.createReadStream(path.join(localDir, `${asset.id}${extension}`)).on('error', () => res.sendStatus(404)).pipe(res);
}

module.exports = { ready, upload, save, stream, durable: Boolean(storage) };
