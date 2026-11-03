'use strict';
(function(){
  const params=new URLSearchParams(location.hash.slice(1)),secret=params.get('router-secret');
  const query=new URLSearchParams(location.search);
  if(query.get('luci-embed')==='overview'){
    const style=document.createElement('style');
    style.textContent='html,body,#root{height:auto!important;min-height:0!important;background:transparent!important}body{margin:0!important;overflow:hidden!important}#root>[class*="_app_"]{display:block!important;min-height:0!important;height:auto!important}#root>[class*="_app_"]>header,#root>[class*="_app_"]>nav{display:none!important}#root>[class*="_app_"]>main{margin:0!important;padding:0!important;width:100%!important;min-height:0!important;height:auto!important;overflow:visible!important}.page{padding:0!important}.page-header{display:none!important}.page>[class*="_card-grid_"]{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px!important;align-items:stretch!important}.card{box-sizing:border-box!important;min-width:0!important;height:174px!important;min-height:174px!important;padding:14px!important;border-radius:10px!important}.card>svg{width:100%!important;height:40px!important}.card .card-header{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:8px!important;white-space:nowrap!important}.card .card-header svg{width:20px!important;height:20px!important;flex:0 0 20px!important}.card .text-metric{font-size:26px!important;line-height:32px!important}.card:nth-child(n+3){display:flex!important;flex-direction:column!important;justify-content:space-between!important}.card .data-line{margin:0!important}.card:nth-child(1) [class*="_metric-sub_"]::before{content:"本次总上传 ";font-size:12px}.card:nth-child(2) [class*="_metric-sub_"]::before{content:"本次总下载 ";font-size:12px}@media(max-width:1000px){.page>[class*="_card-grid_"]{grid-template-columns:repeat(2,minmax(0,1fr))!important}}@media(max-width:520px){.page>[class*="_card-grid_"]{grid-template-columns:1fr!important}.card{height:154px!important;min-height:154px!important}}';
    document.head.appendChild(style);
    let parentOrigin;
    try{const value=new URL(query.get('luci-parent'));if(value.hostname===location.hostname&&['http:','https:'].includes(value.protocol))parentOrigin=value.origin;}catch(_){}
    if(parentOrigin&&window.parent!==window){
      const observe=function(){
        const root=document.getElementById('root');if(!root)return;
        let lastHeight=0;
        const notify=function(){const page=root.querySelector('.page'),height=page?Math.ceil(page.getBoundingClientRect().height)+8:320;if(Math.abs(height-lastHeight)>2){lastHeight=height;window.parent.postMessage({type:'sb-router-overview-size',height},parentOrigin);}};
        new MutationObserver(notify).observe(root,{childList:true,subtree:true});
        new ResizeObserver(notify).observe(root);notify();
      };
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
    }
  }
  if(!secret)return;
  history.replaceState(null,'',location.pathname+location.search);
  const key='sing-box-dashboard.servers',id='router-luci';
  let state;
  try{state=JSON.parse(localStorage.getItem(key)||'{}');}catch(_){state={};}
  const servers=(Array.isArray(state.servers)?state.servers:[]).filter(s=>s.id!==id);
  servers.push({id,name:'软路由',url:location.host,secret});
  localStorage.setItem(key,JSON.stringify({servers,activeId:id}));
  console.info('sb-router: panel credential synchronized',secret.length,JSON.parse(localStorage.getItem(key)).servers.find(s=>s.id===id).secret===secret);
})();
