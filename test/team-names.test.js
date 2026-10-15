const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateCatalog,resolveNames,resolveCatalog}=require('../server');
const requested=require('../teams-import.json');
test('the universal starting list is empty and valid',()=>{
  assert.deepEqual(requested,[]);assert.deepEqual(validateCatalog(requested),[]);
});
test('channel lookup distinguishes General from Projects and gets the actual type',async()=>{
  const id='11111111-1111-1111-1111-111111111111';let calls=0;
  const input=[{name:'Alpha / General',teamName:'Alpha',channelName:'General',type:'channel',teamId:'',channelId:''},{name:'Alpha / Projects',teamName:'Alpha',channelName:'Projects',type:'channel',teamId:'',channelId:''}];
  const resolved=await resolveCatalog(input,[{id,displayName:'Alpha'}],async()=>{calls++;return [{id:'channel1',displayName:'General',membershipType:'private'},{id:'channel2',displayName:'Projects',membershipType:'shared'}];});
  assert.equal(calls,1);assert.equal(resolved.catalog[0].channelId,'channel1');assert.equal(resolved.catalog[0].type,'private');assert.equal(resolved.catalog[1].channelId,'channel2');assert.equal(resolved.catalog[1].type,'shared');
});
test('a failed channel lookup keeps the entry without inventing an ID or type',async()=>{
  const input=[{name:'Alpha / General',teamName:'Alpha',channelName:'General',type:'channel',teamId:'',channelId:''}];
  const resolved=await resolveCatalog(input,[{id:'11111111-1111-1111-1111-111111111111',displayName:'Alpha'}],async()=>{throw Error('Forbidden');});
  assert.equal(resolved.catalog[0].channelId,'');assert.equal(resolved.catalog[0].type,'channel');assert.match(resolved.results.at(-1).status,/Forbidden/);
});
test('import also accepts names without ID fields and shows precise errors',()=>{
  assert.deepEqual(validateCatalog(['Alpha',{name:'Beta'}]),[{name:'Alpha',teamId:'',type:'team',channelId:''},{name:'Beta',teamId:'',type:'team',channelId:''}]);
  assert.throws(()=>validateCatalog([{name:'Gamma',type:'private'}]),/Entry 1 \(Gamma\): Team ID/);
});
test('name lookup rejects ambiguous names and keeps missing teams',()=>{
  const id='11111111-1111-1111-1111-111111111111';
  const result=resolveNames([{name:'Alpha',teamId:'',type:'team'},{name:'Beta',teamId:'',type:'team'},{name:'Missing',teamId:'',type:'team'}],[{id,displayName:'alpha'},{id,displayName:'Beta'},{id:'22222222-2222-2222-2222-222222222222',displayName:'Beta'}]);
  assert.equal(result.catalog[0].teamId,id);assert.equal(result.catalog[1].teamId,'');assert.equal(result.catalog[2].teamId,'');
});
