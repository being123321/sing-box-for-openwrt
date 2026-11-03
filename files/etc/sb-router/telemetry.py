import json,pathlib,subprocess,time,shutil

def core_totals():
    import urllib.request
    from router_platform import api_url,api_secret
    try:
        request=urllib.request.Request(api_url('/connections'),headers={'Authorization':'Bearer '+api_secret()})
        with urllib.request.urlopen(request,timeout=2) as response:data=json.load(response)
        return {key:data[key] for key in ('uploadTotal','downloadTotal') if isinstance(data.get(key),(int,float)) and data[key]>=0}
    except (OSError,ValueError):return {}

def snapshot():
    # WAN counters include direct and proxied traffic without double-counting TUN.
    state=subprocess.run(['ubus','call','network.interface.wan','status'],capture_output=True,text=True)
    interface=json.loads(state.stdout or '{}').get('l3_device')
    if not interface:
        routes=pathlib.Path('/proc/net/route').read_text().splitlines()[1:]
        interface=next((x.split()[0] for x in routes if x.split()[1]=='00000000'),'')
    counters={}
    for key in ('rx_bytes','tx_bytes'):
        p=pathlib.Path('/sys/class/net')/interface/'statistics'/key
        counters[key]=int(p.read_text()) if p.is_file() else 0
    mem={}
    for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
        key,value=line.split(':',1);mem[key]=int(value.split()[0])*1024
    processes=[]
    for role in ('backend','tun'):
        try:pid=int(json.loads(pathlib.Path('/etc/sb-router/runtime-'+role+'.json').read_text()).get('pid',0))
        except (OSError,ValueError,TypeError):continue
        if pid<=0:continue
        p=pathlib.Path('/proc')/str(pid)
        try:
            if b'/etc/sb-router/core' not in (p/'cmdline').read_bytes():continue
            rss=next(int(x.split()[1])*1024 for x in (p/'status').read_text().splitlines() if x.startswith('VmRSS:'))
            processes.append(rss)
        except (OSError,StopIteration):pass
    disk=shutil.disk_usage('/')
    return dict(core_totals(),diskTotal=disk.total,diskUsed=disk.used,diskFree=disk.free,time=time.monotonic(),interface=interface,download=counters['rx_bytes'],upload=counters['tx_bytes'],
                memoryTotal=mem['MemTotal'],memoryUsed=mem['MemTotal']-mem.get('MemAvailable',mem.get('MemFree',0)),
                coreMemory=sum(processes))
