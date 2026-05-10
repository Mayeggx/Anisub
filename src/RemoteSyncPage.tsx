import { useEffect, useMemo, useState } from "react";

import {
  clearRemoteSyncLogs,
  createRemoteSyncEntry,
  fetchRemoteSyncState,
  pickFolder,
  refreshRemoteSyncEntries,
  remoteSyncClear,
  remoteSyncDelete,
  remoteSyncPull,
  remoteSyncPush,
  saveRemoteSyncConfig,
  updateRemoteSyncImageCompression,
} from "./api";
import type {
  RemoteSyncConfig,
  RemoteSyncEntry,
  RemoteSyncStateResponse,
} from "../shared/types";

type RemoteSyncPageProps = {
  onOpenWordNoteForFolder: (folderPath: string) => void;
};

const DEFAULT_IMAGE_SCALE_PERCENT = 50;
const DEFAULT_IMAGE_JPEG_QUALITY = 70;

export function RemoteSyncPage(props: RemoteSyncPageProps) {
  const { onOpenWordNoteForFolder } = props;
  const [state, setState] = useState<RemoteSyncStateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showGitConfigDialog, setShowGitConfigDialog] = useState(false);
  const [showCreateEntryDialog, setShowCreateEntryDialog] = useState(false);
  const [showImageQualityDialog, setShowImageQualityDialog] = useState(false);
  const [showGitLogDialog, setShowGitLogDialog] = useState(false);
  const [showDeleteDialogFor, setShowDeleteDialogFor] = useState<RemoteSyncEntry | null>(null);
  const [showClearDialogFor, setShowClearDialogFor] = useState<RemoteSyncEntry | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [scaleDraft, setScaleDraft] = useState(String(DEFAULT_IMAGE_SCALE_PERCENT));
  const [qualityDraft, setQualityDraft] = useState(String(DEFAULT_IMAGE_JPEG_QUALITY));
  const [configDraft, setConfigDraft] = useState<RemoteSyncConfig | null>(null);

  useEffect(() => {
    void refreshState();
  }, []);

  const canUseActions = Boolean(state) && !loading;

  const sortedLogs = useMemo(() => {
    if (!state) {
      return [];
    }
    return [...state.gitLogs].reverse();
  }, [state]);

  async function refreshState() {
    setLoading(true);
    try {
      const payload = await fetchRemoteSyncState();
      setState(payload);
    } catch (error) {
      setState((current) =>
        current
          ? {
              ...current,
              statusMessage: error instanceof Error ? error.message : "读取远程同步状态失败。",
            }
          : null,
      );
    } finally {
      setLoading(false);
    }
  }

  async function runAction(task: () => Promise<RemoteSyncStateResponse>) {
    setLoading(true);
    try {
      const payload = await task();
      setState(payload);
    } catch (error) {
      setState((current) =>
        current
          ? {
              ...current,
              statusMessage: error instanceof Error ? error.message : "远程同步操作失败。",
            }
          : null,
      );
    } finally {
      setLoading(false);
    }
  }

  function openGitConfigDialog() {
    if (!state) {
      return;
    }
    setConfigDraft(state.config);
    setShowGitConfigDialog(true);
  }

  function openImageQualityDialog() {
    if (!state) {
      return;
    }
    setScaleDraft(String(state.config.imageScalePercent));
    setQualityDraft(String(state.config.imageJpegQuality));
    setShowImageQualityDialog(true);
  }

  async function handleSaveConfig() {
    if (!configDraft) {
      return;
    }
    setShowGitConfigDialog(false);
    await runAction(() =>
      saveRemoteSyncConfig({
        config: configDraft,
      }),
    );
  }

  async function handleSaveImageQuality() {
    const scale = Math.max(1, Math.min(100, Number.parseInt(scaleDraft || "", 10) || DEFAULT_IMAGE_SCALE_PERCENT));
    const quality = Math.max(1, Math.min(100, Number.parseInt(qualityDraft || "", 10) || DEFAULT_IMAGE_JPEG_QUALITY));
    setShowImageQualityDialog(false);
    await runAction(() =>
      updateRemoteSyncImageCompression({
        scalePercent: scale,
        jpegQuality: quality,
      }),
    );
  }

  async function handleCreateEntry() {
    setLoading(true);
    try {
      const folder = await pickFolder();
      const payload = await createRemoteSyncEntry({
        displayName: pendingName,
        folderPath: folder.folderPath,
      });
      setState(payload);
      setPendingName("");
      setShowCreateEntryDialog(false);
    } catch (error) {
      setState((current) =>
        current
          ? {
              ...current,
              statusMessage: error instanceof Error ? error.message : "创建条目失败。",
            }
          : null,
      );
    } finally {
      setLoading(false);
    }
  }

  if (!state) {
    return (
      <main className="layout">
        <section className="control-card">
          <div className="section-title-row">
            <h2>远程同步</h2>
            <button className="ghost-button" type="button" onClick={() => void refreshState()} disabled={loading}>
              {loading ? "加载中..." : "刷新"}
            </button>
          </div>
          <p className="status-banner">正在初始化远程同步页面，请稍候...</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <main className="layout">
        <section className="control-card">
          <div className="section-title-row">
            <h2>远程同步</h2>
            <div className="section-actions">
              <button className="ghost-button" type="button" onClick={openImageQualityDialog} disabled={!canUseActions}>
                图片质量
              </button>
              <button className="ghost-button" type="button" onClick={openGitConfigDialog} disabled={!canUseActions}>
                Git配置
              </button>
              <button className="ghost-button" type="button" onClick={() => setShowCreateEntryDialog(true)} disabled={!canUseActions}>
                新建条目
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowGitLogDialog(true)}
                disabled={loading && state.gitLogs.length === 0}
              >
                日志
              </button>
            </div>
          </div>

          <div className="remote-summary-card">
            <p>仓库 A: {state.repoPath}</p>
            <p>
              当前设备: {state.deviceName} ({state.deviceId})
            </p>
            <p>
              图片压缩: 缩放 {state.config.imageScalePercent}% + JPEG 质量 {state.config.imageJpegQuality}
            </p>
            <p>当前HEAD: {state.headSummary}</p>
            <div className="remote-summary-actions">
              <button className="action-button" type="button" onClick={() => void runAction(() => remoteSyncPull())} disabled={!canUseActions}>
                Pull
              </button>
              <button
                className="action-button secondary"
                type="button"
                onClick={() => void runAction(() => refreshRemoteSyncEntries())}
                disabled={!canUseActions}
              >
                刷新列表
              </button>
            </div>
            {loading ? <p className="hint-text">正在执行 Git 操作...</p> : null}
          </div>

          <p className="status-banner">{state.statusMessage}</p>
        </section>

        <section className="list-card">
          <div className="section-title-row">
            <h2>条目列表</h2>
          </div>
          {state.entries.length === 0 ? (
            <div className="empty-state">还没有可用条目。请先新建条目或执行 Pull。</div>
          ) : (
            <div className="remote-entry-list">
              {state.entries.map((entry) => {
                const canPush = entry.deviceId === state.deviceId && Boolean(entry.folderPath);
                const updatedText = entry.updatedAt > 0 ? formatDateTime(entry.updatedAt) : "-";
                return (
                  <article className="remote-entry-card" key={entry.id}>
                    <div className="remote-entry-head">
                      <h3 title={entry.displayName}>{entry.displayName}</h3>
                      <button
                        className="remote-delete-button"
                        type="button"
                        onClick={() => setShowDeleteDialogFor(entry)}
                        disabled={loading}
                        aria-label={`删除条目 ${entry.displayName}`}
                      >
                        ×
                      </button>
                    </div>
                    <p>
                      设备: {entry.deviceName} ({entry.deviceId})
                    </p>
                    <p>仓库路径: {entry.repoPath}</p>
                    <p>本地绑定: {entry.folderLabel ?? "无"}</p>
                    <p>当前文件夹文件数量: {entry.folderFileCount ?? "-"}</p>
                    <p>更新时间: {updatedText}</p>
                    <div className="remote-entry-actions">
                      {canPush ? (
                        <button
                          className="action-button"
                          type="button"
                          onClick={() => void runAction(() => remoteSyncPush({ entryId: entry.id }))}
                          disabled={loading}
                        >
                          Push
                        </button>
                      ) : null}
                      <button
                        className="action-button secondary"
                        type="button"
                        onClick={() => setShowClearDialogFor(entry)}
                        disabled={loading}
                      >
                        清空
                      </button>
                      {entry.wordNoteFolderPath ? (
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => onOpenWordNoteForFolder(entry.wordNoteFolderPath as string)}
                          disabled={loading}
                        >
                          摘记
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {showDeleteDialogFor ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowDeleteDialogFor(null)}>
          <div className="modal-card remote-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>删除条目</h2>
            </div>
            <p>确认删除 “{showDeleteDialogFor.displayName}” 并 push 到远程仓库吗？</p>
            <div className="section-actions">
              <button className="ghost-button" type="button" onClick={() => setShowDeleteDialogFor(null)}>
                取消
              </button>
              <button
                className="action-button"
                type="button"
                onClick={() => {
                  const entryId = showDeleteDialogFor.id;
                  setShowDeleteDialogFor(null);
                  void runAction(() => remoteSyncDelete({ entryId }));
                }}
                disabled={loading}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showClearDialogFor ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowClearDialogFor(null)}>
          <div className="modal-card remote-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>清空条目</h2>
            </div>
            <p>
              {showClearDialogFor.folderPath
                ? `确认清空 “${showClearDialogFor.displayName}” 对应的仓库子文件夹和本地绑定文件夹内容，并 push 到远程吗？`
                : `确认清空 “${showClearDialogFor.displayName}” 对应的仓库子文件夹，并 push 到远程吗？`}
            </p>
            <div className="section-actions">
              <button className="ghost-button" type="button" onClick={() => setShowClearDialogFor(null)}>
                取消
              </button>
              <button
                className="action-button"
                type="button"
                onClick={() => {
                  const entryId = showClearDialogFor.id;
                  setShowClearDialogFor(null);
                  void runAction(() => remoteSyncClear({ entryId }));
                }}
                disabled={loading}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showGitConfigDialog && configDraft ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowGitConfigDialog(false)}>
          <div className="modal-card remote-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>Git 配置</h2>
            </div>
            <div className="remote-form-grid">
              <label className="select-wrap">
                <span>远程仓库 URL</span>
                <input
                  className="text-input"
                  value={configDraft.remoteUrl}
                  onChange={(event) => setConfigDraft((current) => (current ? { ...current, remoteUrl: event.target.value } : current))}
                />
              </label>
              <label className="select-wrap">
                <span>Git 用户名</span>
                <input
                  className="text-input"
                  value={configDraft.gitUsername}
                  onChange={(event) => setConfigDraft((current) => (current ? { ...current, gitUsername: event.target.value } : current))}
                />
              </label>
              <label className="select-wrap">
                <span>Git Token/PAT</span>
                <input
                  className="text-input"
                  type="password"
                  value={configDraft.gitToken}
                  onChange={(event) => setConfigDraft((current) => (current ? { ...current, gitToken: event.target.value } : current))}
                />
              </label>
              <label className="select-wrap">
                <span>提交作者名</span>
                <input
                  className="text-input"
                  value={configDraft.commitUserName}
                  onChange={(event) =>
                    setConfigDraft((current) => (current ? { ...current, commitUserName: event.target.value } : current))
                  }
                />
              </label>
              <label className="select-wrap">
                <span>提交作者邮箱</span>
                <input
                  className="text-input"
                  value={configDraft.commitUserEmail}
                  onChange={(event) =>
                    setConfigDraft((current) => (current ? { ...current, commitUserEmail: event.target.value } : current))
                  }
                />
              </label>
            </div>
            <div className="section-actions">
              <button className="ghost-button" type="button" onClick={() => setShowGitConfigDialog(false)}>
                取消
              </button>
              <button className="action-button" type="button" onClick={() => void handleSaveConfig()} disabled={loading}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateEntryDialog ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowCreateEntryDialog(false)}>
          <div className="modal-card remote-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>新建条目</h2>
            </div>
            <p>绑定当前设备 + 文件夹 B</p>
            <label className="select-wrap">
              <span>条目名称（可空）</span>
              <input className="text-input" value={pendingName} onChange={(event) => setPendingName(event.target.value)} />
            </label>
            <div className="section-actions">
              <button className="ghost-button" type="button" onClick={() => setShowCreateEntryDialog(false)}>
                取消
              </button>
              <button className="action-button" type="button" onClick={() => void handleCreateEntry()} disabled={loading}>
                选择文件夹B
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showImageQualityDialog ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowImageQualityDialog(false)}>
          <div className="modal-card remote-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>图片质量</h2>
            </div>
            <p>Push 前会把图片缩放并转为 JPG。</p>
            <div className="remote-form-grid">
              <label className="select-wrap">
                <span>缩放比 (1-100)%</span>
                <input
                  className="text-input"
                  value={scaleDraft}
                  onChange={(event) => setScaleDraft(event.target.value.replaceAll(/[^\d]/g, "").slice(0, 3))}
                />
              </label>
              <label className="select-wrap">
                <span>JPG 质量 (1-100)</span>
                <input
                  className="text-input"
                  value={qualityDraft}
                  onChange={(event) => setQualityDraft(event.target.value.replaceAll(/[^\d]/g, "").slice(0, 3))}
                />
              </label>
            </div>
            <div className="section-actions">
              <button className="ghost-button" type="button" onClick={() => setShowImageQualityDialog(false)}>
                取消
              </button>
              <button className="action-button" type="button" onClick={() => void handleSaveImageQuality()} disabled={loading}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showGitLogDialog ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowGitLogDialog(false)}>
          <div className="modal-card logs-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>Git 日志</h2>
            </div>
            {sortedLogs.length === 0 ? (
              <div className="empty-state">暂无日志记录。</div>
            ) : (
              <div className="log-list">
                {sortedLogs.map((line, index) => (
                  <article className="log-card" key={`${line}-${index}`}>
                    <code>{line}</code>
                  </article>
                ))}
              </div>
            )}
            <div className="section-actions">
              <button className="ghost-button" type="button" onClick={() => setShowGitLogDialog(false)}>
                关闭
              </button>
              <button
                className="action-button secondary"
                type="button"
                onClick={() => void runAction(() => clearRemoteSyncLogs())}
                disabled={state.gitLogs.length === 0 || loading}
              >
                清空日志
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatDateTime(value: number): string {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}
