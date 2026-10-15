const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateCatalog,ensureMember,server}=require('../server');
const team={name:'Alpha',teamId:'11111111-1111-1111-1111-111111111111',type:'team'};
test('normalizes and keeps the channel ID',()=>{assert.equal(validateCatalog([team])[0].channelId,'');assert.equal(validateCatalog([{...team,type:'private',channelId:'19:abc@thread.tacv2'}])[0].channelId,'19:abc@thread.tacv2');});
test('rejects duplicates, invalid types, and a missing channel ID',()=>{assert.throws(()=>validateCatalog([team,team]));assert.throws(()=>validateCatalog([{...team,type:'owner'}]));assert.throws(()=>validateCatalog([{...team,type:'private'}]));assert.throws(()=>validateCatalog([{...team,teamId:'../wrong'}]));});
test('existing membership is found on the next page without POST',async()=>{
  let calls=0;
  const client={request:async command=>{assert.equal(command.action,'request');assert.equal(command.method,'GET');calls++;return calls===1?{value:[], '@odata.nextLink':'https://graph.microsoft.com/v1.0/next'}:{value:[{userId:'user-1'}]};}};
  assert.equal(await ensureMember(client,'/teams/team/members','user-1'),'Already a member');assert.equal(calls,2);
});
test('a 403 while reading is explained without trying to change membership',async()=>{
  const client={request:async command=>{assert.equal(command.method,'GET');const e=Error('Forbidden');e.status=403;throw e;}};
  await assert.rejects(ensureMember(client,'/teams/team/members','user-1'),/read the team membership.*TeamMember.Read.All/);
});
test('a 403 while writing shows the required write permission',async()=>{
  const client={request:async command=>{if(command.method==='GET')return {value:[]};const e=Error('Forbidden');e.status=403;throw e;}};
  await assert.rejects(ensureMember(client,'/teams/team/members','user-1'),/change the team membership.*TeamMember.ReadWriteNonOwnerRole.All/);
});
test('the local HTTP server serves the UI and rejects changes without CSRF and sign-in',async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const localFetch=(url,options={})=>new Promise((resolve,reject)=>{
    const req=require('node:http').request(url,{method:options.method||'GET',headers:options.headers},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:{get:name=>{const v=res.headers[name];return Array.isArray(v)?v[0]:v;}},text:async()=>body,json:async()=>JSON.parse(body)}));
    });req.on('error',reject);req.end(options.body);
  });
  try{
    const page=await localFetch(base+'/',{headers:{Host:'localhost:3000'}});assert.equal(page.status,200);assert.match(await page.text(),/Give the user access/);
    const state=await localFetch(base+'/api/state',{headers:{Host:'localhost:3000'}});const cookie=state.headers.get('set-cookie').split(';')[0];const data=await state.json();assert.equal(data.me,null);
    const denied=await localFetch(base+'/api/catalog',{method:'POST',headers:{Host:'localhost:3000'},body:'[]'});assert.equal(denied.status,403);
    const add=await localFetch(base+'/api/add',{method:'POST',headers:{Host:'localhost:3000',Cookie:cookie,Origin:'http://localhost:3000','X-CSRF-Token':data.csrf},body:'{}'});assert.equal(add.status,401);
    const host=await localFetch(base+'/api/state');assert.equal(host.status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
