"""Source-aware node edits: persist one TLS flag or create protected local copies."""
import copy

def without_insecure(node):
    value=copy.deepcopy(node)
    if isinstance(value.get('tls'),dict):
        value['tls'].pop('insecure',None)
        if not value['tls']:value.pop('tls')
    return value

def kind(old,new):
    if old==new:return 'unchanged'
    if without_insecure(old)==without_insecure(new):
        if bool((old.get('tls') or {}).get('insecure'))==bool((new.get('tls') or {}).get('insecure')):return 'unchanged'
        return 'certificate'
    return 'parameters'

def patch_tls(node,values,source_tag=None):
    result=copy.deepcopy(node)
    key=source_tag if source_tag is not None else result.get('tag')
    if key in values:
        result.setdefault('tls',{})['insecure']=bool(values[key])
    return result

def apply_tls(cfg,values):
    cfg['outbounds']=[patch_tls(node,values) for node in cfg.get('outbounds',[])]
    return cfg

def local_copy(node,tags):
    result=copy.deepcopy(node);base=node['tag']+'-本地修改';tag=base;index=2
    while tag in tags:tag=base+'-'+str(index);index+=1
    result['tag']=tag;return result

def migrate_tls(obj):
    """Convert identifiable legacy TLS-only whole-node overrides before fetching updates."""
    def convert(nodes,overrides,preferences):
        originals={n.get('tag'):n for n in nodes}
        for tag,replacement in list(overrides.items()):
            if tag in originals and kind(originals[tag],replacement) in ('unchanged','certificate'):
                preferences[tag]=bool((replacement.get('tls') or {}).get('insecure'));overrides.pop(tag)
    if 'base' in obj:
        for sub in obj.get('subs',[]):
            if sub.get('overrides'):convert(sub.get('nodes',[]),sub['overrides'],sub.setdefault('tlsOverrides',{}))
    elif ('url' in obj or 'suburl' in obj) and obj.get('nodeOverrides'):
        nodes=(obj.get('config') or {}).get('outbounds',[]) if 'url' in obj else obj.get('nodes',[])
        convert(nodes,obj['nodeOverrides'],obj.setdefault('nodeTLS',{}))
    return obj

def outcome(mode,tag):
    message={'unchanged':'没有修改节点参数，不需要重新保存。',
             'local':'已保存本地节点，订阅或配置更新不会覆盖此修改。',
             'certificate':'已保存跳过证书验证的设置，名称不变；更新后仍保留此设置，其他参数继续跟随来源更新。',
             'parameters':'已保存为受保护的本地副本；名称已加“本地修改”后缀，订阅或配置更新不会覆盖它，原节点继续跟随来源更新。'}[mode]
    return dict(ok=True,editKind=mode,tag=tag,updateWillOverwrite=False,message=message)
