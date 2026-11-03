# sing-box for OpenWrt v1.10.6

本次为 **v1.10.5 的安装兼容性修复版**。上一版的功能（节点编辑、分享与二维码、多选、流量显示等）保持不变，本说明汇总相对 v1.10.5 的全部改动。

## 修复

- **IPK 外层格式**：继续使用 OpenWrt opkg 要求的 gzip/tar 容器，不使用 Debian ar。
- **data.tar.gz 目录条目**：现在会在每个文件之前显式包含完整的父目录条目，修复全新系统安装时出现的大量 `wfopen: No such file or directory`。
- **crontab 初始化**：首次安装在缺失时创建 `/etc/crontabs/root`，且不覆盖已有计划任务。
- **opkg 依赖检测**：安装脚本和 LuCI 的依赖检测都兼容 opkg 的 `install user installed` 状态，避免把已安装依赖误报为缺失。
- **一键安装命令**：在未预装 curl 的系统上使用 wget 回退。

## 验证情况（如实记录）

- 真实 OpenWrt opkg 隔离测试通过：全新解包、从失败的 1.10.5 升级恢复均正常。
- 已在反馈者的 ImmortalWrt 24.10.2 i686 虚拟机完成安装：管理包 1.10.6，内核为 1.15.0-alpha.13 的 386-musl 版本。
- 该虚拟机 GitHub API 下载失败，内核与官方面板通过离线上传提供；**未声称全流程在线下载已通过**。
- **iStoreOS 尚未实机验证**。

## 升级

- 从 v1.10.5（或更早的 v1.10.x）升级会保留 `/etc/sb-router` 配置、服务器设置与内核；本次仅修正打包目录条目、crontab 初始化与依赖检测，不改动运行逻辑。

## 安装与校验

一键安装（root）：

~~~sh
if command -v curl >/dev/null 2>&1; then curl -fL --proto '=https' --proto-redir '=https' https://raw.githubusercontent.com/being123321/sing-box-for-openwrt/main/install.sh -o /tmp/install-sb-router.sh; else wget -O /tmp/install-sb-router.sh https://raw.githubusercontent.com/being123321/sing-box-for-openwrt/main/install.sh; fi && sh /tmp/install-sb-router.sh
~~~

发布资产：`luci-app-sb-router.ipk`、`luci-app-sb-router.apk`、`install.sh`、`SHA256SUMS`。安装脚本从本仓库最新 Release 下载匹配包管理器的管理包并校验 SHA-256。
