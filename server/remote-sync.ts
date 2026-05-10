import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
import sharp from "sharp";

import {
  RemoteSyncConfig,
  RemoteSyncEntry,
  RemoteSyncStateResponse,
} from "../shared/types";
import { AppError, toErrorMessage } from "./errors";

const DEFAULT_REMOTE_URL = "https://gitee.com/mayeggx/pic4nisub.git";
const DEFAULT_BRANCH = "main";
const ENTRIES_DIR = "entries";
const ENTRY_META_FILE = "entry.json";
const DEFAULT_IMAGE_SCALE_PERCENT = 50;
const DEFAULT_IMAGE_JPEG_QUALITY = 70;

type EntryBinding = {
  id: string;
  displayName: string;
  deviceId: string;
  deviceName: string;
  folderPath: string;
  folderLabel: string;
  repoPath: string;
  updatedAt: number;
};

type RepoEntryMeta = {
  id: string;
  displayName: string;
  deviceId: string;
  deviceName: string;
  repoPath: string;
  updatedAt: number;
};

type DeviceInfo = {
  id: string;
  name: string;
};

type ImageCompressionSetting = {
  scalePercent: number;
  jpegQuality: number;
};

type CopyStats = {
  copiedFiles: number;
  compressedImages: number;
  skippedFiles: number;
};

type GitCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type RunGitOptions = {
  cwd: string;
  authConfig?: RemoteSyncConfig;
  allowFailure?: boolean;
};

export class RemoteSyncService {
  private readonly store = new RemoteSyncStore();
  private readonly gitService = new RemoteSyncGitService();
  private readonly deviceInfo = resolveDeviceInfo();

  private initialized = false;
  private statusMessage = "请先填写 Git 配置，然后创建条目并执行 Push。";
  private headSummary = "未读取";
  private entries: RemoteSyncEntry[] = [];
  private gitLogs: string[] = [];

  async getState(): Promise<RemoteSyncStateResponse> {
    await this.ensureInitialized();
    return this.buildState();
  }

  async refreshEntries(): Promise<RemoteSyncStateResponse> {
    return this.runTask("刷新", async () => {
      const config = await this.store.loadConfig();
      await this.refreshEntryListInternal();
      const headSummary = await this.appendHeadSummary(config);
      return `已刷新条目列表。${headSummary}`;
    });
  }

  async clearGitLogs(): Promise<RemoteSyncStateResponse> {
    this.gitLogs = [];
    return this.buildState();
  }

  async saveConfig(config: RemoteSyncConfig): Promise<RemoteSyncStateResponse> {
    const normalized = normalizeConfig(config);
    await this.store.saveConfig(normalized);
    this.statusMessage = "配置已保存。";
    return this.buildState(normalized);
  }

  async updateImageCompression(scalePercent: number, jpegQuality: number): Promise<RemoteSyncStateResponse> {
    const current = await this.store.loadConfig();
    const next = normalizeConfig({
      ...current,
      imageScalePercent: scalePercent,
      imageJpegQuality: jpegQuality,
    });
    await this.store.saveConfig(next);
    this.statusMessage = "配置已保存。";
    return this.buildState(next);
  }

  async createEntry(input: { displayName: string; folderPath: string; folderLabel?: string }): Promise<RemoteSyncStateResponse> {
    const folderPath = path.resolve(input.folderPath.trim());
    const folderStat = await stat(folderPath).catch(() => null);
    if (!folderStat?.isDirectory()) {
      throw new AppError("文件夹 B 不存在或不可访问。", 400);
    }

    const cleanName = input.displayName.trim() || `entry-${Date.now()}`;
    const slug = sanitizePathSegment(cleanName);
    const id = `${this.deviceInfo.id}-${slug}`;
    const repoPath = `${ENTRIES_DIR}/${sanitizePathSegment(this.deviceInfo.id)}/${slug}`;
    const binding: EntryBinding = {
      id,
      displayName: cleanName,
      deviceId: this.deviceInfo.id,
      deviceName: this.deviceInfo.name,
      folderPath,
      folderLabel: input.folderLabel?.trim() || path.basename(folderPath),
      repoPath,
      updatedAt: Date.now(),
    };

    const bindings = await this.store.loadBindings();
    const updated = bindings.filter((item) => item.id !== id).concat(binding);
    await this.store.saveBindings(updated);
    this.statusMessage = `已创建条目：${cleanName}`;
    this.initialized = false;
    return this.refreshEntries();
  }

  async pull(): Promise<RemoteSyncStateResponse> {
    return this.runTask("Pull", async () => {
      const config = await this.store.loadConfig();
      await this.gitService.pull(config, (line) => this.appendGitLog(line));
      await this.refreshEntryListInternal();
      const headSummary = await this.appendHeadSummary(config);
      return `Pull 完成。${headSummary}`;
    });
  }

