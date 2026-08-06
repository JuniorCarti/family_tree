const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.DATABASE_SSL = 'false';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'memories-release-test-secret';
process.env.MEDIA_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-memory-test-'));
const unique = Date.now();
const ownerEmail = `memory-owner-${unique}@example.test`;
process.env.SUPERADMIN_EMAILS = ownerEmail;

const { app } = require('../server');
const db = require('../db');
const familyAccess = require('../family-access');
const platformAccess = require('../platform-access');
const archiveAccess = require('../archive-access');
const memoryAccess = require('../memory-access');

test('Release 9 memory workflows persist across reloads and generate QR pages', async (t) => {
  await Promise.all([db.ready, familyAccess.ready, platformAccess.ready, archiveAccess.ready, memoryAccess.ready]);
  t.after(async () => { await db.pool.end(); fs.rmSync(process.env.MEDIA_LOCAL_DIR, { recursive: true, force: true }); });
  const agent = request.agent(app);
  const password = 'correct-horse-battery-staple';
  const signup = await agent.post('/api/auth/signup').send({ email: ownerEmail, password, family_name: 'Memory Test Family' });
  assert.equal(signup.status, 201, signup.text);
  const person = await agent.post('/api/persons').send({ first_name: 'Memory', last_name: 'Keeper', birth_date: '1980-06-06' });
  assert.equal(person.status, 201, person.text);

  const created = await agent.post('/api/memories/items')
    .field('title', 'Family gathering')
    .field('memory_type', 'photo')
    .field('caption', 'Everyone together')
    .field('taken_date', '2001-06-06')
    .field('place', 'Kakamega')
    .field('photographer', 'Auntie')
    .field('person_ids', JSON.stringify([person.body.id]))
    .field('public_token', 'true')
    .attach('file', Buffer.from('fake-image'), { filename: 'gathering.png', contentType: 'image/png' });
  assert.equal(created.status, 201, created.text);
  const memoryId = created.body.item.id;
  const reloaded = await agent.get('/api/memories/items');
  assert.equal(reloaded.status, 200, reloaded.text);
  assert.equal(reloaded.body.items.some((item) => item.id === memoryId), true);
  assert.equal(reloaded.body.items.find((item) => item.id === memoryId).people[0].id, person.body.id);

  const album = await agent.post('/api/memories/albums').send({ title: 'Family gatherings', description: 'Together' });
  assert.equal(album.status, 201, album.text);
  assert.equal((await agent.get('/api/memories/albums')).body.albums.some((item) => item.id === album.body.album.id), true);
  const recipe = await agent.post('/api/memories/recipes').send({ title: 'Grandma stew', ingredients: 'Beans', instructions: 'Cook slowly' });
  assert.equal(recipe.status, 201, recipe.text);
  assert.equal((await agent.get('/api/memories/recipes')).body.recipes.some((item) => item.id === recipe.body.recipe.id), true);
  const memorial = await agent.post('/api/memories/memorials').send({ title: 'Remembering home', message: 'Always remembered' });
  assert.equal(memorial.status, 201, memorial.text);
  assert.equal((await agent.get('/api/memories/memorials')).body.memorials.some((item) => item.id === memorial.body.memorial.id), true);
  assert.equal((await agent.get('/api/memories/calendar')).body.calendar.some((item) => item.id === person.body.id), true);

  const qr = await agent.post(`/api/memories/items/${memoryId}/qr`);
  assert.equal(qr.status, 200, qr.headers['content-type']);
  assert.match(qr.headers['content-type'], /image\/png/);
  const token = (await db.query('SELECT public_token FROM memory_items WHERE id=$1', [memoryId])).rows[0].public_token;
  const publicPage = await request(app).get(`/memory/${token}`);
  assert.equal(publicPage.status, 200);
  const publicData = await request(app).get(`/api/public/memories/${token}`);
  assert.equal(publicData.status, 200, publicData.text);
  const publicMedia = await request(app).get(`/api/public/memories/${token}/media`);
  assert.equal(publicMedia.status, 200, publicMedia.text);
  assert.equal(publicMedia.headers['content-type'], 'image/png');
});
