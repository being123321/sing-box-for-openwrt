'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../assets/official-connect.js'),'utf8');
function run(embed,secret){
  const stored=new Map([['sing-box-dashboard.servers',JSON.stringify({servers:[{id:'other',name:'keep',url:'example.invalid',secret:'other-test-secret'},{id:'router-luci',secret:'old-test-secret'}]})]]),styles=[],messages=[],history=[];
  const query=embed?'?luci-embed=overview&luci-parent='+encodeURIComponent('http://192.0.2.1'):'?theme=light';
  const root={querySelector:()=>({getBoundingClientRect:()=>({height:296})})};
  const context={URL,URLSearchParams,location:{hash:secret?'#router-secret='+secret:'',search:query,pathname:'/dashboard/',hostname:'192.0.2.1',host:'192.0.2.1:9091'},history:{replaceState:(...args)=>history.push(args[2])},localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},console:{info:()=>{}},document:{readyState:'complete',createElement:()=>({}),head:{appendChild:style=>styles.push(style.textContent)},getElementById:()=>root},window:{parent:{postMessage:(data,origin)=>messages.push({data,origin})}},MutationObserver:class{observe(){}},ResizeObserver:class{observe(){}}};
  vm.runInNewContext(script,context);
  return {state:JSON.parse(stored.get('sing-box-dashboard.servers')),styles,messages,history,query};
}
const embedded=run(true,'current-test-secret');
assert.equal(embedded.state.servers.find(x=>x.id==='router-luci').secret,'current-test-secret');
assert.equal(embedded.state.servers.find(x=>x.id==='other').secret,'other-test-secret');
assert.equal(embedded.state.activeId,'router-luci');assert.equal(embedded.styles.length,1);
assert.match(embedded.styles[0],/nav\{display:none/);assert.equal(embedded.history[0],'/dashboard/'+embedded.query);
assert.equal(embedded.messages[0].data.height,304);assert.equal(embedded.messages[0].origin,'http://192.0.2.1');
const normal=run(false,'current-test-secret');assert.equal(normal.styles.length,0);assert.equal(normal.messages.length,0);assert.equal(normal.history[0],'/dashboard/?theme=light');
const reload=run(true,'');assert.equal(reload.styles.length,1);assert.equal(reload.state.servers.find(x=>x.id==='router-luci').secret,'old-test-secret');
process.stdout.write('Official overview embedding: credential refresh, unrelated connections, query preservation and height messages passed\n');
