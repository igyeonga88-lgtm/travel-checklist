/* Shared, dependency-free cloud transport and three-way merge. */
(function(root){
'use strict';
const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
class Conflict extends Error{constructor(){super('같은 항목을 서로 다르게 변경했습니다. 사용할 목록을 선택하세요.');}}
function merge(base,local,remote,path=''){
  if(equal(local,remote)||equal(base,remote))return copy(local);
  if(equal(base,local))return copy(remote);
  if(local===undefined||remote===undefined)throw new Conflict();
  if(Array.isArray(local)&&Array.isArray(remote)){
    if(path==='packingDefaults.groups'||path==='packingDefaults.items')return [...new Set([...local,...remote])];
    if(![...(base||[]),...local,...remote].every(x=>x&&typeof x.id==='string'))throw new Conflict();
    const b=new Map((base||[]).map(x=>[x.id,x])),l=new Map(local.map(x=>[x.id,x])),r=new Map(remote.map(x=>[x.id,x]));
    const entries=new Map();
    for(const id of new Set([...b.keys(),...l.keys(),...r.keys()])){
      const value=merge(b.get(id),l.get(id),r.get(id),path+'[]');if(value!==undefined)entries.set(id,value);
    }
    // Compare the relative order of surviving shared IDs; additions are retained.
    const shared=new Set((base||[]).filter(x=>l.has(x.id)&&r.has(x.id)&&entries.has(x.id)).map(x=>x.id));
    const order=a=>a.filter(x=>shared.has(x.id)).map(x=>x.id);
    const bo=order(base||[]),lo=order(local),ro=order(remote);
    if(!equal(lo,bo)&&!equal(ro,bo)&&!equal(lo,ro))throw new Conflict();
    const primary=!equal(lo,bo)?local:remote,secondary=primary===local?remote:local;
    const ids=primary.map(x=>x.id).filter(id=>entries.has(id));
    // Place additions missing from the chosen order next to their source neighbors.
    for(let n=0;n<secondary.length;n++){
      const id=secondary[n].id;if(!entries.has(id)||ids.includes(id))continue;
      const previous=secondary.slice(0,n).reverse().find(x=>ids.includes(x.id));
      const next=secondary.slice(n+1).find(x=>ids.includes(x.id));
      ids.splice(previous?ids.indexOf(previous.id)+1:next?ids.indexOf(next.id):ids.length,0,id);
    }
    return ids.map(id=>entries.get(id));
  }
  if(local&&remote&&typeof local==='object'&&typeof remote==='object'&&!Array.isArray(local)&&!Array.isArray(remote)){
    const result={};for(const key of new Set([...Object.keys(base||{}),...Object.keys(local),...Object.keys(remote)])){
      const value=merge(base?.[key],local[key],remote[key],path?path+'.'+key:key);if(value!==undefined)result[key]=value;
    }return result;
  }
  throw new Conflict();
}
class CloudAPI{
  constructor(config,session,onSession=()=>{},fetcher=globalThis.fetch.bind(globalThis)){
    const url=new URL(config.url);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Supabase Project URL(https://…supabase.co)을 입력하세요.');
    if(!config.key||config.key.startsWith('sb_secret_'))throw Error('공개 publishable 또는 anon 키만 입력하세요.');
    if(config.key.startsWith('eyJ')){try{const role=JSON.parse(atob(config.key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role;if(role!=='anon')throw Error();}catch{throw Error('공개 anon 키만 사용할 수 있습니다. service_role 키는 입력하지 마세요.');}}
    if(session&&(!session.access_token||!session.refresh_token||!session.user?.id||!Number.isFinite(session.expires_at)))throw Error('로그인 상태를 읽지 못했습니다. 다시 로그인해 주세요.');
    this.url=url.origin;this.key=config.key;this.session=session;this.onSession=onSession;this.fetcher=fetcher;
  }
  async request(path,{body,auth=false,retry=true}={}){
    if(auth&&(!this.session||this.session.expires_at<Date.now()/1000+60))await this.refresh();
    const response=await this.fetcher(this.url+path,{method:body===undefined?'GET':'POST',headers:{apikey:this.key,'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+this.session.access_token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const data=await response.json().catch(()=>null);
    if(response.status===401&&auth&&retry){await this.refresh();return this.request(path,{body,auth,retry:false});}
    if(!response.ok){if(data?.code==='40001')throw new Conflict();throw Error(data?.error_description||data?.msg||data?.message||'서버 연결에 실패했습니다 ('+response.status+').');}
    return data;
  }
  setSession(value){if(!value?.access_token||!value?.refresh_token||!value?.user?.id)throw Error('로그인 응답을 확인하지 못했습니다.');this.session={access_token:value.access_token,refresh_token:value.refresh_token,user:value.user,expires_at:Math.floor(Date.now()/1000)+(value.expires_in||3600)};this.onSession(this.session);return this.session;}
  async signIn(email,password){return this.setSession(await this.request('/auth/v1/token?grant_type=password',{body:{email,password}}));}
  async signUp(email,password){const result=await this.request('/auth/v1/signup',{body:{email,password}});if(result.access_token)this.setSession(result);return result;}
  async refresh(){if(!this.session?.refresh_token)throw Error('다시 로그인해 주세요.');if(!this.refreshing)this.refreshing=this.request('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:this.session.refresh_token}}).then(value=>this.setSession(value)).finally(()=>this.refreshing=null);return this.refreshing;}
  async read(){const rows=await this.request('/rest/v1/travel_documents?select=data,revision&user_id=eq.'+encodeURIComponent(this.session.user.id),{auth:true});return rows[0]||null;}
  async write(revision,data){const rows=await this.request('/rest/v1/rpc/save_travel_document',{body:{expected_revision:revision,document:data},auth:true});if(!rows?.[0])throw Error('저장을 확인하지 못했습니다.');return rows[0];}
}
const api={merge,copy,equal,Conflict,CloudAPI};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TravelCloud=api;
})(globalThis);
