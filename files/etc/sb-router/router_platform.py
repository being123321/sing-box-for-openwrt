import ipaddress
import json
import subprocess
import pathlib

def lan_address():
    r=subprocess.run(['uci','-q','get','network.lan.ipaddr'],capture_output=True,text=True)
    if r.returncode==0 and r.stdout.strip():
        return str(ipaddress.IPv4Address(r.stdout.split()[0].split('/')[0]))
    r=subprocess.run(['ubus','call','network.interface.lan','status'],capture_output=True,text=True,check=True)
    values=json.loads(r.stdout).get('ipv4-address',[])
    if not values:raise ValueError('LAN 接口没有 IPv4 地址')
    return str(ipaddress.IPv4Address(values[0]['address']))

def api_settings():
    root=pathlib.Path('/etc/sb-router')
    try:return json.loads((root/'active.json').read_text()).get('experimental',{}).get('clash_api',{})
    except (OSError,ValueError):return {}

def api_secret():
    value=api_settings().get('secret')
    if value is not None:return value
    try:return pathlib.Path('/etc/sb-router/token').read_text().strip()
    except OSError:return ''

def api_url(path=''):
    value=api_settings().get('external_controller','')
    try:port=int(value.rsplit(':',1)[1])
    except (ValueError,IndexError):port=9090
    return 'http://'+lan_address()+':'+str(port)+path
