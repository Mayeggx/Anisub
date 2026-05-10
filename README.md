# Anisub

Anisub 是一个基于 TypeScript 的本地桌面工具（Web UI + 本地 API），目前包含两个核心功能：

1. 字幕匹配：扫描视频目录并从字幕站点匹配下载字幕  
2. 单词摘记：加载字幕截图，调用大模型生成词条信息，并写入 Anki

## 功能概览

### 1) 字幕匹配

- 扫描本地视频文件夹
- 支持 `Jimaku` / `EdaTribe` 两种字幕来源
- 支持两种模式：
  - `auto`：自动匹配并下载
  - `candidate`：先展示候选字幕，手动确认后下载
- 字幕保存到视频目录下 `sub/` 文件夹
- 支持匹配日志查看

### 2) 单词摘记（参考 PicSubToAnki）

- 先选择图片文件夹并加载全部图片列表
- 使用“文件名去扩展名”作为字幕句子
- 每条可输入目标单词后创建 Anki 卡片
- 支持勾选条目后“批量添加”（右下角悬浮按钮）
- 已添加条目会显示“（已添加）”
- 配置来自本地 `config.ini`，前端可一键打开配置文件

## 配置文件

首次启动后会自动创建：

- `./.anisub/config.ini`
- `./.anisub/word-card-log.json`（单词摘记添加状态记录）

其中 `config.ini` 字段与 PicSubToAnki 对齐：

```ini
[openai]
api_key =
base_url = https://dashscope.aliyuncs.com/compatible-mode/v1
model_name = qwen-plus

[anki]
jp_deck = 日本語::エンタメ::テレビアニメーション
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
4. 用 `findNotes + notesInfo` 查重
5. 已存在则 `updateNoteFields`，否则 `addNote`

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
- `server/`：本地 API、字幕匹配、图片扫描、Anki 制卡
- `shared/`：前后端共享类型
- `.anisub/`：运行时配置与日志

## 当前限制

- 目录选择器与配置文件打开目前仅支持 Windows
- 字幕匹配仍为启发式逻辑，极端命名场景可能误匹配
