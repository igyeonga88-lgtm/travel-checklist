/* Account setup and offline-first synchronization for the existing single-page app. */
(function(){
'use strict';
const {CloudAPI,merge,copy,equal,Conflict}=TravelCloud;
const $=s=>document.querySelector(s),app=window.travelApp;
const CONFIG='yeongjong-cloud-config',SESSION='yeongjong-cloud-session',META='yeongjong-cloud-base',SAFETY='yeongjong-before-cloud';
let client=null,base=null,revision=0,busy=false,timer=null,choice=null,epoch=0;
const read=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
const put=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const status=text=>{$('#cloud-status').textContent=text;$('#cloud-message').textContent=text;};
function backupLocal(){put(SAFETY,app.get());$('#cloud-safety').hidden=false;}
function download(data){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='영종도-동기화전-백업.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function remember(){put(META,{url:client.url,user:client.session.user.id,base,revision});}
function controls(){const signed=!!client?.session;$('#cloud-account').textContent=signed?'연결 계정: '+client.session.user.email:'같은 이메일과 비밀번호로 두 기기에 로그인하세요.';$('#cloud-logout').hidden=!signed;$('#cloud-now').hidden=!signed;$('#cloud-login-fields').hidden=signed;$('#cloud-choices').hidden=!choice;$('#cloud-safety').hidden=!read(SAFETY);}
function open(){controls();if(!$('#cloud-url').value||!$('#cloud-key').value)$('#cloud-settings').open=true;$('#cloud-dialog').showModal();}
function schedule(delay=700){clearTimeout(timer);if(client?.session)timer=setTimeout(sync,delay);}
function needChoice(remote,initial=false){choice={remote,initial};status(initial?'공유할 목록을 선택해 주세요.':'동시 수정이 겹쳤습니다. 사용할 목록을 선택해 주세요.');$('#cloud-use-remote').hidden=!remote;$('#cloud-choice-text').textContent=initial?(remote?'이미 공유 목록이 있습니다. 어느 목록으로 시작할까요?':'아직 공유 목록이 없습니다. 이 기기의 목록을 처음 공유할까요?'):'같은 항목이 서로 다르게 바뀌어 자동으로 합치지 않았습니다. 교체 전 이 기기의 목록은 별도 백업됩니다.';controls();}
async function sync(){
  if(!client?.session||busy||choice)return;
  if(!navigator.onLine){status('오프라인 · 이 기기에 저장 중');return;}
  if(!app.canApply()){schedule(1500);return;}
  busy=true;const active=client,version=epoch;
  const current=()=>active===client&&version===epoch;
  try{
    status('동기화 중…');
    const remote=await active.read();if(!current())return;
    if(!app.canApply()){schedule(1500);return;}
    if(remote){remote.data=app.validate(remote.data);if(!Number.isSafeInteger(remote.revision)||remote.revision<1)throw Error('서버 버전을 읽을 수 없습니다.');}
    if(!base){needChoice(remote,true);return;}
    if(!remote){throw Error('공유 목록이 없어졌습니다. 로그아웃 후 다시 연결해 주세요.');}
    const local=app.get();let next;
    try{next=app.validate(merge(base,local,remote.data));}catch(err){if(err instanceof Conflict){needChoice(remote);return;}throw err;}
    if(!equal(next,remote.data)){
      const sent=copy(next);
      // Apply merged changes before awaiting a write so an editor opened during
      // that request cannot retain references to an older, unmerged document.
      app.replace(sent);base=copy(remote.data);revision=remote.revision;remember();
      const saved=await active.write(remote.revision,sent);if(!current())return;
      // New local changes during this request remain ahead of the acknowledged base.
      base=sent;revision=saved.revision;remember();
    }else{
      base=copy(remote.data);revision=remote.revision;
      app.replace(next);remember();
    }
    status(equal(app.get(),base)?'공유됨 · '+new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'이 기기에 저장됨 · 전송 대기');
    if(!equal(app.get(),base))schedule();
  }catch(err){
    if(!current())return;
    if(err instanceof Conflict){status('다른 기기의 변경을 확인 중…');schedule(300);}
    else status('동기화 대기 · '+(err.message||'연결 상태를 확인하세요.'));
  }finally{busy=false;}
}
async function resolve(useRemote){
  if(!choice||busy||!client)return;
  if(!app.canApply()){status('열린 편집창을 닫고 다시 선택하세요.');return;}
  if(!confirm(useRemote?'이 기기의 목록을 백업하고 공유 목록으로 바꿀까요?':'이 기기의 목록으로 공유 목록을 저장할까요? 다른 기기에도 적용됩니다.'))return;
  busy=true;const active=client,version=epoch,selected=choice;
  try{
    backupLocal();
    if(useRemote){app.replace(app.validate(selected.remote.data));base=app.get();revision=selected.remote.revision;}
    else{
      const sent=app.get(),saved=await active.write(selected.remote?.revision||0,sent);
      if(active!==client||version!==epoch)return;
      base=sent;revision=saved.revision;
    }
    remember();choice=null;controls();status('공유 목록 연결됨');schedule(0);
  }catch(err){if(active!==client||version!==epoch)return;if(err instanceof Conflict){choice=null;status('다른 기기에서 변경했습니다. 다시 확인합니다.');schedule(0);}else status('연결 대기 · '+err.message);}
  finally{busy=false;controls();}
}
function activate(config,session){
  epoch++;choice=null;base=null;revision=0;
  client=new CloudAPI(config,session,value=>put(SESSION,value));
  const saved=read(META);
  if(saved?.url===client.url&&saved.user===session?.user?.id&&saved.base){base=app.validate(saved.base);revision=saved.revision;}
  controls();schedule(0);
}
$('#cloud-open').onclick=open;$('#cloud-close').onclick=()=>$('#cloud-dialog').close();
$('#cloud-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  const submit=e.submitter?.value||'login',config={url:$('#cloud-url').value.trim(),key:$('#cloud-key').value.trim()};
  let candidate;try{candidate=new CloudAPI(config,null,value=>put(SESSION,value));}catch(err){status(err.message);return;}
  const email=$('#cloud-email').value.trim(),password=$('#cloud-password').value;
  busy=true;$('#cloud-form').querySelectorAll('button').forEach(b=>b.disabled=true);status('계정 연결 중…');
  try{
    if(submit==='signup'){
      const result=await candidate.signUp(email,password);
      put(CONFIG,config);
      if(!result.access_token){status('가입 확인 이메일을 열어 인증한 뒤, 여기서 로그인해 주세요.');return;}
    }else await candidate.signIn(email,password);
    put(CONFIG,config);activate(config,candidate.session);status('로그인됨 · 목록 확인 중…');
  }catch(err){status('로그인하지 못했습니다 · '+err.message);}
  finally{busy=false;$('#cloud-password').value='';$('#cloud-form').querySelectorAll('button').forEach(b=>b.disabled=false);controls();schedule(0);}
};
$('#cloud-logout').onclick=()=>{
  if(!confirm('이 기기의 동기화를 끊을까요? 저장된 여행 목록은 유지됩니다. 전송 대기 중인 내용은 이 기기에 남습니다.'))return;
  epoch++;client=null;base=null;choice=null;clearTimeout(timer);localStorage.removeItem(SESSION);controls();status('연결 해제 · 이 기기에만 저장 중');
};
$('#cloud-now').onclick=()=>{if(choice){controls();return;}sync();};
$('#cloud-use-remote').onclick=()=>resolve(true);$('#cloud-use-local').onclick=()=>resolve(false);
$('#cloud-safety').onclick=()=>download(read(SAFETY));
$('#cloud-copy').onclick=async()=>{
  try{
    const config={url:$('#cloud-url').value.trim(),key:$('#cloud-key').value.trim()};new CloudAPI(config,null);
    const url=new URL(location.href);url.hash='cloud='+encodeURIComponent(JSON.stringify(config));
    await navigator.clipboard.writeText(url.href);status('연결 주소를 복사했습니다. 다른 기기에서 연 뒤 같은 계정으로 로그인하세요.');
  }catch{status('프로젝트 URL과 공개 키를 확인하거나 두 기기에 직접 입력하세요.');}
};
window.addEventListener('travel-change',()=>{if(client?.session){status(choice?'목록 선택 필요 · 변경은 이 기기에 저장됨':'이 기기에 저장됨 · 전송 대기');schedule();}});
window.addEventListener('storage',e=>{
  if(e.key!==SESSION)return;
  const session=read(SESSION);
  if(!session){epoch++;client=null;base=null;choice=null;clearTimeout(timer);controls();status('다른 탭에서 연결을 해제했습니다.');return;}
  if(client?.session?.user.id===session.user?.id){client.session=session;return;}
  const config=read(CONFIG);if(config){try{activate(config,session);}catch{status('함께 쓰기에서 다시 로그인해 주세요.');}}
});
window.addEventListener('online',()=>schedule(0));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(0);});
setInterval(()=>{if(!document.hidden)schedule(0);},5000);
try{
  if(location.hash.startsWith('#cloud=')){
    const config=JSON.parse(decodeURIComponent(location.hash.slice(7)));new CloudAPI(config,null);put(CONFIG,config);history.replaceState(null,'',location.pathname+location.search);
  }
  const config=read(CONFIG);if(config){$('#cloud-url').value=config.url;$('#cloud-key').value=config.key;}
  const session=read(SESSION);if(config&&session)activate(config,session);else status('기기에 저장 중 · 함께 쓰기 연결 가능');
}catch{client=null;base=null;status('연결 설정을 읽지 못했습니다. 함께 쓰기에서 다시 연결하세요.');}
controls();
})();
