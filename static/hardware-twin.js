'use strict';
window.HardwareTwin = (() => {
  const clean=value=>value!=null&&!/^(?:unknown|not specified|none|not provided|to be filled by o\.e\.m\.)$/i.test(String(value).trim())?String(value).trim():'';
  const count=value=>Number.isInteger(Number(value))&&Number(value)>0&&Number(value)<=2048?Number(value):0;
  function occupancy(fields,kind){
    const value=String(kind==='cpu'?fields.Status||'':fields.Size||'');
    if(kind==='cpu')return /not populated|unpopulated|not installed/i.test(value)?'empty':/\bpopulated\b/i.test(value)?'installed':'unknown';
    return /no module installed|not installed/i.test(value)?'empty':/^\s*[1-9][\d,.]*\s*(?:[KMGT]i?B|bytes?)\s*$/i.test(value)?'installed':'unknown';
  }
  // Controller identity takes precedence over its advertised rotation flag.
  function classifyDrive(disk){
    const transport=String(disk.tran||'').toLowerCase(),model=String(disk.model||'');
    const rotation=[true,1,'1'].includes(disk.rota)?true:[false,0,'0'].includes(disk.rota)?false:null;
    if(disk.type==='rom')return {label:'Optical drive',kind:'optical'};
    if(/^raid|^md$/.test(disk.type||'')||/\bPERC\b|MegaRAID|Smart Array|\bRAID\b/i.test(model))return {label:'RAID virtual disk',kind:'raid'};
    if(/Virtual Disk|VMware|QEMU|VBOX|Virtual HD/i.test(model)||transport==='virtio')return {label:'Virtual disk',kind:'virtual'};
    if(transport==='nvme'||/\/nvme\d+n\d+$/.test(disk.name||''))return {label:'NVMe',kind:'ssd'};
    const media=rotation===true?'HDD':rotation===false?'SSD':'';
    const bus=transport==='sata'?'SATA':transport==='sas'?'SAS':transport?transport.toUpperCase():String(disk.vendor||'').trim()==='ATA'?'ATA':'';
    return {label:[bus,media].filter(Boolean).join(' ')||'Unknown drive type',kind:rotation===true?'hdd':rotation===false?'ssd':'unknown'};
  }
  function prepare(data){
    const records=data.firmware_records||[],memory=data.memory||{},cpu=data.cpu||{};
    const processors=records.filter(record=>record.type===4),dimms=records.filter(record=>record.type===17);
    let cpus=processors.map((record,index)=>({id:`cpu-${index}`,kind:'cpu',label:clean(record.fields['Socket Designation'])||`CPU ${index+1}`,state:occupancy(record.fields,'cpu'),fields:record.fields,source:'Firmware-reported socket',model:clean(record.fields.Version)}));
    const cpuFallback=!cpus.length;
    if(cpuFallback)cpus=Array.from({length:count(cpu['Socket(s)'])},(_,index)=>({id:`cpu-${index}`,kind:'cpu',label:`CPU ${index+1}`,state:'installed',model:clean(cpu['Model name']),fields:cpu,source:'OS-reported processor; empty sockets are unknown'}));
    let slots=dimms.map((record,index)=>({id:`memory-${index}`,kind:'memory',label:clean(record.fields.Locator)||`DIMM ${index+1}`,state:occupancy(record.fields,'memory'),fields:record.fields,source:'Firmware-reported slot',model:clean(record.fields['Part Number'])}));
    if(!dimms.length){
      slots=(memory.modules||[]).map((fields,index)=>({id:`memory-${index}`,kind:'memory',label:clean(fields.Locator)||`DIMM ${index+1}`,state:occupancy(fields,'memory'),fields,source:'Reported memory module',model:clean(fields['Part Number'])}));
    }
    const reportedSlots=count(memory.slots),unmapped=Math.max(0,reportedSlots-slots.length);
    for(let index=0;index<unmapped;index++)slots.push({id:`unmapped-${index}`,kind:'memory',label:null,ordinal:index+1,state:'unknown',fields:{},source:'Slot location and occupancy are unavailable',model:''});
    const total=rows=>({installed:rows.filter(row=>row.state==='installed').length,empty:rows.filter(row=>row.state==='empty').length,unknown:rows.filter(row=>row.state==='unknown').length,total:rows.length});
    const board={id:'board',kind:'board',label:'Motherboard',state:clean(data.board?.Model)?'installed':'unknown',model:clean(data.board?.Model),fields:data.board||{},source:'System inventory'};
    const bios={id:'bios',kind:'bios',label:'BIOS / firmware',state:clean(data.bios?.Version)?'installed':'unknown',model:clean(data.bios?.Version),fields:data.bios||{},source:'System inventory'};
    const os={id:'os',kind:'os',label:'Operating system',state:data.system?.distribution?'installed':'unknown',model:data.system?.distribution||'',fields:{Distribution:data.system?.distribution,Architecture:data.system?.architecture,Kernel:data.system?.kernel,'Boot mode':data.system?.boot_mode},source:'Operating system'};
    const nics=(data.network||[]).map((nic,index)=>({id:`nic-${index}`,kind:'nic',label:nic.Interface||`NIC ${index+1}`,state:'installed',model:clean(nic.Model),fields:nic,source:'Detected physical interface'}));
    const disks=(data.disks||[]).map((disk,index)=>({classification:classifyDrive(disk),id:`drive-${index}`,kind:'disk',label:disk.name||`Disk ${index+1}`,state:'installed',model:clean(disk.model),fields:{Model:disk.model,Manufacturer:disk.vendor,'Firmware version':disk.rev,Transport:disk.tran,'Mount points':(disk.mountpoints||[]).join(', ')},size:disk.size,optical:disk.type==='rom',controller:classifyDrive(disk).kind==='raid',source:'OS-reported storage device'}));
    return {cpus,slots,nics,disks,board,bios,os,cpuFallback,unmapped,cpuStats:total(cpus),memoryStats:total(slots),memoryBytes:memory.total_bytes,parts:[board,bios,os,...cpus,...slots,...nics,...disks]};
  }
  let current=null,settings=null,selected='board';
  const statusKey=part=>part.kind&&!['cpu','memory'].includes(part.kind)?(part.state==='installed'?'Detected':'Unavailable'):({installed:'Installed',empty:'Empty slot',unknown:'Unknown occupancy'})[part.state];
  const partLabel=part=>part.label?(part.kind==='board'||part.kind==='bios'||part.kind==='os'?t(part.label):part.label):t('Unmapped slot {number}',{number:part.ordinal});
  const icon=kind=>({board:'▦',bios:'▤',os:'▧',nic:'▥',disk:'▰'})[kind]||'◫';
  function overviewStats(stats){return t('{installed} installed · {empty} empty · {unknown} unknown',{installed:stats.installed,empty:stats.empty,unknown:stats.unknown});}
  function html(data,helpers){
    current=prepare(data);settings=helpers;
    if(!current.parts.some(part=>part.id===selected))selected='board';
    const {esc,bytes}=helpers,m=current;
    const button=(part,inner,classes='')=>`<button type="button" class="twin-part ${classes} twin-${part.state}" data-twin-part="${esc(part.id)}" aria-pressed="${part.id===selected}" aria-controls="twin-inspector" aria-label="${esc([partLabel(part),t(statusKey(part)),part.model].filter(Boolean).join(' · '))}" title="${esc([partLabel(part),t(statusKey(part)),part.model].filter(Boolean).join(' · '))}">${inner}</button>`;
    const countPill=(key,stats)=>`<span class="twin-count"><strong>${stats.total?stats.installed:'—'}${stats.total?`<small> / ${stats.total}</small>`:''}</strong><span>${esc(t(key))}</span></span>`;
    const cpuButtons=m.cpus.map(part=>button(part,`<span class="twin-socket-label">${esc(partLabel(part))}</span><span class="twin-cpu-package"><span class="twin-part-kind">CPU</span><strong>${esc(part.state==='empty'?t('Empty slot'):part.model||t('Model unavailable'))}</strong><small>${esc(part.state==='installed'&&count(part.fields['Core Count'])?t('{cores} cores · {threads} threads',{cores:part.fields['Core Count'],threads:part.fields['Thread Count']||'—'}):t(statusKey(part)))}</small></span><span class="twin-part-status"><i></i>${esc(t(statusKey(part)))}</span>`,'twin-cpu')).join('');
    const memoryButtons=m.slots.map(part=>button(part,`<span class="twin-dimm-label">${esc(part.label||'?')}</span><span class="twin-dimm-stick" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="twin-dimm-size">${esc(part.state==='installed'?clean(part.fields.Size)||'—':part.state==='empty'?t('Empty'):'?')}</span>`,'twin-dimm'));
    const memoryRows=Array.from({length:Math.ceil(memoryButtons.length/12)},(_,index)=>`<div class="twin-dimm-grid">${memoryButtons.slice(index*12,index*12+12).join('')}</div>`).join('');
    const nicButtons=m.nics.map(part=>button(part,`<span class="twin-port-jack" aria-hidden="true"><i></i></span><strong>${esc(partLabel(part))}</strong><small>${esc(part.fields['Speed (Mbps)']&&Number(part.fields['Speed (Mbps)'])>0?part.fields['Speed (Mbps)']+' Mb/s':t('Physical NIC'))}</small>`,'twin-nic')).join('');
    const diskButtons=m.disks.map(part=>button(part,`<span class="twin-drive-icon ${part.classification.kind}" aria-hidden="true"><i></i></span><span class="twin-drive-caption"><strong>${esc(partLabel(part))} <em class="twin-drive-type">${esc(t(part.classification.label))}</em></strong><span>${esc(part.model||t('Model unavailable'))}</span><small>${esc(bytes(part.size))}${part.controller?' · '+esc(t('Controller-reported')):''}</small></span>`,'twin-drive')).join('');
    return `<section class="hardware-twin" aria-label="${esc(t('Hardware twin'))}">
      <header class="twin-heading"><div><span class="twin-eyebrow">${esc(t('HARDWARE TWIN'))}</span><h3>${esc(data.system?.['Product name']||m.board.model||t('Server hardware'))}</h3><p>${esc(t('Select a component to inspect its model and specifications.'))}</p></div><div class="twin-counts">${countPill('Processors',m.cpuStats)}${countPill('Memory slots',m.memoryStats)}<span class="twin-count"><strong>${esc(bytes(m.memoryBytes))}</strong><span>${esc(t('OS-visible memory'))}</span></div></header>
      <div class="twin-legend">${['installed','empty','unknown'].map(state=>`<span><i class="twin-legend-${state}"></i>${esc(t(statusKey({state})))}</span>`).join('')}<span class="twin-diagram-note">${esc(t('Schematic layout · not physical placement or wiring'))}</span></div>
      <div class="twin-layout"><div class="twin-scene">
        ${button(m.os,`<span class="twin-os-icon" aria-hidden="true">${icon('os')}</span><span><small>${esc(t('Operating system'))}</small><strong>${esc(m.os.model||t('Unavailable'))}</strong><small>${esc([data.system?.architecture,data.system?.kernel].filter(Boolean).join(' · '))}</small></span>`,'twin-os')}
        <div class="twin-board"><span class="twin-screw screw-a" aria-hidden="true"></span><span class="twin-screw screw-b" aria-hidden="true"></span><span class="twin-screw screw-c" aria-hidden="true"></span><span class="twin-screw screw-d" aria-hidden="true"></span>
          <div class="twin-board-header">${button(m.board,`<span aria-hidden="true">${icon('board')}</span><span><small>${esc(t('Motherboard'))}</small><strong>${esc(m.board.model||t('Model unavailable'))}</strong><small>${esc(clean(data.board?.Manufacturer))}</small></span>`,'twin-board-id')}${button(m.bios,`<span class="twin-bios-chip" aria-hidden="true">BIOS</span><span><strong>${esc(m.bios.model||t('Unavailable'))}</strong><small>${esc(clean(data.bios?.Manufacturer))}</small></span>`,'twin-bios')}</div>
          <div class="twin-zone-heading"><h4>${esc(t('CPU sockets'))}</h4><small>${esc(overviewStats(m.cpuStats))}</small></div>
          <div class="twin-cpu-grid ${m.cpus.length===1?'single-cpu':''}">${cpuButtons||`<p class="twin-unavailable">${esc(t('CPU socket inventory is unavailable.'))}</p>`}</div>
          ${m.cpuFallback?`<p class="twin-evidence-note">${esc(t('OS-reported processors only; physical empty sockets are unknown.'))}</p>`:''}
          <div class="twin-zone-heading"><h4>${esc(t('Memory slots'))}</h4><small>${esc(overviewStats(m.memoryStats))}</small></div>
          <div class="twin-memory-rows">${memoryRows||`<p class="twin-unavailable">${esc(t('Memory slot inventory is unavailable. Total RAM does not reveal slot count.'))}</p>`}</div>
          ${m.unmapped?`<p class="twin-evidence-note">${esc(t('Unmapped slots have no confirmed location or occupancy.'))}</p>`:''}
          <div class="twin-zone-heading"><h4>${esc(t('Physical network interfaces'))}</h4><small>${m.nics.length}</small></div>
          <div class="twin-ports">${nicButtons||`<p class="twin-unavailable">${esc(t('No physical interfaces reported'))}</p>`}</div>
        </div>
        <div class="twin-storage"><div class="twin-zone-heading"><h4>${esc(t('Storage devices'))}</h4><small>${esc(t('Detected devices · bay positions unknown'))}</small></div><div class="twin-drives">${diskButtons||`<p class="twin-unavailable">${esc(t('No storage devices reported'))}</p>`}</div></div>
      </div><aside class="twin-inspector" id="twin-inspector" aria-label="${esc(t('Selected component'))}" aria-live="polite"></aside></div>
    </section>`;
  }
  function inspect(){
    if(!current||!settings)return;
    const host=document.getElementById('hardware-content'),panel=document.getElementById('twin-inspector');if(!panel)return;
    const part=current.parts.find(item=>item.id===selected)||current.board,{esc,bytes}=settings;
    for(const button of host.querySelectorAll('[data-twin-part]'))button.setAttribute('aria-pressed',String(button.dataset.twinPart===part.id));
    const fields={...part.fields,...(part.kind==='disk'?{Type:t(part.classification.label),Capacity:bytes(part.size)}:{})};
    panel.innerHTML=`<button type="button" class="twin-back" data-twin-back>${esc(t('Back to diagram'))}</button><span class="twin-eyebrow">${esc(t('Selected component'))}</span><h4>${esc(partLabel(part))}</h4><p class="twin-inspector-status twin-${part.state}"><i></i>${esc(t(statusKey(part)))}</p><p class="twin-evidence-note">${esc(t(part.source))}</p>`+
      (part.state==='empty'?`<div class="twin-empty-illustration" aria-hidden="true">${part.kind==='cpu'?'▦':'▥'}</div><p class="twin-empty-note">${esc(t('This slot is reported as unoccupied.'))}</p>`:'')+
      (part.controller?`<p class="twin-evidence-note">${esc(t('This is the model reported by the storage controller; member-drive models may be unavailable.'))}</p>`:'')+
      `<dl class="hardware-fields">${Object.entries(fields).map(([key,value])=>`<div><dt>${esc(t(key))}</dt><dd class="${clean(value)?'':'hardware-unavailable'}">${esc(clean(value)||t('Unavailable'))}</dd></div>`).join('')}</dl>`;
  }
  function mount(){
    const host=document.getElementById('hardware-content');if(!host)return;
    if(!host._twinBound){
      host.addEventListener('click',event=>{
        if(event.target.closest('[data-twin-back]')){
          const button=[...host.querySelectorAll('[data-twin-part]')].find(item=>item.dataset.twinPart===selected);
          button?.focus({preventScroll:true});button?.scrollIntoView({block:'center',behavior:'instant'});return;
        }
        const button=event.target.closest('[data-twin-part]');
        if(button&&current?.parts.some(part=>part.id===button.dataset.twinPart)){
          selected=button.dataset.twinPart;inspect();
          if(matchMedia('(max-width:1100px)').matches)document.getElementById('twin-inspector').scrollIntoView({block:'center',behavior:'instant'});
        }
      });
      host._twinBound=true;
    }
    inspect();
  }
  return {prepare,occupancy,classifyDrive,html,mount};
})();
