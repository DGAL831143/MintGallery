# MintGallery

MintGallery 是一个本地优先的私密家庭相册。当前版本支持管理员初始化、家庭成员账号、普通照片与视频上传、手动配对 Live Photo、外部文件夹扫描导入、重复项确认、按拍摄时间浏览、照片墙密度切换、快速筛选、最近导入、待整理入口、标签、批量标签、收藏、最近删除、防窥隐私照片、照片信息面板、共享/私密图片墙、个人文件夹、受保护的媒体访问，以及 Tailscale 私有访问的自动启动与健康检查。

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
.\scripts\start-private.ps1 -DataDirectory 'F:\MintGallery\data'
```

另一个管理员终端配置持久的 tailnet HTTPS 代理：

```powershell
tailscale serve --bg 3000
tailscale serve status
```

浏览器使用 Tailscale 返回的 `https://<设备名>.<tailnet>.ts.net/` 地址。只有已加入同一 tailnet 的设备可以访问；电脑必须保持开机、联网，并禁止自动休眠。

`start-private.ps1` 默认启用 Secure Cookie、只监听 `127.0.0.1`，并拒绝把数据目录放在 Git 仓库内部。`-AllowInsecureHttp` 只允许用于临时诊断。

在“以管理员身份运行”的 Windows PowerShell 中可注册开机启动任务；任务以 Windows `SYSTEM` 账号运行，不需要保存登录密码：

```powershell
.\scripts\install-startup-task.ps1 `
  -DataDirectory 'F:\MintGallery\data' `
  -NodePath 'F:\nodejs\node.exe'
```

安装脚本会注册两个任务：

- `MintGallery`：开机和登录时启动生产服务；如果 Node 进程退出，运行脚本会自动拉起。
- `MintGallery HealthCheck`：每 3 分钟检查 `http://127.0.0.1:3000/api/health`、Tailscale 后端状态和 Tailscale Serve 代理；发现服务不可用时会重启任务，发现 Serve 配置漂移时会恢复到 `127.0.0.1:3000`，发现 Tailscale 卡在 `NoState/starting` 时会尝试重启 Tailscale 服务。

运行日志保存在 `F:\MintGallery\logs\scheduled-server.log`，健康检查日志保存在 `F:\MintGallery\logs\health-check.log`。日常手动启动或修复时运行：

```powershell
.\scripts\start-mintgallery-service.ps1
```

需要输出完整 JSON 诊断时可运行：

```powershell
.\scripts\start-mintgallery-service.ps1 -Json
```

日常启动优先使用任务计划：确认 `MintGallery` 和 `MintGallery HealthCheck` 存在后，只需要保持电脑开机、联网、Tailscale 已登录。网站打不开时先运行上面的启动脚本；如果返回 `HealthOk=true` 但 `TailscaleBackendState=NoState` 且无法自动恢复，请以管理员身份重启 Tailscale 服务或重启电脑。

## GitHub Pages 静态预览

每次推送 `main` 分支后，GitHub Actions 会自动更新静态预览：

