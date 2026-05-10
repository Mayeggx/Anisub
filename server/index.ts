import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

import {
  CreateAnkiWordCardRequest,
  CreateAnkiWordCardResponse,
  CreateRemoteSyncEntryRequest,
  CreateWordNoteRequest,
  CreateWordNoteResponse,
  DownloadCandidateRequest,
  DownloadCandidateResponse,
  OpenConfigFileResponse,
  OpenWordNoteLogResponse,
  LogsResponse,
  MatchLogItem,
  MatchVideoRequest,
  MatchVideoResponse,
  OffsetSubtitleRequest,
  OffsetSubtitleResponse,
  OpenFolderRequest,
  OpenFolderResponse,
  RemoteSyncEntryActionRequest,
  RemoteSyncStateResponse,
  SaveRemoteSyncConfigRequest,
  PickFolderResponse,
  PlayVideoRequest,
  PlayVideoResponse,
  ScanImageFolderRequest,
  ScanImageFolderResponse,
  ScanFolderRequest,
  ScanFolderResponse,
  SubtitleSource,
  UpdateRemoteSyncImageCompressionRequest,
  WordNoteConfigResponse,
} from "../shared/types";
import { AppError, toErrorMessage } from "./errors";
import { createAnkiWordCard } from "./anki-word-card";
import { isSupportedImageFile, scanImageFolder } from "./image-library";
import { LogStore } from "./log-store";
import { EdatribeSubtitleMatcher } from "./matchers/edatribe";
import { JimakuSubtitleMatcher } from "./matchers/jimaku";
import { offsetSubtitleFile } from "./subtitle-offset";
import { DesktopVideoContext, SubtitleMatcher } from "./subtitle-matcher";
import { getVideoByPath, scanVideoFolder } from "./video-library";
import { openFolderInExplorer, openTextFile, openVideoInPlayer, pickFolder } from "./windows-picker";
import { listWordCardLogRecords, upsertWordCardLogRecord } from "./word-card-log";
import { appendWordNoteMarkdownLog, ensureWordNoteMarkdownLogFile, getWordNoteMarkdownLogPath } from "./word-note-md-log";
import { getWordNoteConfigPath, readWordNoteConfig } from "./word-note-config";
import { createWordNote } from "./word-note";
import { RemoteSyncService } from "./remote-sync";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const logStore = new LogStore();
const remoteSyncService = new RemoteSyncService();
const matchers = new Map<SubtitleSource, SubtitleMatcher>([
  ["jimaku", new JimakuSubtitleMatcher()],
  ["edatribe", new EdatribeSubtitleMatcher()],
]);

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/pick-folder", async (_request, response, next) => {
  try {
    const folderPath = await pickFolder();
    const payload: PickFolderResponse = { folderPath };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/open-folder", async (request, response, next) => {
  try {
    const body = request.body as OpenFolderRequest;
    if (!body?.folderPath) {
      throw new AppError("Missing folder path.", 400);
    }
    const openedPath = await openFolderInExplorer(body.folderPath);
    const payload: OpenFolderResponse = { openedPath };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/scan-folder", async (request, response, next) => {
  try {
    const body = request.body as ScanFolderRequest;
    if (!body?.folderPath) {
      throw new AppError("Missing folder path.", 400);
    }
    const videos = await scanVideoFolder(body.folderPath);
    const payload: ScanFolderResponse = {
      folderPath: path.resolve(body.folderPath),
      videos,
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/scan-image-folder", async (request, response, next) => {
  try {
    const body = request.body as ScanImageFolderRequest;
    if (!body?.folderPath) {
      throw new AppError("Missing folder path.", 400);
    }
    const [images, cardLogs] = await Promise.all([scanImageFolder(body.folderPath), listWordCardLogRecords()]);
    const statusMap = new Map(cardLogs.map((item) => [path.resolve(item.imagePath).toLowerCase(), item]));
    const mappedImages = images.map((image) => {
      const key = path.resolve(image.fullPath).toLowerCase();
      const hit = statusMap.get(key);
      return {
        ...image,
        added: Boolean(hit),
        addedAt: hit?.updatedAt,
      };
    });
    const payload: ScanImageFolderResponse = {
      folderPath: path.resolve(body.folderPath),
      images: mappedImages,
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/image-file", async (request, response, next) => {
  try {
    const queryPath = String(request.query.path ?? "");
    if (!queryPath) {
      throw new AppError("Missing image path.", 400);
    }
    const imagePath = path.resolve(queryPath);
    if (!(await isSupportedImageFile(imagePath))) {
      throw new AppError("Unsupported or missing image file.", 404);
    }
    response.sendFile(imagePath);
  } catch (error) {
    next(error);
  }
});

app.get("/api/logs", async (_request, response, next) => {
  try {
    const payload: LogsResponse = {
      logs: await logStore.list(),
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/play-video", async (request, response, next) => {
  try {
    const body = request.body as PlayVideoRequest;
    if (!body?.videoPath) {
      throw new AppError("Missing video path.", 400);
    }
    if (!body?.playerPath) {
      throw new AppError("Missing player path.", 400);
    }
    await openVideoInPlayer(body.playerPath, body.videoPath);
    const payload: PlayVideoResponse = {
      videoPath: path.resolve(body.videoPath),
      playerPath: path.resolve(body.playerPath),
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/match-video", async (request, response, next) => {
  try {
    const body = request.body as MatchVideoRequest;
    if (!body?.videoPath) {
      throw new AppError("Missing video path.", 400);
    }
    const matcher = requireMatcher(body.source);
    const video = await getVideoByPath(body.videoPath);
    const context = toDesktopVideoContext(video, body.matchTag);

    if (body.mode === "candidate") {
      const candidates = await matcher.findCandidates(context);
      const payload: MatchVideoResponse = {
        kind: "candidates",
        video,
        candidates,
      };
      response.json(payload);
      return;
    }

    const result = await matcher.matchAndDownload(context);
    const updatedVideo = await getVideoByPath(body.videoPath);
    const log = buildLog(updatedVideo.fileName, result);
    await logStore.append(log);

    const payload: MatchVideoResponse = {
      kind: "downloaded",
      video: updatedVideo,
      result,
      log,
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/download-candidate", async (request, response, next) => {
  try {
    const body = request.body as DownloadCandidateRequest;
    if (!body?.videoPath) {
      throw new AppError("Missing video path.", 400);
    }
    const matcher = requireMatcher(body.source);
    const video = await getVideoByPath(body.videoPath);
    const result = await matcher.downloadCandidate(toDesktopVideoContext(video), body.candidate);
    const updatedVideo = await getVideoByPath(body.videoPath);
    const log = buildLog(updatedVideo.fileName, result);
    await logStore.append(log);

    const payload: DownloadCandidateResponse = {
      video: updatedVideo,
      result,
      log,
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/offset-subtitle", async (request, response, next) => {
  try {
    const body = request.body as OffsetSubtitleRequest;
    if (!body?.subtitlePath) {
      throw new AppError("Missing subtitle path.", 400);
    }
    if (!Number.isFinite(body.offsetMs)) {
      throw new AppError("Invalid subtitle offset milliseconds.", 400);
    }
    const offsetMs = Math.trunc(body.offsetMs);
    const format = await offsetSubtitleFile(body.subtitlePath, offsetMs);
    const payload: OffsetSubtitleResponse = {
      subtitlePath: path.resolve(body.subtitlePath),
      offsetMs,
      format,
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/word-note", async (request, response, next) => {
  try {
    const body = request.body as CreateWordNoteRequest;
    const payload: CreateWordNoteResponse = await createWordNote(body);
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/create-anki-word-card", async (request, response, next) => {
  try {
    const body = request.body as CreateAnkiWordCardRequest;
    const payload: CreateAnkiWordCardResponse = await createAnkiWordCard(body);
    await upsertWordCardLogRecord({
      imagePath: body.imagePath,
      noteId: payload.noteId,
      updatedAt: new Date().toISOString(),
    });
    await appendWordNoteMarkdownLog({
      imagePath: body.imagePath,
      subtitle: body.subtitle,
      targetWord: body.targetWord,
      result: payload,
    });
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/word-note-config", async (_request, response, next) => {
  try {
    const configPath = await getWordNoteConfigPath();
    const config = await readWordNoteConfig();
    const payload: WordNoteConfigResponse = {
      configPath,
      config,
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/open-word-note-config", async (_request, response, next) => {
  try {
    const configPath = await getWordNoteConfigPath();
    const fileStat = await stat(configPath).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new AppError("Config file was not found.", 404);
    }
    const openedPath = await openTextFile(configPath);
    const payload: OpenConfigFileResponse = { openedPath };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/open-word-note-log", async (_request, response, next) => {
  try {
    const logPath = getWordNoteMarkdownLogPath();
    await ensureWordNoteMarkdownLogFile();
    const openedPath = await openTextFile(logPath);
    const payload: OpenWordNoteLogResponse = { openedPath };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/remote-sync/state", async (_request, response, next) => {
  try {
    const payload: RemoteSyncStateResponse = await remoteSyncService.getState();
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/remote-sync/refresh", async (_request, response, next) => {
  try {
    const payload: RemoteSyncStateResponse = await remoteSyncService.refreshEntries();
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/remote-sync/config", async (request, response, next) => {
  try {
    const body = request.body as SaveRemoteSyncConfigRequest;
    if (!body?.config) {
      throw new AppError("Missing remote sync config.", 400);
    }
    const payload: RemoteSyncStateResponse = await remoteSyncService.saveConfig(body.config);
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/remote-sync/image-compression", async (request, response, next) => {
  try {
    const body = request.body as UpdateRemoteSyncImageCompressionRequest;
    if (!Number.isFinite(body?.scalePercent) || !Number.isFinite(body?.jpegQuality)) {
      throw new AppError("Invalid image compression settings.", 400);
    }
    const payload: RemoteSyncStateResponse = await remoteSyncService.updateImageCompression(
      Math.trunc(body.scalePercent),
      Math.trunc(body.jpegQuality),
    );
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/remote-sync/create-entry", async (request, response, next) => {
  try {
    const body = request.body as CreateRemoteSyncEntryRequest;
    if (!body?.folderPath?.trim()) {
      throw new AppError("Missing folder path.", 400);
    }
    const payload: RemoteSyncStateResponse = await remoteSyncService.createEntry({
      displayName: body.displayName ?? "",
      folderPath: body.folderPath,
      folderLabel: body.folderLabel,
    });
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/remote-sync/pull", async (_request, response, next) => {
  try {
    const payload: RemoteSyncStateResponse = await remoteSyncService.pull();
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/remote-sync/push", async (request, response, next) => {
  try {
    const body = request.body as RemoteSyncEntryActionRequest;
    if (!body?.entryId) {
      throw new AppError("Missing entry ID.", 400);
    }
    const payload: RemoteSyncStateResponse = await remoteSyncService.push(body.entryId);
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/remote-sync/clear", async (request, response, next) => {
  try {
    const body = request.body as RemoteSyncEntryActionRequest;
    if (!body?.entryId) {
      throw new AppError("Missing entry ID.", 400);
    }
    const payload: RemoteSyncStateResponse = await remoteSyncService.clear(body.entryId);
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/remote-sync/delete", async (request, response, next) => {
  try {
    const body = request.body as RemoteSyncEntryActionRequest;
    if (!body?.entryId) {
      throw new AppError("Missing entry ID.", 400);
    }
    const payload: RemoteSyncStateResponse = await remoteSyncService.delete(body.entryId);
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/remote-sync/clear-logs", async (_request, response, next) => {
  try {
    const payload: RemoteSyncStateResponse = await remoteSyncService.clearGitLogs();
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const status = error instanceof AppError ? error.status : 500;
  response.status(status).json({
    error: toErrorMessage(error),
  });
});

app.listen(port, () => {
  console.log(`Anisub server running at http://localhost:${port}`);
  console.log("Web UI: http://localhost:5173");
});

function requireMatcher(source: SubtitleSource): SubtitleMatcher {
  const matcher = matchers.get(source);
  if (!matcher) {
    throw new AppError("Unsupported subtitle source.", 400);
  }
  return matcher;
}

function toDesktopVideoContext(video: Awaited<ReturnType<typeof getVideoByPath>>, matchTag?: string): DesktopVideoContext {
  const normalizedTag = (matchTag ?? "").trim();
  const parsed = path.parse(video.fileName);
  const fileName = normalizedTag ? `${parsed.name}${normalizedTag}${parsed.ext}` : video.fileName;
  return {
    fileName,
    fullPath: video.fullPath,
    folderPath: video.folderPath,
  };
}

function buildLog(videoFileName: string, result: Awaited<ReturnType<SubtitleMatcher["matchAndDownload"]>>): MatchLogItem {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source: result.source,
    videoFileName,
    seriesTitle: result.seriesTitle,
    episode: result.episode,
    originalSubtitleName: result.originalSubtitleName,
    savedFileName: result.savedFileName,
    savedPath: result.savedPath,
  };
}
