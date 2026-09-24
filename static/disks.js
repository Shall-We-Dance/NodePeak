'use strict';
window.DiskUsage = (() => {
  function owner(path, disks) {
    const normalized=String(path).replace(/\/+$/,'')||'/';
    return disks.filter(d=>d.mount==='/'||normalized===d.mount||normalized.startsWith(d.mount.replace(/\/+$/,'')+'/'))
      .sort((a,b)=>b.mount.length-a.mount.length)[0]?.mount;
  }
  function summarize(disk, scan, disks) {
    const roots=(scan.roots||[]).filter(root=>owner(root,disks)===disk.mount);
    const users=Object.entries(scan.users||{}).map(([uid,user])=>({
      uid,name:user.name,bytes:Object.entries(user.roots||{}).reduce((sum,[root,size])=>sum+(owner(root,disks)===disk.mount?size:0),0)
    })).filter(user=>user.bytes>0).sort((a,b)=>b.bytes-a.bytes);
    const attributed=users.reduce((sum,user)=>sum+user.bytes,0);
    const issues=(scan.error_examples||[]).map(entry=>{
      if(typeof entry==='object')return entry;
      const split=String(entry).lastIndexOf(': ');
      return {path:split<0?String(entry):String(entry).slice(0,split),reason:split<0?'Unavailable':String(entry).slice(split+2)};
    }).filter(entry=>owner(entry.path,disks)===disk.mount);
    const total=Math.max(0,Number(disk.total)||0),used=Math.max(0,Number(disk.used)||0);
    const free=Math.max(0,Math.min(Number(disk.free)||0,total-used));
    const reserved=Math.max(0,total-used-free);
    return {users,roots,issues,attributed,total,used,free,reserved,unattributed:Math.max(0,used-attributed),
      denominator:Math.max(total,1),capacityReady:total>0&&attributed<=used&&used<=total,
      snapshotExceedsUsage:attributed>used,
      scanned:roots.length>0,state:scan.state||'pending'};
  }
  function render(disk, scan, disks, options) {
    const {esc,bytes,fmt,color,selectedUser,open}=options;
    const data=summarize(disk,scan,disks);
    const share=size=>size/data.denominator*100;
    const percent=size=>!data.total?'—':size>0&&share(size)<0.1?`<${fmt(0.1)}%`:`${fmt(share(size))}%`;
    const caption=(label,size)=>`${label}: ${bytes(size)} · ${percent(size)}`;
    const rows=data.users.map(user=>`<tr class="${selectedUser===user.uid?'selected-user':''}"><th scope="row"><span class="disk-user-name"><i class="user-swatch" style="--user-color:${color(user.uid)}"></i><span><button type="button" class="storage-link" data-storage-user="${esc(user.uid)}" title="${esc(t('View this user'))}">${esc(user.name)}</button><small>UID ${esc(user.uid)}</small></span></span></th><td>${bytes(user.bytes)}</td><td>${esc(percent(user.bytes))}</td></tr>`).join('');
    const segments=data.users.map(user=>`<span data-owner="${esc(user.uid)}" style="width:${share(user.bytes)}%;background:${color(user.uid)}" title="${esc(caption(user.name,user.bytes))}"></span>`).join('');
    const grey=data.unattributed>0?`<span class="unattributed-segment" style="width:${share(data.unattributed)}%" title="${esc(caption(t('Unattributed'),data.unattributed))}"></span>`:'';
    const reserved=data.reserved>0?`<span class="reserved-segment" style="width:${share(data.reserved)}%" title="${esc(caption(t('Reserved space'),data.reserved))}"></span>`:'';
    const free=`<span class="free-segment" style="width:${share(data.free)}%" title="${esc(caption(t('Free'),data.free))}"></span>`;
    const composition=data.capacityReady?segments+grey+reserved+free:`<span class="unattributed-segment" style="width:100%" title="${esc(t('Scan and live usage differ. The distribution will update after the next scan.'))}"></span>`;
    const scope=data.scanned?data.roots.join(', '):t('No directories scanned on this disk');
    const incomplete=scan.state==='scanning'||scan.state==='pending';
    const issueList=data.issues.map(issue=>`<li><code>${esc(issue.path)}</code><span>${esc(t(issue.reason||'Unavailable'))}</span><span class="unavailable-size">${esc(t('Size unknown'))}</span></li>`).join('');
    return `<article class="disk-card" data-disk="${esc(disk.mount)}">
      <header><div class="disk-heading"><h3>${esc(disk.mount)}</h3><div class="disk-device">${esc(disk.device)} · ${esc(disk.fstype)}</div></div><span class="disk-percent" title="${esc(t('Used / total capacity'))}">${esc(percent(data.used))}</span></header>
      <div class="disk-capacity"><strong>${bytes(disk.used)} <span>/ ${bytes(disk.total)}</span></strong><span>${esc(t('Free {size}',{size:bytes(disk.free)}))}</span></div>
      <div class="disk-composition disk-capacity-bar" role="img" aria-label="${esc(t('Disk capacity by user'))}">${composition}</div>
      <div class="disk-capacity-legend"><span>${esc(t('100% = total disk capacity'))}</span><span class="capacity-keys">${data.reserved>0?`<span title="${esc(caption(t('Reserved space'),data.reserved))}"><i class="user-swatch reserved-swatch"></i>${esc(t('Reserved {size}',{size:bytes(data.reserved)}))}</span>`:''}<span><i class="user-swatch free-swatch"></i>${esc(t('Free'))}</span>${incomplete?`<span class="pill neutral">${esc(t('Scanning'))}</span>`:''}</span></div>
      <div class="disk-user-table-wrap"><table class="disk-user-table"><thead><tr><th scope="col">${esc(t('User'))}</th><th scope="col">${esc(t('Allocated space'))}</th><th scope="col">${esc(t('Capacity %'))}</th></tr></thead><tbody>
      ${rows}
      <tr class="unattributed-row"><th scope="row"><span class="disk-user-name"><i class="user-swatch unavailable-swatch"></i><span>${esc(t('Unattributed'))}</span></span></th><td>${bytes(data.unattributed)}</td><td>${esc(percent(data.unattributed))}</td></tr>
      </tbody></table></div>
      <div class="disk-scan-scope"><span>${esc(t('Scanned directories'))}</span><span>${esc(scope)}</span></div>
      ${data.snapshotExceedsUsage?`<p class="disk-note">${esc(t('File totals reflect the last scan; filesystem usage is live.'))}</p>`:''}
      ${data.issues.length?`<details class="disk-issues" ${open?'open':''}><summary>${esc(t('Unavailable or changed entries'))} <span>${fmt(data.issues.length,0)}</span></summary><ul>${issueList}</ul></details>`:''}
    </article>`;
  }
  function summarizeUsers(scan, disks) {
    const summaries=disks.map(disk=>({disk,data:summarize(disk,scan,disks)}));
    return Object.entries(scan.users||{}).map(([uid,user])=>{
      const allocations=summaries.map(({disk,data})=>({mount:disk.mount,device:disk.device,bytes:data.users.find(row=>row.uid===uid)?.bytes||0}))
        .filter(row=>row.bytes>0).sort((a,b)=>b.bytes-a.bytes);
      return {uid,name:user.name,disks:allocations,bytes:allocations.reduce((sum,row)=>sum+row.bytes,0)};
    }).filter(user=>user.bytes>0).sort((a,b)=>b.bytes-a.bytes);
  }
  function renderUser(user, options) {
    const {esc,bytes,fmt,color}=options;
    const share=size=>size/Math.max(1,user.bytes)*100;
    return `<article class="storage-user-card disk-card" data-storage-uid="${esc(user.uid)}">
      <header><div class="storage-owner"><span class="storage-avatar" style="--user-color:${color(user.uid)}">${esc(user.name[0]?.toUpperCase())}</span><div><h3>${esc(user.name)}</h3><small>UID ${esc(user.uid)} · ${esc(t('{count} disks',{count:fmt(user.disks.length,0)}))}</small></div></div><div class="storage-owner-total"><strong>${bytes(user.bytes)}</strong><small>${esc(t('Allocated space'))}</small></div></header>
      <div class="disk-composition">${user.disks.map(disk=>`<span style="width:${share(disk.bytes)}%;background:${color('disk:'+disk.mount)}" title="${esc(disk.mount)}: ${bytes(disk.bytes)}"></span>`).join('')}</div>
      <table class="disk-user-table"><thead><tr><th scope="col">${esc(t('Disk'))}</th><th scope="col">${esc(t('Allocated space'))}</th><th scope="col">${esc(t('Share'))}</th></tr></thead><tbody>${user.disks.map(disk=>`<tr><th scope="row"><span class="disk-user-name"><i class="user-swatch" style="--user-color:${color('disk:'+disk.mount)}"></i><span><button type="button" class="storage-link" data-storage-disk="${esc(disk.mount)}" title="${esc(t('View this disk'))}">${esc(disk.mount)}</button></span></span></th><td>${bytes(disk.bytes)}</td><td>${fmt(share(disk.bytes))}%</td></tr>`).join('')}</tbody></table>
    </article>`;
  }
  return {owner,summarize,render,summarizeUsers,renderUser};
})();