  async push(entryId: string): Promise<RemoteSyncStateResponse> {
    return this.runTask("Push", async () => {
      const config = await this.store.loadConfig();
      const entry = await this.requirePushableBinding(entryId);
      this.appendGitLog(`Push 条目: ${entry.displayName} (${entry.repoPath})`);
      const stats = await this.gitService.pushEntry(config, entry, (line) => this.appendGitLog(line));
      await this.refreshEntryListInternal();
      const headSummary = await this.appendHeadSummary(config);
      return `Push 完成：${entry.displayName}，复制 ${stats.copiedFiles} 个文件，压缩 ${stats.compressedImages} 张图片，跳过重名 ${stats.skippedFiles} 个文件。${headSummary}`;
    });
  }

  async clear(entryId: string): Promise<RemoteSyncStateResponse> {
    return this.runTask("清空", async () => {
      const config = await this.store.loadConfig();
      const localBindings = await this.store.loadBindings();
      const knownEntries = await this.getKnownEntries(localBindings);
      const entry = knownEntries.find((item) => item.id === entryId);
      if (!entry) {
        throw new AppError("条目不存在。", 404);
      }

      this.appendGitLog(`清空条目: ${entry.displayName} (${entry.repoPath})`);
      const localBinding = localBindings.find((item) => item.id === entryId);
      const deletedFiles =
        localBinding?.folderPath && localBinding.folderPath.trim()
          ? await clearFolderContents(localBinding.folderPath)
          : null;

      await this.gitService.clearEntry(
        config,
        {
          id: entry.id,
          displayName: entry.displayName,
          deviceId: entry.deviceId,
          deviceName: entry.deviceName,
          repoPath: entry.repoPath,
          updatedAt: entry.updatedAt,
        },
        (line) => this.appendGitLog(line),
      );

      await this.refreshEntryListInternal();
      if (deletedFiles === null) {
        return `清空完成：${entry.displayName}，无本地绑定，仅清空远端。`;
      }
      return `清空完成：${entry.displayName}，本地删除 ${deletedFiles} 个文件，远端已推送。`;
    });
  }