[https://dgal831143.github.io/MintGallery/](https://dgal831143.github.io/MintGallery/)

该页面只展示仓库内的示例图片和基础查看器，不连接家庭电脑，不包含真实照片、账号、上传功能或 SQLite 数据库。完整相册仍需运行 Fastify 后端，GitHub Pages 不能替代家庭服务器。

## 数据位置

开发环境默认把数据保存在项目根目录的 `data/`。当前 Tailscale 生产数据位于 `F:\MintGallery\data`：

```text
F:\MintGallery\data\
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

## 外部文件夹导入

管理员可在“相册管理”中输入家用电脑上的绝对文件夹路径，例如 `F:\MintGallery\incoming-test`，扫描后再确认导入。

- 扫描只读取外部文件夹，不会移动、重命名或删除源文件。
- 导入时会把选中的文件复制到 `F:\MintGallery\data` 下，再走与网页上传一致的格式校验、哈希记录和派生文件生成流程。
- 不能扫描 `F:\MintGallery\data` 本身，也不能扫描包含该数据目录的父目录，避免把已入库媒体重复导入。
- 支持 JPEG、PNG、WebP、HEIC/HEIF、MP4 和 MOV；真实格式以服务端检测结果为准，不只看扩展名。
- 同一文件夹内同名 `HEIC/HEIF/JPEG + MOV` 会被识别为一个 Live Photo 候选；多个同名图片或多个同名 MOV 时会降级为普通候选并提示跳过原因。
- 重复项按 SHA-256 辅助识别，默认不导入；需要保留副本时必须手动勾选重复项并允许导入重复项。

## 个人文件夹

登录后可通过照片墙上方的文件夹栏创建个人文件夹。点击右上角的选择图标，勾选照片或视频后使用底部的“加入文件夹”完成批量归类；在某个文件夹内可批量移出项目。

文件夹是保存在 SQLite 中的个人逻辑分类：

- 不会移动、重命名或复制 `originals/` 下的原始文件。
- 同一照片可以加入多个文件夹。
- 删除文件夹只删除分类关系，照片仍保留在“全部照片”中。
- 每个账号只能看到自己的文件夹，但可以归类当前有权查看的家庭共享内容和本人私密内容。

## 时间轴

登录后默认进入时间轴，照片按拍摄月份分段并按拍摄时间倒序排列。照片缺少可读取的 EXIF 拍摄时间时，系统使用上传时间作为兜底，不会因此拒绝上传。

- 桌面端可通过左侧图库栏切换时间轴、照片墙、文件夹和月份。
- 手机端可通过横向文件夹栏、视图切换和月份选择器浏览。
- 时间轴和月份筛选继续遵守“家庭共享”“仅自己可见”和个人文件夹权限。
- v0.5.0 启动时会为既有图片和 Live Photo 补录可读取的拍摄时间，只更新 SQLite，不会改写或移动原件。

## 浏览整理

照片墙提供大图、标准和紧凑三种密度。手机端的大图为单列，标准为两列，紧凑为三列；电脑端会按窗口宽度自动排布。

快速筛选入口位于相册标题下方：

- 媒体类型：全部、照片、视频、实况。
- 整理状态：全部、最近导入、待整理、防窥。
- “最近导入”按上传或外部导入时间倒序显示，不改变时间轴继续按拍摄时间展示的原则。
- “待整理”表示还没有设置标签的项目，适合集中补标签、收藏或加入文件夹。

## 标签、收藏、最近删除与防窥照片

相册顶部提供搜索入口，可在当前“家庭共享/仅自己可见”、文件夹和月份筛选范围内搜索标签、上传者和媒体类型（照片、视频、实况）。原始上传文件名仍会作为技术元数据保留，但不再作为主要展示名称。

打开照片查看器后，标题和信息面板优先展示用户设置的标签；没有标签时显示“未设置标签”。上传者或管理员可以在信息面板中编辑标签，并修改“家庭共享/仅自己可见”和“设为防窥/取消防窥”；选择模式下也支持批量覆盖所选项目的标签。

收藏是家庭共同收藏：已登录且有权查看照片的成员可以点亮星标，收藏后的内容会出现在“收藏”入口中。收藏不会改变照片的可见范围。

“最近删除”是软删除：上传者或管理员把照片移入最近删除后，普通图库、时间轴、文件夹和搜索结果不再显示该项目；原始文件仍保留在 `F:\MintGallery\data` 中，可从最近删除恢复。本版本暂不提供永久删除原文件。

防窥照片用于防止旁人从照片墙、时间轴或搜索结果中瞥到内容，不等同于访问权限：

- 外层卡片显示模糊/马赛克遮挡和“防窥”标识。
- 点击进入查看器后仍先显示遮挡层，需要再点“查看原图”才显示清晰预览或播放实况。
- 关闭查看器或切换到其他照片后，防窥照片会重新回到遮挡状态。
- 谁能访问照片仍由“家庭共享/仅自己可见”决定；防窥只改变展示方式。

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

图片墙会显示 `LIVE` 标识。在全屏查看器中，桌面端悬停、手机端长按或点击“播放实况”后才会请求动态文件。服务端保留原始 MOV，并使用项目自带的 FFmpeg 生成适合远程播放的 H.264 MP4；生成失败时静态图片和两份原件仍可使用。

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

- 普通照片和视频使用 tus 按 1 MB 分片上传；网络中断后自动重试，并从服务端已确认的偏移继续。
- 单文件上限为 2 GB；Live Photo 双文件入口暂时仍使用一次性上传，不具备断点续传。
- 支持 JPEG、PNG、WebP、HEIC/HEIF、MP4 和 MOV；HEIC 是否能生成预览取决于本机 Sharp/libvips 能力，原件不会丢失。
- 普通视频保持原始格式；Live Photo 额外生成最长边不超过 1280 px 的 H.264 MP4 网页派生文件，原始 MOV 不被覆盖。
- Live Photo 已支持手动选择同名图片与 MOV 配对上传；暂不支持从 iPhone 相册自动提取双文件。
- 已支持拍摄时间提取、按月时间轴、月份筛选、照片墙密度切换和桌面/手机响应式浏览；缺少拍摄时间时使用上传时间。
- 个人文件夹支持批量加入、移出和筛选；外部文件夹扫描导入支持重复项确认和同名 Live Photo 候选配对。
- 已支持媒体类型快速筛选、最近导入、待整理、防窥筛选、标签、批量标签、收藏、最近删除、当前范围内搜索、照片信息面板、防窥遮挡，以及单张/批量修改防窥状态和可见范围。
- Windows 生产部署支持开机/登录启动、Node 退出自动拉起、周期健康检查和 Tailscale Serve 配置自愈；电脑关机、休眠、断网或 Tailscale 客户端离线时仍无法访问。
- 当前默认只有本地硬盘一个副本。界面显示“仅 1 个副本”时，请勿删除手机中的唯一原件。

详细产品范围见 [prd.md](./prd.md)。
