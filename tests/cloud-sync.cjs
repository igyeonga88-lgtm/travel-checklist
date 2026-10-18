const assert=require('node:assert/strict');
const {merge,Conflict,CloudAPI}=require('../cloud-sync.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const base={packing:[{id:'g',name:'준비물',items:[{id:'a',name:'신분증',done:false},{id:'b',name:'현금',done:false}]}],places:[],packingDefaults:{groups:['g'],items:['a','b']}};
let l=clone(base),r=clone(base);l.packing[0].items[0].done=true;r.packing[0].items[1].done=true;
let result=merge(base,l,r);assert.ok(result.packing[0].items.every(i=>i.done));
l=clone(base);r=clone(base);l.packing[0].items.shift();r.packing[0].items[1].name='여행 현금';
result=merge(base,l,r);assert.equal(result.packing[0].items.length,1);assert.equal(result.packing[0].items[0].name,'여행 현금');
r.packing[0].items[0].name='내 신분증';assert.throws(()=>merge(base,l,r),Conflict);
l=clone(base);r=clone(base);l.packing[0].items[0].name='A';r.packing[0].items[0].name='B';assert.throws(()=>merge(base,l,r),Conflict);
l=clone(base);r=clone(base);l.packing[0].items.push({id:'c',name:'약',done:false});r.packing[0].items.unshift({id:'d',name:'물',done:false});result=merge(base,l,r);assert.deepEqual(result.packing[0].items.map(i=>i.id),['d','a','b','c']);
l=clone(base);r=clone(base);l.packing[0].items.reverse();r.packing[0].items[0].done=true;result=merge(base,l,r);assert.deepEqual(result.packing[0].items.map(i=>i.id),['b','a']);assert.equal(result.packing[0].items[1].done,true);
const orderBase=[{id:'a'},{id:'b'},{id:'c'}];assert.throws(()=>merge(orderBase,[orderBase[1],orderBase[0],orderBase[2]],[orderBase[0],orderBase[2],orderBase[1]]),Conflict);
assert.deepEqual(merge(['a'],['a','b'],['a','c'],'packingDefaults.items'),['a','b','c']);
assert.deepEqual(merge(base,base,r),r);
assert.throws(()=>new CloudAPI({url:'http://project.supabase.co',key:'public'}));
assert.throws(()=>new CloudAPI({url:'https://project.supabase.co',key:'sb_secret_private'}));
assert.throws(()=>new CloudAPI({url:'https://project.supabase.co',key:'eyJ.'+Buffer.from('{"role":"service_role"}').toString('base64url')+'.x'}));
(async()=>{
  let refreshed=0,saved=0,notified=0;
  const fetcher=async(url,options)=>{
    assert.equal(options.headers.apikey,'sb_publishable_public');
    if(url.includes('grant_type=refresh_token')){refreshed++;assert.equal(JSON.parse(options.body).refresh_token,'refresh');return Response.json({access_token:'new',refresh_token:'refresh',user:{id:'user'},expires_in:3600});}
    assert.equal(options.headers.Authorization,'Bearer new');
    if(url.includes('/rpc/')){saved++;return saved===1?Response.json({code:'40001'},{status:409}):Response.json([{revision:2,data:base}]);}
    return Response.json([{revision:1,data:base}]);
  };
  const api=new CloudAPI({url:'https://project.supabase.co',key:'sb_publishable_public'},{access_token:'expired',refresh_token:'refresh',expires_at:0,user:{id:'user'}},()=>notified++,fetcher);
  assert.equal((await api.read()).revision,1);assert.equal(refreshed,1);assert.equal(notified,1);
  await assert.rejects(api.write(1,base),Conflict);assert.equal((await api.write(1,base)).revision,2);
  console.log('PASS: independent edits, delete/edit conflicts, additions, ordering, catalog history, public-key checks, session refresh, CAS conflict handling');
})().catch(e=>{console.error(e);process.exitCode=1;});
