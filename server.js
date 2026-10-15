const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {GraphClient} = require('./graph-client');
const ROOT = __dirname, BASE = 'http://localhost:3000';
const SCOPES = 'User.Read User.ReadBasic.All Team.ReadBasic.All Channel.ReadBasic.All TeamMember.Read.All TeamMember.ReadWriteNonOwnerRole.All ChannelMember.ReadWrite.All';
const sessions = new Map();
let catalog = fs.existsSync(path.join(ROOT,'data/catalog.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT,'data/catalog.json'))) : JSON.parse(fs.readFileSync(path.join(ROOT,'teams-import.json')));
function validateCatalog(items) {
  if (!Array.isArray(items) || items.length > 500) throw Error('The list can contain at most 500 entries.');
  const keys = new Set();
  const normalized=[];
  for (const [index,item] of items.entries()) {
    const x = typeof item==='string' ? {name:item,type:'team',teamId:'',channelId:''} : item;
    const fail=reason=>{throw Error(`Entry ${index+1}${x?.name?' ('+x.name+')':''}: ${reason}`);};
    if(!x || typeof x.name!=='string' || !x.name.trim() || x.name.length>200)fail('The name is missing or too long.');
    const type=x.type??'team',teamId=typeof x.teamId==='string'?x.teamId.trim():x.teamId??'';
    const namedChannel=type!=='team'&&typeof x.teamName==='string'&&x.teamName.trim()&&x.teamName.length<=200&&typeof x.channelName==='string'&&x.channelName.trim()&&x.channelName.length<=200;
    if(!['team','channel','standard','private','shared'].includes(type))fail('Type must be team, channel, standard, private, or shared.');
    if(type==='channel'&&!namedChannel)fail('A channel without a known type requires teamName and channelName.');
    if(!(teamId===''&&(type==='team'||namedChannel))&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(teamId))fail('Team ID must be a Microsoft GUID. Only entire teams or named channels can be imported without an ID.');
    if(type!=='team'&&!namedChannel&&(typeof x.channelId!=='string'||!x.channelId.trim()||x.channelId.length>300))fail('The channel ID is missing or invalid.');
    if(x.channelId!=null&&(typeof x.channelId!=='string'||x.channelId.length>300))fail('The channel ID is invalid.');
    x.name=x.name.trim();x.teamId=teamId;x.type=type;
    const key = x.teamId&&(type==='team'||x.channelId) ? x.teamId + ':' + (x.type === 'team' ? '' : x.channelId) : 'name:'+x.name.trim().toLocaleLowerCase('en');
    if (keys.has(key)) fail('The list contains a duplicate.');
    keys.add(key);
    normalized.push({name:x.name,teamId,type,channelId:type==='team'?'':(x.channelId||'').trim(),...(namedChannel?{teamName:x.teamName.trim(),channelName:x.channelName.trim()}:{})});
  }
  return normalized;
}
function resolveNames(items,teams){
  const results=[];
  const resolved=items.map(x=>{
    if(x.teamId)return {...x};
    const matches=teams.filter(t=>t.displayName.trim().toLocaleLowerCase('en')===(x.teamName||x.name).trim().toLocaleLowerCase('en'));
    results.push({name:x.name,status:matches.length===1?'Team ID found':matches.length?'Several teams have this name — enter the ID manually':'Not found in the organization — check the name, the account, and the team ID'});
    return {...x,teamId:matches.length===1?matches[0].id:''};
  });
  return {catalog:validateCatalog(resolved),results};
}
async function resolveCatalog(items,teams,loadChannels){
  const resolved=resolveNames(items,teams),cache=new Map();
  for(const x of resolved.catalog){
    if(x.type==='team'||!x.teamId||(x.channelId&&x.type!=='channel'))continue;
    try{
      if(!cache.has(x.teamId))cache.set(x.teamId,await loadChannels(x.teamId));
      const matches=cache.get(x.teamId).filter(c=>c.displayName.trim().toLocaleLowerCase('en')===x.channelName.trim().toLocaleLowerCase('en'));
      if(matches.length!==1)throw Error(matches.length?'Several channels have the same name — enter the ID manually':'The channel was not found. Check the channel name and access.');
      const c=matches[0];if(!['standard','private','shared'].includes(c.membershipType))throw Error('Microsoft returned an unknown channel type.');
      x.channelId=c.id;x.type=c.membershipType;
      resolved.results.push({name:x.name,status:'Channel ID found ('+c.membershipType+')'});
    }catch(e){resolved.results.push({name:x.name,status:'Channel lookup failed: '+e.message});}
  }
  resolved.catalog=validateCatalog(resolved.catalog);return resolved;
}
function storeCatalog(items){fs.mkdirSync(path.join(ROOT,'data'),{recursive:true});fs.writeFileSync(path.join(ROOT,'data/catalog.tmp'),JSON.stringify(items,null,2));fs.renameSync(path.join(ROOT,'data/catalog.tmp'),path.join(ROOT,'data/catalog.json'));catalog=items;}
async function graph(token, endpoint, method='GET', body) {
  let url = endpoint.startsWith('https:') ? endpoint : 'https://graph.microsoft.com/v1.0' + endpoint;
  if (!url.startsWith('https://graph.microsoft.com/v1.0/')) throw Error('Invalid Graph link.');
  return token.request({action:'request',url,method,body});
}
async function all(token,endpoint) {let values=[];do {const d=await graph(token,endpoint);values.push(...(d.value||[]));endpoint=d['@odata.nextLink'];}while(endpoint);return values;}
async function ensureMember(token,endpoint,userId,syncDelayMs=2000) {
  const isChannel=endpoint.includes('/channels/');
  function describe(e,action){
    if(e.status===403||/forbidden/i.test(e.message)){
      const required=action==='read'?isChannel?'ChannelMember.ReadWrite.All':'TeamMember.Read.All':isChannel?'ChannelMember.ReadWrite.All':'TeamMember.ReadWriteNonOwnerRole.All';
      const error=Error(`Microsoft refused to ${action} the ${isChannel?'channel':'team'} membership (403). Sign in again and consent to ${required}. If this error continues, an administrator must check consent and the account's permission to manage the destination.`);error.status=403;return error;
    }
    return e;
  }
  let members;try{members=await all(token,endpoint);}catch(e){throw describe(e,'read');}
  if(members.some(x=>x.userId===userId)) return 'Already a member';
  try{await graph(token,endpoint,'POST',{'@odata.type':'#microsoft.graph.aadUserConversationMember',roles:[],'user@odata.bind':`https://graph.microsoft.com/v1.0/users('${userId}')`});}catch(e){throw describe(e,'change');}
  if(syncDelayMs)await new Promise(resolve=>setTimeout(resolve,syncDelayMs));
  return 'Added';
}
async function addOne(token,item,userId,teams,options={}) {
  const syncDelayMs=options.syncDelayMs??2000,retryDelayMs=options.retryDelayMs??5000,teamPath=`/teams/${item.teamId}`;
  if(item.type!=='team'){
    const actual=await graph(token,`${teamPath}/channels/${encodeURIComponent(item.channelId)}?$select=membershipType`);
    if(actual.membershipType!==item.type)throw Error('The channel type has changed. Update the list.');
  }
  if(item.type!=='shared'){
    if(!teams.has(item.teamId)){try{teams.set(item.teamId,{status:await ensureMember(token,teamPath+'/members',userId,syncDelayMs)});}catch(e){teams.set(item.teamId,{error:e.message});}}
    const team=teams.get(item.teamId);if(team.error)throw Error(team.error);
    if(item.type==='team'||item.type==='standard')return item.type==='standard'?'Access through the team: '+team.status:team.status;
  }
  let status;
  for(let attempt=0;attempt<3;attempt++){
    try{status=await ensureMember(token,`${teamPath}/channels/${encodeURIComponent(item.channelId)}/members`,userId,syncDelayMs);break;}
    catch(e){if(item.type!=='private'||e.status!==400||attempt===2)throw e;if(retryDelayMs)await new Promise(resolve=>setTimeout(resolve,retryDelayMs));}
  }
  return status;
}
function send(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function read(req) {let str='';for await(const chunk of req){str+=chunk;if(str.length>200000)throw Error('Too much data.');}return JSON.parse(str||'{}');}
const server=http.createServer(async(req,res)=>{
  try {
    if(req.headers.host!=='localhost:3000') return send(res,403,{error:'Invalid host.'});
    const url=new URL(req.url,BASE);
    let sid=/sid=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1], session=sessions.get(sid);
    if(!session){sid=crypto.randomBytes(32).toString('hex');session={csrf:crypto.randomBytes(24).toString('hex')};sessions.set(sid,session);res.setHeader('Set-Cookie',`sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);}
    if(req.method==='POST' && (req.headers.origin!==BASE || req.headers['x-csrf-token']!==session.csrf))return send(res,403,{error:'Invalid request. Reload the page.'});
    if(url.pathname==='/api/login'&&req.method==='POST') {
      if(session.busy||session.loggingIn)return send(res,409,{error:'Wait for the operation in progress.'});
      session.loggingIn=true;session.token?.close();delete session.me;
      const client=new GraphClient();session.token=client;
      try{session.me=await client.request({action:'login',scopes:SCOPES.split(' ')});return send(res,200,{me:session.me});}
      catch(e){client.close();delete session.token;throw e;}
      finally{session.loggingIn=false;}
    }
    if(url.pathname==='/api/state')return send(res,200,{catalogVersion:2,csrf:session.csrf,me:session.token&&!session.token.closed?session.me:null,catalog});
    if(url.pathname==='/api/login-status')return send(res,200,{pending:!!session.loggingIn,deviceLogin:session.loggingIn?session.token?.deviceLogin:null});
    if(url.pathname==='/api/catalog'&&req.method==='POST') {storeCatalog(validateCatalog(await read(req)));return send(res,200,{catalog});}
    if(url.pathname==='/api/logout'&&req.method==='POST'){if(session.busy||session.loggingIn)return send(res,409,{error:'Wait for the operation in progress.'});session.token?.close();delete session.token;delete session.me;return send(res,200,{ok:true});}
    if(url.pathname.startsWith('/api/')) {
      if(!session.me||!session.token||session.token.closed)return send(res,401,{error:'Sign in with Microsoft first.'});
      if(url.pathname==='/api/progress'&&req.method==='GET')return send(res,200,session.progress||null);
      if(url.pathname==='/api/teams')return send(res,200,await all(session.token,'/teams?$select=id,displayName'));
      if(url.pathname==='/api/resolve'&&req.method==='POST'){
        const snapshot=catalog;
        const teams=await all(session.token,'/teams?$select=id,displayName');
        if(catalog!==snapshot)return send(res,409,{error:'The list changed during lookup. Try again.'});
        const resolved=await resolveCatalog(snapshot,teams,id=>all(session.token,`/teams/${id}/channels?$select=id,displayName,membershipType`));
        if(catalog!==snapshot)return send(res,409,{error:'The list changed during lookup. Try again.'});
        storeCatalog(resolved.catalog);return send(res,200,resolved);
      }
      if(url.pathname==='/api/channels'){const id=url.searchParams.get('teamId');if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Invalid team ID.');return send(res,200,await all(session.token,`/teams/${id}/channels?$select=id,displayName,membershipType`));}
      if(url.pathname==='/api/add'&&req.method==='POST') {
        if(session.busy) return send(res,409,{error:'An addition is already running.'});
        const b=await read(req);if(typeof b.user!=='string'||!b.user.trim()||!Array.isArray(b.indices)||!b.indices.length||b.indices.some(i=>!Number.isInteger(i)||!catalog[i]))throw Error('Enter a user and select at least one entry.');
        const chosen=[...new Set(b.indices)].map(i=>({...catalog[i]}));session.busy=true;
        session.progress={runId:b.runId,total:chosen.length,completed:0,current:'Finding user',running:true,failed:0};
        try {
          if(chosen.some(x=>!x.teamId||x.type==='channel'||(x.type!=='team'&&!x.channelId)))throw Error('Look up the team and channel IDs, or enter them, before adding the user.');
          const user=await graph(session.token,'/users/'+encodeURIComponent(b.user.trim())+'?$select=id,displayName,userPrincipalName');
          const results=[],teams=new Map();
          for(const item of chosen){
            session.progress.current=item.name;
            try{results.push({name:item.name,status:await addOne(session.token,item,user.id,teams)});}
            catch(e){session.progress.failed++;results.push({name:item.name,status:'Error: '+e.message});}
            finally{session.progress.completed++;}
          }
          return send(res,200,{user,results});
        }finally{session.busy=false;session.progress.running=false;session.progress.current=session.progress.completed===session.progress.total?'Finished':'Stopped before every entry was processed';}
      }
      return send(res,404,{error:'Not found.'});
    }
    if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.png')?'image/png':url.pathname==='/'?'text/html; charset=utf-8':url.pathname.endsWith('.js')?'text/javascript':'text/css','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",'Cache-Control':'no-store'});return res.end(fs.readFileSync(path.join(ROOT,'public',url.pathname==='/'?'index.html':url.pathname.slice(1))));}
    send(res,404,{error:'Not found.'});
  }catch(e){send(res,400,{error:e.message});}
});
if(require.main===module)server.listen(3000,'127.0.0.1',()=>console.log('Open '+BASE));
process.on('exit',()=>{for(const session of sessions.values())session.token?.close();});
module.exports={validateCatalog,resolveNames,resolveCatalog,ensureMember,addOne,server};

