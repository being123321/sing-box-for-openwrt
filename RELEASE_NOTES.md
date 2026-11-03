# sing-box for OpenWrt v1.10.5

本次为 **v1.10.4 的安装修复版**。上一版的功能（节点编辑规则、分享与二维码、多选状态）保持不变，本说明仅列出相对 v1.10.4 的修复。

## 修复

- **IPK 外层格式**：由错误的 Debian ar 容器改为 OpenWrt opkg 要求的 gzip/tar 容器，内层依次为 `debian-binary`、`data.tar.gz`、`control.tar.gz`。旧格式在 opkg 系统上报 `pkg_init_from_file: Malformed package file`，现已修复；APK（apk-tools v3）打包方式不受影响。
- **一键安装命令**：增加 wget 回退，未预装 curl 的系统也能直接运行安装脚本。
- **内核架构识别**：继续按运行系统的用户空间 ABI / CPU 架构识别并下载内核，i686 虚拟机对应 386-musl，不会按物理机 N100 误下载 amd64。

## 验证与说明

- 归档格式检查已通过：IPK 外层 gzip/tar 容器、control 版本、文件权限、payload 与源码一致性均已校验。
- **尚未在反馈者的 opkg 实机（ImmortalWrt 24.10.2 i686 虚拟机）完成实装验证**，请升级后反馈安装结果。
- 管理包不含 sing-box 内核和个人配置；安装脚本自动识别系统、包管理器、架构与依赖。

## 升级

- 从 v1.10.4（或更早的 v1.10.x）升级会保留 `/etc/sb-router` 配置、服务器设置与内核；本次仅修正安装包容器格式与安装命令，不改动运行逻辑。

## 安装与校验

一键安装（root）：

~~~sh
if command -v curl >/dev/null 2>&1; then curl -fL --proto '=https' --proto-redir '=https' https://raw.githubusercontent.com/being123321/sing-box-for-openwrt/main/install.sh -o /tmp/install-sb-router.sh; else wget -O /tmp/install-sb-router.sh https://raw.githubusercontent.com/being123321/sing-box-for-openwrt/main/install.sh; fi && sh /tmp/install-sb-router.sh
~~~

发布资产：`luci-app-sb-router.ipk`、`luci-app-sb-router.apk`、`install.sh`、`SHA256SUMS`。安装脚本从本仓库最新 Release 下载匹配包管理器的管理包并校验 SHA-256。
