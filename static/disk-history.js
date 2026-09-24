'use strict';
window.DiskHistory = (() => {
  // Missing scan coverage is unknown, never a fabricated zero.
  function allocation(scan, uid, root) {
    if(root!=='all'&&!(scan.roots||[]).includes(root))return null;
    const user=scan.users?.[uid];
    const value=root==='all'?user?.bytes:user?.roots?.[root];
    if(Number.isFinite(value)&&value>=0)return value;
    return scan.state==='complete'&&!scan.errors?0:null;
  }
  function prepare(input, {start,end,root='all',user='all'}) {
    const scans=input.filter(scan=>Number.isFinite(scan.finished_at)&&scan.finished_at>=start&&scan.finished_at<=end)
      .slice().sort((a,b)=>a.finished_at-b.finished_at);
    const keys=new Map();
    for(const scan of scans)for(const [uid,row] of Object.entries(scan.users||{}))if(user==='all'||uid===user)keys.set(uid,row.name);
    const rows=[...keys].map(([uid,name])=>({uid,name,values:scans.map(scan=>allocation(scan,uid,root))}))
      .filter(row=>row.values.some(value=>value!==null))
      .sort((a,b)=>Math.max(0,...b.values)-Math.max(0,...a.values)||a.uid.localeCompare(b.uid));
    const totals=scans.map((scan,index)=>rows.reduce((sum,row)=>sum+(row.values[index]||0),0));
    const peak=Math.max(0,...totals);
    const exponent=peak>0?Math.max(0,Math.min(5,Math.floor(Math.log2(peak)/10))):3;
    const sampleCount=scans.filter((scan,index)=>rows.some(row=>row.values[index]!==null)).length;
    return {scans,rows,totals,sampleCount,partial:scans.some(scan=>scan.state!=='complete'||scan.errors>0),
      unit:['B','KiB','MiB','GiB','TiB','PiB'][exponent],scale:1024**exponent};
  }
  return {allocation,prepare};
})();
