# sing-box for OpenWrt v1.10.7

本次为 **v1.10.6 的 iStoreOS / Python 3.10 兼容性修复版**。上一版功能（节点编辑、分享与二维码、多选、流量显示等）保持不变；v1.10.6 的 IPK 外层格式、目录条目与 crontab 初始化修复均已保留，此处不再作为新增。

## 修复

- **SHA-256 分块校验**：用流式分块读取替代 Python 3.11 才提供的 `hashlib.file_digest`，兼容 iStoreOS 自带的 Python 3.10。
- **opkg 依赖检测**：安装脚本与 LuCI 依赖检测都支持 opkg 的 `hold`、`user` 等逗号分隔状态（例如 `Status: install hold,user installed`），不再把已安装依赖误报为缺失；仍拒绝 `reinstreq`、`not-installed` 等异常状态。
- **文档**：README 最低 Python 版本改为 3.10，并补充已验证环境。

## 验证情况（如实记录）

- 已在 iStoreOS 22.03.6、x86_64、Linux 5.10.201、Python 3.10.13 的 N100 / QEMU 环境重装管理包 1.10.7。
- 两项针对性兼容检查通过：分块 SHA-256 校验、opkg 依赖状态识别。
- 使用 `--no-core` 重装，保留原 1.15.0-alpha.13 内核和已安装面板；原节点配置、网络、DHCP/DNS、防火墙和面板设置保持不变。
- 透明代理原本关闭，重装后保持关闭；**未验证该环境下的完整透明代理转发**。

## 升级

- 从 v1.10.6（或更早的 v1.10.x）升级会保留 `/etc/sb-router` 配置、服务器设置与内核；本次仅改核心校验、依赖检测与文档，不改动运行逻辑。

## 安装与校验

一键安装（root）：

~~~sh
if command -v curl >/dev/null 2>&1; then curl -fL --proto '=https' --proto-redir '=https' https://raw.githubusercontent.com/being123321/sing-box-for-openwrt/main/install.sh -o /tmp/install-sb-router.sh; else wget -O /tmp/install-sb-router.sh https://raw.githubusercontent.com/being123321/sing-box-for-openwrt/main/install.sh; fi && sh /tmp/install-sb-router.sh
~~~

发布资产：`luci-app-sb-router.ipk`、`luci-app-sb-router.apk`、`install.sh`、`SHA256SUMS`。安装脚本从本仓库最新 Release 下载匹配包管理器的管理包并校验 SHA-256。
