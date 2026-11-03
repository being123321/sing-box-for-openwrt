#!/bin/sh
set -eu
REPO=being123321/sing-box-for-openwrt
CHANNEL=testing
SOURCE=official
CORE_FILE=
NO_CORE=0
DRY=0
LOCAL_DIR=
DEPS_ONLY=0
CERT_DEPS=0
PROXY_DEPS=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --stable) CHANNEL=stable ;;
        --testing) CHANNEL=testing ;;
        --no-core) NO_CORE=1 ;;
        --core-file) [ "$#" -gt 1 ]; CORE_FILE=$2; shift ;;
        --source) [ "$#" -gt 1 ]; SOURCE=$2; shift ;;
        --local-dir) [ "$#" -gt 1 ]; LOCAL_DIR=$2; shift ;;
        --dry-run) DRY=1 ;;
        --deps-only) DEPS_ONLY=1 ;;
        --with-certificates) CERT_DEPS=1 ;;
        --with-reverse-proxy) PROXY_DEPS=1 ;;
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
repair_official_feeds() {
    board=$(ubus call system board)
    dist=$(echo "$board" | jsonfilter -e '@.release.distribution' | tr 'A-Z' 'a-z')
    ver=$(echo "$board" | jsonfilter -e '@.release.version')
    target=$(echo "$board" | jsonfilter -e '@.release.target')
    echo "$ver" | grep -Eq '^[0-9]{2}\.[0-9]{2}\.[0-9]+$' || { echo "Snapshot feeds cannot be mixed with release feeds."; return 1; }
    case "$dist" in immortalwrt) base=https://downloads.immortalwrt.org ;; openwrt) base=https://downloads.openwrt.org ;; *) echo "Unknown distribution; refusing foreign package feeds."; return 1 ;; esac
    case "$target" in *[!a-zA-Z0-9_/-]*|'') return 1 ;; esac
    if [ "$PM" = apk ]; then
        arch=$(apk --print-arch)
        feed=/etc/apk/repositories.d/sb-router-official.list
        suffix=packages.adb
    else
        arch=$(opkg print-architecture | awk '$2!="all" && $2!="noarch" {print $2}' | tail -n 1)
        feed=/etc/opkg/sb-router-official.conf
        suffix=
    fi
    case "$arch" in *[!a-zA-Z0-9_-]*|'') return 1 ;; esac
    echo "Adding matching official feeds: $dist $ver $target $arch"
    : > "$feed"
    n=0
    for path in "targets/$target/packages" "packages/$arch/base" "packages/$arch/luci" "packages/$arch/packages" "packages/$arch/routing" "packages/$arch/telephony"; do
        n=$((n+1))
        if [ "$PM" = apk ]; then echo "$base/releases/$ver/$path/$suffix" >> "$feed"
        else echo "src/gz sb_router_official_$n $base/releases/$ver/$path" >> "$feed"; fi
    done
    # Keep the exact kmod ABI path already supplied by this firmware.
    if [ "$PM" = apk ]; then
        for original in /etc/apk/repositories.d/*.list; do [ "$original" != "$feed" ] || continue; grep '/kmods/' "$original" 2>/dev/null || true; done | while IFS= read -r line; do
            path=$(echo "$line" | sed -n "s|^https://[^/]*/releases/$ver/targets/$target/kmods/|kmods/|p")
            case "$path" in kmods/*/packages.adb) echo "$base/releases/$ver/targets/$target/$path" >> "$feed" ;; esac
        done
    fi
    chmod 644 "$feed"
}
install_apk_dependencies() {
    plan=$(apk add --simulate $MISSING 2>&1) || { echo "$plan"; return 1; }
    if echo "$plan" | grep -qE '(Installing|Upgrading|Downgrading|Reinstalling) kernel([[:space:]]|$)'; then
        echo "Kernel ABI mismatch. Refusing kernel replacement."
        return 1
    fi
    apk add $MISSING
}
PACKAGES="luci-base python3 python3-yaml curl ca-bundle kmod-tun kmod-nft-queue nftables-json ip-full"
[ "$CERT_DEPS" = 0 ] || PACKAGES="$PACKAGES openssl-util acme-acmesh acme-acmesh-dnsapi"
[ "$PROXY_DEPS" = 0 ] || PACKAGES="$PACKAGES openssl-util haproxy"
MISSING=
for package in $PACKAGES; do
    if [ "$package" = nftables-json ] && command -v nft >/dev/null 2>&1; then continue; fi
    if [ "$PM" = apk ]; then
        apk info -e "$package" >/dev/null 2>&1 && continue
    else
        opkg status "$package" 2>/dev/null | grep -qE '^Status: (install|hold) (ok|user|hold)(,(ok|user|hold))* installed$' && continue
    fi
    MISSING="$MISSING $package"
done
if [ -n "$MISSING" ]; then
    echo "Installing missing dependencies:$MISSING"
    if [ "$PM" = apk ]; then
        apk update || true
        if ! install_apk_dependencies; then repair_official_feeds; apk update || true; install_apk_dependencies; fi
    else
        opkg update || true
        if ! opkg --noaction install $MISSING 2>&1 | grep -qE '(Installing|Upgrading) kernel '; then
            if ! opkg install $MISSING; then
                repair_official_feeds; opkg update || true
                plan=$(opkg --noaction install $MISSING 2>&1 || true)
                echo "$plan" | grep -qE '(Installing|Upgrading) kernel ' && { echo "Kernel ABI mismatch. Refusing kernel replacement."; exit 1; }
                opkg install $MISSING
            fi
        else echo "Kernel ABI mismatch. Refusing kernel replacement."; exit 1; fi
    fi
else echo "All dependencies are installed."; fi
[ "$DEPS_ONLY" = 0 ] || exit 0
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
# IPK payloads use reproducible timestamps; remove generated bytecode so equal-size
# source updates cannot accidentally execute a previous version.
cache=pathlib.Path('/etc/sb-router/__pycache__')
if cache.is_dir():
    for p in cache.glob('*.pyc'):
        if p.is_file():p.unlink()
PY
python3 /etc/sb-router/setup.py init
# Fresh OpenWrt images may not have a root crontab until the first job is saved.
mkdir -p /etc/crontabs
if [ ! -f /etc/crontabs/root ]; then
    (umask 077; : > /etc/crontabs/root)
fi
/etc/sb-router/manage cli migrate-item-updates
/etc/sb-router/manage cli usage-schedule
/etc/sb-router/manage cli refresh-usage
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
