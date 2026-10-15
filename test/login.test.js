const {test}=require('node:test');
const assert=require('node:assert/strict');
const {GraphClient}=require('../graph-client');
test('extracts the Microsoft sign-in code and uses a fixed Microsoft link',()=>{
  const client=new GraphClient();
  client.captureLoginMessage('To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABC123XYZ to authenticate.');
  assert.deepEqual(client.deviceLogin,{code:'ABC123XYZ',verificationUrl:'https://microsoft.com/devicelogin'});
});
