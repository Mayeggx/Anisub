import path from "node:path";
import { readdir, stat } from "node:fs/promises";

import { VideoItem } from "../shared/types";
import { SUBTITLE_EXTENSIONS, SUBTITLE_PRIORITY, VIDEO_EXTENSIONS } from "./constants";
import { AppError } from "./errors";
import { videoPlaybackStatusStore } from "./video-playback-status-store";

export async function scanVideoFolder(folderPath: string): Promise<VideoItem[]> {
  const normalized = path.resolve(folderPath);
  const folderStat = await stat(normalized).catch(() => null);
  if (!folderStat?.isDirectory()) {
    throw new AppError("目标文件夹不存在或不可访问。", 404);
  }

  const entries = await readdir(normalized, { withFileTypes: true });
  const subtitleMap = await buildSubtitleMap(normalized);
  const videoEntries = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const playbackStatuses = await videoPlaybackStatusStore.listStatuses(
    videoEntries.map((entry) => path.join(normalized, entry.name)),
  );
  const playbackStatusMap = new Map(
    playbackStatuses.map((item) => [path.resolve(item.videoPath).toLowerCase(), item.playbackStatus]),
  );

  const videos = videoEntries.map((entry) => {
    const fullPath = path.join(normalized, entry.name);
    const key = normalizeBaseName(entry.name);
    const subtitlePath = subtitleMap.get(key);
    return {
      fileName: entry.name,
      fullPath,
      folderPath: normalized,
      hasSubtitle: Boolean(subtitlePath),
      subtitlePath,
      subtitleStatus: subtitlePath ? "已匹配" : "未匹配",
      playbackStatus: playbackStatusMap.get(fullPath.toLowerCase()) ?? "未播放",
    } satisfies VideoItem;
  });

  return videos;
}

export async function getVideoByPath(videoPath: string): Promise<VideoItem> {
  const normalized = path.resolve(videoPath);
  const fileStat = await stat(normalized).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new AppError("视频文件不存在。", 404);
  }

  const folderPath = path.dirname(normalized);
  const subtitleMap = await buildSubtitleMap(folderPath);
  const fileName = path.basename(normalized);
  const subtitlePath = subtitleMap.get(normalizeBaseName(fileName));
  const playbackStatus = await videoPlaybackStatusStore.getStatus(normalized);

  return {
    fileName,
    fullPath: normalized,
    folderPath,
    hasSubtitle: Boolean(subtitlePath),
    subtitlePath,
    subtitleStatus: subtitlePath ? "已匹配" : "未匹配",
    playbackStatus,
  };
}

async function buildSubtitleMap(folderPath: string): Promise<Map<string, string>> {
  const subtitleDir = path.join(folderPath, "sub");
  const subtitleStat = await stat(subtitleDir).catch(() => null);
  if (!subtitleStat?.isDirectory()) {
    return new Map();
  }

  const entries = await readdir(subtitleDir, { withFileTypes: true });
  const map = new Map<string, string>();

  for (const ext of SUBTITLE_PRIORITY) {
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const entryExt = path.extname(entry.name).toLowerCase();
      if (entryExt !== ext || !SUBTITLE_EXTENSIONS.has(entryExt)) {
        continue;
      }
      const key = normalizeBaseName(entry.name);
      if (!map.has(key)) {
        map.set(key, path.join(subtitleDir, entry.name));
      }
    }
  }

  return map;
}

function normalizeBaseName(name: string): string {
  return path.parse(name).name.toLowerCase();
}
