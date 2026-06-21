# MintGallery

MintGallery 是一个本地优先的私密家庭相册。当前版本支持管理员初始化、家庭成员账号、普通照片与视频上传、手动配对 Live Photo、图片缩略图、共享/私密图片墙和受保护的媒体访问。

## 运行环境

- Windows、macOS 或 Linux
- Node.js 24 或更高版本
- npm 11 或更高版本

## 第一次启动

在项目目录运行：

```powershell
npm install
npm run dev
```

浏览器打开 [http://localhost:5173](http://localhost:5173)，按照页面提示创建第一个管理员账号。

如果 npm 报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，可以让 Node 使用 Windows 已信任的系统证书链：

```powershell
$env:NODE_OPTIONS='--use-system-ca'
npm install
```

## 手机局域网访问

开发服务器启动后会显示类似 `http://192.168.x.x:5173` 的地址。同一家庭网络中的手机可以打开该地址。Windows 第一次运行时可能会询问是否允许局域网访问 Node.js，应只允许可信的家庭网络。

首个版本没有公网 HTTPS 防护，不要把该端口直接暴露到互联网。

## Tailscale 私有访问

生产访问由 Fastify 同时提供 Vue 页面和 API，再通过 Tailscale Serve 暴露给同一 tailnet 中的设备。不要使用 GitHub Pages 承担登录、上传或媒体访问。

首次使用时，在 Tailscale 管理后台的 DNS 页面启用 HTTPS Certificates，然后运行：

```powershell
.\scripts\start-private.ps1 -DataDirectory 'G:\MintGalleryData'
```

另一个管理员终端配置持久的 tailnet HTTPS 代理：

```powershell
tailscale serve --bg 3000
tailscale serve status
```

浏览器使用 Tailscale 返回的 `https://<设备名>.<tailnet>.ts.net/` 地址。只有已加入同一 tailnet 的设备可以访问；电脑必须保持开机、联网，并禁止自动休眠。

`start-private.ps1` 默认启用 Secure Cookie、只监听 `127.0.0.1`，并拒绝把数据目录放在 Git 仓库内部。`-AllowInsecureHttp` 只允许用于临时诊断。

## GitHub Pages 静态预览

每次推送 `main` 分支后，GitHub Actions 会自动更新静态预览：

[https://dgal831143.github.io/MintGallery/](https://dgal831143.github.io/MintGallery/)

该页面只展示仓库内的示例图片和基础查看器，不连接家庭电脑，不包含真实照片、账号、上传功能或 SQLite 数据库。完整相册仍需运行 Fastify 后端，GitHub Pages 不能替代家庭服务器。

## 数据位置

开发环境默认把数据保存在项目根目录的 `data/`。Tailscale 生产运行必须通过 `-DataDirectory` 指向项目外的独立目录：

```text
data/
  originals/     原始照片和视频
  derivatives/   WebP 缩略图和预览图
  temporary/     上传临时文件
  database/      SQLite 数据库
```

可以通过环境变量修改位置：

```powershell
$env:MINTGALLERY_DATA_DIR='D:\MintGalleryData'
npm run dev
```

`data/`、数据库和环境变量文件已被 Git 忽略。不要把家庭照片提交到 GitHub。

不要把正在使用的 SQLite 数据库直接放入同步网盘。网盘只作为后续备份或通过独立存储适配器接入。

## 实况照片格式与上传

一个完整的 Live Photo 必须包含两个原始文件：

```text
IMG_1234.HEIC + IMG_1234.MOV   推荐
IMG_1234.JPG  + IMG_1234.MOV   支持
```

- 静态图片仅支持 HEIC、HEIF、JPG 或 JPEG。
- 动态文件必须是 QuickTime MOV，不能使用普通 MP4 代替。
- 两个文件必须来自同一张实况照片，并保留相同主文件名。
- 应使用能够保留“未修改原片”的导出方式。导出后必须能实际看到图片和 MOV 两个文件；如果只有一张图片，动态部分已经缺失。
- 手机网页的照片选择器可能只提供静态图。建议先把原始文件对保存到“文件”应用或通过电脑导出，再从 MintGallery 的“上传 > 实况照片”中同时选择两个文件。

上传成功后，两份原件会保存在同一个资产目录中，例如：

```text
data/originals/{用户ID}/{年份}/{月份}/{资产ID}/original.heic
data/originals/{用户ID}/{年份}/{月份}/{资产ID}/original.mov
```

图片墙会显示 `LIVE` 标识。在全屏查看器中，桌面端悬停、手机端长按或点击“播放实况”即可播放 MOV。某些 MOV 使用浏览器不支持的编码时，静态图片仍可查看，两份原件也仍会完整保存。

## 常用命令

```powershell
npm run dev        # 启动前端和后端开发服务
npm test           # 运行自动化测试
npm run typecheck  # 检查 TypeScript
npm run build      # 生成生产构建
```

生产构建后可启动单一服务：

```powershell
npm run build
npm run start -w @mintgallery/server
```

然后打开 [http://localhost:3000](http://localhost:3000)。

## 当前版本边界

- 单文件上限为 2 GB，尚未实现 tus 断点续传。
- 支持 JPEG、PNG、WebP、HEIC/HEIF、MP4 和 MOV；HEIC 是否能生成预览取决于本机 Sharp/libvips 能力，原件不会丢失。
- 视频保持原始格式，不转码；浏览器不支持的 MOV 可能只能打开或下载。
- Live Photo 已支持手动选择同名图片与 MOV 配对上传；暂不支持从 iPhone 相册自动提取双文件。
- Live Photo 上传体验优化暂缓，当前优先保证普通图片和视频在 Tailscale 私有网络内上传。
- 当前默认只有本地硬盘一个副本。界面显示“仅 1 个副本”时，请勿删除手机中的唯一原件。

详细产品范围见 [prd.md](./prd.md)。
