'use strict';
(() => {
  const catalogs = window.MONITOR_LOCALES;
  const localeNames = {en:'en-US', zh:'zh-CN', ko:'ko-KR', es:'es-ES', ja:'ja-JP'};
  const storageKey = 'node-monitor.language';
  const nativeNames={en:'English',zh:'中文',ko:'한국어',es:'Español',ja:'日本語'};
  let language = 'en';
  try { const saved = localStorage.getItem(storageKey); if (Object.hasOwn(localeNames,saved)) language=saved; } catch {}
  const aliases = {
    '正在连接 UPS':'Connecting to UPS', '正在连接 Docker':'Connecting to Docker',
    '正在采集第一组数据，请稍候':'Waiting for the first sample. Please try again shortly.',
    'UPS 状态不可用或通信中断':'UPS status is unavailable or communication was lost.',
    'UPS 采集已关闭':'UPS monitoring is disabled.', '命令执行失败':'Command failed.',
    '未安装 apcaccess':'apcaccess is not installed.', '未安装 upsc':'upsc is not installed.',
    '未发现 NUT UPS':'No NUT UPS was found.', 'apcupsd 日志':'apcupsd log', 'UPS 实时状态':'UPS live status',
    '检测到系统重启；重启原因未确认，请结合 UPS 日志判断。':'System reboot detected. The cause is unknown; check the UPS logs.',
    '监控进程上次未正常结束；采集缺口不代表发生断电。':'The monitor did not exit cleanly. A collection gap does not imply a power failure.',
    '监控服务启动，开始记录资源使用情况。':'Monitoring started. Recording resource usage.',
    'UPS 切换为电池供电（可能包含自检，请结合 UPS 日志确认原因）。':'UPS switched to battery power. This may be a self-test; check the UPS logs.',
    'UPS 恢复市电供电。':'UPS returned to mains power.'
  };
  function translate(key, params={}) {
    if (key == null) return '';
    key=String(key);
    key=Object.hasOwn(aliases,key)?aliases[key]:key;
    let match;
    if ((match=key.match(/^时间范围须大于 0 且不超过 (\d+) 天$/)))
      return translate('Select a time range greater than zero and no longer than {days} days.',{days:match[1]});
    if ((match=key.match(/^apcupsd (.+) startup succeeded$/)))
      return translate('apcupsd {version} started successfully.',{version:match[1]});
    if ((match=key.match(/^apcupsd exiting, signal (\d+)$/)))
      return translate('apcupsd exited with signal {signal}.',{signal:match[1]});
    const text=Object.hasOwn(catalogs[language],key)?catalogs[language][key]:Object.hasOwn(catalogs.en,key)?catalogs.en[key]:key;
    return text.replace(/\{(\w+)\}/g, (placeholder,name)=>Object.hasOwn(params,name)?String(params[name]):placeholder);
  }
  const nodes=[], attributes=[];
  const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) {
    const node=walker.currentNode, key=node.nodeValue.trim();
    if(node.parentElement?.closest('script,style,[data-no-i18n]') || !Object.hasOwn(catalogs.en,key))continue;
    nodes.push({node,key,prefix:node.nodeValue.match(/^\s*/)[0],suffix:node.nodeValue.match(/\s*$/)[0]});
  }
  for(const element of document.querySelectorAll('[title],[aria-label],[placeholder],meta[name="description"]')) {
    for(const attribute of ['title','aria-label','placeholder','content']) {
      const key=element.getAttribute(attribute);
      if(Object.hasOwn(catalogs.en,key))attributes.push({element,attribute,key});
    }
  }
  function applyStatic() {
    document.documentElement.lang=localeNames[language];
    for(const {node,key,prefix,suffix} of nodes)if(node.isConnected)node.nodeValue=prefix+translate(key)+suffix;
    for(const {element,attribute,key} of attributes)if(element.isConnected)element.setAttribute(attribute,translate(key));
    const toggle=document.getElementById('language-toggle');
    toggle.dataset.language=language;
    toggle.setAttribute('aria-label',translate('Language')+': '+nativeNames[language]);
    document.getElementById('current-language').textContent=nativeNames[language];
    document.getElementById('language-menu').setAttribute('aria-label',translate('Language'));
    for(const option of document.querySelectorAll('[data-language]'))if(option.matches('[role="menuitemradio"]'))option.setAttribute('aria-checked',String(option.dataset.language===language));
  }
  function setLanguage(next) {
    if(!Object.hasOwn(localeNames,next))return;
    const top=document.querySelector('.topbar').getBoundingClientRect().bottom;
    const anchor=[...document.querySelectorAll('main .section')].find(section=>section.getBoundingClientRect().bottom>top);
    const anchorTop=anchor?.getBoundingClientRect().top;
    language=next;
    try {localStorage.setItem(storageKey,language);} catch {}
    applyStatic();
    window.dispatchEvent(new CustomEvent('monitor-language-change',{detail:{language,locale:localeNames[language]}}));
    // Keep the section being read in place when translated content changes height.
    if(anchor)window.scrollBy({top:anchor.getBoundingClientRect().top-anchorTop,behavior:'instant'});
  }
  window.I18n={t:translate,setLanguage,get language(){return language;},get locale(){return localeNames[language];}};
  window.t=translate;
  applyStatic();
  const picker=document.getElementById('language-picker');
  const toggle=document.getElementById('language-toggle');
  const menu=document.getElementById('language-menu');
  const choices=[...menu.querySelectorAll('button')];
  const focus=element=>element?.focus({preventScroll:true});
  function closeMenu(restoreFocus=false){
    menu.hidden=true;toggle.setAttribute('aria-expanded','false');
    if(restoreFocus)focus(toggle);
  }
  function openMenu(keyboard=false){
    menu.hidden=false;toggle.setAttribute('aria-expanded','true');
    if(keyboard)focus(choices.find(choice=>choice.dataset.language===language));
  }
  toggle.addEventListener('click',event=>menu.hidden?openMenu(event.detail===0):closeMenu());
  toggle.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();openMenu(true);}
    else if(event.key==='Escape'){event.preventDefault();closeMenu(true);}
    else if(event.key==='Tab')closeMenu();
  });
  menu.addEventListener('click',event=>{
    const option=event.target.closest('[role="menuitemradio"]');
    if(option){closeMenu(true);setLanguage(option.dataset.language);}
  });
  menu.addEventListener('keydown',event=>{
    const index=choices.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();
      const target=event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;
      focus(choices[target]);
    }else if(event.key==='Escape'){event.preventDefault();closeMenu(true);}else if(event.key==='Tab'){closeMenu(true);}
  });
  document.addEventListener('pointerdown',event=>{if(!picker.contains(event.target))closeMenu();});
  // focusin is synchronous: a delayed focusout could hide a touched option before click.
  document.addEventListener('focusin',event=>{if(!picker.contains(event.target))closeMenu();});
})();
