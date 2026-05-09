# Anisub

Anisub 是一个电脑端本地工具，用 TypeScript 实现字幕匹配逻辑，并启动一个本地网页前端完成交互。

当前已实现：

- 扫描本地文件夹中的视频文件
- 复用 Anisubroid 的字幕命名启发式解析
- 支持 `Jimaku` / `EdaTribe` 两种字幕来源
- 支持两种匹配模式：
  - `自动下载`：直接匹配并保存字幕
  - `候选确认`：先列出候选字幕，再手动选择下载
- 字幕保存到视频目录下的 `sub/` 文件夹，并使用“视频同名 + 实际字幕后缀”的命名策略
- 本地匹配日志持久化保存
- Windows 下可直接弹出本地文件夹选择器

## 运行

安装依赖：

```powershell
npm install
```

开发模式启动：

```powershell
npm run dev
```

启动后：

- 前端页面：`http://localhost:5173`
- 本地 API：`http://localhost:8787`

生产构建：

```powershell
npm run build
```

运行构建结果：

```powershell
npm start
```

## 使用流程

1. 点击“选择文件夹”，选中你的视频目录
2. 点击“扫描”
3. 选择字幕来源：
   - `Jimaku`
   - `EdaTribe`
4. 选择模式：
   - `自动下载`
   - `候选确认`
5. 对某个视频点击“匹配并下载字幕”或“查找候选字幕”

## 目录结构

- `server/`：本地 API、文件扫描、字幕匹配与下载
- `src/`：网页前端
- `shared/`：前后端共享类型

## 已验证

已完成真实联调验证：

- 测试文件名：
  - `[ASW] Awajima Hyakkei - 02 [1080p HEVC][A19228D7].mkv`
- 通过 `Jimaku` 成功匹配并下载：
  - `[KitaujiSub] Awajima Hyakkei [02][WebRip][HEVC_AAC][CHS, JPN].ass`
- 保存路径：
  - `sub/[ASW] Awajima Hyakkei - 02 [1080p HEVC][A19228D7].ass`

## 当前限制

- 仍然是启发式匹配，极端命名场景可能误匹配
- 目前目录选择器仅直接支持 Windows
- 前端暂未加入视频播放、批量任务队列等能力
