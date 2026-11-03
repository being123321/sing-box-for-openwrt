"""Extract only quota/expiry text from strategy names; never inspect credentials."""
import base64,json,re,urllib.parse

def labels(value):
    found=[]
    def visit(item):
        if isinstance(item,list):
            for child in item:
                if isinstance(child,str):found.append(child)
                else:visit(child)
        elif isinstance(item,dict):
            for field in ('tag','name','remarks','ps'):
                if isinstance(item.get(field),str):found.append(item[field])
            for field in ('outbounds','nodes','proxies','proxy-groups','groups','all'):
                child=item.get(field)
                if isinstance(child,dict):found.extend(child.keys());visit(list(child.values()))
                elif child is not None:visit(child)
    if isinstance(value,(dict,list)):visit(value)
    else:
        text=value.decode('utf-8-sig',errors='replace') if isinstance(value,bytes) else str(value or '')
        try:visit(json.loads(text))
        except ValueError:
            if len(text)<4*1024*1024 and len(text.strip())>24 and re.fullmatch(r'[A-Za-z0-9+/=_\s-]+',text):
                try:text=base64.urlsafe_b64decode(''.join(text.split())+'===').decode('utf-8')
                except (ValueError,UnicodeError):pass
            for line in text.splitlines():
                match=re.match(r'\s*-?\s*name\s*:\s*["\x27]?(.+?)["\x27]?\s*$',line)
                if match:found.append(match.group(1))
                if '://' in line:
                    try:found.append(urllib.parse.unquote(urllib.parse.urlsplit(line.strip()).fragment))
                    except ValueError:pass
    return [x[:220] for x in found if isinstance(x,str) and re.search(r'剩余|流量|到期|有效期|套餐|remaining|expire|traffic',x,re.I)]

def extract(value):
    result={}
    terms={'remaining':r'剩余(?:流量|额度)?|可用流量|remaining(?:\s+traffic)?',
           'used':r'已用(?:流量)?|used(?:\s+traffic)?','total':r'总(?:流量|额度)|套餐流量|total(?:\s+traffic)?'}
    for text in labels(value):
        for field,term in terms.items():
            match=re.search(r'(?:'+term+r')\s*[:：=|]?\s*(\d+(?:\.\d+)?)\s*([KMGTPE]?i?B)\b',text,re.I)
            if match:
                name=match.group(2);power='BKMGTPE'.index(name[0].upper())
                result[field]=round(float(match.group(1))*(1024 if 'i' in name.lower() else 1000)**power)
                result[field+'Text']=match.group(1)+' '+name
        match=re.search(r'(?:到期(?:时间|日期)?|有效期(?:至)?|expire(?:s|d)?(?:\s+(?:at|date))?)\s*[:：=|]?\s*(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?)',text,re.I)
        if match:result['expireText']=match.group(1)
        elif re.search(r'长期有效|永不过期|不限期|never expire',text,re.I):result['expireText']='长期有效'
    if 'remaining' not in result and 'total' in result and 'used' in result:result['remaining']=max(0,result['total']-result['used'])
    if result:result.update(provided=True,source='groups')
    return result
