const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{}};
vm.runInNewContext(fs.readFileSync('static/hardware-twin.js','utf8'),context);
const {prepare,occupancy}=context.window.HardwareTwin;
const cpu=(index,status='Populated, Enabled')=>({type:4,fields:{'Socket Designation':`CPU${index}`,Version:`Example CPU ${index}`,Status:status,'Core Count':'8','Thread Count':'16'}});
const dimm=(index,size='16 GB')=>({type:17,fields:{Locator:`DIMM ${index}`,Size:size,'Part Number':'EXAMPLE-MEMORY'}});
for(const sockets of [1,2,4,8]){
  const model=prepare({firmware_records:Array.from({length:sockets},(_,index)=>cpu(index+1))});
  assert.equal(model.cpus.length,sockets);
  assert.equal(model.cpuStats.installed,sockets);
  assert.equal(model.cpuFallback,false);
}
const model=prepare({firmware_records:[cpu(1),cpu(2,'Unpopulated'),cpu(3,'Not Populated'),cpu(4,'Unknown'),dimm(1),dimm(2,'No Module Installed'),dimm(3,'Unknown')],memory:{slots:3}});
assert.equal(model.cpuStats.installed,1);
assert.equal(model.cpuStats.empty,2);
assert.equal(model.cpuStats.unknown,1);
assert.equal(model.memoryStats.installed,1);
assert.equal(model.memoryStats.empty,1);
assert.equal(model.memoryStats.unknown,1);
assert.equal(occupancy({Status:'Populated, Disabled'},'cpu'),'installed');
assert.equal(occupancy({Size:'Unknown','Part Number':'EXAMPLE'},'memory'),'unknown');
const fallback=prepare({cpu:{'Socket(s)':'2','Model name':'Example'},memory:{slots:8,modules:[dimm(1).fields,dimm(2).fields],empty_slots:6}});
assert.equal(fallback.cpuFallback,true);
assert.equal(fallback.cpus.length,2);
assert.equal(fallback.slots.length,8);
assert.equal(fallback.memoryStats.empty,0); // An aggregate empty count cannot identify a particular slot.
assert.equal(fallback.memoryStats.unknown,6);
assert.equal(fallback.unmapped,6);
const denied=prepare({cpu:{'CPU(s)':'64'},memory:{total_bytes:128*1024**3}});
assert.equal(denied.cpus.length,0); // Logical threads are not physical socket counts.
assert.equal(denied.slots.length,0); // RAM size is not evidence of slot count.
assert.equal(prepare({cpu:{'Socket(s)':'unknown'}}).cpus.length,0);
const expanded=prepare({firmware_records:[cpu(1),...Array.from({length:96},(_,index)=>dimm(index,index<48?'32 GB':'No Module Installed'))]});
assert.equal(expanded.slots.length,96);
assert.equal(expanded.memoryStats.empty,48);
const controller=prepare({network:[{Interface:'eth0'},{Interface:'eth1'}],disks:[{name:'/dev/sda',model:'PERC Example',size:100}]});
assert.equal(controller.nics.length,2);
assert.equal(controller.disks[0].controller,true);
assert.equal(new Set(expanded.parts.map(part=>part.id)).size,expanded.parts.length);
console.log('Passed: 1/2/4/8 CPU sockets, occupancy semantics, 96 DIMMs, empty vs unknown, privilege fallback and controller-reported drives.');
const classify=context.window.HardwareTwin.classifyDrive;
for(const [disk,label] of [
 [{tran:'nvme'},'NVMe'],[{name:'/dev/nvme0n1'},'NVMe'],
 [{tran:'sata',rota:false},'SATA SSD'],[{tran:'sata',rota:'1'},'SATA HDD'],
 [{tran:'sas',rota:0},'SAS SSD'],[{tran:'sas',rota:true},'SAS HDD'],
 [{tran:'sata'},'SATA'],[{vendor:'ATA',rota:false},'ATA SSD'],
 [{model:'PERC H730P',tran:'sas',rota:true},'RAID virtual disk'],
 [{type:'raid1'},'RAID virtual disk'],[{model:'QEMU Virtual Disk'},'Virtual disk'],
 [{type:'rom',tran:'sata',rota:false},'Optical drive'],[{},'Unknown drive type']
])assert.equal(classify(disk).label,label);
console.log('Passed: drive transport, media, unknown attributes and RAID precedence.');
