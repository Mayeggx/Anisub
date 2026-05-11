import path from "node:path";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { decode } from "html-entities";

import type {
  AddSeedSubscriptionRequest,
  DownloadSeedTorrentRequest,
  DownloadSeedTorrentResponse,
  OpenSeedTorrentResponse,
  RemoveSeedSubscriptionRequest,
  SeedDownloadEntriesRequest,
  SeedDownloadEntriesResponse,
  SeedDownloadMutationResponse,
  SeedDownloadSubscriptionsResponse,
  SeedDownloadSyncResponse,
  SeedSubscriptionItem,
  SeedTorrentEntryItem,
} from "../shared/types";
import { AppError } from "./errors";

const DEFAULT_REMOTE_URL = "https://gitee.com/mayeggx/pic4nisub.git";
const DEFAULT_BRANCH = "main";
const SEED_SYNC_FILE_NAME = "seed-subscriptions.json";
const DOWNLOAD_ROOT = path.resolve(process.cwd(), ".anisub", "video_subscriptions");
const STORE_DIR = path.resolve(process.cwd(), ".anisub", "seed-download");
const SUBSCRIPTIONS_PATH = path.join(STORE_DIR, "subscriptions.json");
const REMOTE_SYNC_CONFIG_PATH = path.resolve(process.cwd(), ".anisub", "remote-sync", "config.json");
const REPO_DIR = path.resolve(process.cwd(), ".anisub", "remote-sync", "repo-a");

