"""Share links and QR images for nodes, configurations and servers.

Everything is derived from the stored sing-box objects; no network access and
no extra credential storage. QR encoding uses the bundled qrcodegen module
(MIT, Project Nayuki).
"""
import base64
import json
import urllib.parse

from qrcodegen import QrCode

MAX_QR_BYTES = 1800
NODE_TYPES = {'hysteria2', 'vless', 'vmess', 'trojan', 'shadowsocks', 'tuic', 'anytls'}


def _host(node):
    server = str(node.get('server', '')).strip().strip('[]')
    return '[' + server + ']' if ':' in server else server


def _port(node):
    return int(node.get('server_port') or 0)


def _query(pairs):
    values = {key: value for key, value in pairs if value not in (None, '', False)}
    return urllib.parse.urlencode(values, quote_via=urllib.parse.quote, safe='')


def _fragment(tag):
    return '#' + urllib.parse.quote(str(tag), safe='') if tag else ''


def _transport_pairs(transport):
    kind = (transport or {}).get('type')
    if not kind or kind == 'tcp':
        return []
    pairs = [('type', kind)]
    if kind in ('ws', 'httpupgrade', 'http'):
        pairs.append(('path', transport.get('path') or '/'))
        host = (transport.get('headers') or {}).get('Host') or transport.get('host')
        if host:
            pairs.append(('host', host))
    elif kind == 'grpc' and transport.get('service_name'):
        pairs.append(('serviceName', transport['service_name']))
    return pairs


def _tls_pairs(node):
    tls = node.get('tls') or {}
    reality = tls.get('reality') or {}
    utls = tls.get('utls') or {}
    security = 'reality' if reality.get('enabled') else ('tls' if tls.get('enabled') else 'none')
    pairs = [('security', security)]
    if tls.get('server_name'):
        pairs.append(('sni', tls['server_name']))
    if utls.get('fingerprint'):
        pairs.append(('fp', utls['fingerprint']))
    if reality.get('public_key'):
        pairs.append(('pbk', reality['public_key']))
    if reality.get('short_id'):
        pairs.append(('sid', reality['short_id']))
    if tls.get('alpn'):
        pairs.append(('alpn', ','.join(tls['alpn'])))
    if tls.get('insecure'):
        pairs.append(('insecure', '1'))
    return pairs


def _vless(node):
    pairs = [('encryption', 'none')] + _tls_pairs(node) + _transport_pairs(node.get('transport'))
    if node.get('flow'):
        pairs.append(('flow', node['flow']))
    return 'vless://%s@%s:%d?%s%s' % (
        urllib.parse.quote(str(node.get('uuid', '')), safe=''), _host(node), _port(node), _query(pairs), _fragment(node.get('tag')))


def _vmess(node):
    tls = node.get('tls') or {}
    utls = tls.get('utls') or {}
    transport = node.get('transport') or {}
    data = {
        'v': '2', 'ps': node.get('tag', ''), 'add': str(node.get('server', '')).strip().strip('[]'), 'port': str(_port(node)),
        'id': node.get('uuid', ''), 'aid': str(node.get('alter_id') or 0), 'scy': node.get('security') or 'auto',
        'net': transport.get('type') or 'tcp', 'type': 'none',
        'host': (transport.get('headers') or {}).get('Host') or transport.get('host') or '',
        'path': transport.get('path') or '',
        'tls': 'tls' if tls.get('enabled') else '', 'sni': tls.get('server_name') or '',
        'alpn': ','.join(tls.get('alpn') or []), 'fp': utls.get('fingerprint') or '',
    }
    return 'vmess://' + base64.b64encode(json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()).decode()


def _trojan(node):
    pairs = [('security', 'tls')] + [x for x in _tls_pairs(node) if x[0] != 'security'] + _transport_pairs(node.get('transport'))
    return 'trojan://%s@%s:%d?%s%s' % (
        urllib.parse.quote(str(node.get('password', '')), safe=''), _host(node), _port(node), _query(pairs), _fragment(node.get('tag')))


def _shadowsocks(node):
    if node.get('plugin'):
        raise ValueError('带插件的 Shadowsocks 节点暂不支持链接分享')
    method = str(node.get('method', ''))
    password = str(node.get('password', ''))
    if not method or not password:
        raise ValueError('Shadowsocks 节点缺少加密方式或密码')
    userinfo = base64.urlsafe_b64encode((method + ':' + password).encode()).decode().rstrip('=')
    return 'ss://%s@%s:%d%s' % (userinfo, _host(node), _port(node), _fragment(node.get('tag')))


def _hysteria2(node):
    obfs = node.get('obfs') or {}
    pairs = _tls_pairs(node)[1:]
    if obfs.get('type'):
        pairs.append(('obfs', obfs['type']))
        if obfs.get('password'):
            pairs.append(('obfs-password', obfs['password']))
    return 'hysteria2://%s@%s:%d?%s%s' % (
        urllib.parse.quote(str(node.get('password', '')), safe=''), _host(node), _port(node), _query(pairs), _fragment(node.get('tag')))


