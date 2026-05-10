# Anisub

Anisub 是一个基于 TypeScript 的本地桌面工具（Web UI + 本地 API），目前包含三个核心功能：
1. 字幕匹配：扫描视频目录并从字幕站点匹配下载字幕
2. 单词摘记：加载字幕截图，调用大模型生成词条信息，并写入 Anki
3. 远程同步：将本地摘记素材按条目同步到远程 Git 仓库

## 功能概览

### 1) 字幕匹配

- 扫描本地视频文件夹
- 支持 `Jimaku` / `EdaTribe` 两种字幕来源
- 支持两种模式：
  - `auto`：自动匹配并下载
  - `candidate`：先展示候选字幕，手动确认后下载
- 支持“批量匹配未添加项”（自动模式，跳过已有字幕条目）
- 字幕保存到视频目录下 `sub/` 文件夹
- 支持单条/批量字幕时间偏移（毫秒，直接修改 `.srt` / `.ass` 时间字段）
- 支持“匹配标记”：匹配时会使用 `视频名(不含扩展名) + 匹配标记 + 原扩展名` 参与原匹配流程
- 支持匹配日志查看

### 2) 单词摘记（参考 PicSubToAnki）

- 选择图片文件夹并加载全部图片列表
- 使用“文件名（去扩展名）”作为字幕句子
- 每条可输入目标单词后创建 Anki 卡片
- 支持勾选条目后“批量添加”（右下角悬浮按钮）
- 已添加条目会显示“（已添加）”
- 摘记详情不再直接显示在页面上，而是追加写入本地日志文件 `./.anisub/word-note-log.md`
- 单词摘记页面左下角提供“查看日志”悬浮按钮，可直接打开该 `md` 文件
- 图片条目仅显示标题（不再显示第二行灰色字幕信息）
- 配置来自本地 `config.ini`，前端可一键打开配置文件

### 3) 远程同步（Git）

- 左侧栏新增“远程同步”页面
- 顶栏按钮：
  - `图片质量`：设置 Push 前图片缩放比与 JPG 质量
  - `Git配置`：设置远程仓库 URL、用户名、Token、提交作者信息
  - `新建条目`：绑定“当前设备 + 本地文件夹 B”
  - `日志`：查看 Git 操作日志并支持清空
- 页面操作：`Pull`、`刷新列表`
- 条目操作：
  - `Push`：将本地绑定文件夹复制到仓库 A 对应子目录并推送
  - `清空`：清空条目内容并推送（有本地绑定时同时清空本地文件夹内容）
  - `删除`：删除条目目录并推送
  - `摘记`：打开 Anisub 自己的“单词摘记”页面，并自动加载该条目目标文件夹
- `Push` 时支持图片压缩转 JPG 与同名文件跳过（不覆盖）
- 页面会显示当前设备信息、仓库 A 路径、当前 HEAD 摘要和条目文件统计

## 配置与日志文件

首次启动后会自动创建：
- `./.anisub/config.ini`
- `./.anisub/word-card-log.json`（单词摘记“已添加”状态记录）
- `./.anisub/word-note-log.md`（单词摘记结果日志，按时间追加）
- `./.anisub/remote-sync/`（远程同步配置、条目绑定与仓库 A）

其中 `config.ini` 字段与 PicSubToAnki 对齐：

```ini
[openai]
api_key =
base_url = https://dashscope.aliyuncs.com/compatible-mode/v1
model_name = qwen-plus

[anki]
jp_deck = 日本語::アンキヘルパー::テレビアニメーション
en_deck = English Vocabulary::A English Daily
model_name = 划词助手Antimoon模板
word_field = 单词
pronunciation_field = 音标
meaning_field = 释义
note_field = 笔记
example_field = 例句
voice_field = 发音
max_width = 320
max_height = 240
image_quality = 60
```

## 单词摘记写卡流程

1. 调用 LLM 生成结构化词条（单词/音标/释义/例句/笔记）
2. 按 `max_width/max_height/image_quality` 压缩图片并转 JPG
3. 通过 AnkiConnect `storeMediaFile` 上传图片
4. 通过 `findNotes + notesInfo` 查重
5. 已存在则 `updateNoteFields`，否则 `addNote`
6. 将本次结果追加写入 `./.anisub/word-note-log.md`

> 需要本机运行 Anki 且安装并启用 AnkiConnect（默认端口 `8765`）。

## 运行方式

安装依赖：

```powershell
npm install
```

开发模式：

```powershell
npm run dev
```

访问地址：
- Web UI: `http://localhost:5173`
- API: `http://localhost:8787`

构建与启动：

```powershell
npm run build
npm start
```

## 目录结构

- `src/`：前端页面
- `server/`：本地 API、字幕匹配、图片扫描、Anki 制卡、远程同步、日志写入
- `shared/`：前后端共享类型
- `.anisub/`：运行时配置与日志

## 当前限制

- 目录选择器与配置文件/日志打开目前仅支持 Windows
- 远程同步依赖本机已安装并可调用 `git`
- 字幕匹配仍为启发式逻辑，极端命名场景可能误匹配
