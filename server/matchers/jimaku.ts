import path from "node:path";
import { writeFile } from "node:fs/promises";

import {
  SubtitleCandidate,
  SubtitleDownloadResult,
  SubtitleSource,
} from "../../shared/types";
import { AppError } from "../errors";
import {
  containsSeason,
  decodeHtml,
  extensionOf,
  scoreSubtitleFile,
  tokenOverlap,
  withoutExtension,
} from "../matcher-utils";
import { DesktopVideoContext, SubtitleMatcher } from "../subtitle-matcher";
import { ParsedVideo, SubtitleNameHeuristics } from "../subtitle-heuristics";

interface EntryItem {
  id: string;
  title: string;
}

interface DownloadItem {
  url: string;
  name: string;
}

export class JimakuSubtitleMatcher implements SubtitleMatcher {
  readonly source: SubtitleSource = "jimaku";

  async findCandidates(video: DesktopVideoContext): Promise<SubtitleCandidate[]> {
    const parsed = SubtitleNameHeuristics.parseVideo(video.fileName);
    const entry = await this.findBestEntry(parsed);
    return this.findEpisodeCandidates(entry, parsed);
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
    const entry = await this.findBestEntry(parsed);
    const matched = await this.findBestDownload(entry, parsed);
    const savedPath = await saveSubtitleToVideoFolder(video, matched.name, matched.url);

    return {
      savedFileName: path.basename(savedPath),
      savedPath,
      seriesTitle: entry.title,
      episode: parsed.episode,
      originalSubtitleName: matched.name,
      source: this.source,
    };
  }

  private async findBestEntry(parsed: ParsedVideo): Promise<EntryItem> {
    const homeHtml = await getText("https://jimaku.cc/");
    const entries = parseIndexEntries(homeHtml);
    if (entries.length === 0) {
      throw new AppError("Jimaku 首页解析失败，未找到任何条目。", 502);
    }

    let bestEntry: EntryItem | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const entry of entries) {
      const score = scoreEntry(entry.title, parsed);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (!bestEntry || bestScore < 0.32) {
      throw new AppError(`未找到足够接近的剧集条目，最佳得分 ${bestScore.toFixed(2)}。`, 404);
    }

    return bestEntry;
  }

  private async findBestDownload(entry: EntryItem, parsed: ParsedVideo): Promise<DownloadItem> {
    const candidates = await this.findEpisodeCandidates(entry, parsed);
    if (candidates.length === 0) {
      throw new AppError("字幕筛选失败。", 404);
    }
    const best = [...candidates].sort(
      (left, right) =>
        scoreSubtitleFile(parsed, right.originalSubtitleName) -
        scoreSubtitleFile(parsed, left.originalSubtitleName),
    )[0];
    return {
      url: best.downloadUrl,
      name: best.originalSubtitleName,
    };
  }

  private async findEpisodeCandidates(
    entry: EntryItem,
    parsed: ParsedVideo,
  ): Promise<SubtitleCandidate[]> {
    const html = await getText(`https://jimaku.cc/entry/${entry.id}`);
    const files = parseDownloadItems(html);
    if (files.length === 0) {
      throw new AppError("目标条目内没有可下载字幕文件。", 404);
    }

    const filtered =
      parsed.episode !== null
        ? files.filter((item) => SubtitleNameHeuristics.extractEpisode(item.name) === parsed.episode)
        : files;

    if (filtered.length === 0) {
      throw new AppError("已进入条目，但没有可用字幕。", 404);
    }

    return filtered
      .sort((left, right) => scoreSubtitleFile(parsed, right.name) - scoreSubtitleFile(parsed, left.name))
      .map((item) => ({
        seriesTitle: entry.title,
        episode: parsed.episode,
        originalSubtitleName: item.name,
        downloadUrl: item.url,
      }));
  }
}

function parseIndexEntries(html: string): EntryItem[] {
  const regex = /<a href="\/entry\/(\d+)" class="table-data file-name">([^<]+)<\/a>/g;
  return Array.from(html.matchAll(regex)).map((match) => ({
    id: match[1],
    title: decodeHtml(match[2]),
  }));
}

function parseDownloadItems(html: string): DownloadItem[] {
  const regex = /<a href="(\/entry\/\d+\/download\/[^"]+)" class="table-data file-name">([^<]+)<\/a>/g;
  return Array.from(html.matchAll(regex)).map((match) => ({
    url: `https://jimaku.cc${match[1]}`,
    name: decodeHtml(match[2]),
  }));
}

function scoreEntry(entryTitle: string, parsed: ParsedVideo): number {
  const normalizedEntry = SubtitleNameHeuristics.normalize(entryTitle);
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

  const seasonBonus =
    parsed.season !== null && containsSeason(entryTitle, parsed.season) ? 0.2 : 0;
  return best + seasonBonus;
}

async function getText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Anisub/0.1",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new AppError(`网络请求失败，HTTP ${response.status}。`, 502);
  }

  return response.text();
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
  await import("node:fs/promises").then(({ mkdir }) => mkdir(targetDir, { recursive: true }));
  await writeFile(targetPath, buffer);
  return targetPath;
}
