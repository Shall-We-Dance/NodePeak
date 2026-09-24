const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('static/disks.js', 'utf8'), context);
const {summarize,owner,summarizeUsers} = context.window.DiskUsage;
const disks=[{mount:'/',used:8192,total:32768,free:24064},{mount:'/data',used:16384,total:32768,free:15360},{mount:'/database',used:4096,total:16384,free:12288},{mount:'/empty',used:1024,total:8192,free:7168}];
const scan={state:'partial',roots:['/home','/data','/database'],users:{
 '1000':{name:'alice',roots:{'/home':1024,'/data':4096,'/database':1024}},
 '1001':{name:'bob',roots:{'/data/projects':2048,'/database':1024}}
},errors:2,error_examples:['/data/private: Permission denied','/home/gone: No such file or directory']};
assert.equal(owner('/database/user',disks),'/database');
assert.equal(owner('/data2/user',disks),'/');
const data=summarize(disks[1],scan,disks);
assert.equal(data.users.length,2);
assert.equal(data.attributed,6144);
assert.equal(data.unattributed,10240);
assert.equal(data.users[0].bytes,4096);
assert.equal(data.issues.length,1);
assert.equal(data.issues[0].path,'/data/private');
assert.equal(data.issues[0].bytes,undefined); // an unreadable entry has no fabricated size
assert.equal(data.denominator,32768); // entire disk, not the 16384 bytes used
assert.equal(data.users[0].bytes/data.denominator*100,12.5);
assert.equal(data.reserved,1024);
assert.equal(data.attributed+data.unattributed+data.free+data.reserved,data.total);
assert.equal(data.capacityReady,true);
const root=summarize(disks[0],scan,disks);
assert.equal(root.attributed,1024);
assert.equal(root.issues.length,1);
assert.equal(root.issues[0].reason,'No such file or directory');
const empty=summarize(disks[3],scan,disks);
assert.equal(empty.scanned,false);
assert.equal(empty.unattributed,1024);
const changed=summarize({...disks[1],used:2000},scan,disks);
assert.equal(changed.unattributed,null);
assert.equal(changed.snapshotExceedsUsage,true);
assert.equal(changed.denominator,32768);
assert.equal(changed.capacityReady,false);
const users=summarizeUsers(scan,disks);
assert.equal(users[0].name,'alice');
assert.equal(users[0].bytes,6144);
assert.equal(users[0].disks.length,3);
assert.equal(users[1].bytes,3072);
assert.equal(users.reduce((n,u)=>n+u.bytes,0),disks.reduce((n,d)=>n+summarize(d,scan,disks).attributed,0));
assert.equal(summarizeUsers({users:{}},disks).length,0);
const missing=summarize({mount:'/',total:0,used:0,free:0},{users:{}},disks);
assert.equal(missing.capacityReady,false);
console.log('Passed: per-filesystem ownership, nested paths, unknown entries, unscanned disks, and scan/live differences.');

// Deleting files must not hide confirmed free space or fabricate current ownership.
context.t=(key,values={})=>key.replace(/\{(\w+)\}/g,(_,k)=>values[k]??'');
const afterDelete={mount:'/data',device:'/dev/example',fstype:'ext4',total:1000,used:400,free:550};
const oldScan={state:'complete',finished_at:100,roots:['/data'],users:{'1000':{name:'alice',roots:{'/data':600}}}};
const helpers={esc:String,bytes:n=>String(n),fmt:n=>String(n),color:()=> '#123456',date:()=> 'scan-time'};
const html=context.window.DiskUsage.render(afterDelete,oldScan,[afterDelete],helpers);
assert.match(html,/unattributed-segment" style="width:40%/);
assert.match(html,/reserved-segment" style="width:5%/);
assert.ok(Math.abs(Number(html.match(/free-segment" style="width:([\d.]+)%/)[1])-55)<1e-8);
assert.match(html,/stale-allocation/);
assert.match(html,/Last scan: scan-time/);
assert.match(html,/600<\/td><td>—/);
assert.doesNotMatch(html,/data-owner=/);
const freshScan={...oldScan,users:{'1000':{name:'alice',roots:{'/data':300}}}};
const fresh=context.window.DiskUsage.render(afterDelete,freshScan,[afterDelete],helpers);
assert.match(fresh,/data-owner="1000" style="width:30%/);
assert.doesNotMatch(fresh,/class="stale-allocation/);
console.log('Passed: deleted-file reconciliation preserves live capacity, labels stale ownership, and recovers on a fresh scan.');
