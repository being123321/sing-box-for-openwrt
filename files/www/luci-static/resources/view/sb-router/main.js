'use strict';
'require view';
'require rpc';
'require ui';

var object = 'luci.sbrouter';
function api(method, params) { return rpc.declare({object: object, method: method, params: params || []}); }
var getStatus = api('status'), getCatalog = api('catalog'), job = api('job', ['id']);
var start = api('start'), stop = api('stop'), restart = api('restart'), auto = api('autostart', ['enabled']);
var apply = api('apply', ['name']), setMode = api('base-mode', ['mode']);
var inspectImport = api('import-inspect', ['url', 'value']), commitImport = api('import-commit', ['ticket', 'name', 'mode','policy']);
var manualAdd = api('manual-add', ['value']);
var nodeGet = api('catalog-get', ['id']), nodeSet = api('catalog-set', ['id', 'value']), nodeDelete = api('catalog-del', ['id']);
var testNodes = api('catalog-delay', ['scope']);
var readProfile = api('readprofile', ['name']), editProfile = api('editprofile', ['name', 'dest', 'revision', 'value', 'url', 'source', 'copyOverwrite']);
var deleteProfile = api('delete', ['name']), subDelete = api('sub-del', ['name']);
var updateOptions = api('update-options'), updateSelection = api('update-selection', ['selected']);
var updateSelected = api('update-selected');
var updatePolicy = api('update-policy', ['selected', 'enabled', 'mode', 'weekday', 'day', 'hour', 'minute']);
var kernel = api('kernel', ['mode', 'source', 'channel', 'version', 'sha256']);
var panelSet = api('panel-set', ['id', 'url', 'name']);
var profileApi=api('profile-api',['name']),profileApiSet=api('profile-api-set',['name','port','secret','reset']);
var siteStatus=api('site-status'),siteCheck=api('site-check'),profileUpdate=api('profile-update',['name']);
var runtimeInfo=api('runtime'),batchDelete=api('nodes-delete',['ids']);
var copyNodes=api('node-copy',['ids','target','overwrite']),copyPolicy=api('copy-policy',['name','overwrite']);
var logs = api('logs', ['lines']);
var serversList=api('server-list'),serverGet=api('server-get',['id']);
var serverSave=api('server-save',['id','revision','value','enabled','route','firewall']);
var serverDelete=api('server-delete',['id','revision']),serverGenerate=api('server-generate',['kind']);
var dependencies=api('dependencies'),dependenciesInstall=api('dependencies-install');
var usageStatus=api('usage-status');
var telemetry=api('telemetry'),itemPolicy=api('item-policy-get',['id']),itemSet=api('item-policy-set',['id','policy']),itemUpdate=api('item-update',['id']);
var certScan=api('certificates'),certIssue=api('certificate-issue',['domain','email','provider','token','agree']);
var shareServer=api('server-share',['id','host','user']);
var shareNode=api('node-share',['id']),shareProfile=api('profile-share',['name']);
var selectionGet=api('selection'),selectionSet=api('selection-set',['value']);
var proxyList=api('proxy-list'),proxySave=api('proxy-save',['id','domain','target','port','https','certificate','key','enabled','firewall']),proxyDelete=api('proxy-delete',['id']);

