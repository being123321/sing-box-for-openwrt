const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../files/www/luci-static/resources/view/sb-router/main.js'),'utf8');
const code=source.slice(source.indexOf("    panelLink.addEventListener('click',"),source.indexOf('    var overviewSource='));
async function run(active,long=false){
 let click,paused=0,closed=false,prevented=false;const opened={opener:'old',location:{},close(){closed=true;}};
 const panel={addEventListener(type,fn){click=fn;}};
 const scope={panelLink:panel,panelLong:long,selectProfile:{value:'airport'},state:{active:'airport',panel:{link:'old'}},message:{},window:{open:()=>opened},getStatus:async()=>({active,panel:{link:'http://192.0.2.1:9091/dashboard/#router-secret=new'}}),pauseOverviewFrame(){paused++;},syncOverviewFrame(){}};
 vm.createContext(scope);vm.runInContext(code,scope);await click({preventDefault(){prevented=true;}});
 return {scope,opened,paused,closed,prevented};
}
(async()=>{const good=await run('airport');assert.equal(good.opened.location.href,good.scope.state.panel.link);assert.equal(good.opened.opener,null);assert.equal(good.paused,1);assert.equal(good.prevented,true);const changed=await run('other');assert.equal(changed.closed,true);assert.match(changed.scope.message.textContent,/先应用/);const held=await run('airport',true);assert.equal(held.paused,0);console.log('Panel entry: refresh live link, stale configuration and long-press handling passed');})().catch(e=>{console.error(e);process.exit(1);});
