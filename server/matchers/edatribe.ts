import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import {
  SubtitleCandidate,
  SubtitleDownloadResult,
  SubtitleSource,
} from "../../shared/types";
import { AppError } from "../errors";
import { extensionOf, tokenOverlap, withoutExtension } from "../matcher-utils";
import { DesktopVideoContext, SubtitleMatcher } from "../subtitle-matcher";
import { ParsedVideo, SubtitleNameHeuristics } from "../subtitle-heuristics";

interface FileListItem {
  name: string;
  type: string;
}

interface EpisodeSubtitle {
  name: string;
  url: string;
}

const BASE = "https://cc.edatribe.com";
const TV_SERIES_PATH = "TV series";
const MOVIE_PATH = "Movie";

export class EdatribeSubtitleMatcher implements SubtitleMatcher {
  readonly source: SubtitleSource = "edatribe";

  async findCandidates(video: DesktopVideoContext): Promise<SubtitleCandidate[]> {
    const parsed = SubtitleNameHeuristics.parseVideo(video.fileName);
    const rootPath = pickRootPath(parsed);
    const seriesDir = await findBestSeriesDirectory(rootPath, parsed);
    return findEpisodeCandidates(rootPath, seriesDir.name, parsed);
  }

  async downloadCandidate(
    video: DesktopVideoContext,
    candidate: SubtitleCandidate,
  ): Promise<SubtitleDownloadResult> {
    const savedPath = await saveSubtitleToVideoFolder(video, candidate.originalSubtitleName, candidate.downloadUrl);
    return {
      savedFileName: path.basename(savedPath),
      savedPath,
      seriesTitle: candidate.seriesTitle,
      episode: candidate.episode,
      originalSubtitleName: candidate.originalSubtitleName,
      source: this.source,
    };
  }

  async matchAndDownload(video: DesktopVideoContext): Promise<SubtitleDownloadResult> {
    const parsed = SubtitleNameHeuristics.parseVideo(video.fileName);
    const rootPath = pickRootPath(parsed);
    const seriesDir = await findBestSeriesDirectory(rootPath, parsed);
    const candidate = await findBestEpisodeCandidate(rootPath, seriesDir.name, parsed);
    const savedPath = await saveSubtitleToVideoFolder(video, candidate.name, candidate.url);

    return {
      savedFileName: path.basename(savedPath),
      savedPath,
      seriesTitle: seriesDir.name,
      episode: parsed.episode,
      originalSubtitleName: candidate.name,
      source: this.source,
    };
  }
}

function pickRootPath(parsed: ParsedVideo): string {
  return parsed.episode === null ? MOVIE_PATH : TV_SERIES_PATH;
}

async function findBestSeriesDirectory(
  rootPath: string,
  parsed: ParsedVideo,
): Promise<FileListItem> {
  const entries = (await fetchDirectory(rootPath)).filter((item) => item.type === "directory");
  if (entries.length === 0) {
    throw new AppError(`EdaTribe ${rootPath} 目录为空。`, 502);
  }

  let best: { item: FileListItem; score: number } | null = null;
  for (const item of entries) {
    const score = scoreDirectory(item.name, parsed);
    if (!best || score > best.score) {
      best = { item, score };
    }
  }

  if (!best || best.score < 0.28) {
    throw new AppError(`未找到足够接近的剧集目录，最佳得分 ${best?.score.toFixed(2) ?? "0.00"}。`, 404);
  }

  return best.item;
}

async function findBestEpisodeCandidate(
  rootPath: string,
  seriesDirectoryName: string,
  parsed: ParsedVideo,
): Promise<EpisodeSubtitle> {
  const candidates = await findEpisodeCandidates(rootPath, seriesDirectoryName, parsed);
  if (candidates.length === 0) {
    throw new AppError("字幕筛选失败。", 404);
  }

  const best = candidates.sort(
    (left, right) =>
      scoreSubtitleFile(right.originalSubtitleName) - scoreSubtitleFile(left.originalSubtitleName),
  )[0];

  return {
    name: best.originalSubtitleName,
    url: best.downloadUrl,
  };
}

async function findEpisodeCandidates(
  rootPath: string,
  seriesDirectoryName: string,
  parsed: ParsedVideo,
): Promise<SubtitleCandidate[]> {
  const files = (await fetchDirectory(rootPath, seriesDirectoryName)).filter((item) => item.type === "file");
  if (files.length === 0) {
    throw new AppError("目标目录内没有可下载字幕文件。", 404);
  }

  const filtered =
    parsed.episode !== null
      ? files.filter((item) => SubtitleNameHeuristics.extractEpisode(item.name) === parsed.episode)
      : files;

  if (filtered.length === 0) {
    throw new AppError("已进入目录，但没有可用字幕。", 404);
  }

  return filtered
    .sort((left, right) => scoreSubtitleFile(right.name) - scoreSubtitleFile(left.name))
    .map((item) => ({
      seriesTitle: seriesDirectoryName,
      episode: parsed.episode,
      originalSubtitleName: item.name,
      downloadUrl: buildFileUrl(rootPath, seriesDirectoryName, item.name),
    }));
}

function scoreDirectory(entryName: string, parsed: ParsedVideo): number {
  const cleaned = entryName.replace(/^\s*\[\d+]\s*/, "");
  const normalizedEntry = SubtitleNameHeuristics.normalize(cleaned);
  let best = 0;

  for (const query of parsed.queryTitles) {
    const normalizedQuery = SubtitleNameHeuristics.normalize(query);
    const overlap = tokenOverlap(normalizedEntry, normalizedQuery);
    const containsBonus = normalizedEntry.includes(normalizedQuery)
      ? 0.25
      : normalizedQuery.includes(normalizedEntry)
        ? 0.12
        : 0;
    best = Math.max(best, overlap + containsBonus);
  }

  return best;
}

function scoreSubtitleFile(fileName: string): number {
  switch (extensionOf(fileName)) {
    case ".srt":
      return 50;
    case ".ass":
      return 45;
    case ".ssa":
      return 40;
    case ".vtt":
      return 35;
    default:
      return 10;
  }
}

async function fetchDirectory(...segments: string[]): Promise<FileListItem[]> {
  const response = await fetch(buildDirectoryUrl(...segments), {
    headers: {
      "user-agent": "Anisub/0.1",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new AppError(`网络请求失败，HTTP ${response.status}。`, 502);
  }

  return (await response.json()) as FileListItem[];
}

function buildDirectoryUrl(...segments: string[]): string {
  const pathValue = segments.map(encodeURIComponent).join("/");
  return `${BASE}/files/${pathValue}/`;
}

function buildFileUrl(...segments: string[]): string {
  const pathValue = segments.map(encodeURIComponent).join("/");
  return `${BASE}/files/${pathValue}`;
}

async function saveSubtitleToVideoFolder(
  video: DesktopVideoContext,
  sourceSubtitleName: string,
  downloadUrl: string,
): Promise<string> {
  const response = await fetch(downloadUrl, {
    headers: {
      "user-agent": "Anisub/0.1",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new AppError(`字幕下载失败，HTTP ${response.status}。`, 502);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = extensionOf(sourceSubtitleName) || ".srt";
  const targetDir = path.join(video.folderPath, "sub");
  const targetPath = path.join(targetDir, `${withoutExtension(video.fileName)}${ext}`);

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, buffer);
  return targetPath;
}
