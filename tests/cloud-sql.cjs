// Optional SQL integration test: install @electric-sql/pglite outside the checkout,
// then pass its module path as argv[2], or use a normal local installation.
const {PGlite}=require(process.argv[2]||'@electric-sql/pglite');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
const sql=fs.readFileSync(path.join(__dirname,'../supabase/setup.sql'),'utf8');await db.exec(sql);await db.exec(sql);
await db.exec(`set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'`);
assert.equal((await db.query(`select revision from public.save_travel_document(0,'{"packing":[]}'::jsonb)`)).rows[0].revision,1);
assert.equal((await db.query(`select revision from public.save_travel_document(1,'{"packing":[1]}'::jsonb)`)).rows[0].revision,2);
await assert.rejects(db.query(`select * from public.save_travel_document(1,'{}'::jsonb)`),e=>e.code==='40001');
await assert.rejects(db.query(`select * from public.save_travel_document(0,'{}'::jsonb)`),e=>e.code==='40001');
await db.exec(`set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'`);
assert.equal((await db.query('select * from public.travel_documents')).rows.length,0);
assert.equal((await db.query(`select revision from public.save_travel_document(0,'{}'::jsonb)`)).rows[0].revision,1);
await assert.rejects(db.query(`insert into public.travel_documents(user_id,data) values('00000000-0000-0000-0000-000000000001','{}')`));
await db.exec('set role anon');await assert.rejects(db.query('select * from public.travel_documents'));await assert.rejects(db.query(`select * from public.save_travel_document(0,'{}'::jsonb)`));
await db.exec('reset role');assert.equal((await db.query('select * from public.travel_documents')).rows.length,2);await db.close();
console.log('PASS: SQL repeatability, per-account RLS, anonymous access denied, revision increments, stale write/insert rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});
