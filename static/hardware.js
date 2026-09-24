'use strict';
window.HardwareUI = (() => {
  function render(data, {esc,bytes,date}) {
    const body=document.getElementById('hardware-content');
    const updated=document.getElementById('hardware-updated');
    if(!data?.collected_at){body.innerHTML=`<p class="hardware-unavailable">${esc(t(data?.state==='error'?'Hardware information could not be read.':'Reading hardware information…'))}</p>`;updated.textContent=t('Waiting for data');return;}
    updated.textContent=t(data.snapshot?'Saved inventory · {time}':'Inventory updated {time}',{time:date(data.collected_at)});
    const fieldList=values=>`<dl class="hardware-fields">${Object.entries(values).map(([key,value])=>`<div><dt>${esc(t(key))}</dt><dd class="${value==null||value===''?'hardware-unavailable':''}">${value==null||value===''?esc(t('Unavailable')):esc(value)}</dd></div>`).join('')}</dl>`;
    const card=(title,html)=>`<section class="hardware-card"><h3>${esc(t(title))}</h3>${html}</section>`;
    const extra=(key,title,html)=>`<details class="hardware-extra" data-hardware-key="${esc(key)}"><summary>${esc(t(title))}</summary>${html}</details>`;
    const sys=data.system||{},cpu=data.cpu||{},memory=data.memory||{};
    const primaryCpu={'Model':cpu['Model name'],'Architecture':cpu.Architecture,'Manufacturer':cpu['Vendor ID'],
      'CPU sockets':cpu['Socket(s)'],'Physical cores':Number(cpu['Socket(s)'])*Number(cpu['Core(s) per socket'])||cpu['Physical cores'],
      'Logical cores':cpu['CPU(s)'],'Threads per core':cpu['Thread(s) per core'],
      'Maximum frequency (MHz)':cpu['CPU max MHz'],'Minimum frequency (MHz)':cpu['CPU min MHz'],
      'L1 data cache':cpu['L1d cache'],'L1 instruction cache':cpu['L1i cache'],'L2 cache':cpu['L2 cache'],'L3 cache':cpu['L3 cache'],
      'NUMA nodes':cpu['NUMA node(s)'],'Virtualization':cpu.Virtualization};
    const cpuHtml=card('Processor',fieldList(primaryCpu)+extra('cpu-extra','Additional CPU fields',fieldList(cpu)));
    const osHtml=card('Operating system',fieldList({'Distribution':sys.distribution,'Architecture':sys.architecture,'Kernel':sys.kernel,'Kernel build':sys.kernel_build,'Boot mode':sys.boot_mode}));
    const boardHtml=card('System & motherboard',fieldList({'Manufacturer':sys.Manufacturer,'Product name':sys['Product name'],'Product version':sys['Product version'],
      'Motherboard manufacturer':data.board?.Manufacturer,'Motherboard model':data.board?.Model,'Motherboard version':data.board?.Version})+extra('chassis','Chassis',fieldList(data.chassis||{})));
    const biosHtml=card('BIOS / firmware',fieldList(data.bios||{}));
    const moduleHtml=(memory.modules||[]).map((module,index)=>extra('memory-'+index,
      `${module.Locator||t('Memory module')} · ${module['Part Number']||module.Manufacturer||t('Unavailable')} · ${module.Size||'—'}`,
      fieldList(module))).join('');
    const memoryHtml=card('Memory hardware',fieldList({'OS-visible memory':bytes(memory.total_bytes),'Swap capacity':bytes(memory.swap_bytes),
      ...(memory.dmi_available?{'Memory slots':memory.slots,'Installed modules':memory.modules.length,'Empty slots':memory.empty_slots}:{})})+
      (memory.dmi_available?moduleHtml+extra('memory-arrays','Memory arrays',(memory.arrays||[]).map(fieldList).join('')):
      `<p class="hardware-unavailable">${esc(t('Memory module models are unavailable. DMI data may be missing or unreadable.'))}</p>`));
    const diskHtml=(data.disks||[]).map((disk,index)=>`<article class="hardware-device"><header><div><h4>${esc(disk.name)}</h4><p>${esc(disk.model||t('Unavailable'))}</p></div><span>${bytes(disk.size)}</span></header>`+
      extra('disk-'+index,'Device specifications',fieldList({'Manufacturer':disk.vendor,'Firmware version':disk.rev,'Type':t(HardwareTwin.classifyDrive(disk).label),'Transport':disk.tran,'Logical sector size':disk['log-sec'],'Physical sector size':disk['phy-sec'],'Mount points':(disk.mountpoints||[]).join(', ')||'—'}))+
      (HardwareTwin.classifyDrive(disk).kind==='raid'?`<p class="hardware-unavailable">${esc(t('This is the model reported by the storage controller; member-drive models may be unavailable.'))}</p>`:'')+'</article>').join('');
    const networkHtml=(data.network||[]).map((nic,index)=>extra('nic-'+index,`${nic.Interface} · ${nic.Model||t('Unavailable')}`,fieldList(nic))).join('');
    const pciHtml=(data.pci||[]).map(item=>`<li><strong>${esc(item.model)}</strong><span>${esc(item.vendor)} · ${esc(item.class)} · ${esc(item.slot)}</span></li>`).join('');
    const usbHtml=(data.usb||[]).map(item=>`<li>${esc(item)}</li>`).join('');
    const firmwareHtml=(data.firmware_records||[]).map((record,index)=>extra('firmware-'+index,record.title,fieldList(record.fields))).join('');
    const sources=Object.entries(data.sources||{}).map(([name,source])=>`<span class="${source.status==='available'?'':'hardware-unavailable'}">${esc(name)} · ${esc(t(source.status==='available'?'Available':source.status==='missing'?'Not installed':'Unavailable'))}</span>`).join('');
    const expanded=new Set([...body.querySelectorAll('[data-hardware-key][open]')].map(node=>node.dataset.hardwareKey));
    const focused=body.querySelector('[data-twin-part]:focus')?.dataset.twinPart;
    body.innerHTML=HardwareTwin.html(data,{esc,bytes,date})+
      `<details class="hardware-extra hardware-specifications" data-hardware-key="specifications"><summary>${esc(t('All hardware specifications'))}</summary><div class="hardware-columns"><div>${cpuHtml}${memoryHtml}</div><div>${osHtml}${boardHtml}${biosHtml}${card('Network adapters',networkHtml||`<p class="hardware-unavailable">${esc(t('Unavailable'))}</p>`)}</div></div>`+
      card('Storage devices',`<div class="hardware-device-grid">${diskHtml||`<p class="hardware-unavailable">${esc(t('Unavailable'))}</p>`}</div>`)+
      extra('pci','PCI devices · graphics, storage & controllers',`<ul class="hardware-list">${pciHtml}</ul>`)+
      extra('usb','USB devices',`<ul class="hardware-list">${usbHtml||`<li class="hardware-unavailable">${esc(t('Unavailable'))}</li>`}</ul>`)+
      extra('firmware','Additional firmware specifications',firmwareHtml||`<p class="hardware-unavailable">${esc(t('Unavailable'))}</p>`)+
      `<div class="hardware-sources"><span>${esc(t('Data sources'))}</span>${sources}</div></details>`;
    for(const node of body.querySelectorAll('[data-hardware-key]'))node.open=expanded.has(node.dataset.hardwareKey);
    HardwareTwin.mount();
    if(focused)[...body.querySelectorAll('[data-twin-part]')].find(button=>button.dataset.twinPart===focused)?.focus({preventScroll:true});
  }
  return {render};
})();