  async delete(entryId: string): Promise<RemoteSyncStateResponse> {
    return this.runTask("删除", async () => {
      const localBindings = await this.store.loadBindings();
      const knownEntries = await this.getKnownEntries(localBindings);
      const entry = knownEntries.find((item) => item.id === entryId);
      if (!entry) {
        throw new AppError("条目不存在。", 404);
      }

      const localBinding = localBindings.find((item) => item.id === entryId);
      const remoteEntries = await this.gitService.scanRemoteEntries().catch(() => [] as RepoEntryMeta[]);
      const existsInRemoteRepo = remoteEntries.some((item) => item.id === entry.id || item.repoPath === entry.repoPath);
      if (localBinding && !existsInRemoteRepo) {
        this.appendGitLog(`删除条目: ${entry.displayName}（仅本地条目，跳过 push）`);
        await this.store.saveBindings(localBindings.filter((item) => item.id !== entryId));
        await this.refreshEntryListInternal();
        return `删除完成：${entry.displayName}（仅本地条目，无需 push）`;
      }

      const config = await this.store.loadConfig();
      this.appendGitLog(`删除条目: ${entry.displayName} (${entry.repoPath})`);
      await this.gitService.deleteEntry(config, entry.repoPath, (line) => this.appendGitLog(line));
      await this.store.saveBindings(localBindings.filter((item) => item.id !== entryId));
      await this.refreshEntryListInternal();
      return `删除完成：${entry.displayName}`;
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.refreshEntryListInternal();
    const config = await this.store.loadConfig();
    try {
      await this.appendHeadSummary(config);
    } catch (error) {
      this.headSummary = "未读取";
      this.appendGitLog(`读取 HEAD 失败: ${toErrorMessage(error)}`);
    }
    this.initialized = true;
  }

  private async buildState(configInput?: RemoteSyncConfig): Promise<RemoteSyncStateResponse> {
    const config = configInput ?? (await this.store.loadConfig());
    return {
      config,
      entries: this.entries,
      statusMessage: this.statusMessage,
      deviceId: this.deviceInfo.id,
      deviceName: this.deviceInfo.name,
      repoPath: this.gitService.repoDir,
      headSummary: this.headSummary,
      gitLogs: this.gitLogs,
    };
  }

  private async runTask(operationName: string, task: () => Promise<string>): Promise<RemoteSyncStateResponse> {
    this.appendGitLog(`${operationName}: 开始`);
    try {
      const message = await task();
      if (message.trim()) {
        this.statusMessage = message;
      }
      this.appendGitLog(`${operationName}: 完成`);
    } catch (error) {
      const errorMessage = `失败：${toErrorMessage(error)}`;
      this.statusMessage = errorMessage;
      this.appendGitLog(`${operationName}: ${errorMessage}`);
    }
    return this.buildState();
  }

  private async refreshEntryListInternal(): Promise<void> {
    const localBindings = await this.store.loadBindings();
    const remoteEntries = await this.gitService.scanRemoteEntries().catch(() => [] as RepoEntryMeta[]);
    const folderFileCounts = new Map<string, number | null>();
    for (const binding of localBindings) {
      folderFileCounts.set(binding.id, await countFilesInDirectory(binding.folderPath));
    }
    for (const remote of remoteEntries) {
      if (!folderFileCounts.has(remote.id)) {
        folderFileCounts.set(remote.id, await countFilesInRepoEntryDirectory(this.gitService.repoDir, remote.repoPath));
      }
    }
    this.entries = mergeEntries(localBindings, remoteEntries, folderFileCounts, this.gitService.repoDir);
  }

  private async getKnownEntries(localBindings: EntryBinding[]): Promise<RemoteSyncEntry[]> {
    const remoteEntries = await this.gitService.scanRemoteEntries().catch(() => [] as RepoEntryMeta[]);
    const folderFileCounts = new Map<string, number | null>();
    for (const binding of localBindings) {
      folderFileCounts.set(binding.id, await countFilesInDirectory(binding.folderPath));
    }
    for (const remote of remoteEntries) {
      if (!folderFileCounts.has(remote.id)) {
        folderFileCounts.set(remote.id, await countFilesInRepoEntryDirectory(this.gitService.repoDir, remote.repoPath));
      }
    }
    return mergeEntries(localBindings, remoteEntries, folderFileCounts, this.gitService.repoDir);
  }

  private async requirePushableBinding(entryId: string): Promise<EntryBinding> {
    const bindings = await this.store.loadBindings();
    const entry = bindings.find((item) => item.id === entryId);
    if (!entry) {
      throw new AppError("找不到本地绑定条目。", 404);
    }
    if (entry.deviceId !== this.deviceInfo.id || !entry.folderPath.trim()) {
      throw new AppError("该条目不支持当前设备执行 Push。", 400);
    }
    return entry;
  }

  private async appendHeadSummary(config: RemoteSyncConfig): Promise<string> {
    const headSummary = await this.gitService.readHeadSummary(config, (line) => this.appendGitLog(line));
    this.headSummary = headSummary;
    this.appendGitLog(`当前HEAD: ${headSummary}`);
    return `当前HEAD: ${headSummary}`;
  }

  private appendGitLog(message: string): void {
    const now = new Date();
    const time = `${now.toTimeString().slice(0, 8)}.${`${now.getMilliseconds()}`.padStart(3, "0")}`;
    this.gitLogs = this.gitLogs.concat(`[${time}] ${message}`).slice(-300);
  }
}

class RemoteSyncStore {
  private readonly baseDir = path.join(process.cwd(), ".anisub", "remote-sync");
  private readonly configPath = path.join(this.baseDir, "config.json");
  private readonly bindingsPath = path.join(this.baseDir, "bindings.json");

  async loadConfig(): Promise<RemoteSyncConfig> {
    await this.ensureStoreDir();
    const raw = await readFile(this.configPath, "utf-8").catch(() => "");
    if (!raw.trim()) {
      return defaultRemoteSyncConfig();
    }
    try {
      const parsed = JSON.parse(raw) as Partial<RemoteSyncConfig>;
      return normalizeConfig({
        remoteUrl: parsed.remoteUrl ?? DEFAULT_REMOTE_URL,
        gitUsername: parsed.gitUsername ?? "",
        gitToken: parsed.gitToken ?? "",
        commitUserName: parsed.commitUserName ?? "Anisub Remote Sync",
        commitUserEmail: parsed.commitUserEmail ?? "anisub@local",
        imageScalePercent: parsed.imageScalePercent ?? DEFAULT_IMAGE_SCALE_PERCENT,
        imageJpegQuality: parsed.imageJpegQuality ?? DEFAULT_IMAGE_JPEG_QUALITY,
      });
    } catch {
      return defaultRemoteSyncConfig();
    }
  }

  async saveConfig(config: RemoteSyncConfig): Promise<void> {
    await this.ensureStoreDir();
    await writeFile(this.configPath, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, "utf-8");
  }

  async loadBindings(): Promise<EntryBinding[]> {
    await this.ensureStoreDir();
    const raw = await readFile(this.bindingsPath, "utf-8").catch(() => "");
    if (!raw.trim()) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as Partial<EntryBinding>[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((item): item is Partial<EntryBinding> => Boolean(item && item.id && item.repoPath))
        .map((item) => ({
          id: String(item.id),
          displayName: String(item.displayName ?? item.id),
          deviceId: String(item.deviceId ?? ""),
          deviceName: String(item.deviceName ?? ""),
          folderPath: path.resolve(String(item.folderPath ?? "")),
          folderLabel: String(item.folderLabel ?? ""),
          repoPath: String(item.repoPath),
          updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : 0,
        }));
    } catch {
      return [];
    }
  }

  async saveBindings(bindings: EntryBinding[]): Promise<void> {
    await this.ensureStoreDir();
    await writeFile(this.bindingsPath, `${JSON.stringify(bindings, null, 2)}\n`, "utf-8");
  }

  private async ensureStoreDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }
}

class RemoteSyncGitService {
  readonly repoDir = path.resolve(process.cwd(), ".anisub", "remote-sync", "repo-a");

