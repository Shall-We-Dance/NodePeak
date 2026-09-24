const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync('static/users.js','utf8'),context);
const {prepare,isSystem}=context.window.UserResources;
const user=(uid,cpu,memory,io_denied=0)=>({uid,name:'user'+uid,cpu,memory,processes:2,read:100,write:200,io_denied});
const live={users:{0:user(0,20,400),999:user(999,10,200,1),1000:user(1000,5,100),65534:user(65534,1,50)},disk_scan:{users:{0:{bytes:100},1000:{bytes:500},1001:{name:'alice',bytes:200}}}};
const result=prepare(live);
assert.equal(result.users.length,3);
assert.equal(result.system.length,2);
assert.equal(result.total.cpu,30);
assert.equal(result.total.memory,600);
assert.equal(result.total.processes,4);
assert.equal(result.total.io_denied,1);
assert.equal(result.total.disk,100);
assert.equal(result.total.diskPartial,true);
assert.equal(isSystem(999),true);
assert.equal(isSystem(1000),false);
assert.equal(isSystem(65534),false); // The user's explicit UID threshold is respected.
assert.equal(prepare(live,'0').users[0].uid,0);
assert.equal(prepare(live,'0').total,null);
assert.equal(prepare({users:{},disk_scan:{users:{}}}).total,null);
assert.equal(prepare({users:{1:user(1,0,10)},disk_scan:{users:{}}}).total.disk,undefined);
console.log('Passed: UID boundary, aggregated counters, selected system account, partial disk data and denied I/O.');

const {trends}=context.window.UserResources;
const gib=1024**3;
const history=[
  {ts:10,users:{0:{name:'root',cpu:20,memory:gib},999:{name:'daemon',cpu:30,memory:2*gib},1000:{name:'alice',cpu:5,memory:3*gib},65534:{name:'nobody',cpu:1,memory:gib}}},
  {ts:15,gap:true},
  {ts:20,users:{0:{name:'root',cpu:10,memory:2*gib},1000:{name:'alice',cpu:2,memory:gib}}},
];
const cpu=trends(history,'cpu');
assert.equal(cpu.filter(row=>row.kind==='system').length,1);
assert.equal(cpu.filter(row=>row.kind==='user').length,2);
assert.equal(cpu.find(row=>row.id==='65534').name,'nobody');
assert.equal(JSON.stringify(cpu.find(row=>row.kind==='system').data),JSON.stringify([[10000,50],[15000,null],[20000,10]]));
assert.equal(trends(history,'memory',{scale:gib}).find(row=>row.kind==='system').data[0][1],3);
assert.ok(cpu.every(row=>row.data[1][1]===null));
const root=trends(history,'cpu',{selected:'0'});
assert.equal(root.length,1);
assert.equal(root[0].name,'root');
assert.equal(root[0].kind,'user');
assert.equal(root[0].data[0][1],20);
assert.equal(trends(history,'cpu',{selected:'12345'}).length,0);
assert.equal(trends([],'cpu').length,0);
const crowded=[{ts:100,users:{...history[0].users,...Object.fromEntries(Array.from({length:12},(_,i)=>[1000+i,{name:'user'+i,cpu:i+1,memory:gib}]))}}];
const grouped=trends(crowded,'cpu');
assert.equal(grouped.filter(row=>row.kind==='user').length,7);
assert.equal(grouped.filter(row=>row.kind==='other').length,1);
assert.ok(grouped.find(row=>row.kind==='other').uids.every(uid=>Number(uid)>=1000));
assert.equal(grouped.find(row=>row.kind==='system').data[0][1],50);
assert.equal(grouped.reduce((sum,row)=>sum+row.data[0][1],0),Object.values(crowded[0].users).reduce((sum,u)=>sum+u.cpu,0));
assert.equal(cpu.reduce((sum,row)=>sum+row.data[2][1],0),12);
assert.equal(history[0].users[0].cpu,20);
console.log('Passed: trend System aggregation, UID boundaries, GiB scaling, gaps, missing accounts, explicit root selection and conservation with Other users.');
