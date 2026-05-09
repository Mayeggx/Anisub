import { useEffect, useMemo, useState } from "react";

import { downloadCandidate, fetchLogs, matchVideo, pickFolder, scanFolder } from "./api";
import type {
  MatchLogItem,
  MatchMode,
  SubtitleCandidate,
  SubtitleSource,
  VideoItem,
} from "../shared/types";

const STORAGE_KEYS = {
  folderPath: "anisub.folderPath",
  source: "anisub.source",
  mode: "anisub.mode",
};

type CandidateDialogState = {
  video: VideoItem;
  candidates: SubtitleCandidate[];
} | null;

export function App() {
  const [folderPath, setFolderPath] = useState(() => localStorage.getItem(STORAGE_KEYS.folderPath) ?? "");
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [logs, setLogs] = useState<MatchLogItem[]>([]);
  const [source, setSource] = useState<SubtitleSource>(
    () => (localStorage.getItem(STORAGE_KEYS.source) as SubtitleSource | null) ?? "jimaku",
  );
  const [mode, setMode] = useState<MatchMode>(
    () => (localStorage.getItem(STORAGE_KEYS.mode) as MatchMode | null) ?? "auto",
  );
  const [candidateDialog, setCandidateDialog] = useState<CandidateDialogState>(null);
  const [loading, setLoading] = useState(false);
  const [matchingPath, setMatchingPath] = useState<string | null>(null);
  const [message, setMessage] = useState("请选择一个本地视频文件夹。");
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    void refreshLogs();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.source, source);
  }, [source]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.mode, mode);
  }, [mode]);

  useEffect(() => {
    if (!folderPath) {
      return;
    }
    void handleScan(folderPath, false);
  }, []);

  const stats = useMemo(() => {
    const matched = videos.filter((item) => item.hasSubtitle).length;
    return {
      total: videos.length,
      matched,
      pending: videos.length - matched,
    };
  }, [videos]);

  async function refreshLogs() {
    try {
      const payload = await fetchLogs();
      setLogs(payload.logs);
    } catch (error) {
      console.error(error);
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

  async function handleScan(targetPath = folderPath, persist = true) {
    if (!targetPath.trim()) {
      setMessage("请先输入或选择一个文件夹路径。");
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
      setMessage(
        payload.videos.length === 0
          ? "当前目录没有识别到视频文件。"
          : `已扫描 ${payload.videos.length} 个视频文件。`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "扫描失败。");
    } finally {
      setLoading(false);
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
      setMessage(`正在下载候选字幕 ${candidate.originalSubtitleName} ...`);
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

  function mergeVideo(video: VideoItem) {
    setVideos((current) => current.map((item) => (item.fullPath === video.fullPath ? video : item)));
  }

  return (
    <div className="shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Anisub Desktop</p>
          <h1>本地扫描视频，直接在电脑端匹配并保存字幕</h1>
          <p className="hero-text">
            复用 Anisubroid 的启发式匹配思路，用 TypeScript 实现 Jimaku / EdaTribe 两种来源，并通过本地网页完成交互。
          </p>
        </div>
        <div className="hero-panel">
          <div className="stat-chip">
            <span>视频</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="stat-chip">
            <span>已带字幕</span>
            <strong>{stats.matched}</strong>
          </div>
          <div className="stat-chip">
            <span>待处理</span>
            <strong>{stats.pending}</strong>
          </div>
        </div>
      </header>

      <main className="layout">
        <section className="control-card">
          <div className="section-title-row">
            <h2>工作区</h2>
            <button className="ghost-button" type="button" onClick={() => void refreshLogs()}>
              刷新日志
            </button>
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
            <button className="ghost-button" type="button" onClick={() => setShowLogs(true)}>
              查看日志
            </button>
          </div>

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
                return (
                  <article className="video-card" key={video.fullPath}>
                    <div className="video-meta">
                      <h3 title={video.fileName}>{video.fileName}</h3>
                      <p>{video.folderPath}</p>
                    </div>

                    <div className="video-status-row">
                      <span className={video.hasSubtitle ? "badge badge-ok" : "badge badge-warn"}>
                        {video.subtitleStatus}
                      </span>
                      {video.subtitlePath ? <code>{video.subtitlePath}</code> : <code>sub/ 下暂无同名字幕</code>}
                    </div>

                    <div className="video-actions">
                      <button
                        className="action-button"
                        type="button"
                        onClick={() => void handleMatchVideo(video)}
                        disabled={busy}
                      >
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
                      {candidate.episode !== null ? ` · 第 ${candidate.episode} 集` : ""}
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
                        {log.episode !== null ? ` · 第 ${log.episode} 集` : ""}
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
