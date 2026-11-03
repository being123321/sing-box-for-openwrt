# sing-box for openwrt

OpenWrt / ImmortalWrt 的 sing-box LuCI 管理界面。管理包不包含内核、个人节点、订阅、密码或证书。

- 本项目：https://github.com/being123321/sing-box-for-openwrt
- 上游内核：https://github.com/SagerNet/sing-box
- 上游文档：https://sing-box.sagernet.org/
- 官方面板：https://github.com/SagerNet/sing-box-dashboard

## 一键安装

在路由器 SSH 中以 root 执行：

~~~sh
curl -fL --proto '=https' --proto-redir '=https' https://raw.githubusercontent.com/being123321/sing-box-for-openwrt/main/install.sh -o /tmp/install-sb-router.sh && sh /tmp/install-sb-router.sh
~~~

脚本识别 OpenWrt / ImmortalWrt、APK / IPK 包管理器和 LAN 地址。内核下载器根据用户空间 ABI、CPU 架构和 musl 选择官方文件，并核验官方 SHA-256。默认最新测试版，稳定版加 --stable。没有官方适配包的架构会明确报错。

需要支持 nftables 的较新 OpenWrt，内核应具备 TUN / nft queue。LuCI、Python 3.11+、curl 等依赖由当前系统仓库安装。旧版不支持的依赖、内核模块不匹配会停止安装。不会跨版本升级路由器系统或 Linux 内核。目前真机验证为 ImmortalWrt 25.12 x86_64 musl；其他架构尚未逐一真机验证。

| 系统架构 | 识别与下载 |
| --- | --- |
| x86_64 / AMD64 | amd64，musl 使用 amd64-musl |
| i386 / i686 | 386，musl 使用 386-musl |
| aarch64 / ARM64 | arm64，musl 使用 arm64-musl |
| ARMv7 / ARMv6 / ARMv5 | 按用户空间 ABI 选择官方 ARM 包 |
| MIPS / MIPSEL / MIPS64 | 区分字节序和 soft-float，检查官方资产是否存在 |
| RISC-V 64 / LoongArch 64 | riscv64-musl / loong64-musl |
| PPC64LE / S390X | 检查对应官方 Linux 资产 |

管理包所有架构通用，内核文件分别下载。匹配以当前发行版官方资产为准，架构无匹配文件时安全停止；下载之后还会执行版本和配置兼容性检查。

~~~sh
sh /tmp/install-sb-router.sh --dry-run
sh /tmp/install-sb-router.sh --stable
sh /tmp/install-sb-router.sh --no-core
sh /tmp/install-sb-router.sh --core-file /tmp/sing-box.tar.gz
sh /tmp/install-sb-router.sh --source https://ghfast.top/
~~~

手动安装：在 Releases 下载适合包管理器的 .apk（OpenWrt 安装包，与 Android 无关）或 .ipk。推荐运行脚本，它还会初始化缺失状态、下载面板和启用故障保护。安装完成后进入 **服务 → sing-box**。

首次安装不接管网络。先导入、应用配置，再点击运行。升级保留配置和内核；默认会检查所选内核通道。已有其他透明代理时应先处理冲突，本项目不会擅自卸载它们。

## 功能

- 运行、停止、开机启动；基础配置选择 GFW 或绕过中国大陆 IP。
- 手动添加节点、链接导入、本地上传；自动识别 sing-box JSON、Clash YAML、URI / Base64 节点列表。
- 远程配置可编辑来源链接，本地 JSON 可编辑。订阅来源独立排列，节点可编辑删除、测速排序。
- 导入链接时为每个订阅 / 配置单独设置每天、每周或每月更新；可在该来源的编辑窗口修改。先下载校验，再应用，失败回退。
- TUN auto_route、auto_redirect、strict_route。
- 内核稳定 / 测试通道、官方 / 加速 / 自定义 HTTPS 下载前缀，架构自动识别。
- **本地上传内核**：更新页打开上传窗口，选择官方 .tar.gz 或 Linux sing-box 文件；检查架构、版本、配置兼容性并确认安装，失败回退。上传 SHA-256 用于检查传输一致性，上传者应自行确认来源。
- SagerNet 官方面板、Yacd Meta、MetaCubeXD、Zashboard 和自定义面板。面板仅绑定 LAN，LuCI 一键进入时携带本地密钥。Doona 要求 Honk 原生 API，无法直接用于 sing-box。
- 独立故障保护。持续内部故障约 20–30 秒后停止 TUN，清理本项目接管规则并还原 DNS。公网入站后台独立。保护检查内部链路，不承诺自动修复运营商断线、上游节点故障或设备断电。
- **概览资源**：本次总上传、本次总下载（sing-box 内核累计，重启清零）、系统内存和系统磁盘占用；同时显示运行时长与进程启停、异常退出记录。
- **订阅余量**：配置名称下方小字显示剩余流量和套餐期限，没有数据时隐藏。来源为订阅响应头或策略组文字；运行时每 5 分钟本地提取，停止后保留最后一次结果。
- **网站检测**：经路由器当前配置检测国内外 7 个常用站点，显示耗时、HTTP 异常或连接失败，结果带检测时间和配置名称。
- **服务端菜单**：管理 Hysteria2、VLESS / Reality、Shadowsocks、Trojan、TUIC、AnyTLS、VMess 等服务端入站，可生成分享链接并自动放行防火墙端口。
- **证书与反向代理**：扫描本机证书、用 Cloudflare DNS 验证申请证书，以及为内网应用配置 HTTPS 反向代理。
- **节点与进程**：长按多选、拖放复制、批量删除；后台与 TUN 独立监护，异常退出最多自动重启 3 次，失败后锁定等待手动处理。
- **分享**：节点可生成分享链接和二维码，配置可分享订阅链接、全部节点链接、Base64 订阅文本和完整 JSON（可复制、下载 .json），服务端分享同样显示二维码；节点与配置的编辑窗口内也能直接分享。
- **选择状态**：节点多选状态按配置保存到路由器，刷新页面、切换标签或展开其他配置后自动恢复，清空选择会同步清除。
- **节点编辑**：本地节点直接保存；订阅和远程配置只改「跳过证书验证」时保留原名并持续生效，修改其他参数则生成带「本地修改」后缀的受保护副本，原节点继续随来源更新。

