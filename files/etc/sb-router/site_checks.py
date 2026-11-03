"""Bounded router-side HTTPS checks of a fixed set of popular sites."""
import concurrent.futures,json,pathlib,subprocess,time,os
CACHE=pathlib.Path('/tmp/sb-router-site-checks.json')
SITES=[('baidu','百度','国内','https://www.baidu.com'),('bilibili','哔哩哔哩','国内','https://www.bilibili.com'),('qq','腾讯','国内','https://www.qq.com'),('google','Google','国际','https://www.google.com/generate_204'),('youtube','YouTube','国际','https://www.youtube.com'),('github','GitHub','国际','https://github.com'),('cloudflare','Cloudflare','国际','https://www.cloudflare.com')]
def snapshot():
    try:data=json.loads(CACHE.read_text())
    except (OSError,ValueError):data={}
    saved={x['id']:x for x in data.get('sites',[])}
    return dict(time=data.get('time'),profile=data.get('profile',''),sites=[dict(id=i,name=n,region=r,url=u,**{k:v for k,v in saved.get(i,{}).items() if k not in ('id','name','region','url')}) for i,n,r,u in SITES])
def check(profile=''):
    def one(site):
        i,n,region,url=site
        # Both regions use the same managed backend, so its own routing rules decide DIRECT/PROXY.
        command=['curl','-4sSL','--proxy','http://127.0.0.1:18081','--connect-timeout','4','--max-time','9','--max-redirs','3','-o','/dev/null','-w','%{http_code} %{time_total}',url]
        try:
            r=subprocess.run(command,capture_output=True,text=True,timeout=11)
            code,elapsed=r.stdout.strip().split();code=int(code)
            status='ok' if r.returncode==0 and 200<=code<400 else ('limited' if r.returncode==0 and code>=400 else 'error')
            return dict(id=i,name=n,region=region,url=url,status=status,code=code,ms=round(float(elapsed)*1000),detail='HTTP '+str(code) if code else 'DNS、连接或 TLS 检测失败')
        except Exception:return dict(id=i,name=n,region=region,url=url,status='error',code=0,ms=0,detail='检测超时或连接失败')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(one,SITES))
    data=dict(time=int(time.time()),profile=profile,sites=rows);tmp=CACHE.with_suffix('.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False));os.chmod(tmp,0o600);tmp.replace(CACHE)
    return data