  async pull(config: RemoteSyncConfig, logger: (line: string) => void): Promise<void> {
    await this.openOrCreateRepository(config, logger);
    await this.safePull(config, logger);
  }

  async readHeadSummary(config: RemoteSyncConfig, logger: (line: string) => void): Promise<string> {
    await this.openOrCreateRepository(config, () => undefined);
    const result = await this.runGit(["log", "-1", "--pretty=format:%h %s"], { cwd: this.repoDir, allowFailure: true });
    if (result.code !== 0 || !result.stdout.trim()) {
      return "空仓库（暂无提交）";
    }
    const summary = result.stdout.trim();
    logger(`读取 HEAD: ${summary}`);
    return summary;
  }

  async pushEntry(config: RemoteSyncConfig, entry: EntryBinding, logger: (line: string) => void): Promise<CopyStats> {
    await this.openOrCreateRepository(config, logger);
    await this.safePull(config, logger);
    const targetDir = resolveRepoEntryDirectory(this.repoDir, entry.repoPath);
    if (!targetDir) {
      throw new AppError("非法仓库路径。", 400);
    }
    logger(`复制目录: ${entry.folderPath} -> ${targetDir}`);
    const stats = await copyFolderTree(entry.folderPath, targetDir, {
      scalePercent: config.imageScalePercent,
      jpegQuality: config.imageJpegQuality,
    });
    logger(`复制完成: copied=${stats.copiedFiles}, compressed=${stats.compressedImages}, skipped=${stats.skippedFiles}`);

    await this.writeEntryMetadata(targetDir, {
      id: entry.id,
      displayName: entry.displayName,
      deviceId: entry.deviceId,
      deviceName: entry.deviceName,
      repoPath: entry.repoPath,
      updatedAt: Date.now(),
    });
    logger(`写入元数据: ${entry.repoPath}/${ENTRY_META_FILE}`);

    await this.commitAndPushIfNeeded(
      config,
      `sync: push ${entry.displayName} (${entry.deviceName})`,
      [entry.repoPath],
      logger,
    );
    return stats;
  }

  async clearEntry(config: RemoteSyncConfig, entry: RepoEntryMeta, logger: (line: string) => void): Promise<void> {
    await this.openOrCreateRepository(config, logger);
    await this.safePull(config, logger);
    const targetDir = resolveRepoEntryDirectory(this.repoDir, entry.repoPath);
    if (!targetDir) {
      throw new AppError("非法仓库路径。", 400);
    }
    await clearDirectoryContents(targetDir);
    logger(`已清空仓库目录: ${targetDir}`);
    await this.writeEntryMetadata(targetDir, {
      ...entry,
      updatedAt: Date.now(),
    });
    logger(`重写元数据: ${entry.repoPath}/${ENTRY_META_FILE}`);
    await this.commitAndPushIfNeeded(
      config,
      `sync: clear ${entry.displayName} (${entry.deviceName})`,
      [entry.repoPath],
      logger,
    );
  }

  async deleteEntry(config: RemoteSyncConfig, repoPathValue: string, logger: (line: string) => void): Promise<void> {
    await this.openOrCreateRepository(config, logger);
    await this.safePull(config, logger);
    const targetDir = resolveRepoEntryDirectory(this.repoDir, repoPathValue);
    if (!targetDir) {
      throw new AppError("非法仓库路径。", 400);
    }
    const targetStat = await stat(targetDir).catch(() => null);
    if (targetStat) {
      await rm(targetDir, { recursive: true, force: true });
      logger(`已删除仓库目录: ${targetDir}`);
    }
    await this.commitAndPushIfNeeded(config, `sync: delete ${repoPathValue}`, [repoPathValue], logger);
  }

