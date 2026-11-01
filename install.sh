#!/bin/sh
set -eu
REPO=being123321/sing-box-for-openwrt
CHANNEL=testing
SOURCE=official
CORE_FILE=
NO_CORE=0
DRY=0
LOCAL_DIR=
while [ "$#" -gt 0 ]; do
    case "$1" in
        --stable) CHANNEL=stable ;;
        --testing) CHANNEL=testing ;;
        --no-core) NO_CORE=1 ;;
        --core-file) [ "$#" -gt 1 ]; CORE_FILE=$2; shift ;;
        --source) [ "$#" -gt 1 ]; SOURCE=$2; shift ;;
        --local-dir) [ "$#" -gt 1 ]; LOCAL_DIR=$2; shift ;;
        --dry-run) DRY=1 ;;
        *) echo "Unknown argument: $1"; exit 2 ;;
    esac
    shift
done
[ "$(uname -s)" = Linux ] && [ -f /etc/openwrt_release ] && [ -x /sbin/procd ] || {
    echo "Only OpenWrt / ImmortalWrt with LuCI and procd is supported."; exit 1;
}
if command -v apk >/dev/null 2>&1; then PM=apk
elif command -v opkg >/dev/null 2>&1; then PM=opkg
else echo "Neither apk nor opkg was found."; exit 1; fi
echo "System: $(ubus call system board 2>/dev/null | jsonfilter -e '@.release.description' || echo OpenWrt)"
echo "CPU: $(uname -m); package manager: $PM; core channel: $CHANNEL"
[ "$DRY" = 0 ] || exit 0
[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
if [ "$PM" = apk ]; then
    apk update
    apk add luci-base python3 python3-yaml curl ca-bundle kmod-tun kmod-nft-queue nftables-json ip-full
else
    opkg update
    opkg install luci-base python3 python3-yaml curl ca-bundle kmod-tun kmod-nft-queue nftables-json ip-full
fi
TMP=$(mktemp -d /tmp/sb-router-install.XXXXXX)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
if [ "$PM" = apk ]; then PACKAGE=luci-app-sb-router.apk
else PACKAGE=luci-app-sb-router.ipk; fi
if [ -n "$LOCAL_DIR" ]; then
    cp "$LOCAL_DIR/$PACKAGE" "$LOCAL_DIR/SHA256SUMS" "$TMP/"
else
    curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 90 \
        "https://api.github.com/repos/$REPO/releases/latest" -o "$TMP/release.json"
    python3 - "$TMP/release.json" "$PACKAGE" >"$TMP/urls" <<'PY'
import json,sys
release=json.load(open(sys.argv[1]))
for name in [sys.argv[2],'SHA256SUMS']:
    asset=next(a for a in release['assets'] if a['name']==name)
    url=asset['browser_download_url']
    if not url.startswith('https://github.com/being123321/sing-box-for-openwrt/releases/download/'):
        raise ValueError('Unexpected release download destination')
    print(url)
PY
    index=0
    while IFS= read -r url; do
        index=$((index+1))
        if [ "$index" = 1 ]; then file=$PACKAGE; else file=SHA256SUMS; fi
        curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 10 --max-time 180 "$url" -o "$TMP/$file"
    done <"$TMP/urls"
fi
python3 - "$TMP" "$PACKAGE" <<'PY'
import hashlib,pathlib,sys
d=pathlib.Path(sys.argv[1]);name=sys.argv[2]
sums={line.split()[1].lstrip('*'):line.split()[0] for line in (d/'SHA256SUMS').read_text().splitlines() if line.strip()}
if hashlib.sha256((d/name).read_bytes()).hexdigest()!=sums.get(name):raise ValueError('Package SHA-256 check failed')
PY
python3 - "$TMP" <<'PY'
import pathlib,shutil,sys
d=pathlib.Path(sys.argv[1])/'panels-backup';d.mkdir()
for name in ('ui','panels'):
    src=pathlib.Path('/etc/sb-router')/name
    if src.is_dir():shutil.copytree(src,d/name)
PY
if [ "$PM" = apk ]; then apk add --allow-untrusted "$TMP/$PACKAGE"
else opkg install "$TMP/$PACKAGE"; fi
python3 - "$TMP" <<'PY'
import pathlib,shutil,sys
d=pathlib.Path(sys.argv[1])/'panels-backup'
for src in d.iterdir():
    shutil.copytree(src,pathlib.Path('/etc/sb-router')/src.name,dirs_exist_ok=True)
PY
python3 - <<'PY'
import pathlib
for base in ('/etc/sb-router','/etc/init.d','/usr/libexec/rpcd','/www/luci-static/resources/view/sb-router'):
    for p in pathlib.Path(base).glob('*.apk-new'):
        target=p.with_name(p.name[:-8])
        if base=='/etc/init.d' and not target.name.startswith('sb-'):continue
        if base=='/usr/libexec/rpcd' and target.name!='luci.sbrouter':continue
        p.replace(target)
PY
python3 /etc/sb-router/setup.py init
if [ "$NO_CORE" = 0 ]; then
    if [ -n "$CORE_FILE" ]; then
        cp "$CORE_FILE" /tmp/sb-router-core-upload
        python3 - <<'PY'
import hashlib,pathlib,sys
sys.path.insert(0,'/etc/sb-router')
from core_update import handle
digest=hashlib.sha256(pathlib.Path('/tmp/sb-router-core-upload').read_bytes()).hexdigest()
args={'mode':'upload-check','sha256':digest}
checked=handle(args)
print(handle(dict(args,mode='upload-install',version=checked['latest']))['message'])
PY
    else
        python3 /etc/sb-router/core_update.py ensure "$CHANNEL" "$SOURCE"
    fi
fi
python3 /etc/sb-router/setup.py panels || echo "Panel download incomplete. Retry: python3 /etc/sb-router/setup.py panels"
/etc/init.d/sb-network-guard enable
/etc/init.d/sb-network-guard restart
/etc/init.d/sb-ingress enable
/etc/init.d/sb-core-guard enable
/etc/init.d/sb-panels enable
/etc/init.d/sb-panels restart
rm -f /tmp/luci-indexcache.*
/etc/init.d/rpcd restart
echo "Installation complete. Open LuCI > Services > sing-box."
echo "No automatic LAN takeover. Import and apply your configuration, then click Start."
