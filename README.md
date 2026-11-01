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
- 勾选更新项，每天 / 每周 / 每月更新；先下载校验，再应用，失败回退。
- TUN auto_route、auto_redirect、strict_route。
- 内核稳定 / 测试通道、官方 / 加速 / 自定义 HTTPS 下载前缀，架构自动识别。
- **本地上传内核**：更新页打开上传窗口，选择官方 .tar.gz 或 Linux sing-box 文件；检查架构、版本、配置兼容性并确认安装，失败回退。上传 SHA-256 用于检查传输一致性，上传者应自行确认来源。
- SagerNet 官方面板、Yacd Meta、MetaCubeXD、Zashboard 和自定义面板。面板仅绑定 LAN，LuCI 一键进入时携带本地密钥。Doona 要求 Honk 原生 API，无法直接用于 sing-box。
- 独立故障保护。持续内部故障约 20–30 秒后停止 TUN，清理本项目接管规则并还原 DNS。公网入站后台独立。保护检查内部链路，不承诺自动修复运营商断线、上游节点故障或设备断电。

## 服务与文件

| 服务 | 用途 |
| --- | --- |
| sb-router | LAN 透明接管，可独立停止 |
| sb-ingress | 配置与代理后台，已有公网入站可独立保留 |
| sb-network-guard | 独立故障保护和 DNS 恢复 |
| sb-panels | LAN 第三方面板 |

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
