const express = require('express');
const db = require('./db');
const familyAccess = require('./family-access');
const privacyAccess = require('./privacy-access');

const router = express.Router();
const EAST_AFRICA = [
  { code: 'KE', name: 'Kenya', dial: '+254' }, { code: 'UG', name: 'Uganda', dial: '+256' },
  { code: 'TZ', name: 'Tanzania', dial: '+255' }, { code: 'RW', name: 'Rwanda', dial: '+250' },
  { code: 'BI', name: 'Burundi', dial: '+257' }, { code: 'SS', name: 'South Sudan', dial: '+211' },
  { code: 'ET', name: 'Ethiopia', dial: '+251' }, { code: 'SO', name: 'Somalia', dial: '+252' },
  { code: 'DJ', name: 'Djibouti', dial: '+253' }, { code: 'ER', name: 'Eritrea', dial: '+291' }
];
const LANGUAGES = [{ code: 'en', name: 'English' }, { code: 'sw', name: 'Kiswahili' }];
const value = (v, max = 120) => String(v ?? '').trim().slice(0, max) || null;
const year = (v) => Number(String(v || '').match(/\d{4}/)?.[0]) || null;
function fail(status, message) { return Object.assign(new Error(message), { status }); }
function role(req, min) { return (privacyAccess.ROLE_LEVEL[req.family.role] || 0) >= privacyAccess.ROLE_LEVEL[min]; }

async function initialize() {
  await Promise.all([db.ready, familyAccess.ready, privacyAccess.ready]);
  await db.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS nickname VARCHAR(255)');
  await db.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS occupation VARCHAR(255)');
  await db.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS clan VARCHAR(255)');
  await db.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS country_code CHAR(2)');
  await db.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS county VARCHAR(255)');
  await db.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS constituency VARCHAR(255)');
  await db.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS residence_place VARCHAR(255)');
  await db.query(`CREATE TABLE IF NOT EXISTS family_localization_settings (
    family_id INTEGER PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
    language_code VARCHAR(8) NOT NULL DEFAULT 'en', country_code CHAR(2) NOT NULL DEFAULT 'KE',
    low_bandwidth BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMP NOT NULL DEFAULT now()
  )`);
}
const ready = initialize();

function visiblePerson(person, req) { return privacyAccess.serializePerson(person, req.session.userId, req.family.role); }
function searchScore(person, q) {
  if (!q) return 0;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [person.first_name, person.last_name, person.nickname, person.clan, person.occupation, person.birth_place, person.residence_place, person.county, person.country_code].join(' ').toLowerCase();
  return terms.reduce((score, term) => score + (hay.includes(term) ? 4 : [...hay].some((_, i) => hay.slice(i, i + term.length + 1).includes(term) ? 1 : 0)), 0);
}
function ancestorDepths(start, people, relationships) {
  const map = new Map(), queue = [[Number(start), 0]];
  while (queue.length) { const [id, depth] = queue.shift(); if (map.has(id) && map.get(id) <= depth) continue; map.set(id, depth); relationships.filter(r => r.type === 'parent' && Number(r.person2_id) === id).forEach(r => queue.push([Number(r.person1_id), depth + 1])); }
  return map;
}
function kinship(aId, bId, relationships, people) {
  if (Number(aId) === Number(bId)) return { label: 'Self', common_ancestors: [] };
  const byId = new Map(people.map(p => [Number(p.id), p]));
  const aAnc = ancestorDepths(aId, people, relationships), bAnc = ancestorDepths(bId, people, relationships);
  const common = [...aAnc.keys()].filter(id => bAnc.has(id)).sort((x, y) => (aAnc.get(x) + bAnc.get(x)) - (aAnc.get(y) + bAnc.get(y)));
  if (!common.length) return { label: 'Related, common ancestor not recorded', common_ancestors: [] };
  const ancestor = common[0], da = aAnc.get(ancestor), dbb = bAnc.get(ancestor);
  if (da === 1 && dbb === 1) return { label: 'Sibling', common_ancestors: [byId.get(ancestor)] };
  if (da === 0) return { label: dbb === 1 ? 'Parent' : `${dbb - 1}� great-grandparent`, common_ancestors: [byId.get(ancestor)] };
  if (dbb === 0) return { label: da === 1 ? 'Child' : `${da - 1}� great-grandchild`, common_ancestors: [byId.get(ancestor)] };
  const cousin = Math.max(1, Math.min(da, dbb) - 1), removed = Math.abs(da - dbb);
  return { label: `${cousin === 1 ? 'First' : cousin === 2 ? 'Second' : cousin === 3 ? 'Third' : `${cousin}th`} cousin${removed ? ` ${removed}� removed` : ''}`, common_ancestors: [byId.get(ancestor)] };
}

