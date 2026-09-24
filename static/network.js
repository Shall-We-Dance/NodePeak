'use strict';
window.NetworkUI = (() => {
  function classify(row, physical=[]) {
    const name=row.name;
    if(name==='lo')return {kind:'other',label:'Loopback',description:'Local host traffic'};
    if(/^zt/.test(name))return {kind:'zerotier',label:'ZeroTier',description:'Private overlay network'};
    if(/^docker\d+$/.test(name)||/^br-[\da-f]{12}$/i.test(name))return {kind:'docker',label:'Docker bridge',description:'Container network bridge'};
    if(/^veth/.test(name))return {kind:'virtual',label:'Virtual Ethernet',description:'Container / namespace link'};
    if(/^wg/.test(name))return {kind:'virtual',label:'WireGuard',description:'VPN tunnel'};
    if(/^(tun|tap)/.test(name))return {kind:'virtual',label:'Tunnel',description:'VPN / virtual network'};
    if(/^bond/.test(name))return {kind:'virtual',label:'Bond',description:'Combined network adapters'};
    if(/^br/.test(name))return {kind:'virtual',label:'Bridge',description:'Virtual network bridge'};
    if(/\.\d+$/.test(name))return {kind:'virtual',label:'VLAN',description:'Virtual LAN interface'};
    if(physical.includes(name))return {kind:'physical',label:'Physical NIC',description:'Host network adapter'};
    return {kind:'other',label:'Other interface',description:'Unclassified interface'};
  }
  const order={physical:0,zerotier:1,docker:2,virtual:3,other:4};
  function render(live, settings) {
    const {esc,bytes,fmt,options,selected,filter}=settings;
    const rows=Object.values(live.networks).filter(row=>row.name!=='lo').map(row=>({...row,type:classify(row,live.network_total_interfaces||[])}))
      .sort((a,b)=>order[a.type.kind]-order[b.type.kind]||a.name.localeCompare(b.name,'en',{numeric:true}));
    const items=rows.map(row=>[row.name,`${row.name} · ${t(row.type.label)}`]);
    if(selected!=='physical'&&!rows.some(row=>row.name===selected))items.push([selected,`${selected} · ${t('Unavailable')}`]);
    options('network-select',items,['physical',t('Physical interfaces')]);
    const table=document.getElementById('network-table');
    const existing=new Map([...table.children].map(row=>[row.dataset.interface,row]));
    for(const [index,row] of rows.entries()) {
      let tr=existing.get(row.name);
      if(!tr){tr=document.createElement('tr');tr.dataset.interface=row.name;tr.innerHTML='<td></td><td></td><td class="mint"></td><td class="blue"></td><td></td><td></td>';}
      if(table.children[index]!==tr)table.insertBefore(tr,table.children[index]||null);
      existing.delete(row.name);
      tr.hidden=filter!=='all'&&row.type.kind!==filter;
      tr.classList.toggle('selected-interface',selected===row.name);
      tr.dataset.kind=row.type.kind;
      const identity=`<div class="interface-identity"><button type="button" class="interface-link" data-view-interface="${esc(row.name)}" title="${esc(t('View traffic for {interface}',{interface:row.name}))}">${esc(row.name)}</button><span class="interface-type type-${row.type.kind}" title="${esc(t(row.type.description))}">${esc(t(row.type.label))}</span></div>`;
      // Keep the focused link and row stable while live counters refresh.
      if(tr._identity!==identity){tr.cells[0].innerHTML=identity;tr._identity=identity;}
      const values=[row.addresses.join(', ')||'—',bytes(row.rx,'/s'),bytes(row.tx,'/s'),`${bytes(row.rx_total)} / ${bytes(row.tx_total)}`,`${fmt(row.errors,0)} / ${fmt(row.drops,0)}`];
      values.forEach((value,i)=>{if(tr.cells[i+1].textContent!==value)tr.cells[i+1].textContent=value;});
      tr.querySelector('button').setAttribute('aria-pressed',String(selected===row.name));
    }
    for(const row of existing.values())row.remove();
    for(const button of document.querySelectorAll('[data-interface-kind]')) {
      const kind=button.dataset.interfaceKind,count=rows.filter(row=>kind==='all'||row.type.kind===kind).length;
      button.querySelector('small').textContent=fmt(count,0);
      button.setAttribute('aria-pressed',String(kind===filter));
      button.hidden=kind!=='all'&&count===0&&kind!==filter;
    }
    const caption=document.getElementById('network-chart-caption');
    caption.textContent=selected==='physical'?t('Receive / transmit · excludes duplicate virtual-interface traffic'):t('Traffic for {interface}',{interface:selected});
  }
  return {classify,render};
})();
