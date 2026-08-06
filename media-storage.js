const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const db = require('./db');
const privacyAccess = require('./privacy-access');
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
        original_name TEXT,
        purpose VARCHAR(40) NOT NULL DEFAULT 'profile',
        created_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await db.query("ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS original_name TEXT");
  await db.query("ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS purpose VARCHAR(40) NOT NULL DEFAULT 'profile'");
  await db.query('CREATE INDEX IF NOT EXISTS idx_media_family ON media_assets(family_id, created_at DESC)');
}
const ready = initializeMedia();

async function save(req, file, options = {}) {
  await ready;
  const id = crypto.randomUUID();
  const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/tiff': '.tiff', 'application/pdf': '.pdf', 'text/plain': '.txt', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' }[file.mimetype] || '';
  const objectName = `families/${req.family.id}/${id}${extension}`;
  const cloudFile = storage ? storage.bucket(bucketName).file(objectName) : null;
  const localPath = path.join(localDir, `${id}${extension}`);
  try {
    if (cloudFile) {
      await cloudFile.save(file.buffer, { contentType: file.mimetype, resumable: false, metadata: { cacheControl: 'private, max-age=86400' } });
    } else {
      fs.writeFileSync(localPath, file.buffer);
    }
    await db.query('INSERT INTO media_assets (id, family_id, uploaded_by, object_name, mime_type, size_bytes, original_name, purpose) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, req.family.id, req.session.userId, objectName, file.mimetype, file.size, options.originalName || file.originalname || null, options.purpose || 'profile']);
  } catch (error) {
    if (cloudFile) await cloudFile.delete({ ignoreNotFound: true }).catch(() => {});
    else fs.rmSync(localPath, { force: true });
    throw error;
  }
  return { id, url: `/api/media/${id}` };
}

async function stream(req, res) {
  await Promise.all([ready, privacyAccess.ready]);
  const result = await db.query('SELECT * FROM media_assets WHERE id = $1 AND family_id = $2', [req.params.id, req.family.id]);
  const asset = result.rows[0];
  if (!asset) return res.status(404).json({ error: 'Media not found' });
  const attached = await db.query(
    'SELECT * FROM persons WHERE family_id = $1 AND photo_url = $2 AND deleted_at IS NULL LIMIT 1',
    [req.family.id, `/api/media/${asset.id}`]
  );
  const person = attached.rows[0];
  if (person) {
    const visible = privacyAccess.serializePerson(person, req.session.userId, req.family.role);
    if (!visible || visible.privacy_redacted) return res.status(404).json({ error: 'Media not found' });
  } else if (asset.purpose === 'evidence') {
    const citation = await db.query('SELECT citation_id FROM evidence_media WHERE media_id = $1 LIMIT 1', [asset.id]);
    if (!citation.rows[0]) return res.status(404).json({ error: 'Media not found' });
    const evidenceAccess = require('./evidence-access');
    const allowed = await evidenceAccess.subjectVisibleForCitation(citation.rows[0].citation_id, req);
    if (!allowed) return res.status(404).json({ error: 'Media not found' });
  } else if (asset.purpose === 'memory') {
    const memory = await db.query('SELECT visibility, created_by_user_id FROM memory_items WHERE media_id = $1 AND family_id = $2 AND deleted_at IS NULL LIMIT 1', [asset.id, req.family.id]);
    if (!memory.rows[0] || (memory.rows[0].visibility === 'private' && Number(memory.rows[0].created_by_user_id) !== Number(req.session.userId) && !['admin', 'owner'].includes(req.family.role))) return res.status(404).json({ error: 'Media not found' });
    if (memory.rows[0].visibility === 'admins' && !['admin', 'owner'].includes(req.family.role) && Number(memory.rows[0].created_by_user_id) !== Number(req.session.userId)) return res.status(404).json({ error: 'Media not found' });
    if (memory.rows[0].visibility === 'contributors' && !['contributor', 'admin', 'owner'].includes(req.family.role) && Number(memory.rows[0].created_by_user_id) !== Number(req.session.userId)) return res.status(404).json({ error: 'Media not found' });
  } else if (Number(asset.uploaded_by) !== Number(req.session.userId)
      && !['admin', 'owner'].includes(req.family.role)) {
    return res.status(404).json({ error: 'Media not found' });
  }
  res.type(asset.mime_type).set('Cache-Control', 'private, max-age=86400');
  if (storage) return storage.bucket(bucketName).file(asset.object_name).createReadStream().on('error', () => res.destroy()).pipe(res);
  const extension = path.extname(asset.object_name);
  return fs.createReadStream(path.join(localDir, `${asset.id}${extension}`)).on('error', () => res.sendStatus(404)).pipe(res);
}

async function readAsset(asset) {
  await ready;
  if (storage) {
    const [buffer] = await storage.bucket(bucketName).file(asset.object_name).download();
    return buffer;
  }
  return fs.promises.readFile(path.join(localDir, `${asset.id}${path.extname(asset.object_name)}`));
}

module.exports = { ready, upload, save, stream, readAsset, durable: Boolean(storage) };
