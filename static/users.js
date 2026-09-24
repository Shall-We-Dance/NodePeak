'use strict';
window.UserResources = (() => {
  const isSystem=uid=>/^\d+$/.test(String(uid))&&Number(uid)<1000;
  function prepare(live, selected='all') {
    const scan=live.scan_progress||live.disk_scan||{};
    const ids=new Set([...Object.keys(live.users||{}),...Object.keys(scan.users||{})]);
    const rows=[...ids].map(uid=>({uid,...(live.users[uid]||{name:scan.users[uid].name,cpu:0,memory:0,processes:0,read:0,write:0,io_denied:0}),disk:scan.users?.[uid]?.bytes}))
      .sort((a,b)=>b.cpu-a.cpu||b.memory-a.memory||Number(a.uid)-Number(b.uid));
    if(selected!=='all')return {users:rows.filter(row=>String(row.uid)===selected),system:[],total:null};
    const system=rows.filter(row=>isSystem(row.uid)),users=rows.filter(row=>!isSystem(row.uid));
    const total={cpu:0,memory:0,processes:0,read:0,write:0,io_denied:0,disk:undefined,diskPartial:false};
    for(const row of system){
      for(const key of ['cpu','memory','processes','read','write','io_denied'])total[key]+=Number(row[key])||0;
      if(row.disk!=null)total.disk=(total.disk||0)+row.disk;
      else total.diskPartial=true;
    }
    return {users,system,total:system.length?total:null};
  }
  function trends(points, field, {selected='all', scale=1, limit=7}={}) {
    const scores=new Map();
    for(const point of points){
      if(point.gap)continue;
      for(const [uid,user] of Object.entries(point.users||{})){
        const score=scores.get(uid)||{uid,name:user.name||uid,value:0};
        score.value+=Number(user[field])||0;
        scores.set(uid,score);
      }
    }
    const users=[...scores.values()].sort((a,b)=>b.value-a.value||Number(a.uid)-Number(b.uid));
    const single=user=>({id:user.uid,kind:'user',name:user.name,uids:[user.uid]});
    let groups;
    if(selected!=='all')groups=users.filter(user=>user.uid===String(selected)).map(single);
    else{
      const regular=users.filter(user=>!isSystem(user.uid));
      const system=users.filter(user=>isSystem(user.uid));
      groups=regular.slice(0,limit).map(single);
      if(regular.length>limit)groups.push({id:'other-users',kind:'other',uids:regular.slice(limit).map(user=>user.uid)});
      if(system.length)groups.push({id:'system-users',kind:'system',uids:system.map(user=>user.uid)});
    }
    return groups.map(group=>({...group,data:points.map(point=>[
      point.ts*1000,
      point.gap?null:group.uids.reduce((sum,uid)=>sum+(Number(point.users?.[uid]?.[field])||0),0)/scale,
    ])}));
  }
  return {isSystem,prepare,trends};
})();