  async scanRemoteEntries(): Promise<RepoEntryMeta[]> {
    const entriesRoot = path.join(this.repoDir, ENTRIES_DIR);
    const entriesRootStat = await stat(entriesRoot).catch(() => null);
    if (!entriesRootStat?.isDirectory()) {
      return [];
    }

    const files = await walkFiles(entriesRoot);
    const results: RepoEntryMeta[] = [];
    for (const filePath of files) {
      if (path.basename(filePath) !== ENTRY_META_FILE) {
        continue;
      }
      const raw = await readFile(filePath, "utf-8").catch(() => "");
      if (!raw.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as Partial<RepoEntryMeta>;
        if (!parsed.id || !parsed.repoPath) {
          continue;
        }
        results.push({
          id: String(parsed.id),
          displayName: String(parsed.displayName ?? parsed.id),
          deviceId: String(parsed.deviceId ?? ""),
          deviceName: String(parsed.deviceName ?? ""),
          repoPath: String(parsed.repoPath),
          updatedAt: Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : Date.now(),
        });
      } catch {
        continue;
      }
    }
    return results;
  }

  private async openOrCreateRepository(config: RemoteSyncConfig, logger: (line: string) => void): Promise<void> {
    await mkdir(this.repoDir, { recursive: true });
    const dotGitPath = path.join(this.repoDir, ".git");
    const dotGitStat = await stat(dotGitPath).catch(() => null);
    if (dotGitStat?.isDirectory()) {
      await this.configureRepository(config);
      logger(`打开本地仓库: ${this.repoDir}`);
      return;
    }

    const files = await readdir(this.repoDir).catch(() => [] as string[]);
    if (files.length > 0) {
      logger("检测到仓库目录缺少 .git，正在重建并重新克隆。");
      await rm(this.repoDir, { recursive: true, force: true });
      await mkdir(this.repoDir, { recursive: true });
    }

    const cloneResult = await this.runGit(["clone", config.remoteUrl, this.repoDir], {
      cwd: process.cwd(),
      authConfig: config,
      allowFailure: true,
    });
    if (cloneResult.code !== 0) {
      throw new AppError(
        `无法克隆远端仓库，请检查 URL/账号权限/网络后重试。${cloneResult.stderr || cloneResult.stdout}`.trim(),
        500,
      );
    }
    await this.configureRepository(config);
    logger(`克隆远端仓库: ${config.remoteUrl}`);
  }

  private async configureRepository(config: RemoteSyncConfig): Promise<void> {
    await this.runGit(["config", "remote.origin.url", config.remoteUrl], { cwd: this.repoDir });
    await this.runGit(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], { cwd: this.repoDir });
    await this.runGit(["config", "branch.main.remote", "origin"], { cwd: this.repoDir });
    await this.runGit(["config", "branch.main.merge", `refs/heads/${DEFAULT_BRANCH}`], { cwd: this.repoDir });
    await this.runGit(["config", "user.name", config.commitUserName || "Anisub Remote Sync"], { cwd: this.repoDir });
    await this.runGit(["config", "user.email", config.commitUserEmail || "anisub@local"], { cwd: this.repoDir });
  }

  private async safePull(config: RemoteSyncConfig, logger: (line: string) => void): Promise<void> {
    logger(`执行 pull: origin/${DEFAULT_BRANCH}`);
    const pullResult = await this.runGit(["pull", "origin", DEFAULT_BRANCH, "--rebase"], {
      cwd: this.repoDir,
      authConfig: config,
      allowFailure: true,
    });
    if (pullResult.code === 0) {
      logger("pull 完成。");
      return;
    }

    const pullMessage = `${pullResult.stdout}\n${pullResult.stderr}`.toLowerCase();
    if (pullMessage.includes("unrelated")) {
      logger("检测到无共同历史，尝试强制对齐本地分支到远端。");
      await this.runGit(
        ["fetch", "origin", `+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}`],
        { cwd: this.repoDir, authConfig: config },
      );
      const hasRemoteMain = await this.hasRemoteMainBranch();
      if (!hasRemoteMain) {
        throw new AppError(`远端缺少 ${DEFAULT_BRANCH} 分支，无法对齐本地分支。`, 500);
      }
      await this.runGit(["reset", "--hard", `refs/remotes/origin/${DEFAULT_BRANCH}`], { cwd: this.repoDir });
      logger(`本地分支已强制对齐到 refs/remotes/origin/${DEFAULT_BRANCH}`);
      return;
    }

    logger("pull 未成功，准备 fetch 检查远端分支。");
    const fetchResult = await this.runGit(["fetch", "origin"], {
      cwd: this.repoDir,
      authConfig: config,
      allowFailure: true,
    });
    const fetchMessages = `${fetchResult.stdout}\n${fetchResult.stderr}`.trim();
    if (fetchMessages) {
      logger(`fetch 消息: ${fetchMessages}`);
    }
    if (fetchResult.code !== 0) {
      throw new AppError(fetchResult.stderr.trim() || fetchResult.stdout.trim() || "Git fetch 失败。", 500);
    }

    const hasRemoteMain = await this.hasRemoteMainBranch();
    if (!hasRemoteMain) {
      logger(`远端尚无 ${DEFAULT_BRANCH} 分支，跳过 pull。`);
      return;
    }
    throw new AppError("Git pull 失败，请检查远端分支状态后重试。", 500);
  }

