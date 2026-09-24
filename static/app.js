'use strict';
const $ = id => document.getElementById(id);
const palette = ['#65e3b0','#75b5ff','#b79aff','#efbd71','#ef8da4','#6ad0df','#c0cc74','#ed936f'];
const state = {live:null, hardware:null, systemExpanded:false, history:null, networkHistory:{range:3600,custom:null,data:null,generation:0}, containerHistory:{range:3600,custom:null,data:null,generation:0}, scans:[], diskRange:604800, diskCustom:null, diskWindow:null, diskGeneration:0, diskLoading:false, diskError:null, diskRangeInvalid:false, range:3600, custom:null, user:'all', iface:'physical', interfaceFilter:'all', storageQuery:'', root:'all', events:[], networkError:null, generation:0, charts:new Map()};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, decimals=1) => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString(I18n.locale,{maximumFractionDigits:decimals,minimumFractionDigits:decimals});
const bytes = (n, suffix='') => { if(n == null) return '—'; const units=['B','KiB','MiB','GiB','TiB','PiB']; const i=Math.min(5,Math.max(0,Math.floor(Math.log(Math.max(n,1))/Math.log(1024)))); return `${fmt(n/1024**i,i?1:0)} ${units[i]}${suffix}`; };
const date = (n, short=false) => n ? new Date(n*1000).toLocaleString(I18n.locale,short?{hour:'2-digit',minute:'2-digit',second:'2-digit'}:{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : '—';
const duration = n => n == null ? '—' : n>=86400 ? t('{days}d {hours}h',{days:Math.floor(n/86400),hours:Math.floor(n%86400/3600)}) : n>=3600 ? t('{hours}h {minutes}m',{hours:Math.floor(n/3600),minutes:Math.floor(n%3600/60)}) : t('{minutes}m',{minutes:Math.floor(n/60)});
const color = key => { let n=0; for(const c of String(key)) n=(n*31+c.charCodeAt(0))>>>0; return palette[n%palette.length]; };
const setText=(id,value)=>{$(id).textContent=value;};
const notice=(id,text)=>{setText(id,t(text||''));$(id).hidden=!text;};
function pill(id,text,kind=''){setText(id,text);$(id).className=`pill ${kind}`;}
function options(id,items,first){const select=$(id),value=select.value,html=`<option value="${esc(first[0])}">${esc(first[1])}</option>`+items.map(([key,label])=>`<option value="${esc(key)}">${esc(label)}</option>`).join('');if(select.innerHTML!==html){select.innerHTML=html; if([...select.options].some(o=>o.value===value))select.value=value;}}
async function get(path){const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok){let error;try{error=(await response.json()).detail;}catch{error=t('Request failed {status}',{status:response.status});}throw new Error(error);}return response.json();}

function makeChart(id,series,unit='',extra={}){
  const el=$(id);let chart=state.charts.get(id);if(!chart){chart=echarts.init(el,null,{renderer:'canvas',locale:'EN'});state.charts.set(id,chart);}
  const empty=!series.some(s=>s.data.some(d=>Array.isArray(d)?d[1]!=null:d!=null));
  const base={animation:false,color:palette,backgroundColor:'transparent',textStyle:{fontFamily:'"Segoe UI","Microsoft YaHei",sans-serif'},
    grid:{left:54,right:23,top:28,bottom:70},legend:{type:'scroll',bottom:12,left:20,right:20,itemWidth:10,itemHeight:7,icon:'roundRect',textStyle:{color:'#9fafc2',fontSize:12},pageTextStyle:{color:'#8e9caf'},pageIconColor:'#65e3b0',pageIconInactiveColor:'#334357'},
    tooltip:{trigger:'axis',backgroundColor:'#182333',borderColor:'#344457',textStyle:{color:'#e1eaf6',fontSize:12},confine:true,
      formatter:params=>{if(!params.length)return '';const head=typeof params[0].value?.[0]==='number'?new Date(params[0].value[0]).toLocaleString(I18n.locale):params[0].name;return `<div style="margin-bottom:6px">${esc(head)}</div>`+params.filter(p=>Array.isArray(p.value)?p.value[1]!=null:p.value!=null).map(p=>`${p.marker} ${esc(p.seriesName)} <b>${fmt(Array.isArray(p.value)?p.value[1]:p.value,2)} ${esc(unit)}</b>`).join('<br>');}},
    xAxis:{type:'time',axisLine:{lineStyle:{color:'#263442'}},axisTick:{show:false},axisLabel:{color:'#7e91a9',fontSize:11,hideOverlap:true,formatter:value=>new Intl.DateTimeFormat(I18n.locale,{hour:'2-digit',minute:'2-digit',hour12:false,...(state.range>86400||state.custom?{month:'short',day:'numeric'}:{})}).format(value)},splitLine:{show:false}},
    yAxis:{type:'value',min:0,axisLabel:{color:'#7e91a9',fontSize:11,formatter:value=>fmt(value,Number.isInteger(value)?0:1)},splitLine:{lineStyle:{color:'#24303e',type:'dashed'}},axisLine:{show:false}},
    series,graphic:empty?[{type:'text',left:'center',top:'44%',style:{text:t("No history yet. New samples will appear here."),fill:'#8e9caf',fontSize:13,width:Math.max(120,el.clientWidth-40),overflow:'break',lineHeight:19,align:'center'}}]:[]};
  chart.setOption({...base,...extra},true);
}
function line(name,data,index,stack=false){return {name,type:'line',data,showSymbol:data.length<3,symbolSize:5,smooth:false,connectNulls:false,lineStyle:{width:1.7},itemStyle:{color:typeof index==='string'?index:palette[index%palette.length]},...(stack?{stack:'users',areaStyle:{opacity:.3},emphasis:{focus:'series'}}:{})};}
function pointsWithGaps(history=state.history){const data=history?.points||[],result=[],resolution=history?.resolution||5;for(const p of data){const prev=result.at(-1);if(prev&&p.ts-prev.ts>resolution*2.5)result.push({ts:prev.ts+resolution,gap:true});result.push(p);}return result;}
function userSeries(points,field,scale=1){
  return UserResources.trends(points,field,{selected:state.user,scale}).map(group=>({
    ...line(group.kind==='system'?t('System'):group.kind==='other'?t('Other users'):group.name,
      group.data,group.kind==='system'?'#8292a8':group.kind==='other'?'#d2b785':color(group.id),true),
    id:group.id,
  }));
}
function renderHistory(){
  if(!state.history)return;const points=pointsWithGaps();const cpu=userSeries(points,'cpu');
  if(state.user==='all'&&points.length)cpu.push({...line(t("Host total"),points.map(p=>[p.ts*1000,p.gap?null:p.cpu]),'#c7d4e3'),lineStyle:{width:1.3,type:'dashed'},z:10});
  makeChart('cpu-chart',cpu,'%');makeChart('memory-chart',userSeries(points,'memory',1024**3),'GiB');
  makeChart('health-chart',[line(t("CPU temperature °C"),points.map(p=>[p.ts*1000,p.gap?null:p.temperature]),3),{...line(t("UPS charge %"),points.map(p=>[p.ts*1000,p.gap?null:p.ups_charge]),0),yAxisIndex:1}],'',{
    yAxis:[{type:'value',min:0,name:'°C',nameTextStyle:{color:'#8e9caf'},axisLabel:{color:'#8e9caf',fontSize:11,formatter:value=>fmt(value,Number.isInteger(value)?0:1)},splitLine:{lineStyle:{color:'#24303e',type:'dashed'}}},{type:'value',min:0,max:100,name:'%',nameTextStyle:{color:'#8e9caf'},axisLabel:{color:'#8e9caf',fontSize:11},splitLine:{show:false}}],grid:{left:50,right:45,top:38,bottom:70}});
  setText('resolution-label',t('{seconds}s / point · {count} samples',{seconds:fmt(state.history.resolution,0),count:fmt(state.history.points.length,0)}));
  renderDiskCharts();updateUserSelect();
}
function historyAxis(scope){
  const window=scope.window;
  return {xAxis:{type:'time',min:window?.start*1000,max:window?.end*1000,axisLine:{lineStyle:{color:'#263442'}},axisTick:{show:false},axisLabel:{color:'#7e91a9',fontSize:11,hideOverlap:true,formatter:value=>new Intl.DateTimeFormat(I18n.locale,{hour:'2-digit',minute:'2-digit',hour12:false,...(scope.range>86400||scope.custom?{month:'short',day:'numeric'}:{})}).format(value)},splitLine:{show:false}}};
}
function renderNetworkHistory(){const scope=state.networkHistory;if(!scope.data)return;const points=pointsWithGaps(scope.data);
  makeChart('network-chart',['rx','tx'].map((key,i)=>line(i?t("Transmit"):t("Receive"),points.map(p=>[p.ts*1000,p.gap?null:(state.iface==='physical'?p[key]/1024**2:p.networks?.[state.iface]?.[key]==null?null:p.networks[state.iface][key]/1024**2)]),i)),'MiB/s',historyAxis(scope));
  makeChart('io-chart',['disk_read','disk_write'].map((key,i)=>line(i?t("Write"):t("Read"),points.map(p=>[p.ts*1000,p.gap?null:p[key]/1024**2]),i)),'MiB/s',historyAxis(scope));
}
function renderContainerHistory(){const scope=state.containerHistory;if(!scope.data)return;const points=pointsWithGaps(scope.data);
  const containerMetric=$('container-metric').value, containerIds=new Map();
  for(const p of points)for(const [id,c]of Object.entries(p.containers||{}))containerIds.set(id,c.name);
  const containerSeries=[...containerIds].map(([id,name],i)=>line(name,points.map(p=>[p.ts*1000,p.containers?.[id]?.[containerMetric]==null?null:p.containers[id][containerMetric]/(containerMetric==='memory'?1024**3:1)]),i,true));
  makeChart('container-chart',containerSeries,containerMetric==='memory'?'GiB':'%',historyAxis(scope));
}
async function loadSectionHistory(key){
  const scope=state[key+'History'],generation=++scope.generation,end=Math.floor(Date.now()/1000);
  const window=scope.custom||{start:end-scope.range,end};scope.window=window;
  const signature=JSON.stringify([scope.range,scope.custom]);if(scope.signature!==signature)scope.data=null;scope.signature=signature;scope.error=null;scope.loading=true;renderSectionHistory(key);
  try{const data=await get('/api/history?'+new URLSearchParams(window));if(generation!==scope.generation)return;scope.data=data;}
  catch(error){if(generation!==scope.generation)return;scope.error=error.message;}
  finally{if(generation===scope.generation){scope.loading=false;renderSectionHistory(key);}}
}
function renderSectionHistory(key){
  const scope=state[key+'History'];
  setText(key+'-history-status',scope.error?t('Unable to load history: {error}',{error:t(scope.error)}):scope.loading?t('Loading history…'):t('Independent time range'));
  for(const id of key==='network'?['network-chart','io-chart']:['container-chart']){
    $(id).setAttribute('aria-busy',String(!!scope.loading));
    if(!scope.data)makeChart(id,[],'',{...historyAxis(scope),graphic:[{type:'text',left:'center',top:'44%',style:{text:t(scope.loading?'Loading history…':'History unavailable'),fill:'#8e9caf',fontSize:12}}]});
  }
  if(key==='network')renderNetworkHistory();else renderContainerHistory();
}
function bindSectionRange(key){
  const scope=state[key+'History'];
  $(key+'-range-buttons').addEventListener('click',event=>{
    const button=event.target.closest('[data-section-range]');if(!button)return;
    for(const item of $(key+'-range-buttons').querySelectorAll('button')){item.classList.toggle('active',item===button);item.setAttribute('aria-pressed',String(item===button));}
    const value=button.dataset.sectionRange;$(key+'-custom-range').hidden=value!=='custom';
    setText(key+'-range-error','');
    if(value==='custom'){
      const end=Math.floor(Date.now()/1000),window=scope.custom||{start:end-scope.range,end};
      const local=n=>{const d=new Date(n*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
      $(key+'-range-start').value=local(window.start);$(key+'-range-end').value=local(window.end);return;
    }
    scope.range=Number(value);scope.custom=null;loadSectionHistory(key);
  });
  $(key+'-custom-range').addEventListener('submit',event=>{
    event.preventDefault();const start=new Date($(key+'-range-start').value).getTime()/1000,end=new Date($(key+'-range-end').value).getTime()/1000;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>90*86400){setText(key+'-range-error',t('Select a valid time range of up to 90 days.'));return;}
    setText(key+'-range-error','');scope.custom={start:Math.floor(start),end:Math.floor(end)};loadSectionHistory(key);
  });
}
bindSectionRange('network');bindSectionRange('container');
function updateUserSelect(){const users=new Map();for(const p of state.history?.points||[])for(const [uid,u]of Object.entries(p.users||{}))users.set(uid,u.name);for(const [uid,u]of Object.entries(state.live?.users||{}))users.set(uid,u.name);for(const [uid,u]of Object.entries(state.live?.disk_scan?.users||{}))users.set(uid,u.name);options('user-select',[...users].sort((a,b)=>a[1].localeCompare(b[1],I18n.locale)) ,['all',t("All users")]);}
function renderDiskCharts(){
  if(!state.live)return;const scan=state.live.scan_progress||state.live.disk_scan,root=state.root;
  const value=u=>root==='all'?u.bytes:u.roots?.[root]||0;
  let users=Object.entries(scan.users||{}).filter(([uid])=>state.user==='all'||state.user===uid).sort((a,b)=>value(b[1])-value(a[1]));
  const shown=users.slice(0,10).reverse();
  makeChart('disk-users-chart',[{name:t("Used"),type:'bar',barMaxWidth:17,itemStyle:{borderRadius:[0,4,4,0]},data:shown.map(([uid,u])=>({value:value(u)/1024**3,itemStyle:{color:color(uid)}}))}],'GiB',{
    grid:{left:100,right:28,top:22,bottom:40},legend:{show:false},tooltip:{trigger:'axis',renderMode:'richText',axisPointer:{type:'shadow'},valueFormatter:v=>`${fmt(v,2)} GiB`},
    xAxis:{type:'value',axisLabel:{color:'#8e9caf',fontSize:11,formatter:value=>fmt(value,Number.isInteger(value)?0:1)},splitLine:{lineStyle:{color:'#24303e',type:'dashed'}}},yAxis:{type:'category',data:shown.map(([,u])=>u.name),axisLabel:{color:'#afbed2',fontSize:12,width:80,overflow:'truncate'},axisLine:{show:false},axisTick:{show:false}},graphic:shown.length?[]:[{type:'text',left:'center',top:'44%',style:{text:scan.state==='scanning'?t("Scanning file usage…"):t("No readable user files"),fill:'#8e9caf',fontSize:13,width:Math.max(120,$('disk-users-chart').clientWidth-40),overflow:'break',lineHeight:19,align:'center'}}]});
  renderDiskHistory();
}
function renderDiskHistory(){
  const window=state.diskWindow||diskTimeWindow();
  renderDiskHistoryStatus();
  const model=DiskHistory.prepare(state.scans,{...window,root:state.root,user:state.user});
  const single=model.sampleCount===1;
  const series=model.rows.map(row=>({
    ...line(row.name,model.scans.map((scan,index)=>[scan.finished_at*1000,row.values[index]===null?null:row.values[index]/model.scale]),color(row.uid),true),
    id:row.uid,...(single?{type:'bar',barWidth:24}:{step:'end',showSymbol:true,symbolSize:4}),
  }));
  const chart=$('disk-history-chart');
  setText('disk-history-description',t('Allocated space · {unit} · stacked total',{unit:model.unit}));
  const notes=[single?t('One scan in this range. More scans are needed to show a trend.'):model.sampleCount===0?t(model.scans.length?'No recorded disk usage for this selection':'No disk scans in this range. Scans run every 6 hours; choose a longer range.'):t('{count} scans · each color is one user; the top edge is their total.',{count:fmt(model.sampleCount,0)})];
  if(model.partial)notes.push(t('Includes partial scans; recorded totals may be incomplete.'));
  setText('disk-history-note',notes.join(' '));
  const formatTime=value=>new Intl.DateTimeFormat(I18n.locale,{hour:'2-digit',minute:'2-digit',hour12:false,...(window.end-window.start>=86400?{month:'short',day:'numeric'}:{})}).format(value);
  makeChart('disk-history-chart',series,model.unit,{
    grid:{left:16,right:20,top:40,bottom:58,containLabel:true},
    xAxis:{type:'time',min:window.start*1000,max:window.end*1000,splitNumber:3,
      axisLine:{lineStyle:{color:'#263442'}},axisTick:{show:false},axisLabel:{color:'#7e91a9',fontSize:11,hideOverlap:true,formatter:formatTime},splitLine:{show:false}},
    yAxis:{type:'value',min:0,name:model.unit,nameGap:16,nameTextStyle:{color:'#afbed2',fontSize:11},splitNumber:4,
      axisLabel:{color:'#8e9caf',fontSize:11,formatter:value=>fmt(value,Number.isInteger(value)?0:2)},
      splitLine:{lineStyle:{color:'#24303e',type:'dashed'}},axisLine:{show:false}},
    tooltip:{trigger:'axis',confine:true,backgroundColor:'#182333',borderColor:'#344457',textStyle:{color:'#e1eaf6',fontSize:12},axisPointer:{type:single?'shadow':'line'},
      formatter:params=>{
        const visible=params.filter(point=>Array.isArray(point.value)&&point.value[1]!==null);
        if(!visible.length)return '';
        const scan=model.scans[visible[0].dataIndex];
        const total=visible.reduce((sum,point)=>sum+point.value[1],0);
        return `<div style="margin-bottom:6px">${esc(new Date(scan.finished_at*1000).toLocaleString(I18n.locale))}</div>`+
          visible.map(point=>`${point.marker} ${esc(point.seriesName)} <b>${esc(bytes(point.value[1]*model.scale))}</b>`).join('<br>')+
          `<div style="border-top:1px solid #344457;margin-top:6px;padding-top:6px">${esc(t('Shown total'))}: <b>${fmt(total,2)} ${model.unit}</b></div>`+
          (scan.state!=='complete'||scan.errors?`<div>${esc(t('Partial data'))}</div>`:'');
      }},
    graphic:model.sampleCount?[]:[{type:'text',left:'center',top:'40%',style:{text:t(model.scans.length?'No recorded disk usage for this selection':'No disk scans in this time range'),fill:'#8e9caf',fontSize:13,width:Math.max(120,chart.clientWidth-65),overflow:'break',lineHeight:19,align:'center'}}]
  });
}

function renderLive(live){
  state.live=live;setText('side-host',live.hostname);setText('breadcrumb-host',live.hostname);setText('side-address',live.zerotier_ips?.[0]||location.hostname);
  renderHostIdentity();setText('uptime',t('Uptime {duration}',{duration:duration(live.uptime)}));
  const connection=live.stale?t("Stale data"):t("Connected");setText('connection-label',connection);for(const id of ['connection-dot','side-dot'])$(id).classList.toggle('offline',live.stale);
  $('cpu-value').innerHTML=`${fmt(live.cpu)}<small>%</small>`;setText('cpu-detail',t('{count} logical cores',{count:fmt(live.cpu_count,0)}));$('cpu-bar').style.width=`${Math.min(100,live.cpu)}%`;
  $('memory-value').innerHTML=`${fmt(live.memory_used/1024**3)}<small>GiB</small>`;setText('memory-detail',t('Total {memory} GiB · {percent}%',{memory:fmt(live.memory_total/1024**3),percent:fmt(live.memory_percent)}));$('memory-bar').style.width=`${live.memory_percent}%`;
  $('disk-value').innerHTML=`${fmt(live.disk_used/1024**4,2)}<small>TiB</small>`;setText('disk-detail',t('Total {size} · {count} filesystems',{size:bytes(live.disk_total),count:fmt(live.disks.length,0)}));$('disk-bar').style.width=`${live.disk_total?live.disk_used/live.disk_total*100:0}%`;
  $('temperature-value').innerHTML=`${fmt(live.temperature)}<small>°C</small>`;setText('temperature-detail',live.temperature==null?t("No CPU sensor found"):t("Highest CPU package temperature"));
  const hot=live.temperatures.some(t=>t.high!=null&&t.current>=t.high);pill('temperature-state',live.temperature==null?t("Unavailable"):hot?t("High temperature"):t("Normal"),live.temperature==null?'neutral':hot?'warning':'');
  setText('load-value',live.load.map(n=>fmt(n,2)).join(' / '));setText('network-value',`${bytes(live.rx,'/s')} / ${bytes(live.tx,'/s')}`);setText('network-summary',live.network_total_interfaces.join(' + ')||t("No physical interfaces found"));
  renderUsers();renderDisks();renderNetwork();renderDocker();renderPower();updateUserSelect();
  const errors=Object.entries(live.collector_errors||{}).map(([k,v])=>`${k}: ${v}`);notice('error-banner',live.stale?t("Collection is delayed. Showing the last available sample."):errors.join('; '));
  setText('footer-update',t('Last sample {time} · {seconds}s interval',{time:date(live.ts),seconds:fmt(live.interval,0)}));
}
function renderHostIdentity(){
  const live=state.live;if(!live)return;
  const sys=live.system||state.hardware?.system||{};
  setText('host-meta',t('{host} · {architecture} · {cores} logical cores · {memory} RAM',{host:live.hostname,architecture:sys.architecture||'—',cores:fmt(live.cpu_count,0),memory:bytes(live.memory_total)}));
  setText('os-meta',[sys.distribution,sys.kernel?`Linux ${sys.kernel}`:live.platform].filter(Boolean).join(' · '));
}
let hardwareLoading=false,hardwareSignature='';
async function loadHardware(){
  if(hardwareLoading)return;hardwareLoading=true;
  try{
    let hardware;
    hardware=await get('/api/hardware');
    state.hardware=hardware;renderHostIdentity();
    const signature=JSON.stringify(hardware)+I18n.language;
    if(signature!==hardwareSignature){HardwareUI.render(hardware,{esc,bytes,date});hardwareSignature=signature;}
  }catch{if(!state.hardware)HardwareUI.render({state:'error'},{esc,bytes,date});}
  finally{hardwareLoading=false;}
}
function renderUsers(){
  const l=state.live,scan=l.scan_progress||l.disk_scan;
  const data=UserResources.prepare(l,state.user);
  const row=u=>`<tr data-user-uid="${esc(u.uid)}"><td><span class="user-badge" style="color:${color(u.uid)};background:${color(u.uid)}18">${esc(u.name[0]?.toUpperCase())}</span>${esc(u.name)} <small>UID ${esc(u.uid)}</small></td><td>${fmt(u.cpu,2)}%<span class="table-meter"><i style="width:${Math.min(100,u.cpu)}%"></i></span></td><td>${bytes(u.memory)}</td><td>${fmt(u.processes,0)}</td><td>${bytes(u.disk)}${scan.state!=='complete'&&u.disk!=null?` <small>${esc(t('Partial'))}</small>`:''}</td><td>${u.io_denied?'—':`${bytes(u.read,'/s')} / ${bytes(u.write,'/s')}`}</td></tr>`;
  $('users-table').innerHTML=data.users.map(row).join('')||(!data.total?`<tr><td colspan="6" class="empty">${esc(t('No current resource records for this user'))}</td></tr>`:'');
  $('system-summary').hidden=!data.total;
  $('system-users-body').hidden=!data.total||!state.systemExpanded;
  $('system-users-toggle').setAttribute('aria-expanded',String(state.systemExpanded));
  $('system-users-body').innerHTML=data.system.map(row).join('');
  if(data.total){
    const total=data.total;
    setText('system-users-count',t('UID < 1000 · {count} accounts',{count:fmt(data.system.length,0)}));
    setText('system-cpu',`${fmt(total.cpu,2)}%`);setText('system-memory',bytes(total.memory));setText('system-processes',fmt(total.processes,0));
    $('system-disk').innerHTML=bytes(total.disk)+(total.disk!=null&&(total.diskPartial||scan.state!=='complete')?`<small>${esc(t('Partial'))}</small>`:'');
    setText('system-io',total.io_denied?'—':`${bytes(total.read,'/s')} / ${bytes(total.write,'/s')}`);
  }
  const p=l.permissions;notice('permissions-note',p.processes_denied||p.process_io_denied?t('Limited access: {processes} unreadable processes; disk I/O unavailable for {io} processes. Statistics may be incomplete.',{processes:fmt(p.processes_denied,0),io:fmt(p.process_io_denied,0)}):'');
}
function renderDisks(){
  const l=state.live;setText('disk-count',t('{count} mounted filesystems',{count:fmt(l.disks.length,0)}));
  const currentScan=l.scan_progress||l.disk_scan;
  const cards=$('disk-cards');
  const expanded=new Set([...cards.querySelectorAll('.disk-issues[open]')].map(details=>details.closest('[data-disk]').dataset.disk));
  const scrolls=new Map([...cards.querySelectorAll('.disk-user-table-wrap')].map(table=>[table.closest('[data-disk]').dataset.disk,table.scrollTop]));
  const selectedUser=Object.keys(currentScan.users||{}).includes(state.storageQuery)?state.storageQuery:state.user;
  const html=l.disks.map(disk=>DiskUsage.render(disk,currentScan,l.disks,{esc,bytes,fmt,color,selectedUser,open:expanded.has(disk.mount)})).join('');
  const focused=document.activeElement?.closest('[data-storage-user]');
  const focusKey=focused&&cards.contains(focused)?{disk:focused.closest('[data-disk]').dataset.disk,uid:focused.dataset.storageUser}:null;
  if(cards.innerHTML!==html){
    cards.innerHTML=html;
    for(const table of cards.querySelectorAll('.disk-user-table-wrap'))table.scrollTop=scrolls.get(table.closest('[data-disk]').dataset.disk)||0;
    if(focusKey)[...cards.querySelectorAll('[data-storage-user]')].find(button=>button.dataset.storageUser===focusKey.uid&&button.closest('[data-disk]').dataset.disk===focusKey.disk)?.focus({preventScroll:true});
  }
  renderStorageUsers();

  const scan=l.scan_progress||l.disk_scan,scanning=!!l.scan_progress;const roots=scan.roots||[];options('disk-root-select',roots.map(r=>[r,r]),['all',t("All directories")]);
  pill('scan-state',scanning?t("Scanning"):scan.state==='partial'?t("Partial data"):scan.state==='complete'?t("Scan complete"):t("Waiting to scan"),scan.state==='partial'||scanning?'neutral':'');
  setText('scan-description',t('{count} files · {status}',{count:fmt(scan.files||0,0),status:scanning?scan.current_root||t('Starting scan'):scan.finished_at?date(scan.finished_at):t('Background scan')}));
  notice('scan-note',scan.errors?t('Skipped {count} unreadable or changed entries. User disk totals are incomplete. Scanned: {roots}. Run the service as root to read other users’ private directories.',{count:fmt(scan.errors,0),roots:roots.join(', ')}):scanning?t('Scanning {roots} in the background. Charts show files read so far; live CPU and memory collection continues.',{roots:roots.join(', ')}):'');
  renderDiskCharts();
}
function renderStorageUsers(){
  const scan=state.live.scan_progress||state.live.disk_scan;
  const query=state.storageQuery.trim().toLocaleLowerCase();
  const users=DiskUsage.summarizeUsers(scan,state.live.disks).filter(user=>!query||user.name.toLocaleLowerCase().includes(query)||user.uid.includes(query));
  const html=users.map(user=>DiskUsage.renderUser(user,{esc,bytes,fmt,color})).join('')||`<div class="panel empty">${esc(t(query?'No matching users':'No readable user files'))}</div>`;
  if($('storage-user-cards').innerHTML!==html)$('storage-user-cards').innerHTML=html;
  $('clear-storage-search').hidden=!state.storageQuery;
}
function renderNetwork(){
  NetworkUI.render(state.live,{esc,bytes,fmt,options,selected:state.iface,filter:state.interfaceFilter});
}
function renderDocker(){
  const docker=state.live.docker,rows=docker.containers||[],running=rows.filter(r=>r.state==='running').length;setText('docker-value',docker.available?`${running} / ${rows.length}`:'—');setText('docker-summary',docker.available?t('{count} stopped',{count:fmt(rows.length-running,0)}):t("Docker unavailable"));setText('docker-updated',docker.updated_at?t('Updated {time}',{time:date(docker.updated_at,true)}):'');notice('docker-note',docker.available?docker.stats_error:docker.error);
  $('docker-table').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}<small>${esc(r.image)}</small></td><td><span class="pill ${r.state==='running'?'':'neutral'}">${r.state==='running'?t("Running"):esc(t(({exited:'Stopped',created:'Created',paused:'Paused',restarting:'Restarting',removing:'Removing',dead:'Dead'})[r.state]||r.state))}</span><small>${esc(r.status)}</small></td><td>${esc(r.project)}</td><td>${r.cpu==null?'—':fmt(r.cpu,2)+'%'}</td><td>${esc(r.memory||'—')}</td><td>${esc(r.net_io||'—')}</td></tr>`).join('')||`<tr><td colspan="6" class="empty">${docker.available?t("No containers"):t("Docker is unavailable. Check the connection status.")}</td></tr>`;
}
function renderPower(){
  const l=state.live,u=l.ups,good=u.available,status=good?(u.state==='online'?t("On mains"):t("On battery")):t("UPS unavailable");pill('power-status',status,good?(u.state==='online'?'':'warning'):'neutral');setText('ups-value',good&&u.charge!=null?`${fmt(u.charge,0)}%`:'—');setText('ups-summary',status);
  setText('ups-model',u.model||'UPS');setText('ups-backend',u.backend?`${u.backend} · ${date(u.updated_at,true)}`:t("Auto-detecting apcupsd / NUT"));$('battery-charge').innerHTML=`${good?fmt(u.charge,0):'—'}<small>%</small>`;setText('battery-runtime',t('Remaining {duration}',{duration:good?duration(u.runtime_seconds):'—'}));$('battery-fill').style.width=`${good?Math.max(0,Math.min(100,u.charge||0)):0}%`;
  setText('ups-voltage',good&&u.voltage!=null?`${fmt(u.voltage)} V`:'—');setText('ups-load',good&&u.load!=null?`${fmt(u.load)}%`:'—');setText('ups-battery-voltage',good&&u.battery_voltage!=null?`${fmt(u.battery_voltage)} V`:'—');setText('ups-note',t(u.error)|| (u.transfer_reason?t('Last transfer: {reason}',{reason:t(u.transfer_reason)}):''));
  setText('sensor-count',`(${l.temperatures.length})`);$('sensors').innerHTML=l.temperatures.map(t=>`<div class="sensor"><span class="sensor-name">${esc(t.name)}</span><strong>${fmt(t.current)} °C</strong><small>${esc(t.chip)}${t.high!=null?' · '+esc(window.t('Limit {value} °C',{value:fmt(t.high,0)})):''}</small></div>`).join('')||`<p class="subtle">${esc(t('No temperature sensors available'))}</p>`;
}

const eventNames={container_change:'Container status',power_failure:'Power failure',power_restored:'Power restored',on_battery:'On battery',self_test:'UPS self-test',shutdown:'Shutdown',reboot:'System reboot',monitor_gap:'Collection gap',monitor_start:'Monitor started',ups_communication:'UPS communication',ups_event:'UPS event'};
function translateEvent(message){return t(message);}
function renderEvents(){
  $('event-list').innerHTML=state.events.map(e=>`<div class="event"><time datetime="${new Date(e.ts*1000).toISOString()}">${new Date(e.ts*1000).toLocaleString(I18n.locale,{hour12:false})}</time><span class="pill ${e.severity==='critical'?'error':e.severity==='warning'?'warning':e.severity==='success'?'':'neutral'}">${esc(t(eventNames[e.kind]||e.kind))}</span><div class="event-text">${esc(translateEvent(e.message))}<small>${esc(t(e.source))}</small></div></div>`).join('')||`<div class="empty">${esc(t('No events of this type'))}</div>`;
}
async function loadEvents(older=false){
  const params=new URLSearchParams({limit:'30'}),filter=$('event-filter').value;if(filter)params.set('kind',filter);if(older&&state.events.length)params.set('before',state.events.at(-1).ts);
  try{const data=await get(`/api/events?${params}`);if(filter!==$('event-filter').value)return;state.events=older?[...state.events,...data.events]:data.events;renderEvents();$('more-events').hidden=data.events.length<30;}
  catch(error){if(!state.events.length)$('event-list').innerHTML=`<div class="empty">${esc(t('Unable to load events: {error}',{error:t(error.message)}))}</div>`;}
}
function diskTimeWindow(){const end=Math.floor(Date.now()/1000);return state.diskCustom||{start:end-state.diskRange,end};}
function renderDiskHistoryStatus(){
  const status=$('disk-history-status');
  status.textContent=state.diskError?t('Unable to load disk history: {error}',{error:t(state.diskError)}):state.diskLoading?t('Loading disk history…'):t('Independent time range · scans every 6 hours');
  status.classList.toggle('error',Boolean(state.diskError));
  $('disk-history-chart').setAttribute('aria-busy',String(state.diskLoading));
  setText('disk-range-error',state.diskRangeInvalid?t('Select a time range from 12 hours to 90 days.'):'');
}
async function loadDiskHistory(){
  const generation=++state.diskGeneration,window=diskTimeWindow(),query=new URLSearchParams(window);
  lastDiskHistory=Date.now();state.diskWindow=window;state.diskLoading=true;state.diskError=null;renderDiskHistory();
  try{
    const data=await get(`/api/disk-history?${query}`);
    if(generation!==state.diskGeneration)return;
    state.scans=data.scans;
  }catch(error){if(generation===state.diskGeneration)state.diskError=error.message;}
  finally{if(generation===state.diskGeneration){state.diskLoading=false;renderDiskHistory();}}
}
function timeWindow(){const end=Math.floor(Date.now()/1000);return state.custom||{start:end-state.range,end};}
async function loadHistory(){
  const generation=++state.generation,window=timeWindow(),query=new URLSearchParams(window);
  try{const history=await get(`/api/history?${query}`);if(generation!==state.generation)return;state.history=history;renderHistory();setText('range-error','');}
  catch(error){if(generation===state.generation){setText('range-error',t(error.message));notice('error-banner',t('Unable to load history: {error}',{error:t(error.message)}));}}
}
function renderConnectionError(){setText('connection-label',t('Disconnected'));for(const id of ['connection-dot','side-dot'])$(id).classList.add('offline');notice('error-banner',t('Unable to fetch live data: {error}. Showing the last sample and retrying automatically.',{error:t(state.networkError)}));}
let liveLoading=false,lastHistory=0,lastDiskHistory=0,lastEvents=0;
async function refresh(force=false){
  if(liveLoading)return;liveLoading=true;$('refresh').disabled=true;
  try{const live=await get('/api/live');state.networkError=null;renderLive(live);}catch(error){state.networkError=error.message;renderConnectionError();}
  finally{liveLoading=false;$('refresh').disabled=false;}
  const now=Date.now(),jobs=[];
  if(force||now-lastHistory>14000){lastHistory=now;jobs.push(loadHistory(),loadSectionHistory('network'),loadSectionHistory('container'));}
  if(force||now-lastDiskHistory>59000)jobs.push(loadDiskHistory());
  if(force||now-lastEvents>29000){lastEvents=now;jobs.push(loadEvents());}
  await Promise.all(jobs);
}
$('refresh').addEventListener('click',()=>{refresh(true);loadHardware();});
$('system-users-toggle').addEventListener('click',()=>{state.systemExpanded=!state.systemExpanded;if(state.live)renderUsers();});
$('user-select').addEventListener('change',e=>{state.user=e.target.value;if(state.live){renderUsers();renderDisks();}renderHistory();});
$('network-select').addEventListener('change',e=>{state.iface=e.target.value;renderNetwork();renderNetworkHistory();});
$('interface-filters').addEventListener('click',event=>{
  const button=event.target.closest('[data-interface-kind]');if(!button||!state.live)return;
  state.interfaceFilter=button.dataset.interfaceKind;renderNetwork();
});
$('network-table').addEventListener('click',event=>{
  const button=event.target.closest('[data-view-interface]');if(!button)return;
  state.iface=button.dataset.viewInterface;$('network-select').value=state.iface;
  renderNetwork();renderNetworkHistory();
  $('network-chart').closest('.panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
});
$('storage-user-search').addEventListener('input',event=>{state.storageQuery=event.target.value;if(state.live)renderStorageUsers();});
$('clear-storage-search').addEventListener('click',()=>{state.storageQuery='';$('storage-user-search').value='';renderStorageUsers();$('storage-user-search').focus({preventScroll:true});});
$('disk-cards').addEventListener('click',event=>{
  const button=event.target.closest('[data-storage-user]');if(!button)return;
  state.storageQuery=button.dataset.storageUser;$('storage-user-search').value=state.storageQuery;renderStorageUsers();
  $('storage-user-search').focus({preventScroll:true});$('storage-user-search').scrollIntoView({behavior:'smooth',block:'center'});
});
$('storage-user-cards').addEventListener('click',event=>{
  const button=event.target.closest('[data-storage-disk]');if(!button)return;
  const card=[...$('disk-cards').children].find(card=>card.dataset.disk===button.dataset.storageDisk);if(!card)return;
  card.setAttribute('tabindex','-1');card.focus({preventScroll:true});card.scrollIntoView({behavior:'smooth',block:'center'});
});
$('disk-root-select').addEventListener('change',e=>{state.root=e.target.value;renderDiskCharts();});
$('container-metric').addEventListener('change',()=>renderContainerHistory());
$('event-filter').addEventListener('change',()=>loadEvents());
$('more-events').addEventListener('click',async()=>{$('more-events').disabled=true;await loadEvents(true);$('more-events').disabled=false;});
function activeRange(button){for(const b of document.querySelectorAll('[data-range]')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}}
$('range-buttons').addEventListener('click',e=>{const button=e.target.closest('[data-range]');if(!button)return;activeRange(button);const value=button.dataset.range;$('custom-range').hidden=value!=='custom';if(value==='custom'){if(!$('range-end').value){const local=n=>{const d=new Date(n);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};$('range-start').value=local(Date.now()-3600000);$('range-end').value=local(Date.now());}return;}state.range=Number(value);state.custom=null;loadHistory();});
$('custom-range').addEventListener('submit',e=>{e.preventDefault();const start=new Date($('range-start').value).getTime()/1000,end=new Date($('range-end').value).getTime()/1000;if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>90*86400){setText('range-error',t("Select a valid time range of up to 90 days."));return;}state.custom={start:Math.floor(start),end:Math.floor(end)};loadHistory();});
$('disk-range-buttons').addEventListener('click',event=>{
  const button=event.target.closest('[data-disk-range]');if(!button)return;
  for(const option of $('disk-range-buttons').querySelectorAll('button')){
    option.classList.toggle('active',option===button);option.setAttribute('aria-pressed',String(option===button));
  }
  const value=button.dataset.diskRange;
  $('disk-custom-range').hidden=value!=='custom';state.diskRangeInvalid=false;renderDiskHistoryStatus();
  if(value==='custom'){
    if(!$('disk-range-end').value){
      const window=state.diskWindow||diskTimeWindow();
      const local=ts=>{const d=new Date(ts*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
      $('disk-range-start').value=local(window.start);$('disk-range-end').value=local(window.end);
    }
    return;
  }
  state.diskRange=Number(value);state.diskCustom=null;loadDiskHistory();
});
$('disk-custom-range').addEventListener('submit',event=>{
  event.preventDefault();
  const start=new Date($('disk-range-start').value).getTime()/1000,end=new Date($('disk-range-end').value).getTime()/1000;
  state.diskRangeInvalid=!Number.isFinite(start)||!Number.isFinite(end)||end-start<43200||end-start>90*86400;
  renderDiskHistoryStatus();if(state.diskRangeInvalid)return;
  state.diskCustom={start:Math.floor(start),end:Math.floor(end)};loadDiskHistory();
});
new ResizeObserver(()=>{for(const chart of state.charts.values())chart.resize();}).observe(document.querySelector('main'));
const navLinks=[...document.querySelectorAll('nav a')];const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)for(const a of navLinks)a.classList.toggle('active',a.hash===`#${entry.target.id}`);},{rootMargin:'-100px 0px -65% 0px'});document.querySelectorAll('section[id]').forEach(s=>observer.observe(s));
setInterval(()=>setText('clock',new Date().toLocaleTimeString(I18n.locale,{hour12:false})),1000);
setInterval(()=>{if(!document.hidden)refresh();},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh(true);loadHardware();}});
window.addEventListener('monitor-language-change',()=>{for(const chart of state.charts.values())chart.dispose();state.charts.clear();if(state.live)renderLive(state.live);if(state.hardware)HardwareUI.render(state.hardware,{esc,bytes,date});renderHistory();renderSectionHistory('network');renderSectionHistory('container');renderDiskHistory();renderEvents();if(state.networkError)renderConnectionError();setText('clock',new Date().toLocaleTimeString(I18n.locale,{hour12:false}));if($('range-error').textContent)setText('range-error',t('Select a valid time range of up to 90 days.'));});
if(typeof echarts==='undefined'){notice('error-banner',t("The local chart library failed to load. Refresh the page or check static/vendor/echarts.min.js."));}else{refresh(true);}

loadHardware();
setInterval(()=>{if(!document.hidden)loadHardware();},60000);
