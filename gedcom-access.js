const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const db = require('./db');
const familyAccess = require('./family-access');
const mediaStorage = require('./media-storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function initializeGedcom() {
  await Promise.all([db.ready, familyAccess.ready]);
  await db.query(`CREATE TABLE IF NOT EXISTS gedcom_import_sessions (
    id UUID PRIMARY KEY, family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL, filename TEXT NOT NULL,
    parsed JSONB NOT NULL, warnings JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMP NOT NULL DEFAULT now(), expires_at TIMESTAMP NOT NULL DEFAULT now() + interval '1 hour'
  )`);
}
const ready = initializeGedcom();

function lines(buffer) { return buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean); }
function parse(buffer) {
  const records = { people: [], families: [], sources: [], repositories: [], objects: [], notes: [] }, stack=[];
  let current=null, context=null;
  for (const raw of lines(buffer)) {
    const m=raw.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?([^ ]+)(?:\s+(.*))?$/); if(!m)continue;
    const level=Number(m[1]), xref=m[2], tag=m[3], value=m[4]||'';
    if(level===0){ if(tag==='INDI'){current={xref,fields:{},events:[]};records.people.push(current);} else if(tag==='FAM'){current={xref,fields:{},children:[]};records.families.push(current);} else if(tag==='SOUR'){current={xref,fields:{}};records.sources.push(current);} else if(tag==='REPO'){current={xref,fields:{}};records.repositories.push(current);} else if(tag==='OBJE'){current={xref,fields:{}};records.objects.push(current);} else if(tag==='NOTE'){current={xref,fields:{text:value}};records.notes.push(current);} else current=null; context=null; stack.length=1; continue; }
    if(!current)continue; stack[level]=tag; stack.length=level+1;
    if(tag==='CONC') { const parent=stack[level-1]; current.fields[parent]=(current.fields[parent]||'')+value; continue; }
    if(tag==='CONT') { const parent=stack[level-1]; current.fields[parent]=(current.fields[parent]||'')+'\n'+value; continue; }
    if(level===1 && ['NAME','SEX','NOTE','FAMC','FAMS','HUSB','WIFE','CHIL','TITL','AUTH','PUBL','REPO','FILE','FORM','RIN'].includes(tag)) current.fields[tag]=(current.fields[tag]||[]).concat(value);
    else if(level===1 && ['BIRT','DEAT','MARR'].includes(tag)){ context={tag,fields:{}}; current.events.push(context); }
    else if(level===2 && context) context.fields[tag]=value;
  }
  return records;
}
function val(v){return Array.isArray(v)?v[0]:v||'';}
function clean(s){return String(s||'').replace(/\r?\n/g,' ').trim();}
function gedDate(v){return clean(v);}
function personName(p){const n=val(p.fields.NAME)||'Unknown /';const parts=n.replace(/\//g,'').trim().split(/\s+/);return {first:parts.shift()||'Unknown',last:parts.join(' ')||''};}
function normalize(v){return clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');}
async function familyData(req){const [p,r,s,c,m]=await Promise.all([db.query('SELECT * FROM persons WHERE family_id=$1 AND deleted_at IS NULL ORDER BY id',[req.family.id]),db.query('SELECT * FROM relationships WHERE family_id=$1',[req.family.id]),db.query('SELECT * FROM research_sources WHERE family_id=$1 AND deleted_at IS NULL',[req.family.id]),db.query('SELECT c.*,s.title source_title FROM source_citations c JOIN research_sources s ON s.id=c.source_id WHERE c.family_id=$1 AND c.deleted_at IS NULL',[req.family.id]),db.query('SELECT m.*,em.citation_id FROM media_assets m JOIN evidence_media em ON em.media_id=m.id WHERE m.family_id=$1 AND m.purpose=\'evidence\'',[req.family.id])]);return {people:p.rows,relationships:r.rows,sources:s.rows,citations:c.rows,media:m.rows};}
function exportGedcom(data){const out=['0 HEAD','1 GEDC','2 VERS 7.0','1 CHAR UTF-8','1 SOUR LINEAGE'];for(const p of data.people){out.push(`0 @I${p.id}@ INDI`,`1 NAME ${clean(p.first_name)} /${clean(p.last_name)}/`);if(p.gender&&p.gender!=='unknown')out.push(`1 SEX ${p.gender==='male'?'M':p.gender==='female'?'F':'U'}`);if(p.birth_date||p.birth_place)out.push('1 BIRT',...(p.birth_date?[`2 DATE ${gedDate(p.birth_date)}`]:[]),...(p.birth_place?[`2 PLAC ${clean(p.birth_place)}`]:[]));if(p.death_date)out.push('1 DEAT',`2 DATE ${gedDate(p.death_date)}`);if(p.notes)out.push(`1 NOTE ${clean(p.notes)}`);}
  for(const r of data.relationships){if(r.type==='parent')out.push(`0 @F${r.id}@ FAM`,`1 CHIL @I${r.person2_id}@`,`1 NOTE Parent relationship: @I${r.person1_id}@`);else if(r.type==='spouse')out.push(`0 @F${r.id}@ FAM`,`1 HUSB @I${r.person1_id}@`,`1 WIFE @I${r.person2_id}@`);}
  for(const s of data.sources){out.push(`0 @S${s.id}@ SOUR`,`1 TITL ${clean(s.title)}`,...(s.author?[`1 AUTH ${clean(s.author)}`]:[]),...(s.repository?[`1 REPO ${clean(s.repository)}`]:[]),...(s.description?[`1 NOTE ${clean(s.description)}`]:[]));for(const c of data.citations.filter(x=>x.source_id===s.id)){out.push(`1 NOTE [${c.confidence}] ${clean(c.subject_type)} ${c.subject_id}: ${clean(c.fact_key)} = ${clean(c.claim_value)}`,...(c.page?[`2 CONT Page: ${clean(c.page)}`]:[]),...(c.record_identifier?[`2 CONT Record: ${clean(c.record_identifier)}`]:[]),...(c.research_note?[`2 CONT Research: ${clean(c.research_note)}`]:[]));}}
  out.push('0 TRLR');return out.join('\r\n')+'\r\n';}
function registerRoutes(app,middleware){const {requireAuth,requireApproved,requireFamily,requireRole}=middleware;app.use('/api/gedcom',requireAuth,requireApproved,requireFamily,router);
  router.get('/export',async(req,res,next)=>{try{await ready;const data=await familyData(req);const ged=exportGedcom(data);if(String(req.query.format||'').toLowerCase()==='gedzip'){const zip=new AdmZip();zip.addFile('lineage-family.ged',Buffer.from(ged,'utf8'));for(const asset of data.media){try{zip.addFile(`media/${asset.original_name||asset.id}`,await mediaStorage.readAsset(asset));}catch(error){/* keep the GEDZip usable if a remote attachment is unavailable */}}zip.addFile('README.txt',Buffer.from('GEDZip exported by Lineage. Evidence attachments are stored under media/.\n','utf8'));res.type('application/zip').set('Content-Disposition','attachment; filename="lineage-family.ged.zip"').send(zip.toBuffer());}else res.type('text/plain').set('Content-Disposition','attachment; filename="lineage-family.ged"').send(ged);}catch(e){next(e);}});
  router.post('/preview',requireRole('contributor'),upload.single('file'),async(req,res,next)=>{try{await ready;if(!req.file)return res.status(400).json({error:'Choose a GEDCOM or GEDZip file'});let buffer=req.file.buffer,media=[];if(req.file.originalname.toLowerCase().endsWith('.zip')){const zip=new AdmZip(buffer),entry=zip.getEntries().find(e=>e.entryName.toLowerCase().endsWith('.ged'));if(!entry)return res.status(400).json({error:'GEDZip does not contain a .ged file'});buffer=entry.getData();media=zip.getEntries().filter(e=>!e.isDirectory&&!e.entryName.toLowerCase().endsWith('.ged')).map(e=>e.entryName);}const parsed=parse(buffer),existing=(await db.query('SELECT id,first_name,last_name,birth_date FROM persons WHERE family_id=$1 AND deleted_at IS NULL',[req.family.id])).rows;const duplicates=[];for(const p of parsed.people){const n=personName(p),match=existing.find(x=>normalize(x.first_name)===normalize(n.first)&&normalize(x.last_name)===normalize(n.last)&&(!val(p.events.find(e=>e.tag==='BIRT')?.fields.DATE)||String(x.birth_date||'').slice(0,4)===String(val(p.events.find(e=>e.tag==='BIRT')?.fields.DATE)).slice(-4)));if(match)duplicates.push({gedcom_name:n.first+' '+n.last,existing:match});}const id=crypto.randomUUID();await db.query('INSERT INTO gedcom_import_sessions(id,family_id,uploaded_by,filename,parsed,warnings) VALUES($1,$2,$3,$4,$5,$6)',[id,req.family.id,req.session.userId,req.file.originalname,JSON.stringify(parsed),JSON.stringify(media.length?[`GEDZip media found: ${media.length}; media records are listed for review and can be attached after import.`]:[])]);res.json({preview_id:id,filename:req.file.originalname,summary:{people:parsed.people.length,families:parsed.families.length,sources:parsed.sources.length,media:media.length},duplicates,warnings:media.length?[`GEDZip media found: ${media.length}; import preserves the GEDCOM records first.`]:[]});}catch(e){next(e);}});
  router.post('/import/:id',requireRole('contributor'),async(req,res,next)=>{const client=await db.pool.connect();try{await ready;const session=(await client.query('SELECT * FROM gedcom_import_sessions WHERE id=$1 AND family_id=$2 AND expires_at>now()',[req.params.id,req.family.id])).rows[0];if(!session)return res.status(404).json({error:'Import preview expired'});const parsed=session.parsed,created=new Map();await client.query('BEGIN');for(const p of parsed.people){const n=personName(p),birth=val(p.events.find(e=>e.tag==='BIRT')?.fields.DATE),place=val(p.events.find(e=>e.tag==='BIRT')?.fields.PLAC),death=val(p.events.find(e=>e.tag==='DEAT')?.fields.DATE);const r=await client.query('INSERT INTO persons(first_name,last_name,gender,birth_date,death_date,birth_place,notes,user_id,family_id,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$8) RETURNING id',[n.first,n.last, val(p.fields.SEX)==='M'?'male':val(p.fields.SEX)==='F'?'female':'unknown',birth||null,death||null,place||null,clean(val(p.fields.NOTE))||null,req.session.userId,req.family.id]);created.set(p.xref,r.rows[0].id);}for(const f of parsed.families){const husband=created.get(val(f.fields.HUSB)),wife=created.get(val(f.fields.WIFE));for(const child of (f.fields.CHIL||[])){const cid=created.get(child);if(cid&&husband)await client.query("INSERT INTO relationships(type,person1_id,person2_id,user_id,family_id,created_by_user_id) VALUES('parent',$1,$2,$3,$4,$3) ON CONFLICT DO NOTHING",[husband,cid,req.session.userId,req.family.id]);if(cid&&wife)await client.query("INSERT INTO relationships(type,person1_id,person2_id,user_id,family_id,created_by_user_id) VALUES('parent',$1,$2,$3,$4,$3) ON CONFLICT DO NOTHING",[wife,cid,req.session.userId,req.family.id]);}}await client.query('DELETE FROM gedcom_import_sessions WHERE id=$1',[req.params.id]);await client.query('COMMIT');res.json({success:true,imported_people:created.size});}catch(e){await client.query('ROLLBACK').catch(()=>{});next(e);}finally{client.release();}});
}
module.exports={ready,registerRoutes,parse,exportGedcom};