  private async commitAndPushIfNeeded(
    config: RemoteSyncConfig,
    message: string,
    paths: string[],
    logger: (line: string) => void,
  ): Promise<void> {
    logger(`暂存路径: ${paths.join(", ")}`);
    for (const filePath of paths) {
      await this.stagePathForCommit(filePath);
    }
    const statusResult = await this.runGit(["status", "--porcelain"], { cwd: this.repoDir });
    if (statusResult.stdout.trim()) {
      await this.runGit(["commit", "-m", message], { cwd: this.repoDir });
      logger(`已提交: ${message}`);
    } else {
      logger("无本地变更，尝试直接 push。");
    }

    try {
      await this.pushOrThrow(config);
    } catch {
      logger("push 被拒绝或发生传输异常，尝试先 pull 再重试。");
      await this.safePull(config, logger);
      await this.pushOrThrow(config);
    }
  }

  private async stagePathForCommit(repoRelativePath: string): Promise<void> {
    const absolutePath = path.join(this.repoDir, repoRelativePath);
    if (await exists(absolutePath)) {
      await this.runGit(["add", "--", repoRelativePath], { cwd: this.repoDir });
      return;
    }

    const trackedResult = await this.runGit(["ls-files", "--error-unmatch", "--", repoRelativePath], {
      cwd: this.repoDir,
      allowFailure: true,
    });
    if (trackedResult.code === 0) {
      await this.runGit(["add", "-u", "--", repoRelativePath], { cwd: this.repoDir });
    }
  }

  private async pushOrThrow(config: RemoteSyncConfig): Promise<void> {
    const pushResult = await this.runGit(["push", "origin", `HEAD:refs/heads/${DEFAULT_BRANCH}`], {
      cwd: this.repoDir,
      authConfig: config,
      allowFailure: true,
    });
    if (pushResult.code !== 0) {
      throw new AppError(pushResult.stderr.trim() || pushResult.stdout.trim() || "Git push 失败。", 500);
    }
  }

  private async hasRemoteMainBranch(): Promise<boolean> {
    const result = await this.runGit(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${DEFAULT_BRANCH}`], {
      cwd: this.repoDir,
      allowFailure: true,
    });
    return result.code === 0;
  }

  private async writeEntryMetadata(targetDir: string, entry: RepoEntryMeta): Promise<void> {
    await mkdir(targetDir, { recursive: true });
    const filePath = path.join(targetDir, ENTRY_META_FILE);
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          id: entry.id,
          displayName: entry.displayName,
          deviceId: entry.deviceId,
          deviceName: entry.deviceName,
          repoPath: entry.repoPath,
          updatedAt: entry.updatedAt,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
  }

  private async runGit(args: string[], options: RunGitOptions): Promise<GitCommandResult> {
    const authArgs = buildGitAuthArgs(options.authConfig);
    const fullArgs = authArgs.concat(args);
    const result = await runCommand("git", fullArgs, options.cwd);
    if (result.code !== 0 && !options.allowFailure) {
      const reason = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed (${result.code})`;
      throw new AppError(reason, 500);
    }
    return result;
  }
}

async function runCommand(command: string, args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise<GitCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
    });

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
        reject(new AppError("未检测到 Git，请先安装 Git 并加入 PATH。", 500));
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

