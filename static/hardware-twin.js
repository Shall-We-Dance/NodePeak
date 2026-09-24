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
    if(transport==='nvme'||/\/nvme\d+n\d+$/.test(disk.name||''))return {label:'NVMe',kind:'nvme'};
    const media=rotation===true?'HDD':rotation===false?'SSD':'';
    const bus=transport==='sata'?'SATA':transport==='sas'?'SAS':transport?transport.toUpperCase():String(disk.vendor||'').trim()==='ATA'?'ATA':'';
    return {label:[bus,media].filter(Boolean).join(' ')||'Unknown drive type',kind:rotation===true?'hdd':rotation===false?'ssd':'unknown'};
  }
  // Illustrative device categories, not inferred physical form factors or bay positions.
  function driveGlyph(kind){
    const screws='<g fill="#91a7b8"><circle cx="23" cy="17" r="1.3"/><circle cx="73" cy="17" r="1.3"/><circle cx="23" cy="59" r="1.3"/><circle cx="73" cy="59" r="1.3"/></g>';
    const shell='<path d="M20 12h56l5 5v44l-5 5H20l-5-5V17z" fill="#142331" stroke="#688195" stroke-width="1.4"/><path d="M20 15h55l3 3v40l-4 5H21l-3-4V19z" fill="#263c4d"/>';
    const contacts='<path d="M31 64h34v5H31z" fill="#0a1720"/><path d="M34 65v3m4-3v3m4-3v3m4-3v3m7-3v3m4-3v3m4-3v3" stroke="#cbb478" stroke-width="2"/>';
    const chip=(x,y,w,h)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#101c27" stroke="currentColor" stroke-opacity=".65"/><path d="M${x+3} ${y+4}h${w-6}" stroke="#526b77"/>`;
    const artwork={
      ssd:shell+screws+'<rect x="27" y="23" width="42" height="29" rx="3" fill="#1a302f" stroke="currentColor" stroke-opacity=".5"/>'+chip(32,28,13,18)+chip(51,28,13,18)+'<path d="M30 56h24m4 0h8" stroke="#6e8d91" stroke-width="2"/>'+contacts,
      hdd:shell+screws+'<circle cx="46" cy="36" r="19" fill="#91a7b8" stroke="#c3d1dc"/><circle cx="46" cy="36" r="14" fill="none" stroke="#b6c7d1"/><circle cx="46" cy="36" r="6" fill="#2d4657"/><circle cx="46" cy="36" r="2" fill="#c0d4df"/><path d="m67 55-13-21-3 2 11 23z" fill="currentColor" stroke="#b9ccd3" stroke-width=".7"/><circle cx="65" cy="56" r="4" fill="#233c50" stroke="#a0b8c7"/>'+contacts,
      nvme:'<path d="M12 22h69l5 5v24l-5 5H12z" fill="#173936" stroke="currentColor" stroke-width="1.3"/><path d="M9 17v44h5M15 28h5m-5 22h5" fill="none" stroke="#9aadbb" stroke-width="2"/><path d="M28 57h41v5H28z" fill="#c5ad72"/><path d="M33 57v5m5-5v5m5-5v5m5-5v5m7-5v5m5-5v5m5-5v5" stroke="#17302c"/>'+chip(24,29,20,19)+chip(51,29,13,19)+chip(69,29,10,19)+'<path d="M25 25h27m-6 13h3M20 51h57" stroke="currentColor" stroke-opacity=".45" fill="none"/>',
      raid:'<rect x="13" y="12" width="70" height="55" rx="5" fill="#152535" stroke="#7890a4" stroke-width="1.4"/><path d="M19 68v3h8v-3m42 0v3h8v-3" stroke="#657f92" stroke-width="2"/>'+[19,34,49].map(y=>`<rect x="20" y="${y}" width="56" height="11" rx="2" fill="#2b4154" stroke="#566e83"/><path d="M25 ${y+4}h30m-30 3h30" stroke="#7790a2" stroke-width="1"/><rect x="61" y="${y+3}" width="3" height="5" rx="1" fill="currentColor"/><circle cx="70" cy="${y+5.5}" r="1.3" fill="#b9ca93"/>`).join(''),
      optical:'<path d="M13 17h70v45H13z" fill="#203548" stroke="#7c94a7" stroke-width="1.4"/><path d="M18 21h60v33H18z" fill="#111f2d"/><circle cx="48" cy="37" r="20" fill="#91a3ba" stroke="#c4cedd"/><path d="M48 17a20 20 0 0 1 17 10L48 37z" fill="#c5b9dc"/><path d="M48 57a20 20 0 0 1-17-10l17-10z" fill="#a6c5cd"/><circle cx="48" cy="37" r="7" fill="#1b2b3a" stroke="#d5dce5"/><circle cx="48" cy="37" r="3" fill="#0f1c28"/><path d="M19 59h50" stroke="#698196"/><rect x="73" y="57" width="5" height="2" rx="1" fill="currentColor"/>',
      virtual:'<path d="m48 13 29 15v31L48 73 19 59V28z" transform="translate(0 -5)" fill="#24374d" stroke="currentColor" stroke-width="1.4" stroke-dasharray="4 3"/><path d="m19 23 29 16 29-16M48 39v29" stroke="currentColor" stroke-opacity=".6" fill="none"/><path d="m36 19 25 14v18" fill="none" stroke="#8797ba"/>',
      unknown:shell+screws+'<path d="M41 29a8 8 0 1 1 13 6c-5 3-6 4-6 8" fill="none" stroke="#9eafbd" stroke-width="3" stroke-linecap="round"/><circle cx="48" cy="51" r="2" fill="#9eafbd"/>'
    };
    return `<svg class="drive-glyph" viewBox="0 0 96 80" fill="none" aria-hidden="true" focusable="false">${artwork[kind]||artwork.unknown}</svg>`;
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
    const diskButtons=m.disks.map(part=>button(part,`<span class="twin-drive-art drive-${part.classification.kind}">${driveGlyph(part.classification.kind)}</span><span class="twin-drive-caption"><span class="twin-drive-topline"><strong>${esc(partLabel(part))}</strong><em class="twin-drive-type">${esc(t(part.classification.label))}</em></span><span class="twin-drive-model">${esc(part.model||t('Model unavailable'))}</span><span class="twin-drive-bottom"><small>${esc(bytes(part.size))}${part.controller?' · '+esc(t('Controller-reported')):''}</small><span class="twin-drive-arrow" aria-hidden="true">↗</span></span></span>`,'twin-drive')).join('');
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
  function inspect(animate=false){
    if(!current||!settings)return;
    const host=document.getElementById('hardware-content'),panel=document.getElementById('twin-inspector');if(!panel)return;
    const part=current.parts.find(item=>item.id===selected)||current.board,{esc,bytes}=settings;
    for(const button of host.querySelectorAll('[data-twin-part]'))button.setAttribute('aria-pressed',String(button.dataset.twinPart===part.id));
    const fields={...part.fields,...(part.kind==='disk'?{Type:t(part.classification.label),Capacity:bytes(part.size)}:{})};
    panel.innerHTML=`<button type="button" class="twin-back" data-twin-back>${esc(t('Back to diagram'))}</button><span class="twin-eyebrow">${esc(t('Selected component'))}</span><h4>${esc(partLabel(part))}</h4><p class="twin-inspector-status twin-${part.state}"><i></i>${esc(t(statusKey(part)))}</p><p class="twin-evidence-note">${esc(t(part.source))}</p>`+
      (part.state==='empty'?`<div class="twin-empty-illustration" aria-hidden="true">${part.kind==='cpu'?'▦':'▥'}</div><p class="twin-empty-note">${esc(t('This slot is reported as unoccupied.'))}</p>`:'')+
      (part.controller?`<p class="twin-evidence-note">${esc(t('This is the model reported by the storage controller; member-drive models may be unavailable.'))}</p>`:'')+
      `<dl class="hardware-fields">${Object.entries(fields).map(([key,value])=>`<div><dt>${esc(t(key))}</dt><dd class="${clean(value)?'':'hardware-unavailable'}">${esc(clean(value)||t('Unavailable'))}</dd></div>`).join('')}</dl>`;
    panel.getAnimations().forEach(animation=>animation.cancel());
    if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){panel.animate([{opacity:.65,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:170,easing:'ease-out'});}
  }
  function mount(){
    const host=document.getElementById('hardware-content');if(!host)return;
    if(!host._twinBound){
      const motion=matchMedia('(prefers-reduced-motion: reduce)');
      motion.addEventListener('change',()=>{if(motion.matches)document.getElementById('twin-inspector')?.getAnimations().forEach(animation=>animation.cancel());});
      host.addEventListener('click',event=>{
        if(event.target.closest('[data-twin-back]')){
          const button=[...host.querySelectorAll('[data-twin-part]')].find(item=>item.dataset.twinPart===selected);
          button?.focus({preventScroll:true});button?.scrollIntoView({block:'center',behavior:'instant'});return;
        }
        const button=event.target.closest('[data-twin-part]');
        if(button&&current?.parts.some(part=>part.id===button.dataset.twinPart)){
          selected=button.dataset.twinPart;inspect(true);
          if(matchMedia('(max-width:1100px)').matches)document.getElementById('twin-inspector').scrollIntoView({block:'center',behavior:'instant'});
        }
      });
      host._twinBound=true;
    }
    inspect();
  }
  return {prepare,occupancy,classifyDrive,driveGlyph,html,mount};
})();
