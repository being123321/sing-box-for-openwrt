"""Optional provider-supplied usage headers; never infer quotas from node traffic."""
import hashlib,json,re,time,os
from quota_labels import extract
try:import fcntl
except ImportError:fcntl=None

def serial(function):
    def call(root,*args,**kwargs):
        with (root/'subscription-usage.lock').open('a') as handle:
            if fcntl:fcntl.flock(handle,fcntl.LOCK_EX)
            try:return function(root,*args,**kwargs)
            finally:
                if fcntl:fcntl.flock(handle,fcntl.LOCK_UN)
    return call

@serial
def record(root,url,headers,body=None):
    found=re.findall(r'^subscription-userinfo:\s*([^\r\n]+)',headers,flags=re.I|re.M)
    key=hashlib.sha256(url.encode()).hexdigest()
    try:data=json.loads((root/'subscription-usage.json').read_text())
    except (OSError,ValueError):data={}
    result=extract(body)
    if found:
        values={k.lower():int(v) for k,v in re.findall(r'(upload|download|total|expire)\s*=\s*(\d+)',found[-1],flags=re.I)}
        if 'total' in values:
            used=values.get('upload',0)+values.get('download',0)
            result.update(values,provided=True,source='headers',used=used,remaining=max(0,values['total']-used))
            for field in ('remainingText','usedText','totalText'):result.pop(field,None)
    now=int(time.time())
    if result:result.update(updatedAt=now,lastExtractedAt=now,checked=now,stale=False,lastError='',retryAt=0)
    else:
        result=dict(data.get(key,{}),checked=now,lastError='',retryAt=0)
        result['provided']=bool(result.get('provided'));result['stale']=result['provided']
    data[key]=result;tmp=root/'subscription-usage.json.tmp';tmp.write_text(json.dumps(data));os.chmod(tmp,0o600);tmp.replace(root/'subscription-usage.json')
def info(root,url):
    if not url:return dict(provided=False,reason='未提供可识别的流量或期限信息')
    try:item=json.loads((root/'subscription-usage.json').read_text()).get(hashlib.sha256(url.encode()).hexdigest(),{})
    except (OSError,ValueError):item={}
    reason=('保留上次提取的数据。' if item.get('stale') else '') if item.get('provided') else '未提供可识别的流量或期限；支持订阅响应头和策略组文字，手动更新订阅会同步刷新。'
    return dict(item,reason=reason)

@serial
def record_groups(root,identifier,value):
    incoming=extract(value);key=hashlib.sha256(identifier.encode()).hexdigest();now=int(time.time())
    path=root/'subscription-usage.json'
    try:data=json.loads(path.read_text())
    except (OSError,ValueError):data={}
    old=data.get(key,{});result=dict(old)
    if incoming:
        if old.get('source')=='headers' and old.get('provided'):
            if not old.get('expire') and not old.get('expireText') and incoming.get('expireText'):result['expireText']=incoming['expireText']
        else:
            changed=any(old.get(k)!=v for k,v in incoming.items())
            result=dict(old,**incoming,updatedAt=now if changed else old.get('updatedAt',now))
    result['lastExtractedAt']=now;result.setdefault('provided',False);data[key]=result
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False));tmp.chmod(0o600);tmp.replace(path)

def check_fetch(root,url):
    item=info(root,url);remaining=item.get('retryAt',0)-int(time.time())
    if remaining>0:raise ValueError('服务商限流或风控，约 '+str(max(1,(remaining+59)//60))+' 分钟后再试；保留原配置和上次余量')

@serial
def rate_limit(root,url,status,headers):
    import email.utils
    now=int(time.time());retry=900 if status==403 else 600
    found=re.findall(r'^retry-after:\s*([^\r\n]+)',headers,re.I|re.M)
    if found:
        try:retry=max(retry,int(found[-1]))
        except ValueError:
            try:retry=max(retry,int(email.utils.parsedate_to_datetime(found[-1]).timestamp())-now)
            except (ValueError,TypeError,OverflowError):pass
    path=root/'subscription-usage.json'
    try:data=json.loads(path.read_text())
    except (OSError,ValueError):data={}
    key=hashlib.sha256(url.encode()).hexdigest();item=data.get(key,{})
    item.update(lastError='服务商返回 HTTP '+str(status)+'，暂缓重试并保留上次数据',retryAt=now+min(retry,86400),stale=bool(item.get('provided')))
    data[key]=item;tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False));tmp.chmod(0o600);tmp.replace(path)