return view.extend({
  handleSaveApply: null, handleSave: null, handleReset: null,
  load: function () { return Promise.all([getStatus(), getCatalog(),serversList(),dependencies(),telemetry(),proxyList(),siteStatus(),usageStatus(),selectionGet()]); },
  render: function (initial) {
    var state = initial[0], catalog = initial[1], profiles = state.profileList || [];
    var serverState=initial[2],dependencyState=initial[3];
    var message = E('p', {'class': 'sb-message', style: 'white-space:pre-wrap'});
    var delays = {}, scope = 'all', logTimer = 0;
    function options(items) { return E('select', {}, items.map(function (x) { return E('option', {value: x[0]}, x[1]); })); }
    function input(type, value) { var el = E('input', {type: type || 'text', 'class': 'cbi-input-text'}); el.value = value === undefined ? '' : value; return el; }
    var fieldCounter = 0;
    function field(label, el) {
      var target=el.matches('input,select,textarea')?el:el.querySelector('input,select,textarea');
      target=target||el;if (!target.id) target.id = 'sb-field-' + (++fieldCounter);
      return E('div', {style: 'margin:8px 0'}, [E('label', {'for': target.id}, label + '　'), el]);
    }
    var help={
      '启动透明代理':'启动局域网接管；若故障保护已锁定，会由这次手动启动重新尝试。',
      '停止透明代理':'停止局域网接管并还原 DNS，独立公网服务保留。',
      '重启透明代理':'主动重启后台与网络接管，不计作异常退出。',
      '应用配置':'校验并应用所选配置；失败自动恢复原配置。',
      '更新此配置':'下载此配置的远程来源，校验后应用，启动失败自动回退。',
      '一键检测':'从路由器按当前配置检测国内外热门网站，显示连接状态与耗时。',
      '测速并排序':'逐个通过节点连接测试网站，并按代理延迟排序。',
      '批量删除':'确认后删除已选节点；先校验全部配置，失败保留原文件。',
      '清空选择':'退出多选模式，取消选择；不会删除或移动节点。',
      '全选当前显示':'选择当前展开并显示的节点，可以跨配置一起拖放。',
      '检查最新版本':'读取所选通道的最新内核版本和当前 CPU 架构。',
      '下载并安装':'校验下载文件、CPU 架构和配置后安装内核，失败回退。',
      '本地上传内核':'选择电脑上的官方内核文件，校验通过后安装。',
      '恢复默认':'恢复当前配置自带的端口和密钥；未提供时使用默认值。',
      '保存面板选择':'保存面板名称、地址与当前选择，概览入口同步更新。',
      '显示 / 隐藏密钥':'仅切换当前密钥的显示方式，不会更改密钥。'
    };
    function button(label, action, hint) {
      return E('button', {type: 'button',title:hint||help[label]||(label.indexOf('删除')>=0?'打开确认窗口，确认后删除对应项目。':label.indexOf('编辑')>=0?'打开对应项目的编辑窗口。':label.indexOf('保存')>=0?'校验并保存当前设置。':'点击'+label+'。'), 'class': 'btn cbi-button cbi-button-action', style: 'margin:2px 5px 2px 0', click: ui.createHandlerFn(this, async function () {
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
    var tabs = [['overview', '概览'], ['config', '配置'], ['servers','服务器'], ['settings', '设置'], ['logs', '日志']];
    var nav = E('div', {style: 'display:flex;gap:6px;margin:8px 0 16px'}), sections = {};
    function switchTab(id) {
      tabs.forEach(function (tab) {
        sections[tab[0]].hidden = tab[0] !== id;
        nav.querySelector('[data-tab="'+tab[0]+'"]').className = 'btn cbi-button '+(tab[0] === id ? 'cbi-button-action' : '');
      });
      history.replaceState(null, '', '#'+id);
      if (logTimer) {clearInterval(logTimer);logTimer=0;}
      if (id === 'logs') { loadLogs(); logTimer = setInterval(loadLogs, 3000); }
      if(overviewFrame)syncOverviewFrame();
    }
    tabs.forEach(function (tab) { nav.appendChild(E('button', {'class':'btn cbi-button','data-tab':tab[0],title:'打开'+tab[1]+'页面',click:function () {switchTab(tab[0]);}}, tab[1])); });

    // Overview
    var selectProfile = options(profiles.map(function (p) { return [p.name, profileName(p.name)]; }));
    selectProfile.value = (state.active || '').trim();
    var baseMode = options([['gfw', 'GFW 模式'], ['mainland', '绕过中国大陆 IP']]);
    baseMode.value = state.baseMode || 'mainland';
    var modeRow = field('基础配置分流', baseMode);
    function showMode() { modeRow.hidden = selectProfile.value !== 'base'; if(overviewUpdate&&overviewSource)refreshOverviewSource(); }
    selectProfile.onchange = showMode; showMode();
    var boot = checked(state.autostart);
    boot.onchange = async function () {
      boot.disabled=true;
      try { await result(auto(boot.checked));state.autostart=boot.checked;message.textContent='开机启动设置已保存'; }
      catch(e) {boot.checked=state.autostart;message.textContent=e.message;}
      finally {boot.disabled=false;}
    };
    var panelLink = E('a', {'class':'btn cbi-button cbi-button-action',href:state.panel.link,target:'_blank',rel:'noopener noreferrer'}, '进入 '+((state.panel.panels.find(function (p) {return p.id===state.panel.id;})||{}).name||'面板'));
    function panelChooser(onSaved){
      var panelData=state.panel, panelSaving=false, panelTimer;
    var panelSelect=options(panelData.panels.map(function(p){return [p.id,p.name];}));panelSelect.value=panelData.id;
    var customName=input('text',panelData.name||''),customURL=input('url',panelData.url||'');
    customName.maxLength=64;customName.placeholder='例如：我的 Zashboard';customURL.placeholder='https://面板地址/';
    var customNameRow=field('面板名称',customName),customRow=field('面板地址',customURL),panelMessage=E('p',{'aria-live':'polite'});
    function customVisible(){return panelSelect.value==='custom'||panelSelect.value.indexOf('saved-')===0;}
    function showCustom(){customNameRow.hidden=customRow.hidden=!customVisible();}
    function refreshPanelChoice(r){
      panelData=r;
      while(panelSelect.firstChild)panelSelect.removeChild(panelSelect.firstChild);
      r.panels.forEach(function(p){panelSelect.appendChild(E('option',{value:p.id},p.name));});
      panelSelect.value=r.id;customName.value=r.name||'';customURL.value=r.url||'';
      panelLink.href=r.link;state.panel=r;panelLink.textContent='进入 '+r.name;showCustom();if(onSaved)onSaved(r);
    }
    async function savePanelChoice(quiet){
      clearTimeout(panelTimer);
      if(panelSaving)return;
      if(customVisible()&&(!customName.value.trim()||!customURL.value.trim())){
        if(!quiet)panelMessage.textContent='请填写面板名称和完整地址。';return;
      }
      panelSaving=true;panelSelect.disabled=customName.disabled=customURL.disabled=true;
      try{
        var r=await result(panelSet(panelSelect.value,customURL.value.trim(),customName.value.trim()));
        refreshPanelChoice(r);panelMessage.textContent='已自动保存，下次可在选择框直接选择，也可从概览进入。';
      }catch(e){panelMessage.textContent='保存失败：'+e.message;}
      finally{panelSaving=false;panelSelect.disabled=customName.disabled=customURL.disabled=false;}
    }
    panelSelect.onchange=function(){
      clearTimeout(panelTimer);panelMessage.textContent='';
      var p=panelData.panels.filter(function(x){return x.id===panelSelect.value;})[0];
      customName.value=panelSelect.value==='custom'?'':(p.name||'');customURL.value=p.url||'';showCustom();
      if(panelSelect.value!=='custom')savePanelChoice(false);else customName.focus();
    };
    function queuePanelSave(){clearTimeout(panelTimer);panelMessage.textContent='';panelTimer=setTimeout(function(){savePanelChoice(true);},900);}
    customName.addEventListener('change',queuePanelSave);customURL.addEventListener('change',queuePanelSave);
    showCustom();
      return E('div',{'class':'sb-panel-picker'},[field('面板选择',panelSelect),customNameRow,customRow,E('p',{'class':'sb-muted'},'选择后自动保存。自定义面板填写名称和地址后可留作下次选择。'),button('保存面板选择',function(){return savePanelChoice(false);}),panelMessage]);
    }
    async function panelDetails(){
      var name=selectProfile.value,data=await result(profileApi(name)),port=input('number',data.port),secret=input('password',data.secret),notice=E('p');
      port.min=1024;port.max=65535;
      function updateValues(r){data=r;port.value=r.port;secret.value=r.secret;if(name===(state.active||'').trim()){panelLink.href=r.link;state.panel.link=r.link;if(overviewFrame){nativeOverviewURL.hash='router-secret='+encodeURIComponent(r.secret);overviewFrame.src=nativeOverviewURL.href;}}}
      var targetAddress=E('p',{},'Clash API：http://'+data.address+':'+data.port);
      var currentPanel=E('p',{'class':'sb-panel-current'});
      function showPanelInfo(r){currentPanel.textContent='当前面板：'+(r.name||'SagerNet 官方面板')+' · '+(r.url||r.link.split(/[?#]/)[0]);}
      showPanelInfo(state.panel);var chooser=panelChooser(showPanelInfo);
      dialog(profileName(name)+' · 面板设置',[chooser,currentPanel,E('h4',{},'当前配置的连接信息'),
        E('p',{},'设置仅属于这份配置。优先读取配置中的 Clash API；缺省端口为 9090，密钥随机生成。恢复默认会重新采用配置内的值。'),
        targetAddress,E('p',{},'官方面板使用原生 API：http://'+data.address+':'+data.nativePort+'/dashboard/（与 Clash API 共用此密钥）'),
        field('Clash API 端口',port),field('密钥',secret),button('显示 / 隐藏密钥',function(){secret.type=secret.type==='password'?'text':'password';}),
        notice,button('关闭',close),button('恢复默认',async function(){try{notice.textContent='正在恢复此配置的默认设置…';var r=await result(profileApiSet(name,9090,'',true));updateValues(r);targetAddress.textContent='Clash API：http://'+r.address+':'+r.port;notice.textContent='已恢复默认。';}catch(e){notice.textContent=e.message;}}),
        button('保存',async function(){try{notice.textContent='正在校验端口并保存，失败会恢复原设置…';var r=await result(profileApiSet(name,+port.value,secret.value,false));updateValues(r);targetAddress.textContent='Clash API：http://'+r.address+':'+r.port;notice.textContent='已保存，当前运行配置已重新连接。';}catch(e){notice.textContent=e.message;}})
      ]);
    }
    var panelHold, panelLong=false;
    panelLink.title='点击进入面板；长按、右键或 Shift+F10 打开面板选择、连接信息与密钥设置';
    panelLink.addEventListener('pointerdown',function(e){if(e.button!==0)return;panelLong=false;panelHold=setTimeout(function(){panelLong=true;panelDetails().catch(function(e){message.textContent=e.message;});},550);});
    ['pointerup','pointerleave','pointercancel'].forEach(function(type){panelLink.addEventListener(type,function(){clearTimeout(panelHold);});});
    panelLink.addEventListener('contextmenu',function(e){e.preventDefault();clearTimeout(panelHold);panelLong=true;panelDetails().catch(function(e){message.textContent=e.message;});});
    panelLink.addEventListener('click',async function(e){
      e.preventDefault();
      if(panelLong){panelLong=false;return;}
      pauseOverviewFrame();
      var opened=window.open('about:blank','_blank');if(opened)opened.opener=null;
      try{
        var fresh=await getStatus();if(fresh.error)throw new Error(fresh.error);
        if(selectProfile.value!==(fresh.active||'').trim())throw new Error('请先应用所选配置，再进入它的面板。');
        if(!fresh.panel||!fresh.panel.link)throw new Error('当前配置没有可用的面板入口。');
        panelLink.href=fresh.panel.link;state.panel=fresh.panel;state.active=fresh.active;
        if(opened)opened.location.href=fresh.panel.link;else location.href=fresh.panel.link;
      }catch(error){if(opened)opened.close();message.textContent=error.message;syncOverviewFrame();}
    });
    var overviewSource=E('div'),overviewUpdate=button('更新此配置',function(){return run(profileUpdate(selectProfile.value),'正在下载、校验并更新所选配置；启动失败会自动恢复原配置…');});
    function usageView(value){
      var parts=[];
      if(value&&value.provided){
        if(value.remainingText||Number.isFinite(value.remaining))parts.push('剩余流量：'+(value.remainingText||size(value.remaining)));
        if(value.expire||value.expireText)parts.push('套餐期限：'+(value.expire?new Date(value.expire*1000).toLocaleString():value.expireText));
      }
      var note=E('small',{'class':'sb-usage-note',title:parts.length?((value.source==='groups'?'来源：策略组文字':'来源：订阅响应头')+'；随订阅更新，不是实时账单。'+(value.lastExtractedAt?' 本地提取：'+new Date(value.lastExtractedAt*1000).toLocaleString():'')+(value.lastError?' '+value.lastError:'')):''},parts.join(' · '));
      note.hidden=!parts.length;return note;
    }
    var quotaTargets={},quotaData={};
    function drawQuotas(data){
      (data.items||[]).forEach(function(x){quotaData[x.id]=x.usage;if(quotaTargets[x.id])quotaTargets[x.id].replaceChildren(usageView(x.usage));});
      refreshOverviewSource();
    }
    drawQuotas(initial[7]||{});
    function profileUsage(profile){
      var id='profile:'+profile.name,target=E('div');quotaTargets[id]=target;
      target.appendChild(usageView(quotaData[id]||profile.usage));return target;
    }
    var resourceBox=E('div',{'class':'sb-resource-grid'});
    function drawResources(data){
      resourceBox.replaceChildren();
      [['本次总上传',data.uploadTotal],['本次总下载',data.downloadTotal],['系统内存',data.memoryUsed,data.memoryTotal],['系统磁盘',data.diskUsed,data.diskTotal]].forEach(function(row){
        var total=row.length===2,available=Number.isFinite(row[1])&&(total||row[2]>0),percent=available&&!total?Math.round(row[1]/row[2]*100):0;
        resourceBox.appendChild(E('div',{'class':'sb-resource'},[E('strong',{},row[0]),E('div',{'class':total?'sb-total-value':''},available?(total?size(row[1]):size(row[1])+' / '+size(row[2])+' · '+percent+'%'):'暂不可用'),total?E('small',{'class':'sb-muted'},'本次内核运行累计'):E('progress',{max:100,value:percent,title:row[0]+'已用 '+percent+'%'})]));
      });
    }
    drawResources(initial[4]||{});
    var quotaNext=0,resourceBusy=false,resourceTimer=setInterval(async function(){
      if(!resourceBox.isConnected){clearInterval(resourceTimer);return;}
      if(document.hidden||(sections.overview&&sections.overview.hidden)||resourceBusy)return;
      resourceBusy=true;
      try{var data=await telemetry();if(!data.error)drawResources(data);if(Date.now()>=quotaNext){var quotas=await usageStatus();if(!quotas.error)drawQuotas(quotas);quotaNext=Date.now()+300000;}}catch(_){}finally{resourceBusy=false;}
    },10000);
    function refreshOverviewSource(){
      var p=profiles.find(function(x){return x.name===selectProfile.value;});
      if(!p)return;
      overviewUpdate.disabled=!(p.url||(p.kind==='base'&&(catalog.subscriptions||[]).some(function(x){return x.id.indexOf('base:')===0;})));
      overviewSource.replaceChildren(usageView(quotaData['profile:'+p.name]||p.usage));
      if(p.name==='base')Object.keys(quotaData).filter(function(id){return id.indexOf('base:')===0&&quotaData[id].provided;}).forEach(function(id){overviewSource.appendChild(E('div',{},[E('small',{},id.slice(5)),usageView(quotaData[id])]));});
    }
    var nativeOverviewURL=new URL(state.nativeOverview);
    nativeOverviewURL.searchParams.set('luci-embed','overview');nativeOverviewURL.searchParams.set('luci-parent',location.origin);
    var overviewFrame=E('iframe',{src:nativeOverviewURL.href,title:'sing-box 实时概述','class':'sb-native-overview',referrerpolicy:'no-referrer',style:'display:block;border:0;width:100%;height:200px;background:transparent;'});
    function pauseOverviewFrame(){if(overviewFrame.getAttribute('src')!=='about:blank')overviewFrame.src='about:blank';}
    function syncOverviewFrame(){
      if(document.hidden||(sections.overview&&sections.overview.hidden)){pauseOverviewFrame();return;}
      if(overviewFrame.getAttribute('src')==='about:blank')overviewFrame.src=nativeOverviewURL.href;
    }
    document.addEventListener('visibilitychange',syncOverviewFrame);
    window.addEventListener('focus',syncOverviewFrame);
    window.addEventListener('message',function(event){
      if(!overviewFrame.isConnected||event.source!==overviewFrame.contentWindow||event.origin!==nativeOverviewURL.origin||!event.data||event.data.type!=='sb-router-overview-size')return;
      var height=Number(event.data.height);if(Number.isFinite(height))overviewFrame.style.height=Math.max(160,Math.min(1500,height))+'px';
    });
    var runtimeBox=E('div',{'class':'sb-runtime-summary',title:'只统计本功能启用后的进程记录；手动操作、配置更新和开机启动属于正常启停。'}),runtimeData=Object.assign({uptime:state.uptime},state.runtime||{}),runtimeLoaded=Date.now();
    function duration(value){var n=Math.max(0,Math.floor(value||0)),days=Math.floor(n/86400);n%=86400;var hours=Math.floor(n/3600);n%=3600;return (days?days+' 天 ':'')+String(hours).padStart(2,'0')+':'+String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
    function takeoverActive(){var role=(runtimeData.roles||{}).tun||{};return role.phase?['running','starting','recovering'].includes(role.phase)&&!role.locked:state.running;}
    function drawRuntime(){
      var roles=runtimeData.roles||{},backend=roles.backend||{},tun=roles.tun||{},exits=(backend.unexpectedExits||0)+(tun.unexpectedExits||0),restarts=(backend.autoRestarts||0)+(tun.autoRestarts||0),locked=backend.locked||tun.locked;
      var last=Math.max(backend.lastExitAt||0,tun.lastExitAt||0),age=runtimeData.uptime+(runtimeData.uptime?Math.floor((Date.now()-runtimeLoaded)/1000):0);
      if(startStopButton){startStopButton.textContent=takeoverActive()?'停止透明代理':'启动透明代理';startStopButton.title=help[startStopButton.textContent];}
      runtimeBox.replaceChildren(E('strong',{},'后台本次运行 '+duration(age)),E('span',{},'正常启动：后台 '+(backend.manualStarts||0)+' 次 / 接管 '+(tun.manualStarts||0)+' 次 · '+(exits?'异常退出 '+exits+' 次 · 自动重启 '+restarts+' 次':'尚无异常退出记录')),E('span',{'class':locked?'sb-runtime-locked':''},locked?('已停止自动重试；'+(runtimeData.networkFallback&&runtimeData.networkFallback.restored?'已恢复直连':'正在恢复网络，请查看日志')+'；修复后请手动启动'):'自动恢复：最多 3 次，稳定 60 秒后清零'),last?E('small',{},'最近异常：'+new Date(last*1000).toLocaleString()):E('span'));
    }
    drawRuntime();var runtimeTicks=0,runtimeTimer=setInterval(async function(){if(!runtimeBox.isConnected){clearInterval(runtimeTimer);return;}if(document.hidden)return;runtimeTicks++;drawRuntime();if(runtimeTicks%5===0){try{var r=await runtimeInfo();if(!r.error){runtimeData=r;runtimeLoaded=Date.now();drawRuntime();}}catch(_){}}},1000);
    var startStopButton=button(takeoverActive()?'停止透明代理':'启动透明代理',function(){return run(takeoverActive()?stop():start());});
    var overview = E('div', {}, [
      E('h3',{},'实时概述'),overviewFrame,E('p',{'class':'sb-muted'},'速率与本次总上传、下载来自 sing-box 内核；本次累计随内核重启清零，未经过内核的流量不计入。'),resourceBox,
      E('h3',{},'运行与配置'),runtimeBox,
      E('p', {}, [startStopButton,
                  button('重启透明代理', function () {return run(restart());}), E('label', {}, [boot,' 开机启动'])]),
      field('当前配置', selectProfile), modeRow,
      E('p', {}, [button('应用配置', async function () {
        if (selectProfile.value==='base' && baseMode.value!==state.baseMode) await result(setMode(baseMode.value));
        await run(apply(selectProfile.value), '正在应用配置…');
      }),overviewUpdate, panelLink]),overviewSource
    ]);
    function size(n){var units=['B','KiB','MiB','GiB','TiB'],i=0;while(n>=1024&&i<4){n/=1024;i++;}return n.toFixed(i?1:0)+' '+units[i];}
    refreshOverviewSource();

    var siteBox=E('div',{'class':'sb-site-grid'}),siteNotice=E('p',{'class':'sb-muted'});
    function drawSites(data){
      siteBox.replaceChildren();
      (data.sites||[]).forEach(function(site){
        var label=site.status==='ok'?'可连接 · '+site.ms+' ms':site.status==='limited'?'已连接，HTTP 异常（'+site.code+'）':site.status==='error'?'连接失败':'未检测';
        siteBox.appendChild(E('div',{'class':'sb-site '+(site.status||'unknown'),title:site.detail||''},[E('a',{href:site.url,target:'_blank',rel:'noopener noreferrer'},site.name),E('small',{},site.region),E('div',{},label)]));
      });
      siteNotice.textContent='由路由器经当前 sing-box 配置检测，国内外均按配置分流；不使用电脑 VPN。'+(data.time?' 最近检测：'+new Date(data.time*1000).toLocaleString()+(data.profile?' · 配置 '+profileName(data.profile):''):' 点击一键检测开始。');
    }
    drawSites(initial[6]);
    overview.appendChild(E('h3',{},'热门网站连接状态'));
    overview.appendChild(E('p',{},button('一键检测',async function(){siteNotice.textContent='正在检测，约需 10–20 秒…';try{drawSites(await result(siteCheck()));}catch(e){siteNotice.textContent=e.message;}})));
    overview.appendChild(siteBox);overview.appendChild(siteNotice);

    function policyWidget(data) {
      data=data||{};var enabled=checked(data.enabled),mode=options([['daily','每天'],['weekly','每周'],['monthly','每月']]);mode.value=data.mode||'daily';
      var weekday=options([['0','周日'],['1','周一'],['2','周二'],['3','周三'],['4','周四'],['5','周五'],['6','周六']]);weekday.value=String(data.weekday===undefined?1:data.weekday);
      var day=input('number',data.day||1),hour=input('number',data.hour===undefined?2:data.hour),minute=input('number',data.minute||0);
      day.min=1;day.max=31;hour.min=0;hour.max=23;minute.min=0;minute.max=59;
      [day,hour,minute].forEach(function(x){x.style.width='5em';});
      var weekRow=field('周几',weekday),dayRow=field('几日',day);
      function sync(){weekRow.hidden=mode.value!=='weekly';dayRow.hidden=mode.value!=='monthly';}
      mode.onchange=sync;sync();
      return {el:E('div',{},[E('h4',{},'此来源的更新策略'),E('label',{},[enabled,' 自动更新']),field('更新频率',mode),weekRow,dayRow,field('更新时间',E('span',{},[hour,' 时 ',minute,' 分']))]),
        get:function(){if(!hour.checkValidity()||!minute.checkValidity()||hour.value===''||minute.value===''||(mode.value==='monthly'&&(!day.value||!day.checkValidity())))throw Error('更新时间无效');
          return JSON.stringify({enabled:enabled.checked,mode:mode.value,weekday:+weekday.value,day:+day.value,hour:+hour.value,minute:+minute.value});}};
    }
    async function itemSettings(identity){
      var data=await result(itemPolicy(identity)),widget=policyWidget(data.policy),notice=E('p');
      dialog('来源更新设置',[E('p',{},identity.replace(/^(sub|profile):/,'')),widget.el,notice,button('取消',close),
        button('保存更新策略',async function(){try{await run(itemSet(identity,widget.get()));}catch(e){notice.textContent=e.message;}}),
        button('立即更新此来源',async function(){try{notice.textContent='正在更新此来源…';await result(itemSet(identity,widget.get()));await run(itemUpdate(identity));}catch(e){notice.textContent=e.message;}})]);
    }

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
        var action=options([['nodes','添加节点'],['config','添加配置']]),hint=E('p'),policy=policyWidget({});
        if(!preview.isConfig)action.value='nodes';
        dialog('识别导入内容',[E('p',{},(preview.isConfig?'检测到完整 sing-box 配置':'检测到节点列表')+'，包含 '+preview.count+' 个节点。'),
          field('保存名称',name),preview.isConfig?field('导入方式',action):E('p',{},'此格式按节点导入基础配置。'),preview.source==='link'?policy.el:E('span'),hint,
          button('取消',close),button('确认导入',async function(){
            try{if(!name.value.trim())throw Error('请填写保存名称');hint.textContent='正在校验并保存…';await run(commitImport(preview.ticket,name.value.trim(),action.value,policy.get()));}
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
    var selectionState=initial[8]||{},selectionMode=!!selectionState.visible,selectionByScope=selectionState.scopes||{};
    var selectedNodeIds=new Set(),selectionTimer=0,selectionBar=E('div',{'class':'sb-selection-bar',hidden:true}),selectionCount=E('strong');
    (function restoreSelection(){
      var known=new Set((catalog.nodes||[]).concat(catalog.configNodes||[]).map(function(x){return x.id;}));
      Object.keys(selectionByScope).forEach(function(key){
        selectionByScope[key]=(selectionByScope[key]||[]).filter(function(id){return known.has(id);});
        if(!selectionByScope[key].length)delete selectionByScope[key];
      });
      Object.keys(selectionByScope).forEach(function(key){selectionByScope[key].forEach(function(id){selectedNodeIds.add(id);});});
    })();
    function scopeOf(el){var box=el&&el.closest?el.closest('[data-node-origin]'):null;return box?box.dataset.nodeOrigin:'all';}
    function saveSelection(){
      clearTimeout(selectionTimer);
      selectionTimer=setTimeout(function(){
        selectionSet(JSON.stringify({visible:selectionMode,scopes:selectionByScope})).catch(function(){});
      },400);
    }
    function addSelected(id,scope){
      var list=selectionByScope[scope]||(selectionByScope[scope]=[]);
      if(list.indexOf(id)<0)list.push(id);
      selectedNodeIds.add(id);
    }
    function dropSelected(id){
      selectedNodeIds.delete(id);
      Object.keys(selectionByScope).forEach(function(key){
        var index=selectionByScope[key].indexOf(id);
        if(index>=0)selectionByScope[key].splice(index,1);
        if(!selectionByScope[key].length)delete selectionByScope[key];
      });
    }
    function updateSelection(){
      selectionBar.hidden=!selectionMode;selectionCount.textContent='已选 '+selectedNodeIds.size+' 个节点';
      document.querySelectorAll('.sb-node-card[data-node-id]').forEach(function(card){var yes=selectedNodeIds.has(card.dataset.nodeId);card.classList.toggle('sb-node-selected',yes);var box=card.querySelector('.sb-node-check');if(box){box.hidden=!selectionMode;box.checked=yes;}});
    }
    function selectNode(id,toggle,scope){
      selectionMode=true;
      if(toggle&&selectedNodeIds.has(id))dropSelected(id);else addSelected(id,scope||'all');
      updateSelection();saveSelection();
    }
    function selectionCheckbox(id){var box=checked(selectedNodeIds.has(id));box.className='sb-node-check';box.hidden=!selectionMode;box.title='选择此节点，用于批量删除或一起拖放';box.addEventListener('click',function(e){e.stopPropagation();selectNode(id,true,scopeOf(box));});return box;}
    selectionBar.appendChild(selectionCount);
    selectionBar.appendChild(button('全选当前显示',function(){selectionMode=true;document.querySelectorAll('#sec-config .sb-node-card[data-node-id]').forEach(function(card){if(!card.closest('[hidden]')&&card.getBoundingClientRect().width)addSelected(card.dataset.nodeId,scopeOf(card));});updateSelection();saveSelection();}));
    selectionBar.appendChild(button('批量删除',function(){var ids=Array.from(selectedNodeIds),notice=E('p');if(!ids.length)return;dialog('批量删除节点',[E('p',{},'删除选中的 '+ids.length+' 个节点？原有订阅删除记录会保留，更新不会重新添加。'),notice,button('取消',close),button('确认删除',async function(){try{notice.textContent='正在校验并删除…';await run(batchDelete(JSON.stringify(ids)));}catch(e){notice.textContent=e.message;}})]);}));
    selectionBar.appendChild(button('清空选择',function(){selectionMode=false;selectedNodeIds.clear();selectionByScope={};updateSelection();saveSelection();}));
    var dragPayload=null,pointerDrag=null,dragGhost=null;
    function copyDialog(ids,target){
      if(!ids.length)return;
      var destination=target.indexOf('profile:')===0?target.slice(8):'base',p=profiles.find(function(x){return x.name===destination;}),overwrite=checked(p&&p.copyOverwrite);
      dialog('复制节点',[
        E('p',{},'将 '+ids.length+' 个节点复制到 '+profileName(destination)+'。来源节点会保留，同名节点自动添加副本后缀。'),
        target.indexOf('subscription:')===0?E('p',{},'订阅由服务商维护，拖入订阅的节点会加入「所有节点」的手动节点。'):E('span'),
        destination!=='base'?field('此配置更新时允许覆盖拖入的节点',overwrite):E('span'),
        destination!=='base'?E('p',{'class':'sb-muted'},'不勾选会保留复制节点；勾选后远程更新以来源为准，清除复制节点。以后可在配置编辑中修改。'):E('p',{'class':'sb-muted'},'加入手动节点，订阅更新不会覆盖这些副本。'),
        button('取消',close),button('确认复制',function(){return run(copyNodes(JSON.stringify(ids),target,overwrite.checked),'正在复制节点并校验目标配置…');})
      ]);
    }
    function bindDrop(el,target){
      el.dataset.copyTarget=target;
      el.addEventListener('dragover',function(e){if(!dragPayload)return;e.preventDefault();e.dataTransfer.dropEffect='copy';el.classList.add('sb-drop-active');});
      el.addEventListener('dragleave',function(){el.classList.remove('sb-drop-active');});
      el.addEventListener('drop',function(e){if(!dragPayload)return;e.preventDefault();e.stopPropagation();el.classList.remove('sb-drop-active');var payload=dragPayload;dragPayload=null;var destination=el.dataset.copyTarget;if(destination!==payload.origin)copyDialog(payload.ids,destination);});
    }
    function clearPointer(){
      if(pointerDrag){clearTimeout(pointerDrag.timer);pointerDrag.el.classList.remove('sb-dragging');pointerDrag=null;}
      if(dragGhost){dragGhost.remove();dragGhost=null;}
      document.querySelectorAll('.sb-drop-active').forEach(function(x){x.classList.remove('sb-drop-active');});
    }
    function bindDrag(el,ids,label){
      if(!ids.length)return;
      var isNode=el.classList.contains('sb-node-card'),skipClickUntil=0;
      function origin(){var container=el.closest('[data-node-origin]');return container?container.dataset.nodeOrigin:(el.dataset.scope==='all'?'all':'subscription:'+el.dataset.scope);}
      function draggedIds(){return isNode&&selectedNodeIds.has(ids[0])?Array.from(selectedNodeIds):ids;}
      el.draggable=true;el.title=isNode?'长按进入多选；继续拖动抓起已选节点，放到其他配置或组进行复制。':'拖动此组节点到其他配置；来源保留。';
      if(isNode)el.addEventListener('click',function(e){if(e.target.closest('button,input,a'))return;if(Date.now()<skipClickUntil){e.preventDefault();return;}if(selectionMode)selectNode(ids[0],true,scopeOf(el));});
      el.addEventListener('dragstart',function(e){
        if(e.target.closest('input,select,textarea,a')||(e.target!==el&&e.target.closest('button'))){e.preventDefault();return;}
        clearPointer();if(isNode&&selectionMode)selectNode(ids[0],false,scopeOf(el));dragPayload={ids:draggedIds(),label:label,origin:origin()};e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('text/plain',label);el.classList.add('sb-dragging');
      });
      el.addEventListener('dragend',function(){el.classList.remove('sb-dragging');dragPayload=null;document.querySelectorAll('.sb-drop-active').forEach(function(x){x.classList.remove('sb-drop-active');});});
      el.addEventListener('pointerdown',function(e){
        if(e.button!==0||(e.target!==el&&e.target.closest('button,a,input,select,textarea')))return;
        clearPointer();var data={el:el,x:e.clientX,y:e.clientY,id:e.pointerId,armed:false,ids:ids};pointerDrag=data;
        data.timer=setTimeout(function(){if(pointerDrag!==data)return;data.armed=true;data.origin=origin();data.moved=false;if(isNode)selectNode(ids[0],false,scopeOf(el));data.ids=draggedIds();el.classList.add('sb-dragging');try{el.setPointerCapture(data.id);}catch(_){}},450);
      });
      el.addEventListener('pointermove',function(e){
        var data=pointerDrag;if(!data||data.el!==el)return;
        if(!data.armed){if(Math.hypot(e.clientX-data.x,e.clientY-data.y)>12)clearPointer();return;}
        e.preventDefault();if(Math.hypot(e.clientX-data.x,e.clientY-data.y)>8)data.moved=true;if(data.moved&&!dragGhost){dragGhost=E('div',{'class':'sb-drag-ghost'},'复制 '+data.ids.length+' 个节点');document.body.appendChild(dragGhost);}if(dragGhost){dragGhost.style.left=(e.clientX+10)+'px';dragGhost.style.top=(e.clientY+10)+'px';}
        var under=document.elementFromPoint(e.clientX,e.clientY),target=under&&under.closest('[data-copy-target]');
        document.querySelectorAll('.sb-drop-active').forEach(function(x){x.classList.remove('sb-drop-active');});if(target)target.classList.add('sb-drop-active');
        if(e.clientY<65)window.scrollBy(0,-18);else if(e.clientY>innerHeight-65)window.scrollBy(0,18);
      },{passive:false});
      el.addEventListener('pointerup',function(e){
        var data=pointerDrag;if(!data||data.el!==el)return;
        var armed=data.armed,moved=data.moved,chosen=data.ids,from=data.origin,under=document.elementFromPoint(e.clientX,e.clientY),dest=under&&under.closest('[data-copy-target]');
        clearPointer();if(armed){skipClickUntil=Date.now()+600;e.preventDefault();e.stopPropagation();if(moved&&dest&&dest.dataset.copyTarget!==from)copyDialog(chosen,dest.dataset.copyTarget);}
      });
      el.addEventListener('pointercancel',clearPointer);
      el.addEventListener('contextmenu',function(e){if(pointerDrag&&pointerDrag.armed)e.preventDefault();});
    }
    function renderNodes() {
      nodeContainer.innerHTML='';
      subscriptionActions.innerHTML='';
      var currentSubscription=(catalog.subscriptions||[]).find(function(x){return x.id===scope;});
      if(currentSubscription){var identity=scope.indexOf('base:')===0?'sub:'+currentSubscription.name:'profile:'+currentSubscription.name;subscriptionActions.appendChild(button('立即更新订阅',function(){return run(itemUpdate(identity),'正在更新订阅，运行失败会恢复原配置…');}));subscriptionActions.appendChild(button('来源设置 / 更新策略',function(){return itemSettings(identity);}));subscriptionActions.appendChild(usageView(currentSubscription.usage));}
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
        var card=E('div',{'data-node-id':n.id,'class':'sb-node-card',style:'border:1px solid #bbb;border-radius:7px;padding:10px;overflow-wrap:anywhere'},[
          selectionCheckbox(n.id),E('strong',{},n.tag),E('div',{},n.type+' · '+n.server+':'+n.port),
          E('div',{style:'font-size:12px;opacity:.7'},n.source?'订阅 '+n.source:'手动添加'),
          E('p',{style:'color:'+q[1]},q[0]),button('分享',function(){return shareNodeDialog(n.id);}),button('编辑',function(){return editNode(n.id);}),button('删除',function(){return removeNode(n.id);})
        ]);bindDrag(card,[n.id],n.tag);grid.appendChild(card);
      });
      nodeContainer.appendChild(grid);nodeContainer.dataset.nodeOrigin=scope==='all'?'all':'subscription:'+scope;nodeContainer.dataset.copyTarget=nodeContainer.dataset.nodeOrigin;updateSelection();
      Array.from(nodeTabs.children).forEach(function(x){x.className='btn cbi-button '+(x.dataset.scope===scope?'cbi-button-action':'');});
    }
    function setScope(value){scope=value;renderNodes();}
    var allTab=E('button',{'class':'btn cbi-button','data-scope':'all',click:function(){setScope('all');}},'所有节点');nodeTabs.appendChild(allTab);bindDrop(allTab,'all');bindDrag(allTab,(catalog.nodes||[]).map(function(x){return x.id;}),'所有节点');bindDrop(nodeContainer,'all');
    (catalog.subscriptions||[]).forEach(function(sub){
      var tab=E('button',{'class':'btn cbi-button','data-scope':sub.id,click:function(){setScope(sub.id);}},sub.name+'（'+sub.count+'）');nodeTabs.appendChild(tab);bindDrop(tab,'subscription:'+sub.id);bindDrag(tab,(catalog.nodes||[]).filter(function(n){return (n.owner==='base'?'base:'+n.source:'profile:'+n.owner)===sub.id;}).map(function(n){return n.id;}),sub.name+' 的节点');
    });
    function changedFormValues(original,before,after){
      if(JSON.stringify(before)===JSON.stringify(after))return JSON.parse(JSON.stringify(original));
      if(after===null||typeof after!=='object'||Array.isArray(after))return JSON.parse(JSON.stringify(after));
      var output=original&&typeof original==='object'&&!Array.isArray(original)?JSON.parse(JSON.stringify(original)):{};
      Object.keys(before||{}).forEach(function(key){if(!Object.prototype.hasOwnProperty.call(after,key))delete output[key];});
      Object.keys(after).forEach(function(key){
        if(JSON.stringify((before||{})[key])!==JSON.stringify(after[key]))output[key]=changedFormValues(output[key],(before||{})[key],after[key]);
      });
      return output;
    }
    async function editNode(id) {
      var r=await nodeGet(id);if(r.error)throw Error(r.error);
      var originalNode=JSON.parse(r.value),form=manualForm(originalNode),formBaseline=form.get(),advanced=E('textarea',{rows:12,style:'width:100%;font-family:monospace'}),useJSON=false;
      advanced.value=JSON.stringify(JSON.parse(r.value),null,2);advanced.hidden=true;
      var notice=E('p');
      dialog('编辑节点',[E('p',{'class':'sb-muted'},'本地节点直接保存。订阅或远程配置只改跳过证书验证：原名保留，更新后继续生效。更改其他参数：创建带“本地修改”后缀的受保护副本，原节点继续更新。'),form.el,advanced,button('表单 / JSON',function(){useJSON=!useJSON;form.el.hidden=useJSON;advanced.hidden=!useJSON;}),notice,
        button('分享',function(){return shareNodeDialog(id,function(){editNode(id);});},'分享已保存的节点，未保存的修改不会包含。'),
        button('取消',close),button('校验并保存',async function(){try{
          var n=useJSON?JSON.parse(advanced.value):changedFormValues(originalNode,formBaseline,form.get());notice.textContent='正在保存…';
          var saved=await result(nodeSet(id,JSON.stringify(n)));
          dialog('节点已保存',[E('p',{},saved.message||'节点已保存。'),E('p',{},'保存名称：'+(saved.tag||n.tag)),button('完成',function(){location.reload();})]);
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
      var data=await result(readProfile(name)),dest=input('text',name),overwriteCopied=checked(data.copyOverwrite);
      var editorPolicy=data.remote?policyWidget((await result(itemPolicy('profile:'+name))).policy):null;
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
          await result(editProfile(name,dest.value.trim(),data.revision,area.value,sourceEdit?url.value.trim():'',!!sourceEdit,overwriteCopied.checked));
          await result(copyPolicy(dest.value.trim(),overwriteCopied.checked));
          if(sourceEdit&&editorPolicy)await result(itemSet('profile:'+dest.value.trim(),editorPolicy.get()));
          location.reload();
        }
        catch(e){notice.textContent=e.message;}
      });
      function syncEditor(){
        var isLink=data.remote&&editMode.value==='link';
        sourceRow.hidden=hint.hidden=!isLink;area.hidden=isLink;if(editorPolicy)editorPolicy.el.hidden=!isLink;
        saveButton.textContent=isLink?'校验链接并保存':'校验并保存';
        if(data.remote)dest.value=isLink?name:name+'-local';
      }
      editMode.onchange=syncEditor;syncEditor();
      dialog('编辑配置文件',[type,field('保存名称',dest),modeRow,sourceRow,hint,editorPolicy?editorPolicy.el:E('span'),field('更新时允许覆盖拖入的节点',overwriteCopied),E('p',{'class':'sb-muted'},'关闭时保留复制进来的节点；开启后，此远程配置更新时以来源为准，清除额外复制的节点。'),area,notice,
        button('分享',function(){return shareProfileDialog(name,function(){editor(name);});},'分享已保存的配置链接和 JSON，未保存的修改不会包含。'),
        button('取消',close),saveButton]);
    }
    function customTable() {
      var body=E('tbody');
      profiles.filter(function(p){return p.kind!=='base'&&p.kind!=='subscription';}).forEach(function(p){
        var details=E('div',{'class':'sb-config-nodes','data-node-origin':'profile:'+p.name}),detailRow=E('tr',{'class':'sb-config-details',hidden:true},E('td',{colspan:3},details));
        var toggle=button('显示节点（'+p.nodes+'）',function(){detailRow.hidden=!detailRow.hidden;toggle.textContent=(detailRow.hidden?'显示':'收起')+'节点（'+p.nodes+'）';toggle.title=detailRow.hidden?'在此配置下方展开节点，支持长按多选和拖放。':'收起此配置的节点列表。';},'在此配置下方展开节点，支持长按多选和拖放。');
        (catalog.configNodes||[]).filter(function(n){return n.owner===p.name;}).forEach(function(n){
          var card=E('div',{'class':'sb-node-card','data-node-id':n.id},[selectionCheckbox(n.id),E('strong',{},n.tag),E('small',{},n.type+' · '+n.server+':'+n.port),E('p',{},[button('分享',function(){return shareNodeDialog(n.id);}),button('编辑',function(){return editNode(n.id);}),button('删除',function(){return removeNode(n.id);})])]);
          bindDrag(card,[n.id],n.tag);details.appendChild(card);
        });
        var configRow=E('tr',{'class':'sb-config-summary'},[E('td',{},[E('strong',{},p.name),profileUsage(p),E('div',{},p.kind==='remote'?'链接配置':'本地配置'),E('small',{},'拖放到此行以复制节点')]),
          E('td',{'class':'sb-config-toggle'},toggle),E('td',{},[
            button('删除',function(){dialog('删除配置',[E('p',{},'确定删除 '+p.name+'？'),button('取消',close),button('删除',function(){return run(deleteProfile(p.name));})]);}),
            button('编辑',function(){return editor(p.name);}),button('分享',function(){return shareProfileDialog(p.name);}),p.kind==='remote'?button('立即更新',function(){return run(profileUpdate(p.name),'正在更新并校验；运行失败将回退…');}):E('span'),button(p.active?'已应用':'应用',function(){return run(apply(p.name),'正在应用配置…');})
          ])]);
        bindDrop(configRow,'profile:'+p.name);bindDrop(detailRow,'profile:'+p.name);body.appendChild(configRow);body.appendChild(detailRow);
      });
      return E('table',{'class':'sb-config-table'},[E('colgroup',{},[E('col',{style:'width:30%'}),E('col',{style:'width:32%'}),E('col',{style:'width:38%'})]),E('thead',{},E('tr',{},[E('th',{},'配置'),E('th',{},'节点'),E('th',{},'操作')])),body]);
    }

    var config=E('div',{},[
      button('导入节点 / 订阅 / 配置',importDialog),selectionBar,E('p',{'class':'sb-muted'},'长按节点进入多选，继续拖动可一起复制到其他配置或组；放回原处或空白区域会自动取消。'),E('h3',{},'节点'),nodeTabs,subscriptionActions,E('p',{},[testButton]),nodeInfo,nodeContainer,
      E('h3',{},'自定义配置'),customTable()
    ]);
    renderNodes();

    async function certificatePicker(chosen,back) {
      message.textContent='正在检索本机证书和对应私钥…';
      var data=await result(certScan()),rows=data.certificates||[];message.textContent='';
      var select=options(rows.map(function(c,i){return [String(i),c.domains.join(', ')+' · '+c.expires];})),details=E('p',{style:'overflow-wrap:anywhere'});
      function show(){var c=rows[+select.value];details.textContent=c?c.certificate+'　私钥：'+c.key:'';}select.onchange=show;show();
      dialog('选择本机证书',[E('p',{},'仅列出可用证书和匹配的私钥，不显示私钥内容。'),rows.length?field('可用证书',select):E('p',{},'未检索到匹配证书，可以先申请新证书。'),details,
        button('返回',back||close),button('申请新证书',function(){certificateWizard(chosen,back);}),
        rows.length?button('使用此证书',function(){chosen(rows[+select.value]);}):E('span')]);
    }
    function certificateWizard(chosen,back){
      var domain=input('text'),email=input('email'),secret=input('password'),agree=checked(false),notice=E('p');
      dialog('申请 HTTPS 证书',[E('p',{},'填写域名、联系邮箱和该域名的 Cloudflare DNS API 令牌。使用 DNS 验证，无需开放 80 / 443 端口；成功后每天自动检查续期。'),
        E('p',{},'令牌需具备该区域的 DNS 编辑和区域读取权限，只保存在路由器本机。'),
        field('证书域名',domain),field('联系邮箱',email),field('Cloudflare API 令牌',secret),
        E('label',{},[agree,' 我确认拥有此域名并同意 ',E('a',{href:'https://letsencrypt.org/repository/',target:'_blank',rel:'noopener'},'Let’s Encrypt 服务条款')]),notice,
        button('返回',back||close),button('申请并安装证书',async function(){
          try{
            if(!agree.checked)throw Error('请先确认域名权限和 CA 服务条款');
            notice.textContent='正在申请证书，首次使用会自动补齐签发依赖，请稍候…';
            var c=await result(certIssue(domain.value.trim(),email.value.trim(),'cloudflare',secret.value.trim(),true));
            if(chosen)chosen(c);
            else dialog('证书已安装',[E('p',{},'证书已安装并启用自动续期。'),E('p',{},c.certificate),button('完成',close)]);
          }catch(e){notice.textContent=e.message;}
        })]);
    }
    function qrBox(svg){
      var box=E('div',{'class':'sb-qr'});
      box.innerHTML=svg||'';
      return box;
    }
    function copyToClipboard(text,area){
      try{
        if(typeof navigator!=='undefined'&&navigator.clipboard&&navigator.clipboard.writeText)
          return navigator.clipboard.writeText(text);
      }catch(_){}
      try{area.focus();area.select();document.execCommand('copy');}catch(_){}
      return Promise.resolve();
    }
    function downloadText(filename,text){
      var blob=new Blob([text],{type:'application/json;charset=utf-8'});
      var url=URL.createObjectURL(blob),link=E('a',{href:url,download:filename});
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1500);
    }
    async function shareNodeDialog(id,back){
      var data=await result(shareNode(id)),notice=E('p',{'class':'sb-muted'});
      var area=E('textarea',{rows:4,readOnly:true,style:'width:100%;overflow-wrap:anywhere'});
      area.value=data.link;
      notice.textContent='协议：'+data.type+'；链接包含该节点的认证信息，只分享给可信的人。';
      var children=[
        field('节点链接',area),
        data.qr?qrBox(data.qr):E('p',{'class':'sb-muted'},data.qrError||'内容较长，无法生成二维码，请复制链接。'),
        E('p',{'class':'sb-muted'},'手机相机或客户端扫描二维码即可导入。'),
        notice
      ];
      if(back)children.push(button('返回编辑',back));
      children.push(button('关闭',close));
      children.push(button('复制链接',function(){return copyToClipboard(data.link,area).then(function(){notice.textContent='已复制节点链接。';});}));
      dialog('分享节点 · '+data.tag,children);
    }
    async function shareProfileDialog(name,back){
      var data=await result(shareProfile(name)),notice=E('p',{'class':'sb-muted'});
      var area=E('textarea',{rows:data.kind==='remote'?3:6,readOnly:true,style:'width:100%;overflow-wrap:anywhere'});
      area.value=data.link||'';
      var children=[
        E('p',{},data.link?(data.kind==='remote'?'以下为该配置的订阅来源链接，可复制或扫码导入。':'本地配置没有订阅来源，以下为该配置全部节点链接（每行一个），可复制到客户端导入。'):'此配置没有可分享的节点。')
      ];
      if(data.link){
        children.push(field(data.kind==='remote'?'订阅链接':'全部节点链接',area));
        children.push(data.qr?qrBox(data.qr):E('p',{'class':'sb-muted'},data.qrError||'内容较长，无法生成二维码，请复制文字。'));
        if(data.qr)children.push(E('p',{'class':'sb-muted'},data.kind==='remote'?'二维码内容为订阅链接，可扫码导入。':'二维码内容为该配置的 Base64 订阅文本，供支持文本导入的客户端使用。'));
      }
      if(data.json){
        var jsonArea=E('textarea',{rows:12,readOnly:true,spellcheck:'false',style:'width:100%;font-family:monospace;font-size:12px'});
        jsonArea.value=data.json;
        children.push(E('h3',{},'配置文件 JSON'));
        children.push(jsonArea);
        children.push(E('p',{'class':'sb-muted'},'JSON 含节点认证和面板密钥，只分享给可信的人。'));
        children.push(button('复制 JSON',function(){return copyToClipboard(data.json,jsonArea).then(function(){notice.textContent='已复制配置 JSON。';});}));
        children.push(button('下载 .json 文件',function(){downloadText(data.filename,data.json);}));
      }else if(data.jsonError){
        children.push(E('p',{'class':'sb-muted'},data.jsonError));
      }
      children.push(notice);
      notice.textContent='共 '+data.count+' 个节点'+(data.skipped&&data.skipped.length?'，其中 '+data.skipped.length+' 个协议暂不支持链接分享':'')+'。';
      if(data.kind==='local'&&data.subscription){
        var subArea=E('textarea',{rows:4,readOnly:true,hidden:true,style:'width:100%;overflow-wrap:anywhere'});
        subArea.value=data.subscription;
        children.push(button('显示 / 隐藏订阅文本',function(){subArea.hidden=!subArea.hidden;}));
        children.push(subArea);
      }
      if(back)children.push(button('返回编辑',back));
      children.push(button('关闭',close));
      children.push(button('复制链接',function(){return copyToClipboard(area.value,area).then(function(){notice.textContent='已复制分享内容。';});}));
      dialog('分享配置 · '+name,children);
    }
    async function shareDialog(id){
      var data=await result(serverGet(id)),cfg=JSON.parse(data.value),tls=cfg.tls||{};
      var host=input('text',tls.server_name||(tls.certificate_provider||{}).domain?.[0]||''),users=options((cfg.users||[{}]).map(function(u,i){return [String(i),u.name||u.username||'用户 '+(i+1)];}));
      var output=E('textarea',{rows:5,readOnly:true,style:'width:100%;overflow-wrap:anywhere'}),notice=E('p'),qr=qrBox('');
      dialog('生成节点分享链接',[E('p',{},'填写接收方能够访问的域名或公网 IP。链接含认证信息，请只分享给可信的人。'),field('域名 / 公网 IP',host),field('分享的用户',users),output,qr,notice,
        button('关闭',close),button('生成链接',async function(){try{var r=await result(shareServer(id,host.value.trim(),+users.value));output.value=r.link;qr.innerHTML=r.qr||'';output.focus();output.select();notice.textContent='已生成并选中，可直接复制；也可以直接扫码导入。';}catch(e){notice.textContent=e.message;}})]);
    }
    function proxyEditor(existing){
      var item=existing||{},domain=input('text',item.domain||''),target=input('text',item.target||'http://127.0.0.1:3000');
      var tls=checked(item.https!==false),port=input('number',item.port||443),enabled=checked(item.enabled!==false),firewall=checked(item.firewall!==false);
      var cert=input('text',item.certificate||''),key=input('text',item.key||''),notice=E('p');
      port.min=1;port.max=65535;
      var children;
      function restore(){dialog(item.id?'编辑反向代理':'添加反向代理',children);}
      function chosen(c){cert.value=c.certificate;key.value=c.key;if(!domain.value)domain.value=(c.domains||[])[0]||'';restore();}
      children=[E('p',{},'填好域名和本机应用地址，即可使用域名访问。HTTPS 默认使用 443；已有受支持的 HTTPS 入口会自动按域名复用。'),
        field('访问域名',domain),field('目标应用地址',target),field('监听端口',port),E('label',{},[enabled,' 启用反代　']),E('label',{},[tls,' HTTPS　']),E('label',{},[firewall,' 自动放行防火墙']),
        field('证书路径',cert),field('私钥路径',key),button('选择本机证书',function(){return certificatePicker(chosen,restore);}),button('申请新证书',function(){certificateWizard(chosen,restore);}),
        notice,button('取消',close),button('校验并保存反代',async function(){try{notice.textContent='正在检查反代、证书和防火墙，失败自动恢复…';await run(proxySave(item.id||'',domain.value.trim(),target.value.trim(),+port.value,tls.checked,cert.value.trim(),key.value.trim(),enabled.checked,firewall.checked));}catch(e){notice.textContent=e.message;}})];
      restore();
    }
    async function serverEditor(id) {
      var data=id?await result(serverGet(id)):{value:'{}',revision:serverState.revision,enabled:true,route:'direct'};
      if(data.protected)throw Error('系统保留接口只能查看，不能从此菜单修改');
      var original=JSON.parse(data.value),types=[['hysteria2','Hysteria2'],['vless','VLESS / Reality'],['shadowsocks','Shadowsocks'],
        ['trojan','Trojan'],['tuic','TUIC'],['anytls','AnyTLS'],['vmess','VMess'],['socks','SOCKS'],['http','HTTP'],['mixed','HTTP / SOCKS']];
      if(original.type&&!types.some(function(x){return x[0]===original.type;}))types.push([original.type,original.type]);
      var protocol=options(types);protocol.value=original.type||'hysteria2';
      var name=input('text',original.tag||''),listen=input('text',original.listen||'127.0.0.1'),port=input('number',original.listen_port||'');
      name.readOnly=!!id;port.min=1;port.max=65535;
      var on=checked(data.enabled),routing=options([['direct','直连'],['follow','跟随当前路由策略']]);routing.value=data.route||'direct';
      var allowFirewall=checked(data.firewall===undefined?!id:data.firewall);
      var first=(original.users||[])[0]||{},user=input('text',first.username||first.name||'user');
      var password=input('password',first.password||original.password||''),uuid=input('text',first.uuid||'');
      var method=input('text',original.method||'2022-blake3-aes-128-gcm');
      var flow=options([['','无'],['xtls-rprx-vision','xtls-rprx-vision']]);flow.value=first.flow||'';
      var tls=original.tls||{},reality=tls.reality||{};
      var tlsMode=options([['none','不启用'],['files','证书文件'],['reality','Reality'],['keep','保留现有高级 TLS / ACME 设置']]);
      tlsMode.value=reality.enabled?'reality':tls.certificate_path?'files':tls.enabled?'keep':original.type?'none':'files';
      var cert=input('text',tls.certificate_path||''),key=input('text',tls.key_path||''),sni=input('text',tls.server_name||'');
      var privateKey=input('password',reality.private_key||''),shortId=input('text',(reality.short_id||[])[0]||'');
      var handshake=input('text',(reality.handshake||{}).server||''),handshakePort=input('number',(reality.handshake||{}).server_port||443);
      var publicKey=input('text','');publicKey.readOnly=true;
      var notice=E('p'),json=E('textarea',{rows:20,spellcheck:'false',style:'width:100%;font-family:monospace'}),useJSON=false;
      var passwordRow=field('认证密码',E('span',{},[password,button('生成密码',async function(){
        var r=await result(serverGenerate('password'));password.value=r.password;
        if(protocol.value==='shadowsocks'&&method.value.indexOf('2022-')===0){
          var bytes=new Uint8Array(method.value.indexOf('aes-128')>=0?16:32);crypto.getRandomValues(bytes);
          password.value=btoa(String.fromCharCode.apply(null,bytes));
        }
      })]));
      var uuidRow=field('UUID',E('span',{},[uuid,button('生成 UUID',async function(){uuid.value=(await result(serverGenerate('uuid'))).uuid;})]));
      var userRow=field('用户名称',user),methodRow=field('加密方式',method),flowRow=field('VLESS 流控',flow);
      var filesRow=E('div',{},[field('证书完整路径',cert),field('私钥完整路径',key)]);
      var realityRow=E('div',{},[field('握手域名',handshake),field('握手端口',handshakePort),field('Reality 私钥',privateKey),field('Short ID',shortId),
        button('生成 Reality 密钥',async function(){var r=await result(serverGenerate('reality'));privateKey.value=r.private_key;shortId.value=r.short_id;publicKey.value=r.public_key;}),
        field('客户端使用的公钥',publicKey)]);
      var form=E('div',{},[field('名称 / 标识',name),field('服务端协议',protocol),field('监听地址',listen),field('监听端口',port),
        E('p',{},'127.0.0.1 仅供本机使用；0.0.0.0 / :: 接受其他设备连接。公网访问还需在防火墙放行对应端口。'),
        userRow,passwordRow,uuidRow,methodRow,flowRow,field('TLS 设置',tlsMode),field('TLS 域名',sni),filesRow,realityRow]);
      function syncServer(){
        var p=protocol.value;
        passwordRow.hidden=['vless','vmess'].includes(p);
        uuidRow.hidden=!['vless','vmess','tuic'].includes(p);
        userRow.hidden=p==='shadowsocks';methodRow.hidden=p!=='shadowsocks';flowRow.hidden=p!=='vless';
        filesRow.hidden=tlsMode.value!=='files';realityRow.hidden=tlsMode.value!=='reality';
      }
      protocol.onchange=tlsMode.onchange=syncServer;syncServer();
      function getServer(){
        var n=JSON.parse(JSON.stringify(original));n.type=protocol.value;n.tag=name.value.trim();n.listen=listen.value.trim();n.listen_port=+port.value;
        var users=JSON.parse(JSON.stringify(original.users||[])),u=users[0]||{};
        delete n.password;delete n.method;
        if(n.type==='shadowsocks'){n.method=method.value.trim();n.password=password.value;delete n.users;}
        else {
          if(['socks','http','mixed'].includes(n.type)){u={username:user.value,password:password.value};}
          else {u.name=user.value;delete u.username;if(['vless','vmess','tuic'].includes(n.type))u.uuid=uuid.value.trim();
            else delete u.uuid;
            if(!['vless','vmess'].includes(n.type))u.password=password.value;
            else delete u.password;
            if(n.type!=='vless')delete u.flow;
            if(n.type==='vless'){if(flow.value)u.flow=flow.value;else delete u.flow;}}
          users[0]=u;n.users=users;
        }
        if(tlsMode.value==='none')delete n.tls;
        else if(tlsMode.value==='files')n.tls={enabled:true,server_name:sni.value.trim(),certificate_path:cert.value.trim(),key_path:key.value.trim()};
        else if(tlsMode.value==='reality')n.tls={enabled:true,server_name:sni.value.trim(),reality:{enabled:true,handshake:{server:handshake.value.trim(),server_port:+handshakePort.value},
          private_key:privateKey.value.trim(),short_id:[shortId.value.trim()]}};
        return n;
      }
      json.value=JSON.stringify(original.type?original:{type:'hysteria2',tag:'',listen:'127.0.0.1',listen_port:24443,users:[{name:'user',password:''}],tls:{enabled:true}},null,2);
      json.hidden=true;
      var editorChildren;
      function restoreEditor(){dialog(id?'编辑服务端':'添加服务端',editorChildren);}
      function useCertificate(c){cert.value=c.certificate;key.value=c.key;tlsMode.value='files';if(!sni.value)sni.value=(c.domains||[])[0]||'';syncServer();restoreEditor();}
      editorChildren=[E('label',{},[on,' 启用此服务端　']),E('label',{},[allowFirewall,' 自动放行对应防火墙端口']),field('出站策略',routing),form,
        button('检索本机证书',function(){return certificatePicker(useCertificate,restoreEditor);}),
        button('申请新证书',function(){certificateWizard(useCertificate,restoreEditor);}),json,
        button('表单 / 高级 JSON',function(){
          if(!useJSON){json.value=JSON.stringify(getServer(),null,2);useJSON=true;form.hidden=true;json.hidden=false;}
          else{
            original=JSON.parse(json.value);
            if(!types.some(function(x){return x[0]===original.type;}))protocol.appendChild(E('option',{value:original.type},original.type));
            protocol.value=original.type;name.value=original.tag||'';listen.value=original.listen||'127.0.0.1';port.value=original.listen_port||'';
            var u=(original.users||[])[0]||{};user.value=u.username||u.name||'user';password.value=u.password||original.password||'';uuid.value=u.uuid||'';method.value=original.method||'2022-blake3-aes-128-gcm';flow.value=u.flow||'';
            var t=original.tls||{},r=t.reality||{};sni.value=t.server_name||'';cert.value=t.certificate_path||'';key.value=t.key_path||'';
            privateKey.value=r.private_key||'';shortId.value=(r.short_id||[])[0]||'';handshake.value=(r.handshake||{}).server||'';handshakePort.value=(r.handshake||{}).server_port||443;
            tlsMode.value=r.enabled?'reality':t.certificate_path?'files':t.enabled?'keep':'none';
            useJSON=false;form.hidden=false;json.hidden=true;syncServer();
          }
        }),notice,button('取消',close),button('校验并保存服务端',async function(){
          try{
            var cfg=useJSON?JSON.parse(json.value):getServer();
            notice.textContent='正在校验并应用到独立服务端后台，失败自动回退…';
            await run(serverSave(id||'',data.revision,JSON.stringify(cfg),on.checked,routing.value,allowFirewall.checked));
          }catch(e){notice.textContent=e.message;}
        })];restoreEditor();
    }
    var serverBody=E('tbody');
    (serverState.servers||[]).forEach(function(s){
      var status=s.running?'运行中':s.enabled?'未运行':'已停用';
      serverBody.appendChild(E('tr',{},[
        E('td',{},[E('strong',{},s.id),E('div',{},s.type+' · '+s.source)]),
        E('td',{},[(s.listen||'::')+':'+s.port,E('div',{style:'color:'+ (s.running?'#198f41':'#777')},status)]),
        E('td',{},s.protected?E('span',{},'系统保留接口'): [
          button('编辑',function(){return serverEditor(s.id);}),
          button(s.enabled?'停用':'启用',async function(){
            var data=await result(serverGet(s.id));return run(serverSave(s.id,data.revision,data.value,!s.enabled,data.route,data.firewall));
          }),
          button('生成分享链接',function(){return shareDialog(s.id);}),
          button('删除',function(){dialog('删除服务端',[E('p',{},'删除 '+s.id+'？此操作只删除该服务端入口。'),button('取消',close),
            button('删除服务端',function(){return run(serverDelete(s.id,serverState.revision));})]);})
        ])]));
    });
    var proxyRows=E('tbody');
    (initial[5].items||[]).forEach(function(x){proxyRows.appendChild(E('tr',{},[E('td',{},[(x.https?'https://':'http://')+x.domain+([80,443].includes(x.port)?'':':'+x.port)]),
      E('td',{},x.target),E('td',{},[button('编辑',function(){proxyEditor(x);}),button('删除',function(){dialog('删除反代',[E('p',{},'删除 '+x.domain+' 并撤销本功能创建的防火墙规则？'),button('取消',close),button('确认删除',function(){return run(proxyDelete(x.id));})]);})])]));});
    var serversView=E('div',{},[E('h3',{},'服务端管理'),
      E('p',{},'显示已有服务端和本菜单添加的服务端。服务端独立于客户端订阅，停止透明代理不会停止这些入口。'),
      button('添加服务端',function(){return serverEditor('');}),button('刷新服务端状态',function(){location.reload();}),
      button('证书管理 / 申请',function(){return certificatePicker(function(){close();},close);}),
      E('table',{'class':'sb-config-table'},[E('thead',{},E('tr',{},[E('th',{},'服务端'),E('th',{},'监听 / 状态'),E('th',{},'操作')])),serverBody]),
      E('h3',{},'网站反向代理'),button('添加反向代理',function(){proxyEditor();}),E('table',{'class':'sb-config-table'},[E('thead',{},E('tr',{},[E('th',{},'访问域名'),E('th',{},'目标应用'),E('th',{},'操作')])),proxyRows])]);
    var dependencyRows=E('ul',{},(dependencyState.items||[]).map(function(x){return E('li',{style:'color:'+ (x.installed?'#198f41':'#c33')},x.package+' · '+(x.installed?'已安装':'缺少'));}));

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
    var settings=E('div',{},[
      E('h3',{},'运行依赖'),E('p',{},dependencyState.ready?'依赖已齐全；启动时会自动检查，缺少时自动安装。':'部分依赖缺失，安装后即可使用完整功能。'),dependencyRows,
      button('检查依赖',function(){location.reload();}),button('自动安装缺少的依赖',function(){return run(dependenciesInstall(),'正在从系统软件源安装缺少的依赖…');}),
      E('h3',{},'内核更新'),field('更新通道',channel),field('下载来源',source),sourceRow,sourceHint,E('p',{},[checkButton,installButton,uploadButton]),release,
      E('h3',{},'项目信息'),
      E('article',{'class':'sb-project'},[E('a',{href:"https://github.com/being123321/sing-box-for-openwrt",target:'_blank',rel:'noopener noreferrer'},"本项目 · sing-box for OpenWrt"),E('p',{},"管理 OpenWrt / ImmortalWrt 上的 sing-box，提供配置导入、订阅更新、节点管理、故障保护和面板入口。")]),
      E('article',{'class':'sb-project'},[E('a',{href:"https://github.com/SagerNet/sing-box",target:'_blank',rel:'noopener noreferrer'},"上游内核 · sing-box"),E('p',{},"提供代理协议、DNS、规则分流与 TUN 等网络处理能力，是本项目使用的代理核心。")]),
      E('article',{'class':'sb-project'},[E('a',{href:"https://github.com/SagerNet/sing-box-dashboard",target:'_blank',rel:'noopener noreferrer'},"官方面板 · sing-box-dashboard"),E('p',{},"SagerNet 官方网页面板，用于查看实时流量、连接、日志，并管理节点与策略组。")]),
      E('article',{'class':'sb-project'},[E('a',{href:"https://github.com/being123321/singbox-mihomo-subscription-converter",target:'_blank',rel:'noopener noreferrer'},"订阅转换 · singbox/mihomo"),E('p',{},"将节点链接、Base64、Clash YAML 和 sing-box JSON 转换为统一订阅，支持规则整理、去广告与二维码分享。")]),
      E('article',{'class':'sb-project'},[E('a',{href:"https://github.com/being123321/sing-box-for-harmonyos",target:'_blank',rel:'noopener noreferrer'},"鸿蒙客户端 · sing-box for HarmonyOS"),E('p',{},"非官方鸿蒙原生 sing-box 客户端，使用 ArkUI 与 VPN Extension，支持配置导入、订阅节点管理和连接状态展示。")])
    ]);
    var logBox=E('pre',{style:'max-height:60vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#111;color:#ddd;padding:10px;font:13px/1.65 Consolas,"Cascadia Mono","Microsoft YaHei","Noto Sans SC",monospace'});
    async function loadLogs(){try{var r=await logs(300);logBox.textContent=(r.lines||[]).join('\n');}catch(e){logBox.textContent=e.message;}}
    sections.overview=E('div',{id:'sec-overview'},overview);sections.config=E('div',{id:'sec-config'},config);
    sections.servers=E('div',{id:'sec-servers'},serversView);
    sections.settings=E('div',{id:'sec-settings'},settings);sections.logs=E('div',{id:'sec-logs'},[button('刷新日志',loadLogs),logBox]);
    function styleSections(container){
      var children=Array.from(container.childNodes),section;
      children.forEach(function(child){
        if(!section||child.nodeName==='H3'){section=E('section',{'class':'sb-section'});container.appendChild(section);}
        section.appendChild(child);
      });
    }
    [overview,config,serversView,settings].forEach(styleSections);
    var selected=location.hash.substring(1);if(!tabs.some(function(t){return t[0]===selected;}))selected='overview';
    switchTab(selected);
    return E('div',{'class':'sb-router-view'},[
      E('style',{},'.sb-usage-note{display:block;font-size:12px;opacity:.75;line-height:1.6;margin:5px 0}.sb-total-value{font-size:24px;font-weight:bold}.sb-resource-grid,.sb-quota-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.sb-resource{padding:14px;border:1px solid #bbb;border-radius:10px}.sb-resource div{padding:10px 0}.sb-resource progress{width:100%;height:10px;accent-color:#198f41}.sb-config-toggle button{max-width:100%;white-space:normal;line-height:1.5}.sb-project{padding:12px 0;border-bottom:1px solid #bbb}.sb-project:last-child{border-bottom:0}.sb-project>a{font-size:15px;font-weight:bold}.sb-project>p{margin:6px 0 0;line-height:1.6}.sb-runtime-summary{display:flex;gap:8px 20px;flex-wrap:wrap;align-items:center;padding:10px 0}.sb-runtime-summary small{width:100%;opacity:.75}.sb-runtime-locked{color:#c33;font-weight:bold}.sb-selection-bar{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);display:flex;align-items:center;gap:6px;flex-wrap:wrap;z-index:100;box-shadow:0 4px 16px #0003;padding:10px;background:var(--background-color,#fff);border:1px solid #198f41;border-radius:7px}.sb-node-check{margin-right:8px!important;vertical-align:middle}.sb-node-selected{border-color:#198f41!important;background:rgba(25,143,65,.1)!important}.sb-config-summary>td{vertical-align:middle!important}.sb-config-details>td{padding:12px 0!important}.sb-config-details .sb-config-nodes{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;max-height:none;overflow:visible;width:100%}.sb-config-toggle{vertical-align:middle!important}.sb-panel-picker{padding-bottom:12px;border-bottom:1px solid #bbb}.sb-panel-current{overflow-wrap:anywhere;opacity:.8}.sb-section{border:1px solid #bbb;border-radius:9px;padding:16px;margin:12px 0;background:rgba(127,127,127,.025)}.sb-section>h3{margin:0 0 14px;font-size:18px}.sb-section table{width:100%;border-collapse:collapse}.sb-section th,.sb-section td{padding:12px 10px;text-align:left;vertical-align:top;border-bottom:1px solid #bbb}.sb-section label{display:inline-block;min-width:125px}.sb-muted{font-size:12px;opacity:.75}.sb-site-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px}.sb-site{border:1px solid #aaa;border-radius:7px;padding:12px}.sb-site small{margin-left:8px;opacity:.7}.sb-site.ok{border-left:4px solid #198f41}.sb-site.error{border-left:4px solid #c33}.sb-site.limited{border-left:4px solid #b07600}.sb-node-card{border:1px solid #bbb;border-radius:7px;padding:10px;margin:5px 0;overflow-wrap:anywhere;cursor:grab;user-select:none}.sb-node-card small{display:block}.sb-dragging{opacity:.65;outline:2px dashed #198f41}.sb-drop-active{outline:3px solid #198f41!important;background:rgba(25,143,65,.1)!important}.sb-drag-ghost{position:fixed;z-index:100000;pointer-events:none;background:#198f41;color:white;padding:10px;border-radius:7px}.sb-usage{padding:10px;background:rgba(25,143,65,.07);border-radius:7px;margin:8px 0}.sb-qr{width:220px;max-width:100%;padding:8px;background:#fff;border:1px solid #bbb;border-radius:7px;margin:10px 0}.sb-qr svg{display:block;width:100%;height:auto}.sb-config-nodes{max-height:430px;overflow:auto}@media(max-width:700px){.sb-config-table{table-layout:auto!important}.sb-config-table th,.sb-config-table td{padding:7px 5px!important}.sb-section{padding:10px}.sb-section input:not([type=checkbox]),.sb-section select{max-width:100%}}.sb-router-view [hidden],.modal [hidden]{display:none!important}.sb-config-table{display:table!important;width:100%;table-layout:fixed;border-collapse:collapse}.sb-config-table thead{display:table-header-group!important}.sb-config-table tbody{display:table-row-group!important}.sb-config-table tr{display:table-row!important}.sb-config-table th,.sb-config-table td{display:table-cell!important;text-align:left!important;vertical-align:top;padding:12px 10px;border-bottom:1px solid #bbb;overflow-wrap:anywhere}.sb-config-table th{font-weight:bold;background:rgba(127,127,127,.08)}.sb-update-ready{background:#198f41!important;color:#fff!important;border-color:#198f41!important}'),
      E('h2',{},'sing-box'),nav,message,sections.overview,sections.config,sections.servers,sections.settings,sections.logs]);
  }
});
