"""Per-configuration node selection state.

The selection only drives the LuCI list controls (batch delete, drag copy); it
never changes routing, and stale node ids are ignored by the interface.
"""
import json
import os
import pathlib

MAX_SCOPES = 200
MAX_ITEMS = 2000
MAX_ID = 200


def clean(value):
    if not isinstance(value, dict):
        raise ValueError('选择状态格式无效')
    scopes = value.get('scopes') if isinstance(value.get('scopes'), dict) else {}
    if len(scopes) > MAX_SCOPES:
        raise ValueError('保存的配置数量超出限制')
    result = {}
    for scope, ids in scopes.items():
        if not isinstance(scope, str) or not scope or len(scope) > MAX_ID:
            raise ValueError('配置标识无效')
        if not isinstance(ids, list) or len(ids) > MAX_ITEMS:
            raise ValueError('选择数量超出限制')
        unique = []
        for item in ids:
            if not isinstance(item, str) or not item or len(item) > MAX_ID:
                raise ValueError('节点标识无效')
            if item not in unique:
                unique.append(item)
        if unique:
            result[scope] = unique
    return {'visible': bool(value.get('visible')), 'scopes': result}


def read(root):
    try:
        data = json.loads((pathlib.Path(root) / 'selection.json').read_text())
    except (OSError, ValueError):
        return {'visible': False, 'scopes': {}}
    try:
        return clean(data)
    except ValueError:
        return {'visible': False, 'scopes': {}}


def write(root, value):
    data = clean(value)
    path = pathlib.Path(root) / 'selection.json'
    tmp = path.with_name('selection.json.%d.tmp' % os.getpid())
    tmp.write_text(json.dumps(data, ensure_ascii=False))
    os.chmod(tmp, 0o600)
    tmp.replace(path)
    return data
