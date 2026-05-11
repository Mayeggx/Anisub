# Anisub

Anisub 是一个本地桌面工具（Web UI + 本地 API），用于：

1. 字幕匹配与下载
2. 单词摘记并写入 Anki
3. 远程同步（Git）
4. Seed 下载（兼容 Anisubroid 的订阅格式）

## 最近更新（2026-05）

### 字幕页状态展示调整

- 字幕状态文案统一为：`已匹配 / 未匹配`
- 播放状态新增并持久化：`未播放 / 播放过 / 已播放`
- “匹配状态 + 播放状态”在同一组紧凑展示，字幕路径仍在同一行右侧

### mpv 播放状态监控

- 点击播放后：
  - 条目立即标记为 `播放过`（首次播放）
  - 后端启动 mpv 并监听 IPC 事件
- 当 mpv 触发 `end-file` 且 `reason=eof` 时，条目更新为 `已播放`
- 前端会定时轮询后端状态，自动刷新列表

说明：
- 当前播放状态监控仅支持 `mpv`（播放器路径需指向 `mpv.exe`）
- 播放状态持久化文件：`./.anisub/video-playback-status.json`

## 功能概览

### 1) 字幕匹配

- 扫描本地视频目录
- 支持 `Jimaku` / `EdaTribe`
- 支持 `auto`（自动下载）和 `candidate`（候选确认）
- 支持批量匹配未添加项
- 支持单条/批量字幕偏移（毫秒）
- 支持匹配标记（matchTag）
- 支持匹配日志查看
- 批量任务支持中断

### 2) 单词摘记

- 选择图片文件夹并加载图片列表
- 文件名（去扩展名）作为字幕句子
- 每条可输入目标单词后创建 Anki 卡片
- 支持勾选后批量添加
- 已添加状态可回显
- 日志写入 `./.anisub/word-note-log.md`

### 3) 远程同步（Git）

- 配置远程仓库、账号 Token、提交作者、图片压缩参数
- 支持 `Pull / Push / 清空 / 删除 / 刷新`
- 支持 Git 日志查看与清空
- Push 支持图片转 JPG 压缩与重名跳过

### 4) Seed Download（Anisubroid Compatible）

- 同步文件：仓库根目录 `seed-subscriptions.json`
- 支持多种 pull 格式：
  - `{ "entries": [{ "url": "..." }] }`
  - `{ "urls": [{ "url": "..." }] }`
  - 字符串数组或对象数组（含 `url`）
- 复用远程同步配置目录：
  - `./.anisub/remote-sync/repo-a`
  - `./.anisub/remote-sync/config.json`
- 网络增强：超时、重试、nyaa mirror fallback、更明确错误信息

## 运行

安装依赖：

```powershell
npm install
```

开发模式：

```powershell
npm run dev
```

默认地址：

- Web UI: `http://localhost:5173`
- API: `http://localhost:8787`

构建与启动：

```powershell
npm run build
npm start
```

## 目录结构

- `src/`：前端页面
- `server/`：本地 API、字幕匹配、摘记、远程同步、播放状态管理
- `shared/`：前后端共享类型
- `.anisub/`：运行时配置与日志

## 当前限制

- 文件夹选择器与打开本地文件功能目前仅支持 Windows
- 远程同步依赖本机可调用 `git`
- 播放状态监控当前仅支持 `mpv`
- 字幕匹配仍是启发式策略，极端命名场景下可能误匹配