function buildGitAuthArgs(config: RemoteSyncConfig | undefined): string[] {
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

function defaultRemoteSyncConfig(): RemoteSyncConfig {
  return {
    remoteUrl: DEFAULT_REMOTE_URL,
    gitUsername: "",
    gitToken: "",
    commitUserName: "Anisub Remote Sync",
    commitUserEmail: "anisub@local",
    imageScalePercent: DEFAULT_IMAGE_SCALE_PERCENT,
    imageJpegQuality: DEFAULT_IMAGE_JPEG_QUALITY,
  };
}

function normalizeConfig(config: RemoteSyncConfig): RemoteSyncConfig {
  return {
    remoteUrl: config.remoteUrl.trim() || DEFAULT_REMOTE_URL,
    gitUsername: config.gitUsername.trim(),
    gitToken: config.gitToken.trim(),
    commitUserName: config.commitUserName.trim() || "Anisub Remote Sync",
    commitUserEmail: config.commitUserEmail.trim() || "anisub@local",
    imageScalePercent: clampInt(config.imageScalePercent, 1, 100, DEFAULT_IMAGE_SCALE_PERCENT),
    imageJpegQuality: clampInt(config.imageJpegQuality, 1, 100, DEFAULT_IMAGE_JPEG_QUALITY),
  };
}

function mergeEntries(
  localBindings: EntryBinding[],
  remoteEntries: RepoEntryMeta[],
  folderFileCounts: Map<string, number | null>,
  repoRootPath: string,
): RemoteSyncEntry[] {
  const localById = new Map(localBindings.map((item) => [item.id, item]));
  const merged: RemoteSyncEntry[] = [];
  const knownIds = new Set<string>();

  for (const remote of remoteEntries) {
    knownIds.add(remote.id);
    const local = localById.get(remote.id);
    const folderPath = local?.folderPath ?? null;
    const wordNoteFolderPath = folderPath || resolveWordNoteFolderPath(remote.repoPath, repoRootPath);
    merged.push({
      id: remote.id,
      displayName: remote.displayName,
      deviceId: remote.deviceId,
      deviceName: remote.deviceName,
      repoPath: remote.repoPath,
      updatedAt: Math.max(remote.updatedAt, local?.updatedAt ?? 0),
      folderPath,
      folderLabel: local?.folderLabel ?? null,
      folderFileCount: folderFileCounts.get(remote.id) ?? null,
      wordNoteFolderPath,
    });
  }

  for (const local of localBindings) {
    if (knownIds.has(local.id)) {
      continue;
    }
    merged.push({
      id: local.id,
      displayName: local.displayName,
      deviceId: local.deviceId,
      deviceName: local.deviceName,
      repoPath: local.repoPath,
      updatedAt: local.updatedAt,
      folderPath: local.folderPath,
      folderLabel: local.folderLabel,
      folderFileCount: folderFileCounts.get(local.id) ?? null,
      wordNoteFolderPath: local.folderPath || resolveWordNoteFolderPath(local.repoPath, repoRootPath),
    });
  }

  return merged.sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    return a.displayName.localeCompare(b.displayName, "zh-CN", { sensitivity: "base" });
  });
}

function resolveDeviceInfo(): DeviceInfo {
  const rawId = os.hostname().trim().toLowerCase();
  const id = sanitizePathSegment(rawId || `${os.platform()}-${os.arch()}`);
  const name = os.hostname().trim() || "Desktop Device";
  return { id, name };
}

function sanitizePathSegment(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "entry";
}

async function countFilesInDirectory(folderPath: string): Promise<number | null> {
  const resolved = path.resolve(folderPath);
  const folderStat = await stat(resolved).catch(() => null);
  if (!folderStat?.isDirectory()) {
    return null;
  }
  return countFilesRecursively(resolved);
}

async function countFilesInRepoEntryDirectory(repoRootDir: string, repoPathValue: string): Promise<number | null> {
  const entryDir = resolveRepoEntryDirectory(repoRootDir, repoPathValue);
  if (!entryDir) {
    return null;
  }
  const entryStat = await stat(entryDir).catch(() => null);
  if (!entryStat?.isDirectory()) {
    return null;
  }
  const files = await walkFiles(entryDir);
  return files.filter((filePath) => path.basename(filePath) !== ENTRY_META_FILE).length;
}

function resolveWordNoteFolderPath(repoPathValue: string, repoRootPath: string): string | null {
  const entryDir = resolveRepoEntryDirectory(repoRootPath, repoPathValue);
  if (!entryDir) {
    return null;
  }
  return entryDir;
}

function resolveRepoEntryDirectory(repoRootDir: string, repoPathValue: string): string | null {
  const base = path.resolve(repoRootDir);
  const target = path.resolve(repoRootDir, repoPathValue);
  if (target === base || target.startsWith(`${base}${path.sep}`)) {
    return target;
  }
  return null;
}

async function countFilesRecursively(directoryPath: string): Promise<number> {
  const children = await readdir(directoryPath, { withFileTypes: true });
  let total = 0;
  for (const child of children) {
    const childPath = path.join(directoryPath, child.name);
    if (child.isDirectory()) {
      total += await countFilesRecursively(childPath);
      continue;
    }
    total += 1;
  }
  return total;
}

async function clearFolderContents(folderPath: string): Promise<number> {
  const resolved = path.resolve(folderPath);
  const folderStat = await stat(resolved).catch(() => null);
  if (!folderStat?.isDirectory()) {
    throw new AppError("本地绑定路径不是文件夹。", 400);
  }
  return deleteChildren(resolved);
}

async function clearDirectoryContents(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
  const children = await readdir(directoryPath, { withFileTypes: true }).catch(() => [] as Dirent[]);
  for (const child of children) {
    const childPath = path.join(directoryPath, child.name);
    await rm(childPath, { recursive: true, force: true });
  }
}