## 服务器菜单

服务器菜单自动显示已有和新增的 sing-box 服务端入站，并检查后台实际监听端口。可以添加、编辑、启用、停用和删除单个服务端。表单支持 Hysteria2、VLESS / Reality、Shadowsocks、Trojan、TUIC、AnyTLS、VMess、SOCKS、HTTP、Mixed；高级 JSON 支持自定义协议参数、传输和 ACME。

可以生成密码、UUID、Reality 密钥。新服务默认仅监听本机，可自行改为 LAN / 全地址。非本机 SOCKS / HTTP 不允许空认证。公网访问需自行在防火墙放行端口。本菜单不安装其他代理内核，也不扫描其他 VPS。

服务器设置独立保存在 /etc/sb-router/servers.json。客户端订阅更新不会覆盖它，关闭透明接管也不会关闭服务端后台。保存前校验，应用失败恢复旧服务器设置和旧运行配置。后台内部管理端口显示为系统保留，防止误删影响 DNS、面板和网络保护。

## 自动依赖安装

安装脚本自动识别 APK / IPK，只安装缺少的依赖。手动安装管理包后，设置页可以检查和补齐依赖；开启透明接管前也会自动检查。支持单独执行：

~~~sh
sh /etc/sb-router/install-helper.sh --deps-only
~~~

内核模块只能来自当前系统匹配的软件源，安装失败会报错，不会强制升级 Linux 内核。

## 服务与文件

| 服务 | 用途 |
| --- | --- |
| sb-router | LAN 透明接管，可独立停止 |
| sb-ingress | 配置与代理后台，已有公网入站可独立保留 |
| sb-network-guard | 独立故障保护和 DNS 恢复 |
| sb-core-guard | 后台与 TUN 工作进程监护，异常退出自动恢复 |
| sb-panels | LAN 第三方面板 |
| sb-reverse-proxy | 网站反向代理前端，按需启用 |

数据保存在 /etc/sb-router，由安装时生成。不要提交其中的运行配置、令牌、订阅或证书。可选额外入站配置放在 /etc/sb-router/ingress-extra.json，必须使用独立标签并验证路由。

## 构建

~~~sh
python3 tests/test_source.py
python3 scripts/build.py
python3 scripts/build.py --apk-tool /sbin/apk
~~~

APK / IPK 为架构无关管理包，不含内核。APK 构建需要支持 mkpkg 的 apk-tools v3。推送 v* 标签或手动运行 Actions，可发布安装包、脚本和 SHA256SUMS。

## 上游与许可

本项目是独立管理界面，并非 SagerNet 官方 OpenWrt 客户端。GPL-3.0-or-later。内核及面板资源在安装时从上游下载，遵循各项目许可证：

- https://github.com/SagerNet/sing-box
- https://github.com/SagerNet/sing-box-dashboard
- https://github.com/MetaCubeX/Yacd-meta
- https://github.com/MetaCubeX/metacubexd
- https://github.com/Zephyruso/zashboard

## 证书与反向代理

证书管理可以扫描本机证书及匹配私钥，显示域名和到期时间，也可以直接使用已有证书。申请新证书使用 Cloudflare DNS 验证：填写域名、邮箱、该区域 DNS API 令牌并确认 CA 条款；无需开放 80 / 443。成功后自动安排续期，证书私钥不返回网页；未提供实际域名和令牌时不会自动发起签发。首次使用会自动补齐 acme / openssl 依赖。

反向代理填写域名、目标 HTTP / HTTPS 地址和证书即可，支持 WebSocket、HTTPS 和自动防火墙。本机已有受支持的 api-gw-https 入口时自动按 SNI 复用 443，保留原应用；其他端口冲突会回退并报错。证书续期会重载使用该证书的服务。

## 更新记录

### v1.10.4

