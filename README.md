# MintGallery

MintGallery 是一个本地优先的私密家庭相册。首个版本支持管理员初始化、家庭成员账号、照片与视频上传、图片缩略图、共享/私密图片墙和受保护的媒体访问。

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

## 数据位置

默认数据保存在项目根目录的 `data/`：

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
- Live Photo 手动配对尚未实现。
- 当前默认只有本地硬盘一个副本。界面显示“仅 1 个副本”时，请勿删除手机中的唯一原件。

详细产品范围见 [prd.md](./prd.md)。
