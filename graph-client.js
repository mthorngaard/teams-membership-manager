const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const path=require('node:path');
function graphStatus(status, message) {
  const numeric=Number(status);
  if(Number.isInteger(numeric)&&numeric>=100&&numeric<=599)return numeric;
  const match=/does not indicate success:\s+[^(]*\((\d{3})\)/.exec(String(message||''));
  return match?Number(match[1]):0;
}
class GraphClient {
  constructor(){this.pending=new Map();this.sequence=0;this.closed=false;}
  captureLoginMessage(message){
    const code=/\bcode\s+([A-Z0-9-]{6,})\b/i.exec(message)?.[1];
    if(code)this.deviceLogin={code,verificationUrl:'https://microsoft.com/devicelogin'};
  }
  start(){
    if(this.process)return;
    this.process=spawn('pwsh',['-NoLogo','-NoProfile','-File',path.join(__dirname,'graph-worker.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const fail=()=>{this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('The Graph process ended. Sign in again. Check PowerShell 7 and Microsoft.Graph.Authentication.'));}this.pending.clear();};
    this.process.on('error',fail);this.process.on('exit',fail);this.process.stdin.on('error',fail);
    this.process.stderr.on('data',()=>{});
    createInterface({input:this.process.stdout}).on('line',line=>{
      if(!line.startsWith('GRAPH:')){if(this.loginPending)this.captureLoginMessage(line);return;}
      let d;try{d=JSON.parse(line.slice(6));}catch{return;}
      const p=this.pending.get(d.id);if(!p)return;
      if(d.event==='loginMessage'){this.captureLoginMessage(d.message);return;}
      if(d.id===this.loginPending){this.loginPending=null;this.deviceLogin=null;}
      this.pending.delete(d.id);clearTimeout(p.timer);
      if(d.error){const e=Error(d.error);e.status=graphStatus(d.status,d.error);p.reject(e);}else p.resolve(d.data);
    });
  }
  request(command){
    if(this.closed)return Promise.reject(Error('The Graph session is closed. Sign in again.'));
    this.start();const id=++this.sequence;
    if(command.action==='login'){this.loginPending=id;this.deviceLogin=null;}
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.rejectPending(id,Error('The Graph call took too long. Sign in again.'));this.close();},command.action==='login'?900000:120000);
      this.pending.set(id,{resolve,reject,timer});this.process.stdin.write(JSON.stringify({...command,id})+'\n');
    });
  }
  rejectPending(id,error){const pending=this.pending.get(id);if(!pending)return;this.pending.delete(id);clearTimeout(pending.timer);pending.reject(error);}
  close(){this.closed=true;this.process?.kill();for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error('The Graph session is closed.'));}this.pending.clear();}
}
module.exports={GraphClient,graphStatus};