function registerRoutes(app, middleware) {
  const { requireAuth, requireApproved, requireFamily } = middleware;
  app.use('/api/discovery', requireAuth, requireApproved, requireFamily, router);
  router.get('/search', async (req, res, next) => { try {
    await ready; const q = value(req.query.q, 120) || ''; const params = [req.family.id]; const clauses = ['family_id=$1','deleted_at IS NULL'];
    if (req.query.living) { params.push(req.query.living); clauses.push(`life_status=$${params.length}`); }
    if (req.query.country) { params.push(value(req.query.country, 2)); clauses.push(`country_code=$${params.length}`); }
    if (req.query.generation) { const g = Number(req.query.generation); if (Number.isInteger(g)) { params.push(g); clauses.push(`birth_date IS NOT NULL AND (EXTRACT(YEAR FROM birth_date::date)::int % 100) >= 0`); } }
    const result = await db.query(`SELECT * FROM persons WHERE ${clauses.join(' AND ')} ORDER BY last_name, first_name, id LIMIT 500`, params);
    const people = result.rows.map(p => ({ ...visiblePerson(p, req), search_score: searchScore(p, q) })).filter(Boolean).filter(p => !q || p.search_score > 0).sort((a, b) => b.search_score - a.search_score || String(a.last_name).localeCompare(String(b.last_name)));
    res.json({ people, total: people.length, countries: EAST_AFRICA });
  } catch (e) { next(e); } });
  router.get('/relationship', async (req, res, next) => { try {
    const a = Number(req.query.person_a), b = Number(req.query.person_b); if (!a || !b) throw fail(400, 'Two people are required');
    const [people, relationships] = await Promise.all([db.query('SELECT * FROM persons WHERE family_id=$1 AND deleted_at IS NULL',[req.family.id]), db.query('SELECT * FROM relationships WHERE family_id=$1',[req.family.id])]);
    const result = kinship(a, b, relationships.rows, people.rows); res.json(result);
  } catch (e) { next(e); } });
  router.get('/stats', async (req, res, next) => { try { const [p, places, occupations] = await Promise.all([
    db.query('SELECT count(*)::int total, count(*) FILTER (WHERE life_status=\'living\')::int living, count(*) FILTER (WHERE birth_date IS NULL)::int missing_dates FROM persons WHERE family_id=$1 AND deleted_at IS NULL',[req.family.id]),
    db.query('SELECT COALESCE(NULLIF(country_code,\'\'),\'\') label,count(*)::int count FROM persons WHERE family_id=$1 AND deleted_at IS NULL GROUP BY 1 ORDER BY count DESC LIMIT 10',[req.family.id]),
    db.query('SELECT COALESCE(NULLIF(occupation,\'\'),\'Not recorded\') label,count(*)::int count FROM persons WHERE family_id=$1 AND deleted_at IS NULL GROUP BY 1 ORDER BY count DESC LIMIT 10',[req.family.id])
  ]); res.json({summary:p.rows[0], places:places.rows, occupations:occupations.rows}); } catch(e){next(e);} });
  router.get('/localization', async (req,res,next)=>{try{const r=await db.query('SELECT * FROM family_localization_settings WHERE family_id=$1',[req.family.id]);res.json({settings:r.rows[0]||{family_id:req.family.id,language_code:'en',country_code:'KE',low_bandwidth:false},countries:EAST_AFRICA,languages:LANGUAGES});}catch(e){next(e);}});
  router.put('/localization', async (req,res,next)=>{try{if(!role(req,'admin'))throw fail(403,'Administrator access required');const language=LANGUAGES.some(x=>x.code===req.body.language_code)?req.body.language_code:'en';const country=EAST_AFRICA.some(x=>x.code===req.body.country_code)?req.body.country_code:'KE';const r=await db.query('INSERT INTO family_localization_settings(family_id,language_code,country_code,low_bandwidth,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(family_id) DO UPDATE SET language_code=EXCLUDED.language_code,country_code=EXCLUDED.country_code,low_bandwidth=EXCLUDED.low_bandwidth,updated_at=now() RETURNING *',[req.family.id,language,country,Boolean(req.body.low_bandwidth)]);res.json({settings:r.rows[0]});}catch(e){next(e);}});
}
module.exports = { ready, registerRoutes, EAST_AFRICA, LANGUAGES, kinship };
