'use strict';
'require view';
'require rpc';
'require ui';

var object = 'luci.sbrouter';
function api(method, params) { return rpc.declare({object: object, method: method, params: params || []}); }
var getStatus = api('status'), getCatalog = api('catalog'), job = api('job', ['id']);
var start = api('start'), stop = api('stop'), restart = api('restart'), auto = api('autostart', ['enabled']);
var apply = api('apply', ['name']), setMode = api('base-mode', ['mode']);
var inspectImport = api('import-inspect', ['url', 'value']), commitImport = api('import-commit', ['ticket', 'name', 'mode']);
var manualAdd = api('manual-add', ['value']);
var nodeGet = api('catalog-get', ['id']), nodeSet = api('catalog-set', ['id', 'value']), nodeDelete = api('catalog-del', ['id']);
var testNodes = api('catalog-delay', ['scope']);
var readProfile = api('readprofile', ['name']), editProfile = api('editprofile', ['name', 'dest', 'revision', 'value', 'url', 'source']);
var deleteProfile = api('delete', ['name']), subDelete = api('sub-del', ['name']);
var updateOptions = api('update-options'), updateSelection = api('update-selection', ['selected']);
var updateSelected = api('update-selected');
var updatePolicy = api('update-policy', ['selected', 'enabled', 'mode', 'weekday', 'day', 'hour', 'minute']);
var kernel = api('kernel', ['mode', 'source', 'channel', 'version', 'sha256']);
var panelSet = api('panel-set', ['id', 'url']), token = api('token'), tokenSet = api('token-set', ['token']);
var logs = api('logs', ['lines']);

