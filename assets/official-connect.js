'use strict';
(function(){
  const params=new URLSearchParams(location.hash.slice(1)),secret=params.get('router-secret');
  if(!secret)return;
  history.replaceState(null,'',location.pathname);
  const key='sing-box-dashboard.servers',id='router-luci';
  let state;
  try{state=JSON.parse(localStorage.getItem(key)||'{}');}catch(_){state={};}
  const servers=(Array.isArray(state.servers)?state.servers:[]).filter(s=>s.id!==id);
  servers.push({id,name:'软路由',url:location.host,secret});
  localStorage.setItem(key,JSON.stringify({servers,activeId:id}));
})();