- 本地节点（手动节点、本地配置里的节点）直接修改保存，重名会被拒绝。
- 订阅和远程配置里的节点：只修改「跳过证书验证」（tls.insecure）时原名保存，来源更新后仍保留该设置，其他参数继续跟随来源更新。
- 修改其他参数时生成带「本地修改」后缀的受保护副本，重名自动加序号；原节点继续随来源更新。
- 受保护副本不受「更新时允许覆盖拖入的节点」影响，可继续编辑、单独或批量删除，刷新后不会重新出现。
- 保存后弹窗显示实际节点名称，并说明本次修改是否会被来源更新覆盖。
- 节点表单只提交改动字段，保留未修改的高级参数（Reality、uTLS、ALPN、传输头等）。
- 自动迁移可识别的旧「仅证书验证」整节点覆盖设置，迁移在下次更新前完成。

### v1.10.3

- 节点新增「分享」，生成 vless / vmess / trojan / shadowsocks / hysteria2 / tuic / anytls / socks / http 链接并显示二维码；节点编辑窗口内也可分享。
- 配置分享：远程配置分享订阅链接，本地配置分享全部节点链接与 Base64 订阅文本；可查看、复制或下载完整 JSON，内容较短时生成二维码；配置编辑窗口内也可分享。
- 服务端分享链接同时显示二维码；二维码在路由器本机生成，不访问网络。
- 节点多选状态按配置保存，刷新或切换配置后自动恢复。

### v1.10.2（累计 v1.5.1 → v1.10.2）

v1.6–v1.10 的开发成果此前均未发布，以下为相对 v1.5.1 的全部改动。

**概览与订阅余量**

- 概览独立显示本次总上传、本次总下载（sing-box 内核累计，内核重启清零）、系统内存和系统磁盘占用。
- 配置名称下方小字显示剩余流量和套餐期限，没有可识别数据时隐藏。
- 余量优先取自订阅响应头，其次从本地策略组和节点名称文字提取；运行时每 5 分钟提取一次，停止后保留最后一次显示，手动更新订阅会同步刷新。
- 订阅下载等待延长到 180 秒；服务商返回 403 / 429 时保留原配置和上次余量，按 Retry-After 或 10–15 分钟延后重试。
- 进入面板时重新读取实时链接；所选配置未应用时提示先应用，长按设置不会误触发打开。

**服务器菜单**

- 自动发现已有和新增的服务端入站，并核对实际监听端口；可添加、编辑、启用、停用、删除。
- 支持 Hysteria2、VLESS / Reality、Shadowsocks、Trojan、TUIC、AnyTLS、VMess、SOCKS、HTTP、Mixed，高级 JSON 可自定义协议参数、传输和 ACME。
- 可生成密码、UUID 和 Reality 密钥；默认仅监听本机，非本机 SOCKS / HTTP 不允许空认证。
- 服务端设置独立保存，客户端订阅更新和停止透明接管都不影响；应用失败恢复旧设置与旧运行配置。
- 可生成包含认证信息的分享链接，并自动放行所需 WAN 端口；停用、改端口或删除时只清理本功能创建的规则。

**面板**

- 每份配置独立的 Clash API 端口和密钥，缺省读取配置自带的 experimental.clash_api，支持修改和恢复默认。
- 官方 SagerNet 面板使用原生 9091，嵌入概览使用独立 9095，均与当前配置共用密钥；第三方面板使用所选 Clash API 端口。
- 面板选择、自定义名称与地址、连接信息和密钥设置统一收进概览入口的长按 / 右键菜单。

**节点与配置**

- 长按多选、拖放复制、批量删除；复制到其他配置或组时原节点保留，同名自动加后缀。
- 拖入配置前确认覆盖策略，可在配置编辑中修改；不允许覆盖时保留副本。
- 每个订阅 / 远程配置有独立的每天、每周或每月更新计划，也可单独立即更新；下载并校验成功后才应用，失败回退。
- 概览嵌入官方「概述」图表，隐藏导航并自适应高度；运行、配置与网站检测互不影响。

**网站检测**

- 经路由器当前配置检测百度、哔哩哔哩、腾讯、Google、YouTube、GitHub、Cloudflare，显示耗时、HTTP 异常或连接失败；结果带检测时间和配置名称。

**稳定性与安装**

- 后台与 TUN 独立监护：异常退出最多自动重启 3 次，稳定 60 秒后清零；三次失败锁定并恢复 DNS / 直连，需手动启动。
- 安装脚本只安装缺失依赖；失败时按当前发行版、版本和架构补齐官方软件源，保留 kmod ABI 路径，安装前模拟并拒绝替换内核。
- 升级时清理 __pycache__，避免等长源码更新执行旧字节码；日志去除 ANSI 颜色码并使用兼容中文的字体回退。

**升级注意**

- 从 v1.5.1 升级会保留 /etc/sb-router 配置、服务器设置与内核。
- 升级后建议在概览手动重启一次，让新监护器接管已在运行的进程；未运行时下次启动自动使用。
- 旧的统一更新计划会迁移为每个来源的独立策略。
- 首次显示余量需要更新一次订阅或等待本地提取；服务商未提供时不会推测配额。
- 证书、反代所需的 acme-acmesh、haproxy 等依赖按需补齐，不会替换 Linux 内核。