def _tuic(node):
    pairs = _tls_pairs(node)[1:]
    for key, field in (('congestion_control', 'congestion_control'), ('udp_relay_mode', 'udp_relay_mode')):
        if node.get(field):
            pairs.append((key, node[field]))
    credential = urllib.parse.quote(str(node.get('uuid', '')), safe='') + ':' + urllib.parse.quote(str(node.get('password', '')), safe='')
    return 'tuic://%s@%s:%d?%s%s' % (credential, _host(node), _port(node), _query(pairs), _fragment(node.get('tag')))


def _anytls(node):
    pairs = _tls_pairs(node)[1:]
    return 'anytls://%s@%s:%d?%s%s' % (
        urllib.parse.quote(str(node.get('password', '')), safe=''), _host(node), _port(node), _query(pairs), _fragment(node.get('tag')))


def _socks_like(node, scheme):
    users = node.get('users') or []
    username = node.get('username') or (users[0].get('username') if users else '')
    password = node.get('password') or (users[0].get('password') if users else '')
    credential = ''
    if username:
        credential = base64.urlsafe_b64encode((str(username) + ':' + str(password)).encode()).decode().rstrip('=') + '@'
    return '%s://%s%s:%d%s' % (scheme, credential, _host(node), _port(node), _fragment(node.get('tag')))


def node_uri(node):
    kind = node.get('type')
    if kind not in NODE_TYPES and kind not in ('socks', 'http', 'mixed'):
        raise ValueError('该协议暂不支持生成分享链接，请使用配置导出')
    if not node.get('server') or not _port(node):
        raise ValueError('节点缺少服务器地址或端口')
    if kind == 'vless':
        return _vless(node)
    if kind == 'vmess':
        return _vmess(node)
    if kind == 'trojan':
        return _trojan(node)
    if kind == 'shadowsocks':
        return _shadowsocks(node)
    if kind == 'hysteria2':
        return _hysteria2(node)
    if kind == 'tuic':
        return _tuic(node)
    if kind == 'anytls':
        return _anytls(node)
    if kind == 'socks':
        return _socks_like(node, 'socks5')
    return _socks_like(node, 'http')


def qr_matrix(text):
    data = text.encode('utf-8')
    if len(data) > MAX_QR_BYTES:
        raise ValueError('内容较长，无法生成二维码，请复制文字后再分享')
    code = QrCode.encode_binary(data, QrCode.Ecc.MEDIUM)
    size = code.get_size()
    return [[bool(code.get_module(x, y)) for x in range(size)] for y in range(size)]


def qr_svg(text):
    matrix = qr_matrix(text)
    border = 4
    size = len(matrix) + border * 2
    runs = []
    for y, row in enumerate(matrix):
        x = 0
        while x < len(row):
            if not row[x]:
                x += 1
                continue
            start = x
            while x < len(row) and row[x]:
                x += 1
            runs.append('M%d,%dh%dv1h-%dz' % (start + border, y + border, x - start, x - start))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="100%%" height="100%%" role="img" aria-label="二维码">'
            '<rect width="%d" height="%d" fill="#ffffff"/><path d="%s" fill="#000000"/></svg>') % (
                size, size, size, size, ''.join(runs))


def node_share(entry):
    node = entry['node']
    link = node_uri(node)
    result = {'id': entry.get('id'), 'tag': node.get('tag', ''), 'type': node.get('type', ''),
              'link': link, 'qr': ''}
    try:
        result['qr'] = qr_svg(link)
    except ValueError as error:
        result['qrError'] = str(error)
    return result


def profile_share(name, obj, cfg):
    url = (obj or {}).get('url') or (obj or {}).get('suburl') or ''
    nodes = [x for x in (cfg or {}).get('outbounds', [])
             if x.get('server') and x.get('tag') and x.get('type') not in ('direct', 'block')]
    links, skipped = [], []
    for node in nodes:
        try:
            links.append(node_uri(node))
        except ValueError:
            skipped.append(node.get('tag', ''))
    result = {'name': name, 'count': len(links), 'skipped': skipped,
              'filename': (name or 'config') + '.json', 'json': '', 'jsonError': ''}
    raw = cfg if isinstance(cfg, dict) and cfg else None
    if raw:
        document = json.dumps(raw, ensure_ascii=False, indent=2)
        if len(document.encode('utf-8')) > 1024 * 1024:
            result['jsonError'] = '配置超过 1 MB，无法在网页中显示，请改为分享订阅链接或节点链接'
        else:
            result['json'] = document
    else:
        result['jsonError'] = '该配置尚未缓存 JSON，请先更新一次；仍可分享订阅链接'
    if url:
        result.update(kind='remote', link=url, qr=qr_svg(url))
        return result
    text = '\n'.join(links)
    subscription = base64.b64encode(text.encode()).decode() if text else ''
    result.update(kind='local', link=text, subscription=subscription, qr='')
    if subscription:
        try:
            result['qr'] = qr_svg(subscription)
        except ValueError as error:
            result['qrError'] = str(error)
    return result
