// Browser integration against a deterministic Supabase HTTP test double.
// Start python3 -m http.server 8000, then run this with Playwright installed.
const {chromium}=require('playwright');const assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let n=0;n<160;n++){if(await check())return;await sleep(50);}throw Error('Timed out waiting for synchronization');}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  let remote=null;const errors=[];
  const serve=async route=>{
    const request=route.request(),url=new URL(request.url());let body=null;try{body=request.postDataJSON();}catch{}
    const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if(url.pathname==='/auth/v1/token')return reply({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:{id:'shared-account',email:'shared@example.com'}});
    assert.equal(request.headers().authorization,'Bearer test-access');
    if(url.pathname==='/rest/v1/travel_documents')return reply(remote?[remote]:[]);
    if(url.pathname==='/rest/v1/rpc/save_travel_document'){
      if(body.expected_revision!==(remote?.revision||0))return reply({code:'40001'},409);
      remote={revision:(remote?.revision||0)+1,data:body.document};return reply([remote]);
    }
    throw Error('Unexpected endpoint '+url.pathname);
  };
  async function device(){const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.route('https://demo.supabase.co/**',serve);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(process.env.TEST_URL||'http://127.0.0.1:8000');await page.waitForFunction(()=>window.TravelCloud&&document.querySelector('#cloud-open').onclick);return {context,page};}
  async function login(p){await p.locator('#cloud-open').click();await p.locator('#cloud-url').fill('https://demo.supabase.co');await p.locator('#cloud-key').fill('sb_publishable_test');await p.locator('#cloud-email').fill('shared@example.com');await p.locator('#cloud-password').fill('only-for-test-password');await p.locator('button[value=login]').click();await p.locator('#cloud-choices').waitFor({state:'visible'});assert.equal(await p.locator('#cloud-password').inputValue(),'');}
  const a=await device(),b=await device();const get=p=>p.evaluate(()=>window.travelApp.get());
  await a.page.locator('.check').first().check();await login(a.page);await a.page.locator('#cloud-use-local').click();await until(()=>remote!==null);await a.page.locator('#cloud-close').click();
  await login(b.page);await b.page.locator('#cloud-use-remote').click();await b.page.locator('#cloud-close').click();await until(async()=>(await get(b.page)).packing[0].items[0].done);
  assert.ok(await b.page.evaluate(()=>localStorage.getItem('yeongjong-before-cloud')));
  // Independent changes, including one queued offline, converge without lost checks.
  await b.context.setOffline(true);await a.page.locator('.check').nth(1).check();await b.page.locator('.check').nth(2).check();await until(()=>remote.data.packing[0].items[1].done);await b.context.setOffline(false);
  await until(()=>remote.data.packing[0].items[2].done);await a.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await until(async()=>(await get(a.page)).packing[0].items[2].done);
  assert.ok((await get(b.page)).packing[0].items.slice(0,3).every(i=>i.done));
  // Visible X deletion syncs and stays deleted after reload/migration.
  const removed=(await get(b.page)).packing[0].items[3].id;
  await b.page.locator('.item>.delete-cross').nth(3).click();await until(()=>!remote.data.packing[0].items.some(i=>i.id===removed));
  await a.page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await until(async()=>!(await get(a.page)).packing[0].items.some(i=>i.id===removed));await b.page.reload();await b.page.waitForFunction(()=>window.travelApp);assert.ok(!(await get(b.page)).packing[0].items.some(i=>i.id===removed));
  // Same-field conflict pauses rather than overwriting another device.
  await a.context.setOffline(true);await b.context.setOffline(true);
  const rename=async(p,name)=>{await p.locator('.item strong').first().click();await p.locator('#fields [name=name]').fill(name);await p.locator('#form [type=submit]').click();};
  await rename(a.page,'PC 신분증');await rename(b.page,'폰 신분증');await a.context.setOffline(false);await until(()=>remote.data.packing[0].items[0].name==='PC 신분증');await b.context.setOffline(false);
  await until(async()=>/동시 수정/.test(await b.page.locator('#cloud-status').textContent()));assert.equal(remote.data.packing[0].items[0].name,'PC 신분증');assert.equal((await get(b.page)).packing[0].items[0].name,'폰 신분증');
  await b.page.locator('#cloud-open').click();await b.page.locator('#cloud-use-remote').click();await until(async()=>(await get(b.page)).packing[0].items[0].name==='PC 신분증');assert.equal(await b.page.evaluate(()=>JSON.parse(localStorage.getItem('yeongjong-before-cloud')).packing[0].items[0].name),'폰 신분증');await b.page.locator('#cloud-close').click();
  // Category X is visible; keep the layout compact and horizontally contained.
  assert.ok(await b.page.locator('.cardhead>.delete-cross').first().isVisible());
  for(const width of [280,320,390,700,1000]){await b.page.setViewportSize({width,height:844});assert.ok(await b.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow at '+width);}
  assert.equal(await b.page.evaluate(()=>Object.values(localStorage).join('').includes('only-for-test-password')),false);
  assert.deepEqual(errors,[]);await browser.close();
  console.log('PASS: two-device login, initial upload/download, offline merge, visible X deletion, reload, conflict protection/recovery backup, responsive layout, no password storage or runtime errors (mock HTTP backend)');
})().catch(e=>{console.error(e);process.exit(1);});