return view.extend({
  handleSaveApply: null, handleSave: null, handleReset: null,
  load: function () { return Promise.all([getStatus(), getCatalog()]); },
  render: function (initial) {
    var state = initial[0], catalog = initial[1], profiles = state.profileList || [];
    var message = E('p', {'class': 'sb-message', style: 'white-space:pre-wrap'});
    var delays = {}, scope = 'all', logTimer = 0;
    function options(items) { return E('select', {}, items.map(function (x) { return E('option', {value: x[0]}, x[1]); })); }
    function input(type, value) { var el = E('input', {type: type || 'text', 'class': 'cbi-input-text'}); el.value = value === undefined ? '' : value; return el; }
    var fieldCounter = 0;
    function field(label, el) {
      if (!el.id) el.id = 'sb-field-' + (++fieldCounter);
      return E('div', {style: 'margin:8px 0'}, [E('label', {'for': el.id}, label + '　'), el]);
    }
    function button(label, action) {
      return E('button', {type: 'button', 'class': 'btn cbi-button cbi-button-action', style: 'margin:2px 5px 2px 0', click: ui.createHandlerFn(this, async function () {
        try { await action(); } catch (e) { message.textContent = e.message || String(e); }
      })}, label);
    }
    async function result(request) {
      var r = await request;
      if (!r || !r.id) { if (r && r.error) throw Error(r.error); return r; }
      for (var i = 0; i < 1200; i++) {
        await new Promise(function (resolve) { setTimeout(resolve, 650); });
        var value = await job(r.id);
        if (value.pending) continue;
        if (value.error) throw Error(value.error);
        return value;
      }
      throw Error('等待超时，请刷新查看状态');
    }
    async function run(request, text) {
      message.textContent = text || '正在校验并保存…';
      var r = await result(request);
      if (r.failures && r.failures.length) {
        message.textContent = '已更新 '+r.updated.length+' 项；失败 '+r.failures.length+' 项。'+r.failures.map(function (x) {return x.id+' '+x.error;}).join('\n');
        return r;
      }
      location.reload();
      return r;
    }
    function dialog(title, children) { ui.showModal(title, children); }
    function close() { ui.hideModal(); }
    function profileName(name) { return name === 'base' ? '基础配置' : name; }
    function checked(value) { var el = input('checkbox'); el.checked = !!value; return el; }
    var tabs = [['overview', '概览'], ['config', '配置'], ['settings', '设置'], ['logs', '日志']];
    var nav = E('div', {style: 'display:flex;gap:6px;margin:8px 0 16px'}), sections = {};
    function switchTab(id) {
      tabs.forEach(function (tab) {
        sections[tab[0]].hidden = tab[0] !== id;
        nav.querySelector('[data-tab="'+tab[0]+'"]').className = 'btn cbi-button '+(tab[0] === id ? 'cbi-button-action' : '');
      });
      history.replaceState(null, '', '#'+id);
      if (logTimer) {clearInterval(logTimer);logTimer=0;}
      if (id === 'logs') { loadLogs(); logTimer = setInterval(loadLogs, 3000); }
    }
    tabs.forEach(function (tab) { nav.appendChild(E('button', {'class':'btn cbi-button','data-tab':tab[0],click:function () {switchTab(tab[0]);}}, tab[1])); });

    // Overview
    var selectProfile = options(profiles.map(function (p) { return [p.name, profileName(p.name)]; }));
    selectProfile.value = (state.active || '').trim();
    var baseMode = options([['gfw', 'GFW 模式'], ['mainland', '绕过中国大陆 IP']]);
    baseMode.value = state.baseMode || 'mainland';
    var modeRow = field('基础配置分流', baseMode);
    function showMode() { modeRow.hidden = selectProfile.value !== 'base'; }
    selectProfile.onchange = showMode; showMode();
    var boot = checked(state.autostart);
    boot.onchange = async function () {
      boot.disabled=true;
      try { await result(auto(boot.checked));state.autostart=boot.checked;message.textContent='开机启动设置已保存'; }
      catch(e) {boot.checked=state.autostart;message.textContent=e.message;}
      finally {boot.disabled=false;}
    };
    var panelLink = E('a', {'class':'btn cbi-button cbi-button-action',href:state.panel.link,target:'_blank',rel:'noopener noreferrer'}, '进入 '+((state.panel.panels.find(function (p) {return p.id===state.panel.id;})||{}).name||'面板'));
    var overview = E('div', {}, [
      E('p', {}, [E('strong', {}, state.running ? '● 运行中' : '○ 已停止'), '　内核 '+state.kernel+'　已运行 '+Math.floor((state.uptime||0)/60)+' 分钟']),
      E('p', {}, [button(state.running ? '停止透明代理' : '启动透明代理', function () {return run(state.running ? stop() : start());}),
                  button('重启透明代理', function () {return run(restart());}), E('label', {}, [boot,' 开机启动'])]),
      field('当前配置', selectProfile), modeRow,
      E('p', {}, [button('应用配置', async function () {
        if (selectProfile.value==='base' && baseMode.value!==state.baseMode) await result(setMode(baseMode.value));
        await run(apply(selectProfile.value), '正在应用配置…');
      }), panelLink])
    ]);

    // Manual editor uses the same fields as the Harmony client.
    function manualForm(existing) {
      var original = existing || {};
      var protocol=options([['hysteria2','Hysteria2'],['vless','VLESS'],['vmess','VMess'],['trojan','Trojan'],['shadowsocks','Shadowsocks'],['tuic','TUIC'],['anytls','AnyTLS']]);
      protocol.value=original.type||'hysteria2';
      var name=input('text',original.tag),server=input('text',original.server),port=input('number',original.server_port||443);
      port.min=1;port.max=65535;
      var uuid=input('text',original.uuid),password=input('password',original.password),method=input('text',original.method||original.security||'aes-128-gcm');
      var flow=input('text',original.flow),tls=checked(original.tls ? original.tls.enabled : protocol.value!=='shadowsocks' && protocol.value!=='vmess');
      var sni=input('text',original.tls && original.tls.server_name),insecure=checked(original.tls && original.tls.insecure);
      var fingerprint=input('text',original.tls && original.tls.utls && original.tls.utls.fingerprint);
      var publicKey=input('text',original.tls && original.tls.reality && original.tls.reality.public_key);
      var shortId=input('text',original.tls && original.tls.reality && original.tls.reality.short_id);
      var transport=options([['tcp','TCP'],['ws','WebSocket'],['grpc','gRPC'],['httpupgrade','HTTPUpgrade']]);
      transport.value=original.transport ? original.transport.type : 'tcp';
      var path=input('text',original.transport && original.transport.path),host=input('text',original.transport && original.transport.headers && original.transport.headers.Host);
      var service=input('text',original.transport && original.transport.service_name);
      var obfs=checked(original.obfs),obfsPassword=input('password',original.obfs && original.obfs.password);
      var rows={uuid:field('UUID',uuid),password:field('密码',password),method:field('加密方式',method),flow:field('Flow',flow),
                reality:E('div',{},[field('Reality 公钥',publicKey),field('Short ID',shortId)]),
                transport:E('div',{},[field('传输',transport),field('路径',path),field('Host',host),field('gRPC 服务名',service)]),
                obfs:E('div',{},[field('Salamander 混淆',obfs),field('混淆密码',obfsPassword)])};
      function sync() {
        var t=protocol.value;
        rows.uuid.hidden=!['vless','vmess','tuic'].includes(t);
        rows.password.hidden=!['trojan','hysteria2','shadowsocks','tuic','anytls'].includes(t);
        rows.method.hidden=!['vmess','shadowsocks'].includes(t);
        rows.flow.hidden=t!=='vless';rows.reality.hidden=t!=='vless';
        rows.transport.hidden=!['vmess','vless','trojan'].includes(t);rows.obfs.hidden=t!=='hysteria2';
      }
      protocol.onchange=sync;sync();
      return {el:E('div',{},[field('协议',protocol),field('节点名称',name),field('服务器',server),field('端口',port),
        rows.uuid,rows.password,rows.method,rows.flow,field('TLS',tls),field('SNI',sni),field('跳过证书验证',insecure),
        field('uTLS 指纹',fingerprint),rows.reality,rows.transport,rows.obfs]),
        get:function () {
          if(!name.value.trim()||!server.value.trim()||!port.checkValidity()) throw Error('请填写名称、服务器和有效端口');
          var n=JSON.parse(JSON.stringify(original));
          n.type=protocol.value;n.tag=name.value.trim();n.server=server.value.trim().replace(/^\[|\]$/g,'');n.server_port=+port.value;
          ['uuid','password','method','security','flow','tls','transport','obfs'].forEach(function(k){delete n[k];});
          if(!rows.uuid.hidden)n.uuid=uuid.value.trim();
          if(!rows.password.hidden)n.password=password.value;
          if(!rows.method.hidden)n[protocol.value==='vmess'?'security':'method']=method.value.trim();
          if(!rows.flow.hidden&&flow.value)n.flow=flow.value.trim();
          if(tls.checked){
            n.tls=Object.assign({},original.tls||{},{enabled:true,server_name:sni.value.trim()||n.server,insecure:insecure.checked});
            if(fingerprint.value.trim()) n.tls.utls={enabled:true,fingerprint:fingerprint.value.trim()};
            else delete n.tls.utls;
            if(!rows.reality.hidden&&publicKey.value.trim())n.tls.reality={enabled:true,public_key:publicKey.value.trim(),short_id:shortId.value.trim()};
            else delete n.tls.reality;
          }
          if(!rows.transport.hidden&&transport.value!=='tcp'){
            n.transport={type:transport.value};
            if(transport.value==='grpc')n.transport.service_name=service.value;
            else {n.transport.path=path.value||'/';if(host.value)n.transport.headers={Host:host.value};}
          }
          if(!rows.obfs.hidden&&obfs.checked)n.obfs={type:'salamander',password:obfsPassword.value};
          return n;
        }};
    }

    function importDialog() {
      dialog('选择导入方式',[
        E('p',{},'请选择要使用的导入方式。'),
        E('div',{style:'display:flex;gap:12px;flex-wrap:wrap;margin:18px 0'},[
          button('手动添加节点',function(){importStep('manual');}),
          button('链接添加',function(){importStep('link');}),
          button('本地上传',function(){importStep('file');})
        ]),button('取消',close)]);
    }
    function importStep(selectedMethod) {
      var method={value:selectedMethod};
      var form=manualForm(),url=input('url'),file=input('file'),name=input('text');
      url.placeholder='https://…';file.accept='.json,.yaml,.yml,.txt,application/json,text/plain';name.placeholder='订阅或配置名称';
      var notice=E('p'),formRow=E('div',{},form.el),linkRow=field('链接',url),fileRow=field('电脑文件',file),nameRow=field('保存名称',name);
      function sync() {formRow.hidden=method.value!=='manual';linkRow.hidden=method.value!=='link';fileRow.hidden=method.value!=='file';nameRow.hidden=method.value==='manual';}
      sync();
      file.onchange=function(){if(file.files[0]&&!name.value)name.value=file.files[0].name.replace(/\.(json|ya?ml|txt)$/i,'');};
      function commit(preview) {
        var action=options([['nodes','添加节点'],['config','添加配置']]),hint=E('p');
        if(!preview.isConfig)action.value='nodes';
        dialog('识别导入内容',[E('p',{},(preview.isConfig?'检测到完整 sing-box 配置':'检测到节点列表')+'，包含 '+preview.count+' 个节点。'),
          field('保存名称',name),preview.isConfig?field('导入方式',action):E('p',{},'此格式按节点导入基础配置。'),hint,
          button('取消',close),button('确认导入',async function(){
            try{if(!name.value.trim())throw Error('请填写保存名称');hint.textContent='正在校验并保存…';await run(commitImport(preview.ticket,name.value.trim(),action.value));}
            catch(e){hint.textContent=e.message;}
          })]);
      }
      dialog({manual:'手动添加节点',link:'链接添加',file:'本地上传'}[selectedMethod],[formRow,nameRow,linkRow,fileRow,notice,
        button('返回选择',importDialog),button('取消',close),button('下一步',async function(){
          try{
            notice.textContent='正在识别并校验…';
            if(method.value==='manual'){await run(manualAdd(JSON.stringify(form.get())));return;}
            if(method.value==='link'&&!url.value.trim())throw Error('请填写 HTTPS 链接');
            if(method.value==='file'&&!file.files[0])throw Error('请选择电脑上的文件');
            if(file.files[0]&&file.files[0].size>8*1024*1024)throw Error('文件最大 8 MiB');
            var data=await result(inspectImport(method.value==='link'?url.value.trim():'',method.value==='file'?await file.files[0].text():''));
            commit(data);
          }catch(e){notice.textContent=e.message;}
        })]);
    }

    // Source-aware node cards.
    var nodeContainer=E('div'),nodeTabs=E('div',{style:'display:flex;flex-wrap:wrap;gap:5px;margin:12px 0'}),nodeInfo=E('p'),subscriptionActions=E('div');
    function filteredNodes(){return (catalog.nodes||[]).filter(function(n){return scope==='all'||(n.owner==='base'?'base:'+n.source:'profile:'+n.owner)===scope;});}
    function quality(ms) {
      if(ms===undefined)return ['未测试','#777'];
      if(ms<0)return ['超时','#c33'];
      return [ms+' ms',ms<=100?'#198f41':ms<=250?'#458b34':ms<=600?'#b07600':'#c46a22'];
    }
    function renderNodes() {
      nodeContainer.innerHTML='';
      subscriptionActions.innerHTML='';
      var currentSubscription=(catalog.subscriptions||[]).find(function(x){return x.id===scope;});
      if(currentSubscription)subscriptionActions.appendChild(button('删除此订阅',function(){
        dialog('删除订阅',[E('p',{},'删除 '+currentSubscription.name+' 以及该来源的节点？'),
          button('取消',close),button('删除订阅',function(){
            return run(scope.indexOf('base:')===0?subDelete(currentSubscription.name):deleteProfile(currentSubscription.name));
          })]);
      }));
      var rows=filteredNodes().slice();
      rows.sort(function(a,b){var x=delays[a.id],y=delays[b.id];var rx=x>0?0:x===undefined?1:2,ry=y>0?0:y===undefined?1:2;return rx-ry||(rx===0?x-y:0);});
      if(!rows.length)nodeContainer.appendChild(E('p',{},'此来源还没有节点'));
      var grid=E('div',{style:'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px'});
      rows.forEach(function(n){
        var q=quality(delays[n.id]);
        grid.appendChild(E('div',{'data-node-id':n.id,style:'border:1px solid #bbb;border-radius:7px;padding:10px;overflow-wrap:anywhere'},[
          E('strong',{},n.tag),E('div',{},n.type+' · '+n.server+':'+n.port),
          E('div',{style:'font-size:12px;opacity:.7'},n.source?'订阅 '+n.source:'手动添加'),
          E('p',{style:'color:'+q[1]},q[0]),button('编辑',function(){return editNode(n.id);}),button('删除',function(){return removeNode(n.id);})
        ]));
      });
      nodeContainer.appendChild(grid);
      Array.from(nodeTabs.children).forEach(function(x){x.className='btn cbi-button '+(x.dataset.scope===scope?'cbi-button-action':'');});
    }
    function setScope(value){scope=value;renderNodes();}
    nodeTabs.appendChild(E('button',{'class':'btn cbi-button','data-scope':'all',click:function(){setScope('all');}},'所有节点'));
    (catalog.subscriptions||[]).forEach(function(sub){
      nodeTabs.appendChild(E('button',{'class':'btn cbi-button','data-scope':sub.id,click:function(){setScope(sub.id);}},sub.name+'（'+sub.count+'）'));
    });
    async function editNode(id) {
      var r=await nodeGet(id);if(r.error)throw Error(r.error);
      var form=manualForm(JSON.parse(r.value)),advanced=E('textarea',{rows:12,style:'width:100%;font-family:monospace'}),useJSON=false;
      advanced.value=JSON.stringify(JSON.parse(r.value),null,2);advanced.hidden=true;
      var notice=E('p');
      dialog('编辑节点',[form.el,advanced,button('表单 / JSON',function(){useJSON=!useJSON;form.el.hidden=useJSON;advanced.hidden=!useJSON;}),notice,
        button('取消',close),button('校验并保存',async function(){try{
          var n=useJSON?JSON.parse(advanced.value):form.get();notice.textContent='正在保存…';await run(nodeSet(id,JSON.stringify(n)));
        }catch(e){notice.textContent=e.message;}})]);
    }
    function removeNode(id) {
      dialog('删除节点',[E('p',{},'确定删除这个节点？订阅更新后仍会记住这次删除。'),button('取消',close),
        button('删除',function(){return run(nodeDelete(id));})]);
    }
    var testButton=button('测速并排序',async function(){
      testButton.disabled=true;nodeInfo.textContent='正在通过节点测试代理延迟…';
      try{
        var r=await result(testNodes(scope));Object.assign(delays,r.delays);renderNodes();nodeInfo.textContent='测速完成，成功结果按延迟从低到高排列。';
      }finally{testButton.disabled=false;}
    });

    async function editor(name) {
      var data=await result(readProfile(name)),dest=input('text',name);
      var area=E('textarea',{rows:20,spellcheck:'false',style:'width:100%;font-family:monospace'}),notice=E('p');
      var url=input('url',data.url||''),sourceRow=field('来源链接 URL',url);
      url.style.width='100%';
      var editMode=options([['link','编辑来源链接'],['json','编辑 JSON，另存本地副本']]);
      var modeRow=field('编辑方式',editMode);
      modeRow.hidden=!data.remote;
      var type=E('p',{},'类型：'+(data.remote?'远程链接配置':'本地配置'));
      var hint=E('p',{},'保存链接时会先下载并校验配置。当前配置应用失败会恢复原链接和配置；后续自动更新使用保存的新链接。');
      area.value=data.value;
      var saveButton=button('校验并保存',async function(){
        try{
          var sourceEdit=data.remote&&editMode.value==='link';
          if(sourceEdit&&!url.value.trim())throw Error('请填写配置来源链接');
          if(!sourceEdit)JSON.parse(area.value);
          notice.textContent=sourceEdit?'正在下载并校验链接配置…':'正在校验…';
          await run(editProfile(name,dest.value.trim(),data.revision,area.value,sourceEdit?url.value.trim():'',!!sourceEdit));
        }
        catch(e){notice.textContent=e.message;}
      });
      function syncEditor(){
        var isLink=data.remote&&editMode.value==='link';
        sourceRow.hidden=hint.hidden=!isLink;area.hidden=isLink;
        saveButton.textContent=isLink?'校验链接并保存':'校验并保存';
        if(data.remote)dest.value=isLink?name:name+'-local';
      }
      editMode.onchange=syncEditor;syncEditor();
      dialog('编辑配置文件',[type,field('保存名称',dest),modeRow,sourceRow,hint,area,notice,button('取消',close),saveButton]);
    }
    function customTable() {
      var body=E('tbody');
      profiles.filter(function(p){return p.kind!=='base'&&p.kind!=='subscription';}).forEach(function(p){
        var details=E('div'),toggle=button('显示节点（'+p.nodes+'）',async function(){
          if(details.childNodes.length){details.hidden=!details.hidden;return;}
          var data=await result(readProfile(p.name)),cfg=JSON.parse(data.value);
          var group=E('ul');
          (cfg.outbounds||[]).filter(function(n){return n.server;}).forEach(function(n){
            group.appendChild(E('li',{},n.tag+' · '+n.type+' · '+n.server+':'+n.server_port));
          });details.appendChild(group);
        });
        body.appendChild(E('tr',{},[E('td',{},[E('strong',{},p.name),E('div',{},p.kind==='remote'?'链接配置':'本地配置')]),
          E('td',{},[toggle,details]),E('td',{},[
            button('删除',function(){dialog('删除配置',[E('p',{},'确定删除 '+p.name+'？'),button('取消',close),button('删除',function(){return run(deleteProfile(p.name));})]);}),
            button('编辑',function(){return editor(p.name);}),
            button(p.active?'已应用':'应用',function(){return run(apply(p.name),'正在应用配置…');})
          ])]));
      });
      return E('table',{'class':'sb-config-table'},[
        E('colgroup',{},[E('col',{style:'width:30%'}),E('col',{style:'width:32%'}),E('col',{style:'width:38%'})]),
        E('thead',{},E('tr',{},[E('th',{},'配置'),E('th',{},'节点'),E('th',{},'操作')])),body]);
    }

    function selectedUpdatesDialog() {
      var opts=state.updates,boxes=[];
      var rows=opts.items.map(function(item){var box=checked(opts.selected.includes(item.id));boxes.push([item.id,box]);return field(item.kind+' · '+item.name,box);});
      var notice=E('p');
      function selection(){return JSON.stringify(boxes.filter(function(x){return x[1].checked;}).map(function(x){return x[0];}));}
      dialog('选择订阅和配置更新项',[E('p',{},'只下载勾选的项目。保存后手动更新和定时更新使用相同选择。'),E('div',{},rows),notice,
        button('取消',close),button('保存选择',function(){return run(updateSelection(selection()));}),
        button('更新勾选项',async function(){
          try{
            notice.textContent='正在更新…';await result(updateSelection(selection()));
            var r=await result(updateSelected());
            if(r.failures.length){notice.textContent='成功 '+r.updated.length+' 项，失败 '+r.failures.length+' 项。'+r.failures.map(function(f){return f.id+' '+f.error;}).join('\n');return;}
            location.reload();
          }catch(e){notice.textContent=e.message;}
        })]);
    }
    function updateSchedule() {
      var data=state.updates.schedule,on=checked(data.enabled),mode=options([['daily','每天'],['weekly','每周'],['monthly','每月']]);
      mode.value=data.mode;
      var weekday=options([['0','周日'],['1','周一'],['2','周二'],['3','周三'],['4','周四'],['5','周五'],['6','周六']]);weekday.value=String(data.weekday);
      var day=input('number',data.day);day.min=1;day.max=31;day.style.width='5em';
      var hour=input('number',data.hour),minute=input('number',data.minute);hour.min=0;hour.max=23;minute.min=0;minute.max=59;hour.style.width=minute.style.width='5em';
      var weekRow=field('周几',weekday),dayRow=field('几日',day);
      function sync(){weekRow.hidden=mode.value!=='weekly';dayRow.hidden=mode.value!=='monthly';}
      mode.onchange=sync;sync();
      return E('div',{},[E('p',{},E('label',{},[on,' 启用定时更新'])),field('更新频率',mode),weekRow,dayRow,field('更新时间',E('span',{},[hour,' 时 ',minute,' 分'])),
        button('保存更新策略',function(){
          if(hour.value===''||minute.value===''||!hour.checkValidity()||!minute.checkValidity()||(mode.value==='monthly'&&(!day.value||!day.checkValidity())))throw Error('更新日期或时间无效');
          return run(updatePolicy(JSON.stringify(state.updates.selected),on.checked,mode.value,+weekday.value,+day.value,+hour.value,+minute.value),'正在保存更新策略…');
        })]);
    }
    var config=E('div',{},[
      button('导入节点 / 订阅 / 配置',importDialog),E('h3',{},'节点'),nodeTabs,subscriptionActions,E('p',{},[testButton]),nodeInfo,nodeContainer,
      E('h3',{},'自定义配置'),customTable(),E('h3',{},'订阅与配置更新'),
      button('选择更新项 / 立即更新',selectedUpdatesDialog),updateSchedule()
    ]);
    renderNodes();

    // Settings retain the deployed kernel updater.
    var channel=options([['testing','最新测试版'],['stable','最新稳定版']]),source=options([['official','GitHub 官方源（默认）'],['ghfast','GHFast 免费加速'],['ghproxy','GH-Proxy 免费加速'],['custom','自定义更新源 / 加速地址']]);
    var prefs=state.coreUpdate||{},sourceAddress=input('url'),sourceRow=field('自定义下载地址',sourceAddress);
    channel.value=prefs.channel||'testing';source.value=['official','ghfast','ghproxy'].includes(prefs.source||'official')?(prefs.source||'official'):'custom';
    sourceAddress.value=source.value==='custom'?prefs.source:'';
    sourceAddress.placeholder='https://加速地址/ 或 https://镜像地址/{url}';
    var sourceHint=E('p',{},'自定义地址用于下载安装包。可填写 HTTPS 加速前缀，或用 {url} 表示完整官方安装包链接。版本与校验值仍取自 GitHub 官方。');
    function showSource(){sourceRow.hidden=sourceHint.hidden=source.value!=='custom';}
    showSource();
    var release=E('p'),version='';
    var installButton=button('下载并安装',function(){return kernelTask('install');}),checkButton=button('检查最新版本',function(){return kernelTask('check');});
    installButton.disabled=true;
    var uploadButton=button('本地上传内核',async function(){
      var uploaded=await ui.uploadFile('/tmp/sb-router-core-upload',null,'支持 sing-box Linux 可执行文件和官方 .tar.gz 安装包，最大 120 MB。');
      if(uploaded.size>120000000)throw Error('文件超过 120 MB，请重新选择');
      release.textContent='正在检查上传内核的架构、版本和配置兼容性…';
      var r=await result(kernel('upload-check','official',channel.value,'',uploaded.sha256sum));
      var notice=E('p');
      dialog('安装本地内核',[E('p',{},'版本 '+r.latest+'　架构 '+r.target),
        E('p',{},r.message),E('p',{style:'overflow-wrap:anywhere'},'SHA-256 '+r.sha256),notice,
        button('取消',close),button('确认安装',async function(){
          try{notice.textContent='正在安装，失败会回退…';await result(kernel('upload-install','official',channel.value,r.latest,r.sha256));close();location.reload();}
          catch(e){notice.textContent=e.message;}
        })]);
    });
    function resetVersion(){version='';installButton.disabled=true;installButton.classList.remove('sb-update-ready');release.textContent='';release.style.color='';}
    channel.onchange=resetVersion;source.onchange=function(){showSource();resetVersion();};sourceAddress.oninput=resetVersion;
    async function kernelTask(mode) {
      var downloadSource=source.value==='custom'?sourceAddress.value.trim():source.value;
      if(source.value==='custom'&&!/^https:\/\/\S+/.test(downloadSource))throw Error('请填写有效的 HTTPS 更新源或加速地址');
      channel.disabled=source.disabled=sourceAddress.disabled=checkButton.disabled=installButton.disabled=true;release.textContent='正在处理内核…';release.style.color='';
      try{
        var r=await result(kernel(mode,downloadSource,channel.value,version,''));version=r.latest;
        var available=!!r.updateAvailable;
        installButton.classList.toggle('sb-update-ready',available);
        installButton.disabled=!available;
        release.style.color='#198f41';
        release.textContent='当前 '+r.current+'　通道 '+r.latest+'　架构 '+r.target+(r.message?'　'+r.message:(available?'　发现可安装版本':'　已是所选通道最新版本'));
      }catch(e){version='';installButton.disabled=true;installButton.classList.remove('sb-update-ready');release.style.color='#c33';release.textContent=e.message;}
      finally{channel.disabled=source.disabled=sourceAddress.disabled=checkButton.disabled=false;}
    }
    var panelSelect=options(state.panel.panels.map(function(p){return [p.id,p.name];}));panelSelect.value=state.panel.id;
    var customURL=input('url',state.panel.url),customRow=field('自定义面板地址',customURL),panelMessage=E('p');
    function showCustom(){customRow.hidden=panelSelect.value!=='custom';}panelSelect.onchange=showCustom;showCustom();
    var secret=input('password');secret.readOnly=true;secret.style.width='65%';
    var settings=E('div',{},[
      E('h3',{},'内核更新'),field('更新通道',channel),field('下载来源',source),sourceRow,sourceHint,E('p',{},[checkButton,installButton,uploadButton]),release,
      E('h3',{},'面板设置'),field('选择面板',panelSelect),customRow,
      button('保存面板选择',async function(){
        var r=await result(panelSet(panelSelect.value,customURL.value.trim()));panelLink.href=r.link;
        panelLink.textContent='进入 '+panelSelect.selectedOptions[0].textContent;
        panelMessage.textContent='已保存，可从概览直接进入所选面板。';
      }),panelMessage,E('h3',{},'面板密钥'),secret,
      button('显示 / 隐藏',async function(){if(!secret.value)secret.value=(await token()).token;secret.type=secret.type==='password'?'text':'password';}),
      button('修改密钥',function(){
        var value=input('text'),notice=E('p');
        dialog('修改面板密钥',[field('新密钥',value),notice,button('取消',close),button('保存',async function(){
          try{await run(tokenSet(value.value.trim()));}catch(e){notice.textContent=e.message;}
        })]);
      }),
      E('h3',{},'项目信息'),
      E('p',{},E('a',{href:'https://github.com/being123321/sing-box-for-openwrt',target:'_blank',rel:'noopener'},'本项目 · sing-box for openwrt')),
      E('p',{},E('a',{href:'https://github.com/SagerNet/sing-box',target:'_blank',rel:'noopener'},'上游 · SagerNet/sing-box')),
      E('p',{},E('a',{href:'https://github.com/SagerNet/sing-box-dashboard',target:'_blank',rel:'noopener'},'官方面板 · SagerNet/sing-box-dashboard'))
    ]);
    var logBox=E('pre',{style:'max-height:60vh;overflow:auto;white-space:pre-wrap;background:#111;color:#ddd;padding:10px'});
    async function loadLogs(){try{var r=await logs(300);logBox.textContent=(r.lines||[]).join('\n');}catch(e){logBox.textContent=e.message;}}
    sections.overview=E('div',{id:'sec-overview'},overview);sections.config=E('div',{id:'sec-config'},config);
    sections.settings=E('div',{id:'sec-settings'},settings);sections.logs=E('div',{id:'sec-logs'},[button('刷新日志',loadLogs),logBox]);
    var selected=location.hash.substring(1);if(!tabs.some(function(t){return t[0]===selected;}))selected='overview';
    switchTab(selected);
    return E('div',{'class':'sb-router-view'},[
      E('style',{},'.sb-router-view [hidden],.modal [hidden]{display:none!important}.sb-config-table{display:table!important;width:100%;table-layout:fixed;border-collapse:collapse}.sb-config-table thead{display:table-header-group!important}.sb-config-table tbody{display:table-row-group!important}.sb-config-table tr{display:table-row!important}.sb-config-table th,.sb-config-table td{display:table-cell!important;text-align:left!important;vertical-align:top;padding:12px 10px;border-bottom:1px solid #bbb;overflow-wrap:anywhere}.sb-config-table th{font-weight:bold;background:rgba(127,127,127,.08)}.sb-update-ready{background:#198f41!important;color:#fff!important;border-color:#198f41!important}'),
      E('h2',{},'sing-box'),nav,message,sections.overview,sections.config,sections.settings,sections.logs]);
  }
});
