import ipaddress
import json
import subprocess

def lan_address():
    r=subprocess.run(['uci','-q','get','network.lan.ipaddr'],capture_output=True,text=True)
    if r.returncode==0 and r.stdout.strip():
        return str(ipaddress.IPv4Address(r.stdout.split()[0].split('/')[0]))
    r=subprocess.run(['ubus','call','network.interface.lan','status'],capture_output=True,text=True,check=True)
    values=json.loads(r.stdout).get('ipv4-address',[])
    if not values:raise ValueError('LAN 接口没有 IPv4 地址')
    return str(ipaddress.IPv4Address(values[0]['address']))

def api_url(path=''):
    return 'http://'+lan_address()+':9090'+path
