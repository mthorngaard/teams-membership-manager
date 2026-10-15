const {test}=require('node:test');
const assert=require('node:assert/strict');
const {addOne,validateCatalog}=require('../server');
const teamId='11111111-1111-1111-1111-111111111111';
const channelId='19:abc@thread.tacv2';
const fast={syncDelayMs:0,retryDelayMs:0};
function client(handler){
  const calls=[];
  return {calls,request:async command=>{calls.push(command);return handler(command);}};
}
test('a standard channel is rejected without a team change when its type has changed',async()=>{
  const token=client(()=>({membershipType:'private'}));
  await assert.rejects(addOne(token,{name:'General',teamId,type:'standard',channelId},'user-1',new Map(),fast),/The channel type has changed/);
  assert.equal(token.calls.length,1);
  assert.equal(token.calls[0].method,'GET');
  assert.match(token.calls[0].url,/membershipType/);
});
test('a standard channel is added only through the team when the type is still standard',async()=>{
  const token=client(command=>{
    if(command.url.includes('membershipType'))return {membershipType:'standard'};
    if(command.method==='GET')return {value:[]};
    assert.equal(command.method,'POST');
    assert.doesNotMatch(command.url,/\/channels\//);
    return {};
  });
  assert.equal(await addOne(token,{name:'General',teamId,type:'standard',channelId},'user-1',new Map(),fast),'Access through the team: Added');
  assert.equal(token.calls.filter(call=>call.method==='POST').length,1);
});
test('a private channel checks the type before team membership and retries on 400',async()=>{
  let channelPosts=0;
  const token=client(command=>{
    if(command.url.includes('membershipType'))return {membershipType:'private'};
    if(command.method==='GET')return {value:[]};
    if(command.url.includes('/channels/')){channelPosts++;if(channelPosts===1){const error=Error('Bad Request');error.status=400;throw error;}return {};}
    return {};
  });
  assert.equal(await addOne(token,{name:'Private',teamId,type:'private',channelId},'user-1',new Map(),fast),'Added');
  assert.equal(channelPosts,2);
  assert.deepEqual(token.calls.slice(0,3).map(call=>call.method+' '+(call.url.includes('membershipType')?'type':call.url.includes('/channels/')?'channel':'team')),['GET type','GET team','POST team']);
});
test('a shared channel is added directly and rejected before any change if the type has changed',async()=>{
  const changed=client(()=>({membershipType:'standard'}));
  await assert.rejects(addOne(changed,{name:'Shared',teamId,type:'shared',channelId},'user-1',new Map(),fast),/The channel type has changed/);
  assert.equal(changed.calls.length,1);
  const token=client(command=>{
    if(command.url.includes('membershipType'))return {membershipType:'shared'};
    if(command.method==='GET')return {value:[]};
    assert.match(command.url,/\/channels\//);
    return {};
  });
  assert.equal(await addOne(token,{name:'Shared',teamId,type:'shared',channelId},'user-1',new Map(),fast),'Added');
  assert.equal(token.calls.some(call=>call.method==='POST'&&!call.url.includes('/channels/')),false);
});
test('a channel without an ID can be saved when the team and channel names are included',()=>{
  const saved=validateCatalog([{name:'Alpha / General',teamName:'Alpha',channelName:'General',type:'channel',teamId:'',channelId:''}]);
  assert.equal(saved[0].teamName,'Alpha');
  assert.equal(saved[0].channelName,'General');
  assert.equal(saved[0].teamId,'');
});
