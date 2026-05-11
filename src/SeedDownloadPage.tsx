import { useEffect, useState } from "react";

import {
  addSeedSubscription,
  downloadSeedTorrent,
  fetchSeedSubscriptionEntries,
  fetchSeedSubscriptions,
  openSeedTorrent,
  pullSeedSubscriptions,
  pushSeedSubscriptions,
  removeSeedSubscription,
} from "./api";
import type { SeedSubscriptionItem, SeedTorrentEntryItem } from "../shared/types";

export function SeedDownloadPage() {
  const [subscriptions, setSubscriptions] = useState<SeedSubscriptionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("Please add a subscription URL first.");
  const [activeSubscriptionId, setActiveSubscriptionId] = useState<string | null>(null);
  const [activeSubscriptionLabel, setActiveSubscriptionLabel] = useState("");
  const [activeEntries, setActiveEntries] = useState<SeedTorrentEntryItem[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [addDialogVisible, setAddDialogVisible] = useState(false);
  const [addUrlInput, setAddUrlInput] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SeedSubscriptionItem | null>(null);
  const [downloadingEntryId, setDownloadingEntryId] = useState<string | null>(null);

  useEffect(() => {
    void loadSubscriptions();
  }, []);

  async function loadSubscriptions() {
    setLoading(true);
    try {
      const payload = await fetchSeedSubscriptions();
      setSubscriptions(payload.subscriptions);
      setMessage(payload.subscriptions.length === 0 ? "Please add a subscription URL first." : "Select a subscription to view entries.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load subscriptions.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddSubscription() {
    const url = addUrlInput.trim();
    if (!url) {
      setMessage("Subscription URL is required.");
      return;
    }
    setLoading(true);
    try {
      const payload = await addSeedSubscription({ url });
      setSubscriptions(payload.subscriptions);
      setAddDialogVisible(false);
      setAddUrlInput("");
      setMessage(payload.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add subscription.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveSubscription(id: string) {
    setLoading(true);
    try {
      const payload = await removeSeedSubscription({ id });
      setSubscriptions(payload.subscriptions);
      if (activeSubscriptionId === id) {
        setActiveSubscriptionId(null);
        setActiveSubscriptionLabel("");
        setActiveEntries([]);
      }
      setPendingDelete(null);
      setMessage(payload.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove subscription.");
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenSubscription(id: string) {
    setEntriesLoading(true);
    setActiveEntries([]);
    setActiveSubscriptionId(id);
    setActiveSubscriptionLabel(subscriptions.find((item) => item.id === id)?.label ?? "");
    try {
      const payload = await fetchSeedSubscriptionEntries({ subscriptionId: id });
      setActiveEntries(payload.entries);
      setActiveSubscriptionId(payload.subscription.id);
      setActiveSubscriptionLabel(payload.subscription.label);
      setMessage(payload.message);
    } catch (error) {
      setActiveEntries([]);
      setMessage(error instanceof Error ? error.message : "Failed to parse subscription entries.");
    } finally {
      setEntriesLoading(false);
    }
  }

  async function handleRefreshEntries() {
    if (!activeSubscriptionId) {
      return;
    }
    await handleOpenSubscription(activeSubscriptionId);
  }

  function handleBackToList() {
    setActiveSubscriptionId(null);
    setActiveSubscriptionLabel("");
    setActiveEntries([]);
    setMessage(subscriptions.length === 0 ? "Please add a subscription URL first." : "Select a subscription to view entries.");
  }

  async function handlePull() {
    setSyncing(true);
    try {
      const payload = await pullSeedSubscriptions();
      setSubscriptions(payload.subscriptions);
      setActiveSubscriptionId(null);
      setActiveSubscriptionLabel("");
      setActiveEntries([]);
      setMessage(payload.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pull failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function handlePush() {
    setSyncing(true);
    try {
      const payload = await pushSeedSubscriptions();
      setSubscriptions(payload.subscriptions);
      setMessage(payload.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Push failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDownload(item: SeedTorrentEntryItem) {
    if (!activeSubscriptionId) {
      return;
    }
    setDownloadingEntryId(item.id);
    setMessage(`Downloading torrent: ${item.title}`);
    try {
      const payload = await downloadSeedTorrent({
        subscriptionId: activeSubscriptionId,
        entryId: item.id,
        downloadUrl: item.downloadUrl,
      });
      setSubscriptions(payload.subscriptions);
      setActiveEntries((current) =>
        current.map((entry) => (entry.id === payload.entryId ? { ...entry, localFilePath: payload.localFilePath } : entry)),
      );
      setMessage(payload.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Torrent download failed.");
    } finally {
      setDownloadingEntryId(null);
    }
  }

  async function handleOpenTorrent(filePath: string) {
    try {
      const payload = await openSeedTorrent({ filePath });
      setMessage(payload.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to open torrent file.");
    }
  }

  return (
    <>
      <main className="layout">
        <section className="control-card">
          <div className="section-title-row">
            <h2>{activeSubscriptionId ? activeSubscriptionLabel || "Subscription Entries" : "Seed Download"}</h2>
            <div className="section-actions">
              {activeSubscriptionId ? (
                <>
                  <button className="ghost-button" type="button" onClick={handleBackToList}>
                    Back
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void handleRefreshEntries()} disabled={entriesLoading}>
                    Refresh
                  </button>
                </>
              ) : (
                <>
                  <button className="ghost-button" type="button" onClick={() => void handlePull()} disabled={syncing}>
                    {syncing ? "Pulling..." : "Pull"}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void handlePush()} disabled={syncing}>
                    {syncing ? "Pushing..." : "Push"}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setAddDialogVisible(true)} disabled={loading || syncing}>
                    Add
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="status-banner">{message}</p>
        </section>

        <section className="list-card">
          {activeSubscriptionId ? (
            entriesLoading ? (
              <div className="empty-state">Loading entries...</div>
            ) : activeEntries.length === 0 ? (
              <div className="empty-state">No torrent entries found.</div>
            ) : (
              <div className="remote-entry-list">
                {activeEntries.map((item) => {
                  const busy = downloadingEntryId === item.id;
                  return (
                    <article className="remote-entry-card" key={item.id}>
                      <div className="remote-entry-head">
                        <h3 title={item.title}>{item.title}</h3>
                      </div>
                      <p>
                        Size: {item.sizeText || "-"} | Uploaded: {item.uploadText || "-"}
                      </p>
                      <p>Local status: {item.localFilePath ? "Downloaded" : "Not downloaded"}</p>
                      <div className="remote-entry-actions">
                        <button className="action-button" type="button" onClick={() => void handleDownload(item)} disabled={busy}>
                          {busy ? "Downloading..." : "Download Torrent"}
                        </button>
                        <button
                          className="action-button secondary"
                          type="button"
                          onClick={() => item.localFilePath && void handleOpenTorrent(item.localFilePath)}
                          disabled={!item.localFilePath || busy}
                        >
                          Open Torrent
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          ) : loading ? (
            <div className="empty-state">Loading subscriptions...</div>
          ) : subscriptions.length === 0 ? (
            <div className="empty-state">No subscriptions yet.</div>
          ) : (
            <div className="remote-entry-list">
              {subscriptions.map((item) => (
                <article className="remote-entry-card" key={item.id}>
                  <div className="remote-entry-head">
                    <h3 title={item.label}>{item.label}</h3>
                    <button
                      className="remote-delete-button"
                      type="button"
                      onClick={() => setPendingDelete(item)}
                      disabled={syncing || loading}
                      aria-label={`Remove subscription ${item.label}`}
                    >
                      ×
                    </button>
                  </div>
                  <a className="seed-subscription-link" href={item.url} target="_blank" rel="noreferrer noopener">
                    {item.url}
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {addDialogVisible ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setAddDialogVisible(false)}>
          <div className="modal-card remote-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>Add Subscription</h2>
            </div>
            <label className="select-wrap">
              <span>Subscription URL</span>
              <input
                className="text-input"
                value={addUrlInput}
                onChange={(event) => setAddUrlInput(event.target.value)}
                placeholder="https://nyaa.si/?f=0&c=0_0&q=..."
              />
            </label>
            <div className="section-actions">
              <button className="ghost-button" type="button" onClick={() => setAddDialogVisible(false)}>
                Cancel
              </button>
              <button className="action-button" type="button" onClick={() => void handleAddSubscription()} disabled={loading}>
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setPendingDelete(null)}>
          <div className="modal-card remote-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <h2>Confirm Delete</h2>
            </div>
            <p>Are you sure you want to remove subscription "{pendingDelete.label}"?</p>
            <div className="section-actions">
              <button className="ghost-button" type="button" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button className="action-button danger" type="button" onClick={() => void handleRemoveSubscription(pendingDelete.id)} disabled={loading}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
