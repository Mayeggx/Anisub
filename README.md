# Anisub

## Seed Download (Anisubroid Compatible)

Anisub now includes a Seed Download page compatible with the Anisubroid seed-sync format.

- Sync file: `seed-subscriptions.json` at repository root.
- Supported pull formats:
  - `{ "entries": [{ "url": "..." }] }`
  - `{ "urls": [{ "url": "..." }] }`
  - JSON array of strings or objects with `url`.
- Uses the same remote-sync repo/config base:
  - `./.anisub/remote-sync/repo-a`
  - `./.anisub/remote-sync/config.json`
- Network robustness:
  - request timeout + retry
  - nyaa mirror fallback
  - clearer error messages instead of generic `fetch failed`.

UI update for subscription cards:
- removed `Local status: Not downloaded`
- removed `View Entries` button
- subscription URL is highlighted and clickable (opens in a new tab).

Anisub 是一个基于 TypeScript 的本地桌面工具（Web UI + 本地 API），目前包含三大核心功能：

1. 字幕匹配：扫描视频目录并从字幕站点匹配下载字幕
2. 单词摘记：加载截图，调用大模型生成词条并写入 Anki
3. 远程同步：将本地素材按条目同步到远程 Git 仓库

## 功能概览

### 1) 字幕匹配

- 扫描本地视频文件夹
- 支持 `Jimaku` / `EdaTribe` 两种字幕源
- 支持 `auto`（自动下载）和 `candidate`（候选确认）两种模式
- 支持“批量匹配未添加项”（自动模式，跳过已有字幕条目）
- 支持单条/批量字幕时间偏移（毫秒）
- 支持“匹配标记”
- 支持查看匹配日志
- 新增：批量匹配/批量偏移支持“中断批量任务”按钮，可中途打断

### 2) 单词摘记

- 选择图片文件夹并加载图片列表
- 文件名（去扩展名）作为字幕句子
- 每条可输入目标单词后创建 Anki 卡片
- 支持勾选后批量添加
- 已添加条目显示状态
- 摘记结果写入 `./.anisub/word-note-log.md`
- 支持一键打开配置文件与日志文件

### 3) 远程同步（Git）

- 侧栏“远程同步”页面
- 支持配置远程仓库、账号 Token、提交作者、图片压缩参数
- 支持新建条目（绑定当前设备 + 本地文件夹）
- 支持 `Pull`、`Push`、`清空`、`删除`、`刷新列表`
- 支持 Git 操作日志查看与清空
- `Push` 支持图片转 JPG 压缩与同名文件跳过

#### 与 Anisubroid 对齐的兼容逻辑（已实现）

1. 远端清空联动：如果其他设备把“本机条目”清空，本机执行 `Pull` 后会自动清空：
   - 本地绑定文件夹内容
   - 本地仓库缓存中的该条目内容
   - 并在列表中显示对应数量为 0

2. 清空删除标记：
   - 清空条目时会生成/更新 `deleted-files.json`（删除标记）
   - 之后 `Push` 会跳过同名相对路径文件（避免被重新上传）
   - 清空时不再删除 `entry.json` 元数据文件

3. 元数据兼容：
   - `entry.json` 读写 `clearedAt`
   - 兼容已有旧数据（无 `clearedAt` 时按 0 处理）

## 配置与日志

首次启动后会自动创建：

- `./.anisub/config.ini`
- `./.anisub/word-card-log.json`
- `./.anisub/word-note-log.md`
- `./.anisub/remote-sync/`

## 运行方式

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
- `server/`：本地 API、字幕匹配、摘记、远程同步
- `shared/`：前后端共享类型
- `.anisub/`：运行时配置与日志

## 当前限制

- 目录选择器与打开配置/日志目前仅支持 Windows
- 远程同步依赖本机已安装并可调用 `git`
- 字幕匹配仍为启发式策略，极端命名场景可能误匹配
