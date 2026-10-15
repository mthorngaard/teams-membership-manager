let state, editing=-1, teams=[], channels=[];
const $=id=>document.getElementById(id);
const unresolved=x=>!x.teamId||x.type==='channel'||(x.type!=='team'&&!x.channelId);
const types={channel:'Channel (awaiting lookup)',team:'Team',standard:'Standard channel',private:'Private channel',shared:'Shared channel'};
let resolving=false,adding=false;
const readiness=document.createElement('div');readiness.className='readiness';
const readinessText=document.createElement('p');
const resolveButton=document.createElement('button');resolveButton.id='resolve';resolveButton.className='secondary';resolveButton.textContent='Get team and channel IDs';
readiness.append(readinessText,resolveButton);$('list').before(readiness);
const addHelp=document.createElement('p');addHelp.className='hint';$('add').before(addHelp);
const progressPanel=document.createElement('div');progressPanel.className='progress-panel';progressPanel.hidden=true;
const progressLabel=document.createElement('p');progressLabel.setAttribute('aria-live','polite');
const progressBar=document.createElement('progress');progressBar.setAttribute('aria-label','Teams and channels processed');
const progressCurrent=document.createElement('p');progressCurrent.className='hint';
progressPanel.append(progressLabel,progressBar,progressCurrent);$('results').before(progressPanel);
function showProgress(p){
  progressPanel.hidden=false;progressBar.max=p.total;progressBar.value=p.completed;
  const percent=p.total?Math.round(p.completed/p.total*100):0;
  progressLabel.textContent=`${p.completed} of ${p.total} processed · ${percent}%`;
  progressCurrent.textContent=(p.running?'Processing: ':'')+p.current+(p.failed?` · ${p.failed} errors`:'');
}
function startProgress(runId,total){
  showProgress({total,completed:0,current:'Finding user',running:true,failed:0});let active=true,polling=false;
  async function poll(){if(polling)return;polling=true;try{const p=await api('/api/progress');if(p?.runId===runId)showProgress(p);}catch{}finally{polling=false;}}
  const timer=setInterval(()=>{if(active)poll();},700);
  return async()=>{active=false;clearInterval(timer);await poll();};
}
async function resolveList(){
  if(!state.me||resolving)return;resolving=true;updateControls();message('Getting team and channel IDs from Microsoft…');
  try{const d=await api('/api/resolve',{});state.catalog=d.catalog;render();message(d.results.length?d.results.map(x=>x.name+': '+x.status).join('\n'):'Every entry already has a team ID.');}
  finally{resolving=false;updateControls();}
}
resolveButton.onclick=()=>run(resolveList);
function updateControls(){
  if(!state)return;
  const missing=state.catalog.filter(unresolved).length;
  readiness.hidden=!missing;
  readinessText.textContent=!state.me?'Sign in with Graph at the top of the page. Team and channel IDs are then retrieved so you can select teams.':`${missing} entries are missing an ID or channel type. Get IDs from Microsoft to make them selectable. Names that are missing or ambiguous need an ID via Edit.`;
  resolveButton.disabled=!state.me||resolving||adding;
  resolveButton.textContent=resolving?'Getting team and channel IDs…':'Get team and channel IDs';
  resolveButton.setAttribute('aria-busy',String(resolving));
  const selected=$('list').querySelectorAll('input:checked').length;
  $('add').disabled=!state.me||!selected||adding||resolving;
  $('add').textContent=adding?'Adding user…':'Add user to selected';
  $('add').setAttribute('aria-busy',String(adding));
  addHelp.textContent=adding?'Memberships are being processed. Wait for the results.':!state.me?'Sign in with Graph to add a user.':!selected?'Select at least one team with a found team ID.':`${selected} entries selected. Enter the user's sign-in address above.`;
}
$('list').addEventListener('change',updateControls);
$('load').textContent='Get the organization\'s teams';
option($('type'),'channel','Channel (awaiting lookup)');
function message(text){$('message').textContent=text;}
async function api(url,body){const r=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
function option(select,value,text){const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);}
async function login(button){
  button.disabled=true;message('Getting a sign-in code from Microsoft…');
  let polling=false,shownCode='',active=true;
  const timer=setInterval(async()=>{
    if(polling||!active)return;polling=true;
    try{
      const d=await api('/api/login-status');
      if(active&&d.deviceLogin&&d.deviceLogin.code!==shownCode){
        shownCode=d.deviceLogin.code;
        $('message').replaceChildren();
        const text=document.createElement('p');text.textContent='Open Microsoft sign-in and enter the code:';
        const code=document.createElement('strong');code.textContent=shownCode;
        const link=document.createElement('a');link.href='https://microsoft.com/devicelogin';link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open Microsoft sign-in';
        const p=document.createElement('p');p.append(link);$('message').append(text,code,p);
      }
    }catch{}finally{polling=false;}
  },1000);
  try{await api('/api/login',{});active=false;clearInterval(timer);await init();message('You are signed in.');if(state.catalog.some(unresolved))await resolveList();}
  finally{active=false;clearInterval(timer);button.disabled=false;}
}
function render(){
  $('account').replaceChildren();if(state.me){const s=document.createElement('span');s.textContent=state.me.displayName+' ';const b=document.createElement('button');b.textContent='Sign out';b.className='secondary';b.onclick=()=>run(async()=>{await api('/api/logout',{});await init();});$('account').append(s,b);}else{const b=document.createElement('button');b.textContent='Sign in with Graph';b.onclick=()=>run(()=>login(b));$('account').append(b);}
  $('list').replaceChildren();if(!state.catalog.length){const p=document.createElement('p');p.className='empty';p.textContent='The list is empty. Add your first team or channel on the right.';$('list').append(p);}
  state.catalog.forEach((x,i)=>{const row=document.createElement('div');row.className='entry';const c=document.createElement('input');c.type='checkbox';c.value=i;c.id='entry'+i;const l=document.createElement('label');l.htmlFor=c.id;l.textContent=x.name;const small=document.createElement('small');small.textContent=types[x.type];l.append(small);const edit=document.createElement('button');edit.textContent='Edit';edit.className='secondary';edit.onclick=()=>{editing=i;for(const k of ['name','teamId','type','channelId','teamName','channelName'])$(k).value=x[k]||'';updateEditor();$('save').textContent='Save change';};const del=document.createElement('button');del.textContent='Delete';del.className='secondary';del.onclick=()=>run(async()=>{if(!confirm('Delete '+x.name+' from the list?'))return;await save(state.catalog.filter((_,n)=>n!==i));reset();});row.append(c,l,edit,del);$('list').append(row);});
  $('list').querySelectorAll('.entry').forEach((row,i)=>{if(unresolved(state.catalog[i])){row.querySelector('small').textContent+=' · ID or channel type is missing';row.querySelector('input').disabled=true;}});
  $('add').disabled=!state.me;$('load').disabled=!state.me;$('resolve').disabled=!state.me;
  updateControls();
}
async function save(items){const d=await api('/api/catalog',items);state.catalog=d.catalog;render();}
function updateEditor(){const awaiting=$('type').value==='channel';$('lookupNames').hidden=!awaiting;$('teamName').required=awaiting;$('channelName').required=awaiting;$('teamId').required=!awaiting;$('teamId').placeholder=awaiting?'Can be left empty until the ID is retrieved':'';}
$('type').addEventListener('change',updateEditor);
function reset(){editing=-1;$('editor').reset();$('save').textContent='Save entry';updateEditor();}
async function run(fn){try{message('');await fn();}catch(e){message(e.message);}}
async function init(){state=await api('/api/state');if(state.catalogVersion!==2)throw Error('The server is running an older version that does not support import without a team ID. Stop the app with Ctrl+C in PowerShell, start Start.ps1 again, and reload the page.');render();}
$('editor').onsubmit=e=>{e.preventDefault();run(async()=>{const x=editing>=0?{...state.catalog[editing]}:{};for(const k of ['name','teamId','type','channelId'])x[k]=$(k).value.trim();if(x.type==='channel'){x.teamName=$('teamName').value.trim();x.channelName=$('channelName').value.trim();}else{delete x.teamName;delete x.channelName;}const items=[...state.catalog];if(editing>=0)items[editing]=x;else items.push(x);await save(items);reset();message('The list is saved.');if(state.me&&state.catalog.some(unresolved))await resolveList();});};
$('cancel').onclick=reset;
$('selectAll').onclick=()=>{const all=[...$('list').querySelectorAll('input:not(:disabled)')];const checked=!all.every(x=>x.checked);all.forEach(x=>x.checked=checked);updateControls();};
$('load').onclick=()=>run(async()=>{teams=await api('/api/teams');$('team').replaceChildren();option($('team'),'','Select team');teams.forEach(t=>option($('team'),t.id,t.displayName));message(teams.length?'Select a team to get its channels.':'No teams were found in the organization. Check that you are signed in with the right work account.');});
$('team').onchange=()=>run(async()=>{const id=$('team').value;$('channel').replaceChildren();option($('channel'),'','Entire team');channels=[];if(!id){updateEditor();return;}$('teamId').value=id;$('name').value=teams.find(t=>t.id===id).displayName;$('type').value='team';$('channelId').value='';updateEditor();channels=await api('/api/channels?teamId='+encodeURIComponent(id));channels.forEach(c=>option($('channel'),c.id,c.displayName+' · '+types[c.membershipType]));});
$('channel').onchange=()=>{const c=channels.find(x=>x.id===$('channel').value),t=teams.find(x=>x.id===$('team').value);$('channelId').value=c?.id||'';$('type').value=c?.membershipType||'team';$('name').value=t.displayName+(c?' / '+c.displayName:'');updateEditor();};
$('add').onclick=()=>run(async()=>{const indices=[...$('list').querySelectorAll('input:checked')].map(x=>Number(x.value)),user=$('user').value.trim();if(!user||!indices.length)throw Error('Enter a user and select at least one entry.');if(!confirm('Add '+user+' to:\n'+indices.map(i=>state.catalog[i].name).join('\n')+'\n\nPrivate and standard channels also give access to the team and all of its standard channels.'))return;adding=true;updateControls();$('results').replaceChildren();const runId=crypto.randomUUID();const stopProgress=startProgress(runId,indices.length);message('Adding memberships. Please wait…');try{const d=await api('/api/add',{user,indices,runId});message('Processing finished for '+d.user.displayName+'.');d.results.forEach(x=>{const p=document.createElement('p');p.textContent=x.name+' — '+x.status;$('results').append(p);});}finally{await stopProgress();adding=false;updateControls();}});
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(state.catalog,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='teams-channels.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=()=>run(async()=>{const file=$('import').files[0];if(!file)return;try{const items=JSON.parse(await file.text());if(!confirm('Replace the existing list with the imported list?'))return;await save(items);reset();message('The list is imported.');if(state.me&&state.catalog.some(unresolved))await resolveList();}finally{$('import').value='';}});
run(async()=>{await init();if(state.me&&state.catalog.some(unresolved))await resolveList();});
