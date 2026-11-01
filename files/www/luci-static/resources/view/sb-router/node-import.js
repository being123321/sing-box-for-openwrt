function emptyTls() {
    return {
        enabled: false,
        serverName: '',
        insecure: false,
        alpn: [],
        utls: {
            enabled: false,
            fingerprint: ''
        },
        reality: {
            enabled: false,
            publicKey: '',
            shortId: ''
        }
    };
}
function emptyTransport() {
    return {
        type: '',
        path: '',
        host: '',
        serviceName: ''
    };
}
function emptyMetadata(format) {
    return {
        title: '未命名订阅',
        uploadBytes: 0,
        downloadBytes: 0,
        totalBytes: 0,
        expireAtSeconds: 0,
        sourceFormat: format
    };
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function normalizedBase64(input) {
    let value = input.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
    while (value.length % 4 !== 0) {
        value += '=';
    }
    return value;
}
function decodeBase64Bytes(input) {
    const value = normalizedBase64(input);
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (let index = 0; index < value.length; index++) {
        const character = value.charAt(index);
        if (character === '=') {
            break;
        }
        const digit = BASE64_ALPHABET.indexOf(character);
        if (digit < 0) {
            throw new Error('订阅包含无效的 Base64 字符');
        }
        buffer = (buffer << 6) | digit;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
    }
    return bytes;
}
function decodeUtf8(bytes) {
    let result = '';
    let index = 0;
    while (index < bytes.length) {
        const first = bytes[index];
        if (first < 0x80) {
            result += String.fromCharCode(first);
            index += 1;
        }
        else if ((first & 0xe0) === 0xc0 && index + 1 < bytes.length) {
            const codePoint = ((first & 0x1f) << 6) | (bytes[index + 1] & 0x3f);
            result += String.fromCharCode(codePoint);
            index += 2;
        }
        else if ((first & 0xf0) === 0xe0 && index + 2 < bytes.length) {
            const codePoint = ((first & 0x0f) << 12) |
                ((bytes[index + 1] & 0x3f) << 6) |
                (bytes[index + 2] & 0x3f);
            result += String.fromCharCode(codePoint);
            index += 3;
        }
        else if ((first & 0xf8) === 0xf0 && index + 3 < bytes.length) {
            const codePoint = ((first & 0x07) << 18) |
                ((bytes[index + 1] & 0x3f) << 12) |
                ((bytes[index + 2] & 0x3f) << 6) |
                (bytes[index + 3] & 0x3f);
            const adjusted = codePoint - 0x10000;
            result += String.fromCharCode(0xd800 + (adjusted >> 10));
            result += String.fromCharCode(0xdc00 + (adjusted & 0x3ff));
            index += 4;
        }
        else {
            result += '\uFFFD';
            index += 1;
        }
    }
    return result;
}
function decodeBase64Text(input) {
    return decodeUtf8(decodeBase64Bytes(input));
}
function decodeUrlComponent(input) {
    try {
        // Share links use RFC 3986 URI components, not HTML form encoding. A
        // literal `+` is therefore part of a password/UUID/name and must not be
        // rewritten to a space; `%2B` is decoded by decodeURIComponent itself.
        return decodeURIComponent(input);
    }
    catch (_) {
        return input;
    }
}
function fnv1aId(input) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `node-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const SUPPORTED_SCHEMES = ['ss://', 'trojan://', 'vless://', 'vmess://', 'hysteria2://', 'hy2://'];
const SUPPORTED_UTLS_FINGERPRINTS = [
    'chrome', 'chrome_psk', 'chrome_psk_shuffle', 'chrome_padding_psk_shuffle', 'chrome_pq', 'chrome_pq_psk',
    'firefox', 'edge', 'safari', '360', 'qq', 'ios', 'android', 'random', 'randomized'
];
const SUPPORTED_SHADOWSOCKS_METHODS = [
    'aes-128-ctr', 'aes-192-ctr', 'aes-256-ctr',
    'aes-128-cfb', 'aes-192-cfb', 'aes-256-cfb',
    'rc4-md5', 'chacha20-ietf', 'xchacha20',
    'aes-128-gcm', 'aes-192-gcm', 'aes-256-gcm',
    'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305',
    '2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm',
    '2022-blake3-chacha20-poly1305'
];
const SUPPORTED_VMESS_SECURITY = [
    'auto', 'none', 'zero', 'aes-128-cfb', 'aes-128-gcm', 'chacha20-poly1305'
];
const SUPPORTED_TRANSPORTS = ['', 'tcp', 'http', 'ws', 'quic', 'grpc', 'httpupgrade'];
const SUPPORTED_SING_BOX_RULE_KEYS = [
    'type', 'domain', 'domain_suffix', 'domain_keyword', 'ip_cidr', 'rule_set', 'outbound', 'action'
];
function queryValue(items, key) {
    for (let index = 0; index < items.length; index++) {
        if (items[index].key.toLowerCase() === key.toLowerCase()) {
            return items[index].value;
        }
    }
    return '';
}
function hasQueryKey(items, key) {
    return items.some((item) => item.key.toLowerCase() === key.toLowerCase());
}
function isTrue(value) {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}
function yamlValue(values, key) {
    return queryValue(values, key);
}
function parseInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}
function parseAlterId(value) {
    const text = `${value}`.trim();
    if (text.length === 0)
        return 0;
    const parsed = Number(text);
    if (!Number.isInteger(parsed) || parsed < 0)
        throw new Error('VMess alterId 必须是非负整数');
    return parsed;
}
function stripQuotes(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2 &&
        ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}
function splitInlineYamlFields(value) {
    let source = value.trim();
    if (source.startsWith('{') && source.endsWith('}'))
        source = source.slice(1, -1);
    const fields = [];
    let current = '';
    let quote = '';
    let escaped = false;
    let squareDepth = 0;
    let curlyDepth = 0;
    for (let index = 0; index < source.length; index++) {
        const character = source.charAt(index);
        if (escaped) {
            current += character;
            escaped = false;
            continue;
        }
        if (quote.length > 0 && character === '\\') {
            current += character;
            escaped = true;
            continue;
        }
        if (character === '"' || character === "'") {
            if (quote.length === 0)
                quote = character;
            else if (quote === character)
                quote = '';
            current += character;
            continue;
        }
        if (quote.length === 0) {
            if (character === '[')
                squareDepth++;
            if (character === ']')
                squareDepth--;
            if (character === '{')
                curlyDepth++;
            if (character === '}')
                curlyDepth--;
            if (character === ',' && squareDepth === 0 && curlyDepth === 0) {
                if (current.trim().length > 0)
                    fields.push(current.trim());
                current = '';
                continue;
            }
        }
        current += character;
    }
    if (current.trim().length > 0)
        fields.push(current.trim());
    return fields;
}
function findTopLevelColon(value) {
    let quote = '';
    let escaped = false;
    let squareDepth = 0;
    let curlyDepth = 0;
    for (let index = 0; index < value.length; index++) {
        const character = value.charAt(index);
        if (escaped) {
            escaped = false;
            continue;
        }
        if (quote.length > 0 && character === '\\') {
            escaped = true;
            continue;
        }
        if (character === '"' || character === "'") {
            if (quote.length === 0)
                quote = character;
            else if (quote === character)
                quote = '';
            continue;
        }
        if (quote.length > 0)
            continue;
        if (character === '[')
            squareDepth++;
        if (character === ']')
            squareDepth--;
        if (character === '{')
            curlyDepth++;
        if (character === '}')
            curlyDepth--;
        if (character === ':' && squareDepth === 0 && curlyDepth === 0)
            return index;
    }
    return -1;
}
function parseInlineYamlValues(value) {
    const values = [];
    const fields = splitInlineYamlFields(value);
    for (let index = 0; index < fields.length; index++) {
        const colon = findTopLevelColon(fields[index]);
        if (colon < 1)
            continue;
        values.push({
            key: stripQuotes(fields[index].slice(0, colon)).trim(),
            value: stripQuotes(fields[index].slice(colon + 1)).trim()
        });
    }
    return values;
}
function validateProtocolCredentials(protocol, name, password, uuid, method) {
    const label = name.length > 0 ? name : protocol;
    if (protocol === 'shadowsocks' && method.trim().length === 0) {
        throw new Error(`节点 ${label} 缺少 Shadowsocks 加密方式`);
    }
    if (protocol === 'shadowsocks' && password.length === 0) {
        throw new Error(`节点 ${label} 缺少 Shadowsocks 密码`);
    }
    if ((protocol === 'vless' || protocol === 'vmess') && uuid.trim().length === 0) {
        throw new Error(`节点 ${label} 缺少 UUID`);
    }
    if ((protocol === 'trojan' || protocol === 'hysteria2') && password.length === 0) {
        throw new Error(`节点 ${label} 缺少密码`);
    }
}
function normalizeTransportType(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'websocket')
        return 'ws';
    if (normalized === 'h2')
        return 'http';
    return normalized;
}
function validateNodeCompatibility(protocol, name, password, method, flow, transport) {
    const label = name.length > 0 ? name : protocol;
    if (protocol === 'shadowsocks' && !SUPPORTED_SHADOWSOCKS_METHODS.includes(method)) {
        throw new Error(`节点 ${label} 使用当前 sing-box 不支持的 Shadowsocks 加密方式`);
    }
    if (protocol === 'vmess' && !SUPPORTED_VMESS_SECURITY.includes(method)) {
        throw new Error(`节点 ${label} 使用当前 sing-box 不支持的 VMess 加密方式`);
    }
    if (protocol === 'vless' && flow.length > 0 && flow !== 'xtls-rprx-vision') {
        throw new Error(`节点 ${label} 使用当前 sing-box 不支持的 VLESS flow`);
    }
    if (!SUPPORTED_TRANSPORTS.includes(transport.type)) {
        throw new Error(`节点 ${label} 使用当前版本不支持的传输类型`);
    }
    if ((protocol === 'shadowsocks' || protocol === 'hysteria2') && transport.type.length > 0 &&
        transport.type !== 'tcp') {
        throw new Error(`节点 ${label} 的协议不支持当前传输配置`);
    }
    if (method.startsWith('2022-blake3-')) {
        const requiredLength = method === '2022-blake3-aes-128-gcm' ? 16 : 32;
        const keys = password.split(':');
        for (let index = 0; index < keys.length; index++) {
            try {
                if (decodeBase64Bytes(keys[index]).length !== requiredLength)
                    throw new Error('invalid key length');
            }
            catch (_) {
                throw new Error(`节点 ${label} 的 Shadowsocks 2022 密钥格式无效`);
            }
        }
    }
}
function validateUtlsFingerprint(value) {
    const fingerprint = value.trim().toLowerCase();
    if (fingerprint.length === 0)
        return '';
    if (!SUPPORTED_UTLS_FINGERPRINTS.includes(fingerprint)) {
        throw new Error(`不支持的 uTLS fingerprint：${value}`);
    }
    return fingerprint;
}
function singBoxTransportHost(transport) {
    if (!transport || transport.host === undefined)
        return '';
    if (typeof transport.host === 'string')
        return transport.host;
    return transport.host.length > 0 ? transport.host[0] : '';
}
function hasUnsupportedSingBoxTransportHeaders(headers) {
    if (!headers)
        return false;
    const actual = JSON.stringify(headers);
    const allowed = {};
    if (headers.Host !== undefined)
        allowed.Host = headers.Host;
    if (headers.host !== undefined)
        allowed.host = headers.host;
    return actual !== JSON.stringify(allowed);
}
function validateRealityPublicKey(value) {
    const publicKey = value.trim();
    if (publicKey.length === 0)
        throw new Error('Reality 节点缺少 public key');
    try {
        if (decodeBase64Bytes(publicKey).length !== 32)
            throw new Error('invalid length');
    }
    catch (_) {
        throw new Error('Reality public key 格式无效');
    }
    return publicKey;
}
function validateRealityShortId(value) {
    const shortId = value.trim().toLowerCase();
    if (shortId.length === 0)
        return '';
    if (shortId.length > 16 || shortId.length % 2 !== 0)
        throw new Error('Reality short id 格式无效');
    for (let index = 0; index < shortId.length; index++) {
        const code = shortId.charCodeAt(index);
        const digit = code >= 48 && code <= 57;
        const hexLetter = code >= 97 && code <= 102;
        if (!digit && !hexLetter)
            throw new Error('Reality short id 格式无效');
    }
    return shortId;
}
function canonicalQuery(items) {
    return items.slice().sort((left, right) => {
        const leftText = `${left.key.toLowerCase()}=${left.value}`;
        const rightText = `${right.key.toLowerCase()}=${right.value}`;
        if (leftText < rightText)
            return -1;
        if (leftText > rightText)
            return 1;
        return 0;
    });
}
function splitCsv(value) {
    let source = value.trim();
    if (source.startsWith('[') && source.endsWith(']')) {
        source = source.slice(1, -1);
    }
    if (source.length === 0) {
        return [];
    }
    return source.split(',').map((item) => stripQuotes(item)).filter((item) => item.length > 0);
}
function parseQuery(value) {
    if (value.length === 0) {
        return [];
    }
    return value.split('&').filter((item) => item.length > 0).map((item) => {
        const equalsIndex = item.indexOf('=');
        if (equalsIndex < 0) {
            return { key: decodeUrlComponent(item), value: '' };
        }
        return {
            key: decodeUrlComponent(item.slice(0, equalsIndex)),
            value: decodeUrlComponent(item.slice(equalsIndex + 1))
        };
    });
}
function parseUri(value) {
    const schemeEnd = value.indexOf('://');
    if (schemeEnd < 1) {
        throw new Error('节点链接缺少协议名');
    }
    const scheme = value.slice(0, schemeEnd).toLowerCase();
    let rest = value.slice(schemeEnd + 3);
    let name = '';
    const hashIndex = rest.indexOf('#');
    if (hashIndex >= 0) {
        name = decodeUrlComponent(rest.slice(hashIndex + 1));
        rest = rest.slice(0, hashIndex);
    }
    let query = [];
    const queryIndex = rest.indexOf('?');
    if (queryIndex >= 0) {
        query = parseQuery(rest.slice(queryIndex + 1));
        rest = rest.slice(0, queryIndex);
    }
    return { scheme: scheme, authority: rest, query: query, name: name };
}
function parseAddress(value) {
    const authority = value.trim();
    if (authority.startsWith('[')) {
        const closing = authority.indexOf(']');
        if (closing < 0) {
            throw new Error('IPv6 地址缺少右方括号');
        }
        const portText = authority.slice(closing + 1).replace(/^:/, '');
        return { host: authority.slice(1, closing), port: parseInteger(portText) };
    }
    const colon = authority.lastIndexOf(':');
    if (colon < 1) {
        throw new Error('节点链接缺少端口');
    }
    return { host: authority.slice(0, colon), port: parseInteger(authority.slice(colon + 1)) };
}
function makeNode(protocol, name, server, port, username, password, uuid, method, alterId, flow, query, transport) {
    if (server.length === 0 || port < 1 || port > 65535) {
        throw new Error(`节点 ${name || protocol} 的地址或端口无效`);
    }
    if (protocol === 'hysteria2' && (hasQueryKey(query, 'obfs') || hasQueryKey(query, 'obfs-password') ||
        hasQueryKey(query, 'obfsPassword'))) {
        throw new Error(`节点 ${name || protocol} 使用 Hysteria2 obfs，当前版本未完整支持，已跳过`);
    }
    if (protocol === 'vmess' && (!Number.isInteger(alterId) || alterId < 0)) {
        throw new Error(`节点 ${name || protocol} 的 VMess alterId 无效`);
    }
    if (hasQueryKey(query, 'ed') || hasQueryKey(query, 'eh') || hasQueryKey(query, 'max_early_data') ||
        hasQueryKey(query, 'early_data_header_name')) {
        throw new Error(`节点 ${name || protocol} 使用 WebSocket early-data，当前版本未完整建模，已跳过`);
    }
    const resolvedMethod = method.trim().toLowerCase();
    const resolvedFlow = flow.trim().toLowerCase();
    transport.type = normalizeTransportType(transport.type);
    validateProtocolCredentials(protocol, name, password, uuid, resolvedMethod);
    validateNodeCompatibility(protocol, name, password, resolvedMethod, resolvedFlow, transport);
    const security = (queryValue(query, 'security') || queryValue(query, 'tls')).trim().toLowerCase();
    const realityEnabled = security === 'reality' || isTrue(queryValue(query, 'reality_enabled'));
    const tlsEnabled = security === 'tls' || isTrue(security) || realityEnabled ||
        protocol === 'trojan' || protocol === 'hysteria2';
    const serverName = queryValue(query, 'sni') || queryValue(query, 'peer');
    const insecureText = queryValue(query, 'allowInsecure') || queryValue(query, 'insecure');
    let fingerprint = validateUtlsFingerprint(queryValue(query, 'fp') || queryValue(query, 'fingerprint'));
    let utlsEnabled = fingerprint.length > 0 || isTrue(queryValue(query, 'utls_enabled'));
    if (realityEnabled && !utlsEnabled) {
        // sing-box requires uTLS for Reality. Chrome is its own default fingerprint
        // and is also the convention used by share links which omit `fp`.
        utlsEnabled = true;
        fingerprint = 'chrome';
    }
    if (utlsEnabled && !tlsEnabled)
        throw new Error(`节点 ${name || protocol} 的 uTLS 未启用 TLS`);
    const tls = emptyTls();
    tls.enabled = tlsEnabled;
    tls.serverName = serverName;
    tls.insecure = isTrue(insecureText);
    tls.alpn = splitCsv(queryValue(query, 'alpn'));
    tls.utls.enabled = utlsEnabled;
    tls.utls.fingerprint = fingerprint;
    if (realityEnabled) {
        tls.reality.enabled = true;
        tls.reality.publicKey = validateRealityPublicKey(queryValue(query, 'pbk') || queryValue(query, 'public_key') ||
            queryValue(query, 'public-key'));
        tls.reality.shortId = validateRealityShortId(queryValue(query, 'sid') || queryValue(query, 'short_id') ||
            queryValue(query, 'short-id'));
    }
    const resolvedName = name.length > 0 ? name : `${protocol}-${server}`;
    const canonical = JSON.stringify({
        protocol: protocol,
        name: resolvedName,
        server: server,
        port: port,
        username: username,
        password: password,
        uuid: uuid,
        method: resolvedMethod,
        alterId: alterId > 0 ? alterId : undefined,
        flow: resolvedFlow,
        tls: tls,
        transport: transport,
        query: canonicalQuery(query)
    });
    return {
        id: fnv1aId(canonical),
        name: resolvedName,
        protocol: protocol,
        server: server,
        port: port,
        username: username,
        password: password,
        uuid: uuid,
        method: resolvedMethod,
        alterId: alterId,
        flow: resolvedFlow,
        tls: tls,
        transport: transport,
        query: query
    };
}
function parseVmess(value) {
    const encoded = value.slice('vmess://'.length).split('#')[0].split('?')[0];
    const payload = JSON.parse(decodeBase64Text(encoded));
    const query = [];
    if (payload.tls)
        query.push({ key: 'security', value: payload.tls });
    if (payload.sni)
        query.push({ key: 'sni', value: payload.sni });
    if (payload.alpn)
        query.push({ key: 'alpn', value: payload.alpn });
    if (payload.fp)
        query.push({ key: 'fp', value: payload.fp });
    const transport = emptyTransport();
    transport.type = payload.net || '';
    transport.path = payload.path || '';
    transport.host = payload.host || '';
    return makeNode('vmess', payload.ps || '', payload.add || '', parseInteger(payload.port || ''), '', '', payload.id || '', payload.scy || 'auto', parseAlterId(payload.aid || payload.alterId || ''), '', query, transport);
}
function parseShadowsocks(value) {
    const parsed = parseUri(value);
    if (hasQueryKey(parsed.query, 'plugin') || hasQueryKey(parsed.query, 'plugin-opts') ||
        hasQueryKey(parsed.query, 'plugin_opts')) {
        throw new Error('Shadowsocks SIP002/SIP003 plugin 当前版本尚未安全建模，已跳过');
    }
    let authority = parsed.authority;
    if (authority.indexOf('@') < 0) {
        authority = decodeBase64Text(authority);
    }
    const at = authority.lastIndexOf('@');
    if (at < 0) {
        throw new Error('Shadowsocks 节点缺少服务器地址');
    }
    let credential = authority.slice(0, at);
    if (credential.indexOf(':') < 0) {
        credential = decodeBase64Text(credential);
    }
    const colon = credential.indexOf(':');
    if (colon < 1) {
        throw new Error('Shadowsocks 节点缺少加密方式');
    }
    const address = parseAddress(authority.slice(at + 1));
    return makeNode('shadowsocks', parsed.name, address.host, address.port, '', decodeUrlComponent(credential.slice(colon + 1)), '', decodeUrlComponent(credential.slice(0, colon)), 0, '', parsed.query, emptyTransport());
}
function parseStandardUri(value) {
    const parsed = parseUri(value);
    const at = parsed.authority.lastIndexOf('@');
    if (at < 0) {
        throw new Error(`${parsed.scheme} 节点缺少凭据`);
    }
    const credential = decodeUrlComponent(parsed.authority.slice(0, at));
    const address = parseAddress(parsed.authority.slice(at + 1));
    const protocol = parsed.scheme === 'hy2' ? 'hysteria2' : parsed.scheme;
    const transport = emptyTransport();
    transport.type = queryValue(parsed.query, 'type');
    transport.path = queryValue(parsed.query, 'path');
    transport.host = queryValue(parsed.query, 'host');
    transport.serviceName = queryValue(parsed.query, 'serviceName');
    return makeNode(protocol, parsed.name, address.host, address.port, '', protocol === 'trojan' || protocol === 'hysteria2' ? credential : '', protocol === 'vless' ? credential : '', '', 0, queryValue(parsed.query, 'flow'), parsed.query, transport);
}
function parseNodeUri(value) {
    if (value.startsWith('vmess://')) {
        return parseVmess(value);
    }
    if (value.startsWith('ss://')) {
        return parseShadowsocks(value);
    }
    return parseStandardUri(value);
}
function supportedProtocol(value) {
    if (value === 'ss' || value === 'shadowsocks')
        return 'shadowsocks';
    if (value === 'trojan')
        return 'trojan';
    if (value === 'vless')
        return 'vless';
    if (value === 'vmess')
        return 'vmess';
    if (value === 'hysteria2' || value === 'hy2')
        return 'hysteria2';
    return null;
}
function parseUserInfo(value) {
    const metadata = emptyMetadata('uri-list');
    const parts = value.split(';');
    for (let index = 0; index < parts.length; index++) {
        const pair = parts[index].trim().split('=');
        if (pair.length !== 2)
            continue;
        const amount = Number.parseInt(pair[1].trim(), 10);
        if (!Number.isFinite(amount))
            continue;
        const key = pair[0].trim().toLowerCase();
        if (key === 'upload')
            metadata.uploadBytes = amount;
        if (key === 'download')
            metadata.downloadBytes = amount;
        if (key === 'total')
            metadata.totalBytes = amount;
        if (key === 'expire')
            metadata.expireAtSeconds = amount;
    }
    return metadata;
}
function mergeMetadata(format, headers) {
    const metadata = parseUserInfo(headers.subscriptionUserInfo);
    metadata.sourceFormat = format;
    metadata.title = headers.title.trim().length > 0 ? headers.title.trim() : '未命名订阅';
    return metadata;
}
function defaultDns() {
    return { strategy: 'prefer_ipv4', servers: ['https://1.1.1.1/dns-query'] };
}
function defaultGroup(nodes) {
    if (nodes.length === 0)
        return [];
    return [{
            name: '自动选择',
            type: 'select',
            nodeIds: nodes.map((node) => node.id),
            selectedNodeId: nodes[0].id
        }];
}
function finalizeBundle(bundle) {
    const nodes = [];
    const validNodeIds = [];
    let duplicateCount = 0;
    for (let index = 0; index < bundle.nodes.length; index++) {
        const node = bundle.nodes[index];
        if (validNodeIds.includes(node.id)) {
            duplicateCount++;
            continue;
        }
        nodes.push(node);
        validNodeIds.push(node.id);
    }
    const groups = [];
    for (let index = 0; index < bundle.policyGroups.length; index++) {
        const source = bundle.policyGroups[index];
        const nodeIds = [];
        for (let nodeIndex = 0; nodeIndex < source.nodeIds.length; nodeIndex++) {
            const nodeId = source.nodeIds[nodeIndex];
            if (validNodeIds.includes(nodeId) && !nodeIds.includes(nodeId))
                nodeIds.push(nodeId);
        }
        if (nodeIds.length === 0)
            continue;
        groups.push({
            name: source.name,
            type: source.type,
            nodeIds: nodeIds,
            selectedNodeId: nodeIds.includes(source.selectedNodeId) ? source.selectedNodeId : nodeIds[0]
        });
    }
    const warnings = bundle.warnings.slice();
    if (duplicateCount > 0) {
        warnings.push(`检测到 ${duplicateCount} 个重复节点，已按配置指纹稳定去重并保留首次出现项`);
    }
    return {
        metadata: bundle.metadata,
        nodes: nodes,
        policyGroups: groups.length > 0 ? groups : defaultGroup(nodes),
        rules: bundle.rules,
        dns: bundle.dns,
        warnings: warnings
    };
}
function normalizeTarget(value) {
    const upper = value.trim().toUpperCase();
    if (upper === 'DIRECT')
        return 'direct';
    if (upper.startsWith('REJECT'))
        return 'reject';
    if (upper === 'PROXY')
        return 'proxy';
    return stripQuotes(value);
}
function buildSingBoxTargetMap(outbounds) {
    const targets = [];
    for (let index = 0; index < outbounds.length; index++) {
        const outbound = outbounds[index];
        const tag = (outbound.tag || '').trim();
        if (tag.length === 0)
            continue;
        const type = (outbound.type || '').trim().toLowerCase();
        let target = '';
        if (type === 'direct')
            target = 'direct';
        else if (type === 'block' || type === 'reject')
            target = 'reject';
        else if (type === 'selector' || type === 'urltest')
            target = tag;
        else if (supportedProtocol(type) !== null)
            target = 'proxy';
        else
            target = `unsupported:${type.length > 0 ? type : 'unknown'}`;
        targets.push({ key: tag, value: target });
    }
    return targets;
}
function resolveSingBoxTarget(targetMap, outboundTag) {
    const tag = outboundTag.trim();
    if (tag.length === 0)
        return { target: 'proxy', issue: '规则未指定目标出站' };
    const mapped = queryValue(targetMap, tag);
    if (mapped === 'direct' || mapped === 'reject' || mapped === 'proxy') {
        return { target: mapped, issue: '' };
    }
    if (mapped.startsWith('unsupported:')) {
        return {
            target: 'proxy',
            issue: `目标出站 ${tag} 的类型 ${mapped.slice('unsupported:'.length)} 尚未支持规则映射`
        };
    }
    if (mapped.length > 0)
        return { target: mapped, issue: '' };
    return { target: 'proxy', issue: `目标出站 ${tag} 未在 outbounds 中定义` };
}
function singBoxStringList(values) {
    if (values === undefined)
        return [];
    if (typeof values === 'string')
        return values.length > 0 ? [values] : [];
    return values;
}
function addRuleValues(rules, kind, sourceValues, target, source) {
    const values = singBoxStringList(sourceValues);
    for (let index = 0; index < values.length; index++) {
        rules.push({ kind: kind, value: values[index], target: normalizeTarget(target), source: source });
    }
}
function singBoxRuleCompatibilityIssue(source) {
    const keys = Object.keys(source);
    const unmodeled = keys.filter((key) => !SUPPORTED_SING_BOX_RULE_KEYS.includes(key));
    if (unmodeled.length > 0)
        return `未建模字段 ${unmodeled.join(', ')}`;
    const ruleType = (source.type || '').trim().toLowerCase();
    if (ruleType.length > 0 && ruleType !== 'default')
        return `逻辑规则类型 ${ruleType}`;
    const action = (source.action || '').trim().toLowerCase();
    if (action.length > 0 && action !== 'route' && action !== 'reject')
        return `规则动作 ${action}`;
    const matchKinds = [];
    if (singBoxStringList(source.domain).length > 0)
        matchKinds.push('domain');
    if (singBoxStringList(source.domain_suffix).length > 0)
        matchKinds.push('domain_suffix');
    if (singBoxStringList(source.domain_keyword).length > 0)
        matchKinds.push('domain_keyword');
    if (singBoxStringList(source.ip_cidr).length > 0)
        matchKinds.push('ip_cidr');
    if (singBoxStringList(source.rule_set).length > 0)
        matchKinds.push('rule_set');
    if (matchKinds.length === 0)
        return '缺少当前版本可表达的匹配条件';
    // Different match fields in one sing-box rule are conjunctive. Flattening
    // them into independent rules would broaden traffic matches, so block it.
    if (matchKinds.length > 1)
        return `复合匹配 ${matchKinds.join(' + ')}`;
    return '';
}
function parseYamlSections(text, section) {
    const lines = text.replace(/\r/g, '').split('\n');
    const maps = [];
    let inside = false;
    let current = null;
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index];
        const trimmed = raw.trim();
        if (trimmed === `${section}:`) {
            inside = true;
            current = null;
            continue;
        }
        if (!inside)
            continue;
        if (trimmed.length > 0 && !raw.startsWith(' ') && !raw.startsWith('\t')) {
            break;
        }
        if (trimmed.startsWith('- ')) {
            const first = trimmed.slice(2).trim();
            const values = first.startsWith('{') && first.endsWith('}') ? parseInlineYamlValues(first) : [];
            current = { name: queryValue(values, 'name'), values: values };
            maps.push(current);
            if (values.length === 0) {
                const colon = findTopLevelColon(first);
                if (colon <= 0)
                    continue;
                const key = first.slice(0, colon).trim();
                const value = stripQuotes(first.slice(colon + 1));
                current.values.push({ key: key, value: value });
                if (key === 'name')
                    current.name = value;
            }
            continue;
        }
        if (current && trimmed.length > 0 && !trimmed.startsWith('#')) {
            const colon = findTopLevelColon(trimmed);
            if (colon > 0) {
                const key = trimmed.slice(0, colon).trim();
                const value = stripQuotes(trimmed.slice(colon + 1));
                current.values.push({ key: key, value: value });
                if (key === 'name')
                    current.name = value;
            }
        }
    }
    return maps;
}
function parseYamlList(text, section) {
    const lines = text.replace(/\r/g, '').split('\n');
    const items = [];
    let inside = false;
    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index];
        const trimmed = raw.trim();
        if (trimmed === `${section}:`) {
            inside = true;
            continue;
        }
        if (!inside)
            continue;
        if (trimmed.length > 0 && !raw.startsWith(' ') && !raw.startsWith('\t'))
            break;
        if (trimmed.startsWith('- '))
            items.push(stripQuotes(trimmed.slice(2)));
    }
    return items;
}
class SubscriptionParser {
    parse(body, headers = { title: '', subscriptionUserInfo: '' }) {
        let payload = body.trim();
        if (payload.length === 0) {
            throw new Error('订阅内容为空');
        }
        if (!payload.startsWith('{') && payload.indexOf('proxies:') < 0 &&
            !SUPPORTED_SCHEMES.some((scheme) => payload.indexOf(scheme) >= 0)) {
            payload = decodeBase64Text(payload).trim();
        }
        if (payload.startsWith('{')) {
            return finalizeBundle(this.parseSingBox(payload, headers));
        }
        if (payload.indexOf('proxies:') >= 0) {
            return finalizeBundle(this.parseClash(payload, headers));
        }
        return finalizeBundle(this.parseUriList(payload, headers));
    }
    parseUriList(payload, headers) {
        const warnings = [];
        const nodes = [];
        const lines = payload.replace(/\r/g, '').split('\n');
        for (let index = 0; index < lines.length; index++) {
            const line = lines[index].trim();
            if (line.length === 0 || line.startsWith('#'))
                continue;
            if (!SUPPORTED_SCHEMES.some((scheme) => line.startsWith(scheme))) {
                warnings.push(`第 ${index + 1} 行不是首版支持的节点协议，已跳过`);
                continue;
            }
            try {
                nodes.push(parseNodeUri(line));
            }
            catch (error) {
                const message = error instanceof Error ? error.message : '无法解析';
                warnings.push(`第 ${index + 1} 行解析失败：${message}`);
            }
        }
        if (nodes.length === 0) {
            const detail = warnings.length > 0 ? `：${warnings[0]}` : '';
            throw new Error(`订阅中没有可用的首版节点${detail}`);
        }
        return {
            metadata: mergeMetadata('uri-list', headers),
            nodes: nodes,
            policyGroups: defaultGroup(nodes),
            rules: [],
            dns: defaultDns(),
            warnings: warnings
        };
    }
    parseSingBox(payload, headers) {
        const root = JSON.parse(payload);
        const outbounds = root.outbounds || [];
        const nodes = [];
        const tagToNodeId = [];
        const warnings = [];
        const tagToRuleTarget = buildSingBoxTargetMap(outbounds);
        for (let index = 0; index < outbounds.length; index++) {
            const outbound = outbounds[index];
            const protocol = supportedProtocol(outbound.type || '');
            if (!protocol)
                continue;
            try {
                if (protocol === 'shadowsocks' && (outbound.plugin !== undefined || outbound.plugin_opts !== undefined)) {
                    throw new Error('Shadowsocks SIP002/SIP003 plugin 当前版本尚未安全建模，已跳过');
                }
                if (protocol === 'hysteria2' && outbound.obfs !== undefined) {
                    throw new Error('Hysteria2 obfs 当前版本未完整支持，已跳过');
                }
                const query = [];
                if (outbound.tls?.reality?.enabled) {
                    query.push({ key: 'security', value: 'reality' });
                    query.push({ key: 'pbk', value: outbound.tls.reality.public_key || '' });
                    if (outbound.tls.reality.short_id)
                        query.push({ key: 'sid', value: outbound.tls.reality.short_id });
                }
                else if (outbound.tls?.enabled) {
                    query.push({ key: 'security', value: 'tls' });
                }
                if (outbound.tls?.server_name)
                    query.push({ key: 'sni', value: outbound.tls.server_name });
                if (outbound.tls?.insecure)
                    query.push({ key: 'insecure', value: 'true' });
                if (outbound.tls?.alpn)
                    query.push({ key: 'alpn', value: outbound.tls.alpn.join(',') });
                if (outbound.tls?.utls?.enabled) {
                    query.push({ key: 'utls_enabled', value: 'true' });
                    if (outbound.tls.utls.fingerprint)
                        query.push({ key: 'fp', value: outbound.tls.utls.fingerprint });
                }
                const transport = emptyTransport();
                if ((outbound.transport?.max_early_data || 0) > 0 ||
                    (outbound.transport?.early_data_header_name || '').length > 0) {
                    throw new Error('WebSocket early-data 当前版本未完整建模，已跳过');
                }
                if (hasUnsupportedSingBoxTransportHeaders(outbound.transport?.headers)) {
                    throw new Error('transport 自定义 headers 当前版本未完整建模，已跳过');
                }
                transport.type = outbound.transport?.type || '';
                transport.path = outbound.transport?.path || '';
                transport.host = singBoxTransportHost(outbound.transport) || outbound.transport?.headers?.Host ||
                    outbound.transport?.headers?.host || '';
                transport.serviceName = outbound.transport?.service_name || '';
                const node = makeNode(protocol, outbound.tag || '', outbound.server || '', outbound.server_port || 0, outbound.username || '', outbound.password || '', outbound.uuid || '', protocol === 'vmess' ? (outbound.security || outbound.method || 'auto') : (outbound.method || ''), outbound.alter_id || 0, outbound.flow || '', query, transport);
                nodes.push(node);
                tagToNodeId.push({ key: outbound.tag || node.name, value: node.id });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : '无法解析';
                warnings.push(`出站 ${outbound.tag || index + 1} 解析失败：${message}`);
            }
        }
        if (nodes.length === 0) {
            const detail = warnings.length > 0 ? `：${warnings[0]}` : '';
            throw new Error(`sing-box 配置中没有首版支持的代理出站${detail}`);
        }
        const groups = [];
        for (let index = 0; index < outbounds.length; index++) {
            const outbound = outbounds[index];
            if (outbound.type !== 'selector' && outbound.type !== 'urltest')
                continue;
            const nodeIds = (outbound.outbounds || []).map((tag) => queryValue(tagToNodeId, tag))
                .filter((id) => id.length > 0);
            if (nodeIds.length === 0)
                continue;
            const selected = queryValue(tagToNodeId, outbound.default || '') || nodeIds[0];
            groups.push({
                name: outbound.tag || '代理',
                type: outbound.type === 'urltest' ? 'urltest' : 'select',
                nodeIds: nodeIds,
                selectedNodeId: selected
            });
        }
        const rules = [];
        const sourceRules = root.route?.rules || [];
        for (let index = 0; index < sourceRules.length; index++) {
            const sourceRule = sourceRules[index];
            const action = (sourceRule.action || '').trim().toLowerCase();
            const targetResolution = action === 'reject' ? { target: 'reject', issue: '' } :
                resolveSingBoxTarget(tagToRuleTarget, sourceRule.outbound || '');
            const ruleCompatibilityIssue = singBoxRuleCompatibilityIssue(sourceRule);
            const compatibilityIssue = ruleCompatibilityIssue.length > 0 ? ruleCompatibilityIssue :
                targetResolution.issue;
            if (compatibilityIssue.length > 0) {
                rules.push({
                    kind: 'unsupported',
                    value: `sing-box 规则 ${index + 1}：${compatibilityIssue}`,
                    target: targetResolution.target,
                    source: 'subscription'
                });
                warnings.push(`sing-box 规则 ${index + 1} 包含${compatibilityIssue}；规则模式已被安全阻止`);
                continue;
            }
            addRuleValues(rules, 'domain', sourceRule.domain, targetResolution.target, 'subscription');
            addRuleValues(rules, 'domain_suffix', sourceRule.domain_suffix, targetResolution.target, 'subscription');
            addRuleValues(rules, 'domain_keyword', sourceRule.domain_keyword, targetResolution.target, 'subscription');
            addRuleValues(rules, 'ip_cidr', sourceRule.ip_cidr, targetResolution.target, 'subscription');
            addRuleValues(rules, 'rule_set', sourceRule.rule_set, targetResolution.target, 'subscription');
        }
        if (root.route?.final) {
            const finalResolution = resolveSingBoxTarget(tagToRuleTarget, root.route.final);
            if (finalResolution.issue.length > 0) {
                rules.push({
                    kind: 'unsupported',
                    value: `sing-box final：${finalResolution.issue}`,
                    target: finalResolution.target,
                    source: 'subscription'
                });
                warnings.push(`sing-box final 的${finalResolution.issue}；规则模式已被安全阻止`);
            }
            else {
                rules.push({ kind: 'final', value: '', target: finalResolution.target, source: 'subscription' });
            }
        }
        const dnsServers = [];
        const sourceServers = root.dns?.servers || [];
        for (let index = 0; index < sourceServers.length; index++) {
            const address = sourceServers[index].address || sourceServers[index].server || '';
            if (address.length > 0)
                dnsServers.push(address);
        }
        return {
            metadata: mergeMetadata('sing-box-json', headers),
            nodes: nodes,
            policyGroups: groups.length > 0 ? groups : defaultGroup(nodes),
            rules: rules,
            dns: {
                strategy: root.dns?.strategy || 'prefer_ipv4',
                servers: dnsServers.length > 0 ? dnsServers : defaultDns().servers
            },
            warnings: warnings
        };
    }
    parseClash(payload, headers) {
        const proxyMaps = parseYamlSections(payload, 'proxies');
        const nodes = [];
        const nameToNodeId = [];
        const warnings = ['当前为 Clash/Mihomo YAML 常用字段解析器；复杂锚点和 provider 将在真机版接入完整解析器'];
        for (let index = 0; index < proxyMaps.length; index++) {
            const map = proxyMaps[index];
            const protocol = supportedProtocol(yamlValue(map.values, 'type').toLowerCase());
            if (!protocol) {
                warnings.push(`节点 ${map.name || index + 1} 的协议暂不支持`);
                continue;
            }
            if (protocol === 'shadowsocks' && (hasQueryKey(map.values, 'plugin') ||
                hasQueryKey(map.values, 'plugin-opts') || hasQueryKey(map.values, 'plugin_opts'))) {
                warnings.push(`节点 ${map.name || index + 1} 使用 Shadowsocks SIP002/SIP003 plugin，当前版本尚未安全建模，已跳过`);
                continue;
            }
            const query = [];
            const realityInline = parseInlineYamlValues(yamlValue(map.values, 'reality-opts'));
            const realityPublicKey = queryValue(realityInline, 'public-key') ||
                queryValue(realityInline, 'public_key') || yamlValue(map.values, 'public-key') || yamlValue(map.values, 'public_key');
            const realityShortId = queryValue(realityInline, 'short-id') ||
                queryValue(realityInline, 'short_id') || yamlValue(map.values, 'short-id') || yamlValue(map.values, 'short_id');
            const hasReality = hasQueryKey(map.values, 'reality-opts') || realityPublicKey.length > 0;
            const tlsValue = yamlValue(map.values, 'tls');
            if (hasReality) {
                query.push({ key: 'security', value: 'reality' });
                query.push({ key: 'pbk', value: realityPublicKey });
                if (realityShortId.length > 0)
                    query.push({ key: 'sid', value: realityShortId });
            }
            else if (isTrue(tlsValue)) {
                query.push({ key: 'security', value: 'tls' });
            }
            const sni = yamlValue(map.values, 'servername') || yamlValue(map.values, 'sni');
            if (sni.length > 0)
                query.push({ key: 'sni', value: sni });
            if (isTrue(yamlValue(map.values, 'skip-cert-verify')))
                query.push({ key: 'insecure', value: 'true' });
            const fingerprint = yamlValue(map.values, 'client-fingerprint') || yamlValue(map.values, 'fingerprint');
            if (fingerprint.length > 0)
                query.push({ key: 'fp', value: fingerprint });
            if (hasQueryKey(map.values, 'obfs') || hasQueryKey(map.values, 'obfs-password')) {
                query.push({ key: 'obfs', value: yamlValue(map.values, 'obfs') });
            }
            const wsInline = parseInlineYamlValues(yamlValue(map.values, 'ws-opts'));
            const wsHeadersInline = parseInlineYamlValues(queryValue(wsInline, 'headers'));
            const grpcInline = parseInlineYamlValues(yamlValue(map.values, 'grpc-opts'));
            const transport = emptyTransport();
            const wsEarlyData = queryValue(wsInline, 'max-early-data') || queryValue(wsInline, 'max_early_data') ||
                yamlValue(map.values, 'max-early-data') || yamlValue(map.values, 'max_early_data');
            const wsEarlyHeader = queryValue(wsInline, 'early-data-header-name') ||
                queryValue(wsInline, 'early_data_header_name') || yamlValue(map.values, 'early-data-header-name') ||
                yamlValue(map.values, 'early_data_header_name');
            if ((wsEarlyData.length > 0 && Number(wsEarlyData) > 0) || wsEarlyHeader.length > 0) {
                warnings.push(`节点 ${map.name || index + 1} 使用 WebSocket early-data，当前版本未完整建模，已跳过`);
                continue;
            }
            transport.type = yamlValue(map.values, 'network');
            transport.path = queryValue(wsInline, 'path') || yamlValue(map.values, 'path');
            transport.host = queryValue(wsHeadersInline, 'Host') || queryValue(wsInline, 'host') ||
                yamlValue(map.values, 'Host') || yamlValue(map.values, 'host');
            transport.serviceName = queryValue(grpcInline, 'grpc-service-name') ||
                queryValue(grpcInline, 'service-name') || yamlValue(map.values, 'grpc-service-name') ||
                yamlValue(map.values, 'service-name') || yamlValue(map.values, 'serviceName');
            try {
                const node = makeNode(protocol, map.name, yamlValue(map.values, 'server'), parseInteger(yamlValue(map.values, 'port')), yamlValue(map.values, 'username'), yamlValue(map.values, 'password'), yamlValue(map.values, 'uuid'), yamlValue(map.values, 'cipher'), parseAlterId(yamlValue(map.values, 'alterId') || yamlValue(map.values, 'alter-id')), yamlValue(map.values, 'flow'), query, transport);
                nodes.push(node);
                nameToNodeId.push({ key: node.name, value: node.id });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : '无法解析';
                warnings.push(`节点 ${map.name || index + 1} 解析失败：${message}`);
            }
        }
        if (nodes.length === 0) {
            const detail = warnings.length > 1 ? `：${warnings[1]}` : '';
            throw new Error(`Clash/Mihomo 配置中没有首版支持的代理节点${detail}`);
        }
        const groups = [];
        const groupMaps = parseYamlSections(payload, 'proxy-groups');
        for (let index = 0; index < groupMaps.length; index++) {
            const group = groupMaps[index];
            const type = yamlValue(group.values, 'type').toLowerCase();
            if (type !== 'select' && type !== 'url-test')
                continue;
            const nodeIds = splitCsv(yamlValue(group.values, 'proxies'))
                .map((name) => queryValue(nameToNodeId, name))
                .filter((id) => id.length > 0);
            if (nodeIds.length > 0) {
                groups.push({
                    name: group.name || '代理',
                    type: type === 'url-test' ? 'urltest' : 'select',
                    nodeIds: nodeIds,
                    selectedNodeId: nodeIds[0]
                });
            }
        }
        const rules = [];
        const sourceRules = parseYamlList(payload, 'rules');
        for (let index = 0; index < sourceRules.length; index++) {
            const parts = sourceRules[index].split(',').map((item) => item.trim());
            const type = parts[0].toUpperCase();
            if ((type === 'MATCH' || type === 'FINAL') && parts.length >= 2) {
                rules.push({ kind: 'final', value: '', target: normalizeTarget(parts[1]), source: 'subscription' });
            }
            else if (parts.length >= 3) {
                let kind = null;
                if (type === 'DOMAIN')
                    kind = 'domain';
                if (type === 'DOMAIN-SUFFIX')
                    kind = 'domain_suffix';
                if (type === 'DOMAIN-KEYWORD')
                    kind = 'domain_keyword';
                if (type === 'IP-CIDR' || type === 'IP-CIDR6')
                    kind = 'ip_cidr';
                if (type === 'RULE-SET')
                    kind = 'rule_set';
                if (kind) {
                    rules.push({ kind: kind, value: parts[1], target: normalizeTarget(parts[2]), source: 'subscription' });
                }
                else {
                    rules.push({
                        kind: 'unsupported',
                        value: sourceRules[index],
                        target: normalizeTarget(parts[parts.length - 1]),
                        source: 'subscription'
                    });
                    warnings.push(`规则类型 ${type || '未知'} 尚不支持；规则模式已被安全阻止`);
                }
            }
            else if (sourceRules[index].trim().length > 0) {
                rules.push({ kind: 'unsupported', value: sourceRules[index], target: 'proxy', source: 'subscription' });
                warnings.push(`规则 ${sourceRules[index]} 格式不完整；规则模式已被安全阻止`);
            }
        }
        return {
            metadata: mergeMetadata('clash-yaml', headers),
            nodes: nodes,
            policyGroups: groups.length > 0 ? groups : defaultGroup(nodes),
            rules: rules,
            dns: defaultDns(),
            warnings: warnings
        };
    }
}

function coreTag(node) {
    return node.id;
}
function buildTls(source) {
    if (!source.enabled)
        return undefined;
    const tls = { enabled: true };
    if (source.serverName.length > 0)
        tls.server_name = source.serverName;
    if (source.insecure)
        tls.insecure = true;
    if (source.alpn.length > 0)
        tls.alpn = source.alpn;
    // Persisted schema-v1 subscriptions created before these fields existed do
    // not have nested uTLS/Reality objects. Treat them as disabled instead of
    // breaking an otherwise valid saved subscription after an app update.
    if (source.utls !== undefined && source.utls.enabled) {
        tls.utls = { enabled: true };
        if (source.utls.fingerprint.length > 0)
            tls.utls.fingerprint = source.utls.fingerprint;
    }
    if (source.reality !== undefined && source.reality.enabled) {
        tls.reality = {
            enabled: true,
            public_key: source.reality.publicKey
        };
        if (source.reality.shortId.length > 0)
            tls.reality.short_id = source.reality.shortId;
    }
    return tls;
}
function buildTransport(source) {
    if (source.type.length === 0 || source.type === 'tcp')
        return undefined;
    const transport = { type: source.type };
    if (source.path.length > 0)
        transport.path = source.path;
    if (source.host.length > 0) {
        if (source.type === 'http' || source.type === 'httpupgrade')
            transport.host = source.host;
        else
            transport.headers = { Host: source.host };
    }
    if (source.serviceName.length > 0)
        transport.service_name = source.serviceName;
    return transport;
}
function buildNodeOutbound(node) {
    const outbound = {
        type: node.protocol,
        tag: coreTag(node),
        server: node.server,
        server_port: node.port
    };
    if (node.username.length > 0)
        outbound.username = node.username;
    if (node.password.length > 0)
        outbound.password = node.password;
    if (node.uuid.length > 0)
        outbound.uuid = node.uuid;
    if (node.method.length > 0) {
        if (node.protocol === 'vmess')
            outbound.security = node.method;
        else
            outbound.method = node.method;
    }
    // Saved subscriptions created before alterId was added do not contain this
    // field. Omit zero/undefined while preserving legacy VMess configurations.
    if (node.protocol === 'vmess' && node.alterId !== undefined && node.alterId > 0) {
        outbound.alter_id = node.alterId;
    }
    if (node.flow.length > 0)
        outbound.flow = node.flow;
    const tls = buildTls(node.tls);
    if (tls)
        outbound.tls = tls;
    const transport = buildTransport(node.transport);
    if (transport)
        outbound.transport = transport;
    return outbound;
}

function parseNodes(text){const b=new SubscriptionParser().parse(text);if(b.warnings.length)throw Error(b.warnings.join('；'));return b.nodes.map(n=>({...buildNodeOutbound(n),tag:n.name||n.id}));}

export { parseNodes };
