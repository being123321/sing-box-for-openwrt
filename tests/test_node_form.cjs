const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../files/www/luci-static/resources/view/sb-router/main.js'),'utf8');
const code=source.slice(source.indexOf('    function changedFormValues('),source.indexOf('    async function editNode('));const scope={};vm.createContext(scope);vm.runInContext(code,scope);
const original={type:'vless',tag:'A',server:'example.test',tls:{enabled:true,utls:{enabled:true,fingerprint:'chrome',custom:'keep'}},transport:{type:'ws',headers:{Host:'example.test',Extra:'keep'},max_early_data:2048}};
const before={...original,tls:{enabled:true,server_name:'example.test',insecure:false,utls:{enabled:true,fingerprint:'chrome'}},transport:{type:'ws',headers:{Host:'example.test'}}};
const after=JSON.parse(JSON.stringify(before));after.tls.insecure=true;
const saved=scope.changedFormValues(original,before,after);
assert.equal(saved.tls.insecure,true);assert.equal(saved.tls.server_name,undefined);assert.equal(saved.tls.utls.custom,'keep');assert.equal(saved.transport.max_early_data,2048);assert.equal(saved.transport.headers.Extra,'keep');assert.equal(original.tls.insecure,undefined);
console.log('Node form: TLS-only changes preserve all untouched advanced parameters');
