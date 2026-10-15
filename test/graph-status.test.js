const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {GraphClient,graphStatus}=require('../graph-client');
test('a Graph error message becomes an HTTP status when the module does not send the code',()=>{
  assert.equal(graphStatus(0,'Response status code does not indicate success: Bad Request (400). The user is not found'),400);
  assert.equal(graphStatus(403,'Response status code does not indicate success: Bad Request (400).'),403);
  assert.equal(graphStatus(undefined,'Sign in with Microsoft first.'),0);
});
test('the time limit rejects with the timeout message',async()=>{
  mock.timers.enable({apis:['setTimeout']});
  const client=new GraphClient();
  let killed=false;
  client.process={stdin:{write(){},on(){}},kill(){killed=true;}};
  try{
    const pending=client.request({action:'request'});
    const assertion=assert.rejects(pending,/The Graph call took too long/);
    mock.timers.tick(120000);
    await assertion;
    assert.equal(killed,true);
    assert.equal(client.pending.size,0);
  }finally{mock.timers.reset();}
});
test('PowerShell reads the status from the Graph module error',()=>{
  const script=path.join(__dirname,'..','graph-status.ps1').replace(/'/g,"''");
  const command=`
    . '${script}'
    $message = [System.Management.Automation.ErrorRecord]::new([System.Exception]::new('Response status code does not indicate success: Bad Request (400).'), 'InvokeGraphHttpResponseException', 'InvalidOperation', $null)
    Add-Type -TypeDefinition @'
public class GraphStatusResponse { public int StatusCode { get; set; } public GraphStatusResponse(int code) { StatusCode = code; } }
public class GraphStatusException : System.Exception {
  public GraphStatusResponse Response { get; }
  public int StatusCode { get; }
  public GraphStatusException(int responseCode, int statusCode, string message) : base(message) {
    if (responseCode > 0) Response = new GraphStatusResponse(responseCode);
    StatusCode = statusCode;
  }
}
'@
    $response = [System.Management.Automation.ErrorRecord]::new([GraphStatusException]::new(403, 0, 'fail'), 'id', 'InvalidOperation', $null)
    $statusCode = [System.Management.Automation.ErrorRecord]::new([GraphStatusException]::new(0, 401, 'fail'), 'id', 'InvalidOperation', $null)
    @{ message = (Get-GraphHttpStatus $message); response = (Get-GraphHttpStatus $response); statusCode = (Get-GraphHttpStatus $statusCode) } | ConvertTo-Json -Compress
  `;
  const result=spawnSync('pwsh',['-NoLogo','-NoProfile','-Command',command],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.deepEqual(JSON.parse(result.stdout),{message:400,response:403,statusCode:401});
});