async function deleteChildren(directoryPath: string): Promise<number> {
  const children = await readdir(directoryPath, { withFileTypes: true });
  let deletedFileCount = 0;
  for (const child of children) {
    const childPath = path.join(directoryPath, child.name);
    if (child.isDirectory()) {
      deletedFileCount += await deleteChildren(childPath);
      await rm(childPath, { recursive: true, force: false });
      continue;
    }
    await unlink(childPath);
    deletedFileCount += 1;
  }
  return deletedFileCount;
}

async function copyFolderTree(
  sourceFolderPath: string,
  destinationDir: string,
  setting: ImageCompressionSetting,
): Promise<CopyStats> {
  const sourceRoot = path.resolve(sourceFolderPath);
  const sourceStat = await stat(sourceRoot).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new AppError("无法访问所选文件夹。", 400);
  }
  return copyDirectoryChildren(sourceRoot, destinationDir, setting);
}

async function copyDirectoryChildren(
  sourceDir: string,
  destinationDir: string,
  setting: ImageCompressionSetting,
): Promise<CopyStats> {
  await mkdir(destinationDir, { recursive: true });
  const children = await readdir(sourceDir, { withFileTypes: true });

  let stats: CopyStats = {
    copiedFiles: 0,
    compressedImages: 0,
    skippedFiles: 0,
  };

  for (const child of children) {
    const sourcePath = path.join(sourceDir, child.name);
    const targetPath = path.join(destinationDir, child.name);
    if (child.isDirectory()) {
      const subStats = await copyDirectoryChildren(sourcePath, targetPath, setting);
      stats = sumCopyStats(stats, subStats);
      continue;
    }
    if (!child.isFile()) {
      continue;
    }
    const fileStats = await copySingleFile(sourcePath, targetPath, setting);
    stats = sumCopyStats(stats, fileStats);
  }

  return stats;
}

async function copySingleFile(sourcePath: string, targetPath: string, setting: ImageCompressionSetting): Promise<CopyStats> {
  const shouldCompress = shouldCompressImage(sourcePath);
  const targetFilePath = shouldCompress
    ? path.join(path.dirname(targetPath), buildCompressedImageName(path.basename(targetPath)))
    : targetPath;

  await mkdir(path.dirname(targetFilePath), { recursive: true });

  if (await exists(targetFilePath)) {
    return { copiedFiles: 0, compressedImages: 0, skippedFiles: 1 };
  }

  if (shouldCompress) {
    const compressed = await compressImageToJpeg(sourcePath, targetFilePath, setting);
    if (compressed) {
      return { copiedFiles: 1, compressedImages: 1, skippedFiles: 0 };
    }
  }

  if (await exists(targetPath)) {
    return { copiedFiles: 0, compressedImages: 0, skippedFiles: 1 };
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  return { copiedFiles: 1, compressedImages: 0, skippedFiles: 0 };
}

function shouldCompressImage(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp" || ext === ".gif" || ext === ".bmp";
}

function buildCompressedImageName(originalName: string): string {
  const lower = originalName.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return `${originalName.replace(/\.[^./\\]+$/, "")}.jpg`;
  }
  return `${originalName}.jpg`;
}

async function compressImageToJpeg(
  sourcePath: string,
  targetPath: string,
  setting: ImageCompressionSetting,
): Promise<boolean> {
  try {
    const metadata = await sharp(sourcePath).metadata();
    if (!metadata.width || !metadata.height) {
      return false;
    }

    const scale = clampInt(setting.scalePercent, 1, 100, DEFAULT_IMAGE_SCALE_PERCENT);
    const targetWidth = Math.max(1, Math.trunc((metadata.width * scale) / 100));
    const targetHeight = Math.max(1, Math.trunc((metadata.height * scale) / 100));

    await sharp(sourcePath)
      .rotate()
      .resize(targetWidth, targetHeight)
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: clampInt(setting.jpegQuality, 1, 100, DEFAULT_IMAGE_JPEG_QUALITY) })
      .toFile(targetPath);

    return true;
  } catch {
    return false;
  }
}

async function exists(targetPath: string): Promise<boolean> {
  const hit = await stat(targetPath).catch(() => null);
  return Boolean(hit);
}

function sumCopyStats(a: CopyStats, b: CopyStats): CopyStats {
  return {
    copiedFiles: a.copiedFiles + b.copiedFiles,
    compressedImages: a.compressedImages + b.compressedImages,
    skippedFiles: a.skippedFiles + b.skippedFiles,
  };
}

async function walkFiles(rootPath: string): Promise<string[]> {
  const queue = [rootPath];
  const files: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [] as Dirent[]);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
