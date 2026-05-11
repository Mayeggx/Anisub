import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { VideoPlaybackStatus } from "../shared/types";

const storageDir = path.resolve(process.cwd(), ".anisub");
const playbackStatusPath = path.join(storageDir, "video-playback-status.json");

type PlaybackRecord = {
  status: VideoPlaybackStatus;
  updatedAt: string;
};

export class VideoPlaybackStatusStore {
  private records = new Map<string, PlaybackRecord>();
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  async getStatus(videoPath: string): Promise<VideoPlaybackStatus> {
    await this.ensureLoaded();
    const key = normalizeVideoPath(videoPath);
    return this.records.get(key)?.status ?? "未播放";
  }

  async listStatuses(videoPaths: string[]): Promise<Array<{ videoPath: string; playbackStatus: VideoPlaybackStatus }>> {
    await this.ensureLoaded();
    return videoPaths.map((videoPath) => {
      const resolvedPath = path.resolve(videoPath);
      const key = normalizeVideoPath(resolvedPath);
      return {
        videoPath: resolvedPath,
        playbackStatus: this.records.get(key)?.status ?? "未播放",
      };
    });
  }

  async setStatus(videoPath: string, status: VideoPlaybackStatus): Promise<void> {
    await this.ensureLoaded();
    const key = normalizeVideoPath(videoPath);
    const current = this.records.get(key)?.status;
    if (current === status) {
      return;
    }
    this.records.set(key, {
      status,
      updatedAt: new Date().toISOString(),
    });
    await this.persist();
  }

  async markAsPlayed(videoPath: string): Promise<VideoPlaybackStatus> {
    await this.ensureLoaded();
    const key = normalizeVideoPath(videoPath);
    const current = this.records.get(key)?.status ?? "未播放";
    if (current === "未播放") {
      this.records.set(key, {
        status: "播放过",
        updatedAt: new Date().toISOString(),
      });
      await this.persist();
      return "播放过";
    }
    return current;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    await mkdir(storageDir, { recursive: true });
    const raw = await readFile(playbackStatusPath, "utf8").catch(() => "{}");
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      this.records = new Map();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return;
      }
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const status = (value as { status?: unknown }).status;
        if (!isValidPlaybackStatus(status)) {
          continue;
        }
        const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
        this.records.set(key, {
          status,
          updatedAt: typeof updatedAt === "string" ? updatedAt : "",
        });
      }
    } catch {
      this.records = new Map();
    }
  }

  private async persist(): Promise<void> {
    const payload: Record<string, PlaybackRecord> = {};
    for (const [key, value] of this.records.entries()) {
      payload[key] = value;
    }
    this.writeQueue = this.writeQueue.then(() =>
      writeFile(playbackStatusPath, JSON.stringify(payload, null, 2), "utf8"),
    );
    await this.writeQueue;
  }
}

export const videoPlaybackStatusStore = new VideoPlaybackStatusStore();

function normalizeVideoPath(videoPath: string): string {
  return path.resolve(videoPath).toLowerCase();
}

function isValidPlaybackStatus(value: unknown): value is VideoPlaybackStatus {
  return value === "未播放" || value === "播放过" || value === "已播放";
}
