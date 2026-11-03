"""Named panel bookmarks; changing a bookmark never restarts the proxy."""
import hashlib
import json
import os
import urllib.parse


def address(value):
    value = (value or '').strip()
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or any(ord(c) < 33 for c in value)):
        raise ValueError('请输入完整的 HTTP 或 HTTPS 面板地址，不要包含用户名和密码')
    try:
        parsed.port
    except ValueError:
        raise ValueError('面板端口无效')
    return value


def load(root):
    try:
        data = json.loads((root / 'panel.json').read_bytes())
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    bookmarks = []
    for item in data.get('saved', []) if isinstance(data.get('saved'), list) else []:
        try:
            name = str(item['name']).strip()
            url = address(item['url'])
            pid = str(item['id'])
            if not name or len(name) > 64 or not pid.startswith('saved-'):
                continue
            if any(x['id'] == pid for x in bookmarks):
                continue
            bookmarks.append(dict(id=pid, name=name, url=url))
        except (KeyError, TypeError, ValueError):
            continue
    # Keep previously configured custom addresses available after upgrading.
    if data.get('id') == 'custom' and data.get('url'):
        try:
            url = address(data['url'])
            item = next((x for x in bookmarks if x['url'] == url), None)
            if item is None:
                item = dict(id='saved-' + hashlib.sha256(url.encode()).hexdigest()[:16],
                            name='我的面板', url=url)
                bookmarks.append(item)
            data['id'] = item['id']
        except ValueError:
            data['id'] = 'official'
    data['saved'] = bookmarks[:50]
    return data


def state(root, builtins, link):
    data = load(root)
    panels = [dict(x) for x in builtins if x['id'] != 'custom'] + data['saved']
    selected = next((x for x in panels if x['id'] == data.get('id')), panels[0])
    panels.append(dict(id='custom', name='添加自定义面板…'))
    return dict(id=selected['id'], name=selected['name'], url=selected.get('url', ''),
                panels=panels, link=link(selected['id'], selected.get('url', '')))


def update(root, builtins, link, arg):
    data = load(root)
    pid = arg.get('id', 'official')
    if pid == 'custom' or str(pid).startswith('saved-'):
        old = next((x for x in data['saved'] if x['id'] == pid), None)
        name = str(arg.get('name') or (old or {}).get('name', '')).strip()
        if not name or len(name) > 64 or any(ord(c) < 32 for c in name):
            raise ValueError('请填写面板名称（最多 64 个字符）')
        url = address(arg.get('url') or (old or {}).get('url', ''))
        same_name = next((x for x in data['saved'] if x['name'].casefold() == name.casefold()), None)
        if old and same_name and old['id'] != same_name['id']:
            raise ValueError('已有同名面板，请使用其他名称')
        item = old or same_name
        if item is None:
            if len(data['saved']) >= 50:
                raise ValueError('最多保存 50 个自定义面板')
            item = dict(id='saved-' + hashlib.sha256(name.encode()).hexdigest()[:16])
            data['saved'].append(item)
        item.update(name=name, url=url)
        pid = item['id']
    elif pid not in {x['id'] for x in builtins if x['id'] != 'custom'}:
        raise ValueError('面板无效')
    data['id'] = pid
    data['url'] = next((x['url'] for x in data['saved'] if x['id'] == pid), '')
    # Validate link generation before committing the selected bookmark.
    result = state_from_data(data, builtins, link)
    temporary = root / 'panel.json.tmp'
    with temporary.open('w', encoding='utf-8') as output:
        json.dump(data, output, ensure_ascii=False)
    os.chmod(temporary, 0o600)
    os.replace(temporary, root / 'panel.json')
    return dict(ok=True, **result)


def state_from_data(data, builtins, link):
    panels = [dict(x) for x in builtins if x['id'] != 'custom'] + data['saved']
    selected = next(x for x in panels if x['id'] == data['id'])
    panels.append(dict(id='custom', name='添加自定义面板…'))
    return dict(id=selected['id'], name=selected['name'], url=selected.get('url', ''),
                panels=panels, link=link(selected['id'], selected.get('url', '')))
