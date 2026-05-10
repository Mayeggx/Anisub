import { useEffect, useState } from "react";

import {
  createAnkiWordCard,
  downloadCandidate,
  fetchLogs,
  fetchWordNoteConfig,
  matchVideo,
  openFolder,
  openWordNoteConfig,
  pickFolder,
  playVideo,
  scanFolder,
  scanImageFolder,
} from "./api";
import type {
  CreateAnkiWordCardResponse,
  CreateWordNoteResponse,
  ImageItem,
  MatchLogItem,
  MatchMode,
  SubtitleCandidate,
  SubtitleSource,
  VideoItem,
  WordNoteConfigResponse,
  WordNoteMode,
} from "../shared/types";

type FeatureKey = "subtitle-match" | "word-note";

const STORAGE_KEYS = {
  folderPath: "anisub.folderPath",
  source: "anisub.source",
  mode: "anisub.mode",
  playerPath: "anisub.playerPath",
  activeFeature: "anisub.activeFeature",
  wordImageFolderPath: "anisub.wordNote.imageFolderPath",
  wordNoteMode: "anisub.wordNote.mode",
};

type CandidateDialogState = {
  video: VideoItem;
  candidates: SubtitleCandidate[];
} | null;

export function App() {
  const [activeFeature, setActiveFeature] = useState<FeatureKey>(
    () => (localStorage.getItem(STORAGE_KEYS.activeFeature) as FeatureKey | null) ?? "subtitle-match",
  );
  const [folderPath, setFolderPath] = useState(() => localStorage.getItem(STORAGE_KEYS.folderPath) ?? "");
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [logs, setLogs] = useState<MatchLogItem[]>([]);
  const [source, setSource] = useState<SubtitleSource>(
    () => (localStorage.getItem(STORAGE_KEYS.source) as SubtitleSource | null) ?? "jimaku",
  );
  const [mode, setMode] = useState<MatchMode>(
    () => (localStorage.getItem(STORAGE_KEYS.mode) as MatchMode | null) ?? "auto",
  );
  const [playerPath, setPlayerPath] = useState(() => localStorage.getItem(STORAGE_KEYS.playerPath) ?? "");
  const [candidateDialog, setCandidateDialog] = useState<CandidateDialogState>(null);
  const [loading, setLoading] = useState(false);
  const [matchingPath, setMatchingPath] = useState<string | null>(null);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [message, setMessage] = useState("请选择本地视频文件夹。");
  const [showLogs, setShowLogs] = useState(false);

  const [wordImageFolderPath, setWordImageFolderPath] = useState(
    () => localStorage.getItem(STORAGE_KEYS.wordImageFolderPath) ?? "",
  );
  const [wordImages, setWordImages] = useState<ImageItem[]>([]);
  const [wordInputs, setWordInputs] = useState<Record<string, string>>({});
  const [wordSelected, setWordSelected] = useState<Record<string, boolean>>({});
  const [wordMode, setWordMode] = useState<WordNoteMode>(
    () => (localStorage.getItem(STORAGE_KEYS.wordNoteMode) as WordNoteMode | null) ?? "auto",
  );
  const [wordConfig, setWordConfig] = useState<WordNoteConfigResponse | null>(null);
  const [wordStatus, setWordStatus] = useState("先选择图片文件夹并加载图片列表。");
  const [wordBusyPath, setWordBusyPath] = useState<string | null>(null);
  const [wordBatchBusy, setWordBatchBusy] = useState(false);
  const [wordResult, setWordResult] = useState<CreateWordNoteResponse | null>(null);
  const [lastCardResult, setLastCardResult] = useState<CreateAnkiWordCardResponse | null>(null);

  const selectedCount = wordImages.filter((image) => wordSelected[image.fullPath]).length;

  useEffect(() => {
    void refreshLogs();
    void refreshWordConfig();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.activeFeature, activeFeature);
  }, [activeFeature]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.source, source);
  }, [source]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.mode, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.playerPath, playerPath);
  }, [playerPath]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.wordImageFolderPath, wordImageFolderPath);
  }, [wordImageFolderPath]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.wordNoteMode, wordMode);
  }, [wordMode]);

  useEffect(() => {
    if (!folderPath) {
      return;
    }
    void handleScan(folderPath, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!wordImageFolderPath) {
      return;
    }
    void handleScanWordImages(wordImageFolderPath, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshLogs() {
    try {
      const payload = await fetchLogs();
      setLogs(payload.logs);
    } catch (error) {
      console.error(error);
    }
  }

  async function refreshWordConfig() {
    try {
      const payload = await fetchWordNoteConfig();
      setWordConfig(payload);
    } catch (error) {
      setWordStatus(error instanceof Error ? error.message : "读取配置失败。");
    }
  }

  async function handlePickFolder() {
    try {
      setLoading(true);
      setMessage("正在打开本地文件夹选择器...");
      const payload = await pickFolder();
      setFolderPath(payload.folderPath);
      localStorage.setItem(STORAGE_KEYS.folderPath, payload.folderPath);
      await handleScan(payload.folderPath, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "打开文件夹失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handlePickWordImageFolder() {
    try {
      setWordStatus("正在打开图片文件夹选择器...");
      const payload = await pickFolder();
      setWordImageFolderPath(payload.folderPath);
      localStorage.setItem(STORAGE_KEYS.wordImageFolderPath, payload.folderPath);
      await handleScanWordImages(payload.folderPath, true);
    } catch (error) {
      setWordStatus(error instanceof Error ? error.message : "打开图片文件夹失败。");
    }
  }

  async function handleScan(targetPath = folderPath, persist = true) {
    if (!targetPath.trim()) {
      setMessage("请先输入或选择文件夹路径。");
      return;
    }

    try {
      setLoading(true);
      setMessage("正在扫描当前目录中的视频文件...");
      const payload = await scanFolder({ folderPath: targetPath.trim() });
      setFolderPath(payload.folderPath);
      setVideos(payload.videos);
      if (persist) {
        localStorage.setItem(STORAGE_KEYS.folderPath, payload.folderPath);
      }
      setMessage(payload.videos.length === 0 ? "当前目录没有识别到视频文件。" : `已扫描到 ${payload.videos.length} 个视频文件。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "扫描失败。");
    } finally {
      setLoading(false);
    }
  }

  async function handleScanWordImages(targetPath = wordImageFolderPath, persist = true) {
    if (!targetPath.trim()) {
      setWordStatus("请先输入或选择图片文件夹路径。");
      return;
    }

    try {
      setWordStatus("正在扫描图片文件...");
      const payload = await scanImageFolder({ folderPath: targetPath.trim() });
      setWordImageFolderPath(payload.folderPath);
      setWordImages(payload.images);
      if (persist) {
        localStorage.setItem(STORAGE_KEYS.wordImageFolderPath, payload.folderPath);
      }

      setWordInputs((current) => {
        const next: Record<string, string> = {};
        for (const image of payload.images) {
          next[image.fullPath] = current[image.fullPath] ?? "";
        }
        return next;
      });
      setWordSelected((current) => {
        const next: Record<string, boolean> = {};
        for (const image of payload.images) {
          next[image.fullPath] = current[image.fullPath] ?? false;
        }
        return next;
      });

      setWordStatus(payload.images.length === 0 ? "当前目录没有识别到图片文件。" : `已加载 ${payload.images.length} 张图片。`);
    } catch (error) {
      setWordStatus(error instanceof Error ? error.message : "扫描图片失败。");
    }
  }

  async function handleOpenFolder() {
    const targetPath = folderPath.trim();
    if (!targetPath) {
      setMessage("请先输入或选择文件夹路径。");
      return;
    }

    try {
      await openFolder({ folderPath: targetPath });
      setMessage(`已在资源管理器中打开 ${targetPath}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "打开文件夹失败。");
    }
  }

  async function handlePlayVideo(video: VideoItem) {
    const targetPlayerPath = playerPath.trim();
    if (!targetPlayerPath) {
      setMessage("请先设置本地播放器路径。");
      return;
    }

    try {
      setPlayingPath(video.fullPath);
      setMessage(`正在使用本地播放器打开 ${video.fileName}...`);
      await playVideo({
        videoPath: video.fullPath,
        playerPath: targetPlayerPath,
      });
      setMessage(`已使用 ${targetPlayerPath} 播放 ${video.fileName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "播放失败。");
    } finally {
      setPlayingPath(null);
    }
  }

  async function handleMatchVideo(video: VideoItem) {
    try {
      setMatchingPath(video.fullPath);
      setMessage(`正在为 ${video.fileName} 匹配字幕...`);
      const payload = await matchVideo({
        videoPath: video.fullPath,
        source,
        mode,
      });

      if (payload.kind === "candidates") {
        setCandidateDialog({
          video: payload.video,
          candidates: payload.candidates,
        });
        setMessage(`已找到 ${payload.candidates.length} 个候选字幕，请确认。`);
        return;
      }

      mergeVideo(payload.video);
      setLogs((current) => [payload.log, ...current].slice(0, 200));
      setMessage(`字幕已保存到 ${payload.result.savedPath}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "字幕匹配失败。");
    } finally {
      setMatchingPath(null);
    }
  }

  async function handleDownloadCandidate(video: VideoItem, candidate: SubtitleCandidate) {
    try {
      setMatchingPath(video.fullPath);
      setMessage(`正在下载候选字幕 ${candidate.originalSubtitleName}...`);
      const payload = await downloadCandidate({
        videoPath: video.fullPath,
        source,
        candidate,
      });
      mergeVideo(payload.video);
      setLogs((current) => [payload.log, ...current].slice(0, 200));
      setCandidateDialog(null);
      setMessage(`字幕已保存到 ${payload.result.savedPath}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "下载候选字幕失败。");
    } finally {
      setMatchingPath(null);
    }
  }

  async function handleCreateWordNote(image: ImageItem) {
    const targetWord = (wordInputs[image.fullPath] ?? "").trim();
    if (!targetWord) {
      setWordStatus("请先输入目标单词。");
      return;
    }

    try {
      setWordBusyPath(image.fullPath);
      setWordStatus(`正在创建 Anki 卡片：${image.fileName} ...`);
      const payload = await submitAnkiCard(image, targetWord);
      setWordStatus(buildCardSuccessMessage(payload, image.fileName));
    } catch (error) {
      setWordStatus(error instanceof Error ? error.message : "创建 Anki 卡片失败。");
    } finally {
      setWordBusyPath(null);
    }
  }

  async function handleBatchCreateWordNotes() {
    const selectedItems = wordImages.filter((image) => wordSelected[image.fullPath]);
    if (selectedItems.length === 0) {
      setWordStatus("请先勾选需要批量添加的条目。");
      return;
    }
    for (const image of selectedItems) {
      const targetWord = (wordInputs[image.fullPath] ?? "").trim();
      if (!targetWord) {
        setWordStatus(`请先为 ${image.fileName} 输入目标单词。`);
        return;
      }
    }

    try {
      setWordBatchBusy(true);
      let successCount = 0;
      for (const image of selectedItems) {
        const targetWord = (wordInputs[image.fullPath] ?? "").trim();
        setWordBusyPath(image.fullPath);
        setWordStatus(`正在批量创建：${image.fileName} ...`);
        await submitAnkiCard(image, targetWord);
        successCount += 1;
      }
      setWordStatus(`批量添加完成，成功 ${successCount} / ${selectedItems.length} 条。`);
    } catch (error) {
      setWordStatus(error instanceof Error ? error.message : "批量添加失败。");
    } finally {
      setWordBusyPath(null);
      setWordBatchBusy(false);
    }
  }

  async function handleOpenWordNoteConfig() {
    try {
      await openWordNoteConfig();
      await refreshWordConfig();
      setWordStatus("已打开配置文件，请保存后点击“刷新配置”。");
    } catch (error) {
      setWordStatus(error instanceof Error ? error.message : "打开配置文件失败。");
    }
  }

  function mergeVideo(video: VideoItem) {
    setVideos((current) => current.map((item) => (item.fullPath === video.fullPath ? video : item)));
  }

  async function submitAnkiCard(image: ImageItem, targetWord: string): Promise<CreateAnkiWordCardResponse> {
    const payload = await createAnkiWordCard({
      imagePath: image.fullPath,
      subtitle: image.subtitleText,
      targetWord,
      mode: wordMode,
    });
    setLastCardResult(payload);
    setWordResult({
      mode: payload.mode,
      note: payload.wordNote,
    });
    setWordImages((current) =>
      current.map((item) =>
        item.fullPath === image.fullPath
          ? {
              ...item,
              added: true,
              addedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
    setWordSelected((current) => ({ ...current, [image.fullPath]: false }));
    return payload;
  }

  function buildCardSuccessMessage(payload: CreateAnkiWordCardResponse, fileName: string): string {
    return payload.status === "updated"
      ? `已更新卡片（ID: ${payload.noteId}，${fileName}）。`
      : `已创建卡片（ID: ${payload.noteId}，${fileName}）。`;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <p className="sidebar-brand">Anisub</p>
        <button
          className={activeFeature === "subtitle-match" ? "nav-button active" : "nav-button"}
          type="button"
          onClick={() => setActiveFeature("subtitle-match")}
        >
          字幕匹配
        </button>
        <button
          className={activeFeature === "word-note" ? "nav-button active" : "nav-button"}
          type="button"
          onClick={() => setActiveFeature("word-note")}
        >
          单词摘记
        </button>
      </aside>

      <div className="content">
        <header className="hero hero-compact">
          <p className="eyebrow">Anisub Desktop</p>
        </header>

        {activeFeature === "subtitle-match" ? (
          <main className="layout">
            <section className="control-card">
              <div className="section-title-row">
                <h2>工作区</h2>
                <div className="section-actions">
                  <button className="ghost-button" type="button" onClick={() => void handleOpenFolder()}>
                    打开文件夹
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setShowLogs(true)}>
                    查看日志
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void refreshLogs()}>
                    刷新日志
                  </button>
                </div>
              </div>

              <label className="field-label" htmlFor="folderPath">
                视频文件夹
              </label>
              <div className="folder-row">
                <input
                  id="folderPath"
                  className="text-input"
                  value={folderPath}
                  onChange={(event) => setFolderPath(event.target.value)}
                  placeholder="例如 E:\\Anime\\Awajima Hyakkei"
                />
                <button className="action-button" type="button" onClick={() => void handlePickFolder()} disabled={loading}>
                  选择文件夹
                </button>
                <button className="action-button secondary" type="button" onClick={() => void handleScan()} disabled={loading}>
                  扫描
                </button>
              </div>

              <div className="toolbar">
                <label className="select-wrap">
                  <span>来源</span>
                  <select value={source} onChange={(event) => setSource(event.target.value as SubtitleSource)}>
                    <option value="jimaku">Jimaku</option>
                    <option value="edatribe">EdaTribe</option>
                  </select>
                </label>
                <label className="select-wrap">
                  <span>模式</span>
                  <select value={mode} onChange={(event) => setMode(event.target.value as MatchMode)}>
                    <option value="auto">自动下载</option>
                    <option value="candidate">候选确认</option>
                  </select>
                </label>
              </div>

              <label className="field-label player-field" htmlFor="playerPath">
                本地播放器路径
              </label>
              <input
                id="playerPath"
                className="text-input"
                value={playerPath}
                onChange={(event) => setPlayerPath(event.target.value)}
                placeholder="例如 D:\\Software\\mpv\\mpv.exe"
              />

              <p className="status-banner">{message}</p>
            </section>

            <section className="list-card">
              <div className="section-title-row">
                <h2>视频列表</h2>
                <span className="hint-text">仅扫描当前目录，不递归子目录</span>
              </div>

              {videos.length === 0 ? (
                <div className="empty-state">当前还没有可操作的视频文件。</div>
              ) : (
                <div className="video-list">
                  {videos.map((video) => {
                    const busy = matchingPath === video.fullPath;
                    const playing = playingPath === video.fullPath;
                    return (
                      <article className="video-card" key={video.fullPath}>
                        <div className="video-meta">
                          <h3 title={video.fileName}>{video.fileName}</h3>
                          <p>{video.folderPath}</p>
                        </div>

                        <div className="video-status-row">
                          <span className={video.hasSubtitle ? "badge badge-ok" : "badge badge-warn"}>{video.subtitleStatus}</span>
                          {video.subtitlePath ? <code>{video.subtitlePath}</code> : <code>sub/ 下暂无同名字幕</code>}
                        </div>

                        <div className="video-actions">
                          <button className="ghost-button" type="button" onClick={() => void handlePlayVideo(video)} disabled={playing}>
                            {playing ? "播放中..." : "播放"}
                          </button>
                          <button className="action-button" type="button" onClick={() => void handleMatchVideo(video)} disabled={busy}>
                            {busy ? "匹配中..." : mode === "candidate" ? "查找候选字幕" : "匹配并下载字幕"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </main>
        ) : (
          <main className="layout">
            <section className="control-card">
              <div className="section-title-row">
                <h2>单词摘记</h2>
                <div className="section-actions">
                  <button className="ghost-button" type="button" onClick={() => void refreshWordConfig()}>
                    刷新配置
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void handleOpenWordNoteConfig()}>
                    打开配置文件
                  </button>
                </div>
              </div>

              <label className="field-label" htmlFor="wordImageFolderPath">
                图片文件夹
              </label>
              <div className="folder-row">
                <input
                  id="wordImageFolderPath"
                  className="text-input"
                  value={wordImageFolderPath}
                  onChange={(event) => setWordImageFolderPath(event.target.value)}
                  placeholder="例如 E:\\Anime\\screenshots"
                />
                <button className="action-button" type="button" onClick={() => void handlePickWordImageFolder()}>
                  选择文件夹
                </button>
                <button className="action-button secondary" type="button" onClick={() => void handleScanWordImages()}>
                  加载图片列表
                </button>
              </div>

              <div className="toolbar">
                <label className="select-wrap">
                  <span>模式</span>
                  <select value={wordMode} onChange={(event) => setWordMode(event.target.value as WordNoteMode)}>
                    <option value="auto">自动判断</option>
                    <option value="jp">日语</option>
                    <option value="en">英语</option>
                  </select>
                </label>
                <div className="config-hint">
                  <span>配置文件：</span>
                  <code>{wordConfig?.configPath ?? "加载中..."}</code>
                </div>
              </div>

              <p className="hint-text">
                当前模型：<code>{wordConfig?.config.openai.modelName ?? "-"}</code> ｜ Base URL：
                <code>{wordConfig?.config.openai.baseUrl ?? "-"}</code>
              </p>
              <p className="hint-text">
                JP Deck：<code>{wordConfig?.config.anki.jpDeck ?? "-"}</code> ｜ EN Deck：
                <code>{wordConfig?.config.anki.enDeck ?? "-"}</code>
              </p>
              <p className="hint-text">
                图片压缩：<code>{wordConfig?.config.anki.maxWidth ?? "-"}</code> x
                <code>{wordConfig?.config.anki.maxHeight ?? "-"}</code> ｜ 质量：
                <code>{wordConfig?.config.anki.imageQuality ?? "-"}</code>
              </p>

              <p className="status-banner">{wordStatus}</p>
            </section>

            <section className="list-card">
              <div className="section-title-row">
                <h2>图片列表</h2>
                <span className="hint-text">文件名（去扩展名）将作为字幕句子</span>
              </div>
              {wordImages.length === 0 ? (
                <div className="empty-state">当前还没有可处理的图片。</div>
              ) : (
                <div className="word-image-list">
                  {wordImages.map((image) => {
                    const busy = wordBusyPath === image.fullPath || wordBatchBusy;
                    return (
                      <article className="word-image-card" key={image.fullPath}>
                        <label className="word-image-check">
                          <input
                            type="checkbox"
                            checked={wordSelected[image.fullPath] ?? false}
                            onChange={(event) =>
                              setWordSelected((current) => ({
                                ...current,
                                [image.fullPath]: event.target.checked,
                              }))
                            }
                            disabled={wordBatchBusy}
                          />
                        </label>
                        <img
                          className="word-image-preview"
                          src={`/api/image-file?path=${encodeURIComponent(image.fullPath)}`}
                          alt={image.fileName}
                        />
                        <div className="word-image-main">
                          <h3 title={image.fileName}>{image.fileName}{image.added ? "（已添加）" : ""}</h3>
                          <p>{image.subtitleText}</p>
                          <div className="word-image-actions">
                            <input
                              className="text-input"
                              value={wordInputs[image.fullPath] ?? ""}
                              onChange={(event) =>
                                setWordInputs((current) => ({
                                  ...current,
                                  [image.fullPath]: event.target.value,
                                }))
                              }
                              placeholder="输入目标单词"
                            />
                            <button className="action-button" type="button" onClick={() => void handleCreateWordNote(image)} disabled={busy}>
                              {busy ? "创建中..." : "创建 Anki 卡片"}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="list-card">
              <div className="section-title-row">
                <h2>摘记结果</h2>
              </div>
              {wordResult ? (
                <article className="word-note-card">
                  {lastCardResult ? (
                    <div className="word-note-row">
                      <strong>写入状态</strong>
                      <span>
                        {lastCardResult.status === "updated" ? "已更新已有卡片" : "已创建新卡片"} ｜ Note ID: {lastCardResult.noteId}
                      </span>
                    </div>
                  ) : null}
                  <div className="word-note-row">
                    <strong>模式</strong>
                    <span>{wordResult.mode === "jp" ? "日语" : "英语"}</span>
                  </div>
                  <div className="word-note-row">
                    <strong>单词原型</strong>
                    <span>{wordResult.note.word || "-"}</span>
                  </div>
                  <div className="word-note-row">
                    <strong>音标/读音</strong>
                    <span>{wordResult.note.pronunciation || "-"}</span>
                  </div>
                  <div className="word-note-row">
                    <strong>释义</strong>
                    <span>{wordResult.note.meaning || "-"}</span>
                  </div>
                  <div className="word-note-row">
                    <strong>例句</strong>
                    <span
                      dangerouslySetInnerHTML={{
                        __html: sanitizeExampleHtml(wordResult.note.example || "-"),
                      }}
                    />
                  </div>
                  <div className="word-note-row">
                    <strong>笔记</strong>
                    <span>{wordResult.note.note || "-"}</span>
                  </div>
                </article>
              ) : (
                <div className="empty-state">还没有生成结果。</div>
              )}
            </section>
          </main>
        )}
      </div>

      {activeFeature === "word-note" && wordImages.length > 0 ? (
        <button
          className="batch-fab"
          type="button"
          onClick={() => void handleBatchCreateWordNotes()}
          disabled={selectedCount === 0 || wordBatchBusy}
        >
          {wordBatchBusy ? "批量添加中..." : `批量添加 (${selectedCount})`}
        </button>
      ) : null}

      {candidateDialog ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setCandidateDialog(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>候选字幕确认</h2>
              <button className="ghost-button" type="button" onClick={() => setCandidateDialog(null)}>
                关闭
              </button>
            </div>
            <p className="hint-text">{candidateDialog.video.fileName}</p>
            <div className="candidate-list">
              {candidateDialog.candidates.map((candidate, index) => (
                <article className="candidate-card" key={`${candidate.downloadUrl}-${index}`}>
                  <div>
                    <strong>{candidate.originalSubtitleName}</strong>
                    <p>
                      {candidate.seriesTitle}
                      {candidate.episode !== null ? ` · 第 ${candidate.episode} 话` : ""}
                    </p>
                  </div>
                  <button
                    className="action-button"
                    type="button"
                    onClick={() => void handleDownloadCandidate(candidateDialog.video, candidate)}
                    disabled={matchingPath === candidateDialog.video.fullPath}
                  >
                    选择并下载
                  </button>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showLogs ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowLogs(false)}>
          <div className="modal-card logs-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>匹配日志</h2>
              <button className="ghost-button" type="button" onClick={() => setShowLogs(false)}>
                关闭
              </button>
            </div>
            {logs.length === 0 ? (
              <div className="empty-state">暂时还没有匹配记录。</div>
            ) : (
              <div className="log-list">
                {logs.map((log) => (
                  <article className="log-card" key={log.id}>
                    <div className="log-line">
                      <strong>{log.videoFileName}</strong>
                      <span>{formatDateTime(log.timestamp)}</span>
                    </div>
                    <div className="log-line">
                      <span>
                        {log.source} · {log.seriesTitle}
                        {log.episode !== null ? ` · 第 ${log.episode} 话` : ""}
                      </span>
                    </div>
                    <div className="log-line">
                      <code>{log.originalSubtitleName}</code>
                    </div>
                    <div className="log-line">
                      <code>{log.savedPath}</code>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function sanitizeExampleHtml(value: string): string {
  const escaped = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return escaped
    .replaceAll("&lt;b&gt;", "<b>")
    .replaceAll("&lt;/b&gt;", "</b>")
    .replaceAll("&lt;B&gt;", "<b>")
    .replaceAll("&lt;/B&gt;", "</b>");
}
