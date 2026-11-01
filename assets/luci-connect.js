'use strict';
(function(){
  const params=new URLSearchParams(location.hash.slice(1)),token=params.get('token'),kind=params.get('kind');
  history.replaceState(null,'',location.pathname);
  if(!token || !['yacd','metacubexd','zashboard'].includes(kind)){document.querySelector('p').textContent='请从 LuCI 概览进入此面板。';return;}
  if(kind==='metacubexd'){
    let endpoints;
    try{endpoints=JSON.parse(localStorage.getItem('endpointList')||'[]');}catch(_){endpoints=[];}
    const id='router-luci';
    endpoints=(Array.isArray(endpoints)?endpoints:[]).filter(x=>x.id!==id);
    endpoints.push({id,url:'http://'+location.hostname+':9090',secret:token,label:'软路由'});
    localStorage.setItem('endpointList',JSON.stringify(endpoints));
    localStorage.setItem('selectedEndpoint',id);
    location.replace('/overview');
    return;
  }
  const query=new URLSearchParams({hostname:location.hostname,port:'9090',secret:token,http:'true'});
  location.replace('/?'+query.toString());
})();
