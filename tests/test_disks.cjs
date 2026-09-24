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
assert.equal(changed.unattributed,0);
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