const ID_PATTERN = /\/(?:view|download)\/(\d+)/i;
const ROW_PATTERN = /<tr[^>]*>(.*?)<\/tr>/gis;
const TD_PATTERN = /<td[^>]*>(.*?)<\/td>/gis;
const VIEW_LINK_PATTERN = /<a[^>]*href\s*=\s*["']([^"']*\/view\/\d+[^"']*)["'][^>]*>(.*?)<\/a>/gis;
const DOWNLOAD_LINK_PATTERN = /<a[^>]*href\s*=\s*["']([^"']*\/download\/\d+[^"']*)["']/gis;
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_RETRY_ATTEMPTS = 3;
const NYAA_MIRROR_HOSTS = ["nyaa.si", "nyaa.land", "nyaa.iss.ink"] as const;

type PersistedSubscription = {
  id: string;
  label: string;
  url: string;
  folderName: string;
};

type ParsedTorrentEntry = {
  id: string;
  title: string;
  sizeText: string;
  uploadText: string;
  downloadUrl: string;
};

type SeedSyncConfig = {
  remoteUrl: string;
  gitUsername: string;
  gitToken: string;
  commitUserName: string;
  commitUserEmail: string;
};

type GitCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type RunGitOptions = {
  cwd: string;
  authConfig?: SeedSyncConfig;
  allowFailure?: boolean;
};

export class SeedDownloadService {
  async listSubscriptions(): Promise<SeedDownloadSubscriptionsResponse> {
    const subscriptions = await this.readSubscriptions();
    return {
      subscriptions: await this.toUiSubscriptions(subscriptions),
    };
  }

  async addSubscription(input: AddSeedSubscriptionRequest): Promise<SeedDownloadMutationResponse> {
    const normalizedUrl = normalizeSubscriptionUrl(input.url);
    if (!normalizedUrl) {
      throw new AppError("Invalid subscription URL.", 400);
    }

    const current = await this.readSubscriptions();
    if (current.some((item) => item.url === normalizedUrl)) {
      return {
        subscriptions: await this.toUiSubscriptions(current),
        message: "Subscription already exists.",
      };
    }

    const uri = new URL(normalizedUrl);
    const label = buildSubscriptionLabel(uri);
    const id = generateSubscriptionId();
    const next: PersistedSubscription = {
      id,
      label,
      url: normalizedUrl,
      folderName: buildFolderName(label, id),
    };
    const updated = [next, ...current];
    await this.saveSubscriptions(updated);
    return {
      subscriptions: await this.toUiSubscriptions(updated),
      message: `Added subscription: ${label}`,
    };
  }

  async removeSubscription(input: RemoveSeedSubscriptionRequest): Promise<SeedDownloadMutationResponse> {
    const current = await this.readSubscriptions();
    const target = current.find((item) => item.id === input.id);
    if (!target) {
      throw new AppError("Subscription not found.", 404);
    }

    const updated = current.filter((item) => item.id !== input.id);
    await this.saveSubscriptions(updated);
    return {
      subscriptions: await this.toUiSubscriptions(updated),
      message: `Removed subscription: ${target.label}`,
    };
  }

  async listEntries(input: SeedDownloadEntriesRequest): Promise<SeedDownloadEntriesResponse> {
    const subscriptions = await this.readSubscriptions();
    const target = subscriptions.find((item) => item.id === input.subscriptionId);
    if (!target) {
      throw new AppError("Subscription not found.", 404);
    }

    const parsed = await fetchEntriesFromSubscription(target.url);
    const folder = await ensureSubscriptionFolder(target);
    const entries: SeedTorrentEntryItem[] = [];
    for (const entry of parsed) {
      const localPath = path.join(folder, torrentFileName(entry.id));
      const exists = await stat(localPath).catch(() => null);
      entries.push({
        id: entry.id,
        title: entry.title,
        sizeText: entry.sizeText,
        uploadText: entry.uploadText,
        downloadUrl: entry.downloadUrl,
        localFilePath: exists?.isFile() ? localPath : null,
      });
    }

    const subscription = await this.toUiSubscription(target);
    return {
      subscription,
      entries,
      message: entries.length === 0 ? "No entries parsed from this subscription." : `Loaded ${entries.length} entries.`,
    };
  }

  async downloadTorrent(input: DownloadSeedTorrentRequest): Promise<DownloadSeedTorrentResponse> {
    const subscriptions = await this.readSubscriptions();
    const target = subscriptions.find((item) => item.id === input.subscriptionId);
    if (!target) {
      throw new AppError("Subscription not found.", 404);
    }

    if (!input.entryId.trim()) {
      throw new AppError("Missing entry ID.", 400);
    }
    if (!input.downloadUrl.trim()) {
      throw new AppError("Missing download URL.", 400);
    }

    const folder = await ensureSubscriptionFolder(target);
    const bytes = await downloadBytes(input.downloadUrl.trim());
    const localFilePath = path.join(folder, torrentFileName(input.entryId.trim()));
    await writeFile(localFilePath, bytes);

    return {
      entryId: input.entryId.trim(),
      localFilePath,
      subscriptions: await this.toUiSubscriptions(subscriptions),
      message: `Download complete: ${path.basename(localFilePath)}`,
    };
  }

  async openTorrentFile(filePath: string): Promise<OpenSeedTorrentResponse> {
    const normalizedPath = filePath.trim();
    if (!normalizedPath) {
      throw new AppError("Missing torrent file path.", 400);
    }
    const resolvedPath = path.resolve(normalizedPath);
    const fileStat = await stat(resolvedPath).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new AppError("Torrent file does not exist.", 404);
    }
    await openFileWithDefaultApp(resolvedPath);
    return {
      openedPath: resolvedPath,
      message: `Opened torrent file: ${path.basename(resolvedPath)}`,
    };
  }

  async pullSubscriptionConfig(): Promise<SeedDownloadSyncResponse> {
    const config = await this.loadSeedSyncConfig();
    await this.openOrCreateRepository(config);
    await this.safePull(config);

    const syncFilePath = path.join(REPO_DIR, SEED_SYNC_FILE_NAME);
    const hit = await stat(syncFilePath).catch(() => null);
    if (!hit?.isFile()) {
      const current = await this.readSubscriptions();
      return {
        fileFound: false,
        syncedCount: current.length,
        subscriptions: await this.toUiSubscriptions(current),
        message: "Pull complete. seed-subscriptions.json was not found on remote.",
      };
    }

    const payload = await readFile(syncFilePath, "utf-8");
    const urls = parseSeedSyncPayload(payload);
    const current = await this.readSubscriptions();
    const merged = mergeSubscriptionsByUrls(current, urls);
    await this.saveSubscriptions(merged);
    return {
      fileFound: true,
      syncedCount: merged.length,
      subscriptions: await this.toUiSubscriptions(merged),
      message: `Pull complete. Synced ${merged.length} subscriptions.`,
    };
  }

  async pushSubscriptionConfig(): Promise<SeedDownloadSyncResponse> {
    const config = await this.loadSeedSyncConfig();
    await this.openOrCreateRepository(config);
    await this.safePull(config);

    const current = await this.readSubscriptions();
    const uniqueUrls = [...new Set(current.map((item) => item.url))];
    const syncFilePath = path.join(REPO_DIR, SEED_SYNC_FILE_NAME);
    await writeFile(syncFilePath, buildSeedSyncPayload(uniqueUrls), "utf-8");
    await this.commitAndPushIfNeeded(config, "seed-sync: update subscriptions", [SEED_SYNC_FILE_NAME]);

    return {
      fileFound: true,
      syncedCount: uniqueUrls.length,
      subscriptions: await this.toUiSubscriptions(current),
      message: `Push complete. Synced ${uniqueUrls.length} subscriptions.`,
    };
  }

  private async toUiSubscriptions(items: PersistedSubscription[]): Promise<SeedSubscriptionItem[]> {
    const result: SeedSubscriptionItem[] = [];
    for (const item of items) {
      result.push(await this.toUiSubscription(item));
    }
    return result;
  }

  private async toUiSubscription(item: PersistedSubscription): Promise<SeedSubscriptionItem> {
    const folder = await ensureSubscriptionFolder(item);
    const files = await readdir(folder, { withFileTypes: true }).catch(() => []);
    const downloadedCount = files.filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".torrent"),
    ).length;
    return {
      id: item.id,
      label: item.label,
      url: item.url,
      folderName: item.folderName,
      downloadedCount,
    };
  }

  private async readSubscriptions(): Promise<PersistedSubscription[]> {
    await mkdir(STORE_DIR, { recursive: true });
    const raw = await readFile(SUBSCRIPTIONS_PATH, "utf-8").catch(() => "");
    if (!raw.trim()) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((item) => normalizePersistedSubscription(item))
        .filter((item): item is PersistedSubscription => Boolean(item))
        .filter((item) => Boolean(normalizeSubscriptionUrl(item.url)));
    } catch {
      return [];
    }
  }

  private async saveSubscriptions(items: PersistedSubscription[]): Promise<void> {
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(SUBSCRIPTIONS_PATH, `${JSON.stringify(items, null, 2)}\n`, "utf-8");
  }

  private async loadSeedSyncConfig(): Promise<SeedSyncConfig> {
    const raw = await readFile(REMOTE_SYNC_CONFIG_PATH, "utf-8").catch(() => "");
    if (!raw.trim()) {
      return defaultSeedSyncConfig();
    }
    try {
      const parsed = JSON.parse(raw) as Partial<SeedSyncConfig>;
      return normalizeSeedSyncConfig({
        remoteUrl: parsed.remoteUrl ?? DEFAULT_REMOTE_URL,
        gitUsername: parsed.gitUsername ?? "",
        gitToken: parsed.gitToken ?? "",
        commitUserName: parsed.commitUserName ?? "Anisub Remote Sync",
        commitUserEmail: parsed.commitUserEmail ?? "anisub@local",
      });
    } catch {
      return defaultSeedSyncConfig();
    }
  }

  private async openOrCreateRepository(config: SeedSyncConfig): Promise<void> {
    await mkdir(REPO_DIR, { recursive: true });
    const dotGitPath = path.join(REPO_DIR, ".git");
    const dotGitStat = await stat(dotGitPath).catch(() => null);
    if (dotGitStat?.isDirectory()) {
      await this.configureRepository(config);
      return;
    }

    const files = await readdir(REPO_DIR).catch(() => [] as string[]);
    if (files.length > 0) {
      await rm(REPO_DIR, { recursive: true, force: true });
      await mkdir(REPO_DIR, { recursive: true });
    }

    const cloneResult = await runGit(["clone", config.remoteUrl, REPO_DIR], {
      cwd: process.cwd(),
      authConfig: config,
      allowFailure: true,
    });
    if (cloneResult.code !== 0) {
      throw new AppError(
        `Failed to clone remote repository. ${cloneResult.stderr || cloneResult.stdout}`.trim(),
        500,
      );
    }
    await this.configureRepository(config);
  }

  private async configureRepository(config: SeedSyncConfig): Promise<void> {
    await runGit(["config", "remote.origin.url", config.remoteUrl], { cwd: REPO_DIR });
    await runGit(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], { cwd: REPO_DIR });
    await runGit(["config", "branch.main.remote", "origin"], { cwd: REPO_DIR });
    await runGit(["config", "branch.main.merge", `refs/heads/${DEFAULT_BRANCH}`], { cwd: REPO_DIR });
    await runGit(["config", "user.name", config.commitUserName || "Anisub Remote Sync"], { cwd: REPO_DIR });
    await runGit(["config", "user.email", config.commitUserEmail || "anisub@local"], { cwd: REPO_DIR });
  }

  private async safePull(config: SeedSyncConfig): Promise<void> {
    const pullResult = await runGit(["pull", "origin", DEFAULT_BRANCH, "--rebase"], {
      cwd: REPO_DIR,
      authConfig: config,
      allowFailure: true,
    });
    if (pullResult.code === 0) {
      return;
    }

    const pullMessage = `${pullResult.stdout}\n${pullResult.stderr}`.toLowerCase();
    if (pullMessage.includes("unrelated")) {
      await runGit(
        ["fetch", "origin", `+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}`],
        { cwd: REPO_DIR, authConfig: config },
      );
      const hasRemoteMain = await this.hasRemoteMainBranch();
      if (!hasRemoteMain) {
        throw new AppError(`Remote ${DEFAULT_BRANCH} branch not found.`, 500);
      }
      await runGit(["reset", "--hard", `refs/remotes/origin/${DEFAULT_BRANCH}`], { cwd: REPO_DIR });
      return;
    }

    const fetchResult = await runGit(["fetch", "origin"], {
      cwd: REPO_DIR,
      authConfig: config,
      allowFailure: true,
    });
    if (fetchResult.code !== 0) {
      throw new AppError(fetchResult.stderr.trim() || fetchResult.stdout.trim() || "Git fetch failed.", 500);
    }

    const hasRemoteMain = await this.hasRemoteMainBranch();
    if (!hasRemoteMain) {
      return;
    }
    throw new AppError("Git pull failed. Please check remote branch state and retry.", 500);
  }

  private async hasRemoteMainBranch(): Promise<boolean> {
    const result = await runGit(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${DEFAULT_BRANCH}`], {
      cwd: REPO_DIR,
      allowFailure: true,
    });
    return result.code === 0;
  }

  private async commitAndPushIfNeeded(config: SeedSyncConfig, message: string, paths: string[]): Promise<void> {
    for (const filePath of paths) {
      await stagePathForCommit(filePath);
    }
    const statusResult = await runGit(["status", "--porcelain"], { cwd: REPO_DIR });
    if (statusResult.stdout.trim()) {
      await runGit(["commit", "-m", message], { cwd: REPO_DIR });
    }

    try {
      await this.pushOrThrow(config);
    } catch {
      await this.safePull(config);
      await this.pushOrThrow(config);
    }
  }

  private async pushOrThrow(config: SeedSyncConfig): Promise<void> {
    const pushResult = await runGit(["push", "origin", `HEAD:refs/heads/${DEFAULT_BRANCH}`], {
      cwd: REPO_DIR,
      authConfig: config,
      allowFailure: true,
    });
    if (pushResult.code !== 0) {
      throw new AppError(pushResult.stderr.trim() || pushResult.stdout.trim() || "Git push failed.", 500);
    }
  }
}

async function stagePathForCommit(repoRelativePath: string): Promise<void> {
  const absolutePath = path.join(REPO_DIR, repoRelativePath);
  const exists = await stat(absolutePath).catch(() => null);
  if (exists) {
    await runGit(["add", "--", repoRelativePath], { cwd: REPO_DIR });
    return;
  }

  const trackedResult = await runGit(["ls-files", "--error-unmatch", "--", repoRelativePath], {
    cwd: REPO_DIR,
    allowFailure: true,
  });
  if (trackedResult.code === 0) {
    await runGit(["add", "-u", "--", repoRelativePath], { cwd: REPO_DIR });
  }
}

async function fetchEntriesFromSubscription(url: string): Promise<ParsedTorrentEntry[]> {
  const html = await downloadText(url);
  const results: ParsedTorrentEntry[] = [];
  for (const rowMatch of html.matchAll(ROW_PATTERN)) {
    const rowHtml = rowMatch[1] ?? "";
    const downloadMatch = [...rowHtml.matchAll(DOWNLOAD_LINK_PATTERN)][0];
    if (!downloadMatch) {
      continue;
    }

    const viewMatches = [...rowHtml.matchAll(VIEW_LINK_PATTERN)];
    const viewMatch = viewMatches.sort((left, right) => (right[2] ?? "").length - (left[2] ?? "").length)[0];
    if (!viewMatch) {
      continue;
    }

    const viewHref = viewMatch[1] ?? "";
    const downloadHref = downloadMatch[1] ?? "";
    const id = extractTorrentId(viewHref) ?? extractTorrentId(downloadHref);
    if (!id) {
      continue;
    }

    const columns = [...rowHtml.matchAll(TD_PATTERN)].map((hit) => textFromHtml(hit[1] ?? ""));
    results.push({
      id,
      title: textFromHtml(viewMatch[2] ?? ""),
      sizeText: columns[3] ?? "",
      uploadText: columns[4] ?? "",
      downloadUrl: resolveUrl(url, downloadHref),
    });
  }

  const dedup = new Map<string, ParsedTorrentEntry>();
  for (const item of results) {
    if (!dedup.has(item.id)) {
      dedup.set(item.id, item);
    }
  }
  return [...dedup.values()];
}

function extractTorrentId(link: string): string | null {
  const hit = link.match(ID_PATTERN);
  return hit?.[1] ?? null;
}

async function ensureSubscriptionFolder(item: PersistedSubscription): Promise<string> {
  await mkdir(DOWNLOAD_ROOT, { recursive: true });
  const folderPath = path.join(DOWNLOAD_ROOT, item.folderName);
  await mkdir(folderPath, { recursive: true });
  return folderPath;
}

function torrentFileName(entryId: string): string {
  return `${entryId}.torrent`;
}

async function downloadBytes(url: string): Promise<Buffer> {
  const response = await requestWithFallback(url);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length === 0) {
    throw new AppError("Torrent download returned empty content.", 502);
  }
  return data;
}

async function downloadText(url: string): Promise<string> {
  const response = await requestWithFallback(url);
  return response.text();
}

async function requestWithFallback(inputUrl: string): Promise<Response> {
  const candidates = buildCandidateUrls(inputUrl);
  const failures: string[] = [];

  for (const candidate of candidates) {
    for (let attempt = 1; attempt <= REQUEST_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchWithTimeout(candidate, REQUEST_TIMEOUT_MS);
        if (response.ok) {
          return response;
        }

        const reason = `HTTP ${response.status}`;
        failures.push(`${candidate} (${reason}, attempt ${attempt}/${REQUEST_RETRY_ATTEMPTS})`);
        if (!isRetryableStatus(response.status)) {
          break;
        }
      } catch (error) {
        const reason = describeFetchError(error);
        failures.push(`${candidate} (${reason}, attempt ${attempt}/${REQUEST_RETRY_ATTEMPTS})`);
      }
    }
  }

  const shortDetail = failures.slice(0, 4).join(" | ");
  throw new AppError(
    `Subscription request failed. ${shortDetail || "Unknown network error."} Browser may work while Node network path times out.`,
    502,
  );
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function buildCandidateUrls(rawUrl: string): string[] {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (!NYAA_MIRROR_HOSTS.includes(host as (typeof NYAA_MIRROR_HOSTS)[number])) {
      return [parsed.toString()];
    }
    const urls = [parsed.toString()];
    for (const mirrorHost of NYAA_MIRROR_HOSTS) {
      if (mirrorHost === host) {
        continue;
      }
      const mirror = new URL(parsed.toString());
      mirror.hostname = mirrorHost;
      urls.push(mirror.toString());
    }
    return urls;
  } catch {
    return [rawUrl];
  }
}

function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown network error";
  }

  if (error.name === "AbortError") {
    return `timeout(${REQUEST_TIMEOUT_MS}ms)`;
  }

  const cause = (error as Error & { cause?: unknown }).cause as { code?: string; message?: string } | undefined;
  if (cause?.code === "UND_ERR_CONNECT_TIMEOUT") {
    return "connect timeout";
  }
  if (cause?.code === "UND_ERR_HEADERS_TIMEOUT") {
    return "headers timeout";
  }
  if (cause?.code === "ECONNRESET") {
    return "connection reset";
  }
  if (cause?.code === "ENOTFOUND") {
    return "dns not found";
  }
  if (cause?.message) {
    return cause.message;
  }

  return error.message || "unknown network error";
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function resolveUrl(baseUrl: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}

function textFromHtml(fragment: string): string {
  const text = decode(fragment.replace(/<[^>]*>/g, " "));
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePersistedSubscription(raw: unknown): PersistedSubscription | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Partial<PersistedSubscription>;
  const id = String(item.id ?? "").trim();
  const label = String(item.label ?? "").trim();
  const url = String(item.url ?? "").trim();
  const folderName = String(item.folderName ?? "").trim();
  if (!id || !label || !url || !folderName) {
    return null;
  }
  return { id, label, url, folderName };
}

function normalizeSubscriptionUrl(rawUrl: string): string | null {
  const value = rawUrl.trim();
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (!url.protocol || !url.hostname) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function generateSubscriptionId(): string {
  return `${Date.now()}_${randomInt(1000, 10000)}`;
}

function buildSubscriptionLabel(url: URL): string {
  const query = (url.searchParams.get("q") ?? "").replace(/\+/g, " ").trim();
  if (query) {
    return query;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments.at(-1)?.trim() ?? "";
  if (last) {
    return last;
  }
  return url.hostname || "subscription";
}

function buildFolderName(label: string, id: string): string {
  const safe = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "subscription";
  return `${safe}_${id}`;
}

function mergeSubscriptionsByUrls(current: PersistedSubscription[], rawUrls: string[]): PersistedSubscription[] {
  const existingByUrl = new Map(current.map((item) => [item.url, item]));
  const merged: PersistedSubscription[] = [];
  for (const rawUrl of rawUrls) {
    const normalized = normalizeSubscriptionUrl(rawUrl);
    if (!normalized) {
      continue;
    }
    const existing = existingByUrl.get(normalized);
    if (existing) {
      merged.push(existing);
      continue;
    }
    const uri = new URL(normalized);
    const label = buildSubscriptionLabel(uri);
    const id = generateSubscriptionId();
    merged.push({
      id,
      label,
      url: normalized,
      folderName: buildFolderName(label, id),
    });
  }
  const unique = new Map<string, PersistedSubscription>();
  for (const item of merged) {
    if (!unique.has(item.url)) {
      unique.set(item.url, item);
    }
  }
  return [...unique.values()];
}

function buildSeedSyncPayload(urls: string[]): string {
  const entries = urls.map((url) => ({ url }));
  return `${JSON.stringify({ entries }, null, 2)}\n`;
}

function parseSeedSyncPayload(payload: string): string[] {
  const trimmed = payload.trim();
  if (!trimmed) {
    return [];
  }

  let rawItems: string[] = [];
  try {
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed) as { entries?: unknown; urls?: unknown };
      rawItems = parseSeedSyncUrlArray(parsed.entries ?? parsed.urls);
    } else if (trimmed.startsWith("[")) {
      rawItems = parseSeedSyncUrlArray(JSON.parse(trimmed) as unknown);
    }
  } catch {
    return [];
  }

  const normalized = rawItems
    .map((item) => normalizeSubscriptionUrl(item))
    .filter((item): item is string => Boolean(item));
  return [...new Set(normalized)];
}

function parseSeedSyncUrlArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const urls: string[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      urls.push(item);
      continue;
    }
    if (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string") {
      urls.push((item as { url: string }).url);
    }
  }
  return urls;
}

function defaultSeedSyncConfig(): SeedSyncConfig {
  return {
    remoteUrl: DEFAULT_REMOTE_URL,
    gitUsername: "",
    gitToken: "",
    commitUserName: "Anisub Remote Sync",
    commitUserEmail: "anisub@local",
  };
}

function normalizeSeedSyncConfig(config: SeedSyncConfig): SeedSyncConfig {
  return {
    remoteUrl: config.remoteUrl.trim() || DEFAULT_REMOTE_URL,
    gitUsername: config.gitUsername.trim(),
    gitToken: config.gitToken.trim(),
    commitUserName: config.commitUserName.trim() || "Anisub Remote Sync",
    commitUserEmail: config.commitUserEmail.trim() || "anisub@local",
  };
}

async function runGit(args: string[], options: RunGitOptions): Promise<GitCommandResult> {
  const authArgs = buildGitAuthArgs(options.authConfig);
  const fullArgs = authArgs.concat(args);
  const result = await runCommand("git", fullArgs, options.cwd);
  if (result.code !== 0 && !options.allowFailure) {
    const reason = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed (${result.code})`;
    throw new AppError(reason, 500);
  }
  return result;
}

function runCommand(command: string, args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise<GitCommandResult>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new AppError("Git executable not found in PATH.", 500));
        return;
      }
      reject(new AppError(error.message, 500));
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

function buildGitAuthArgs(config: SeedSyncConfig | undefined): string[] {
  if (!config) {
    return [];
  }
  const token = config.gitToken.trim();
  if (!token) {
    return [];
  }
  const username = config.gitUsername.trim() || "oauth2";
  const basic = Buffer.from(`${username}:${token}`).toString("base64");
  return ["-c", `http.extraheader=Authorization: Basic ${basic}`];
}

async function openFileWithDefaultApp(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new AppError("Opening torrent files is only supported on Windows.", 400);
  }
  const escaped = filePath.replace(/'/g, "''");
  await runPowerShell(
    `if (-not (Test-Path -LiteralPath '${escaped}' -PathType Leaf)) { exit 2 }; Start-Process -FilePath '${escaped}'`,
  );
}

function runPowerShell(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-Command", script], {
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => reject(new AppError(error.message, 500)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new AppError(stderr.trim() || `PowerShell execution failed (${code ?? "unknown"}).`, 500));
        return;
      }
      resolve();
    });
  });
}
