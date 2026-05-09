import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  DownloadCandidateRequest,
  DownloadCandidateResponse,
  LogsResponse,
  MatchLogItem,
  MatchVideoRequest,
  MatchVideoResponse,
  OpenFolderRequest,
  OpenFolderResponse,
  PickFolderResponse,
  ScanFolderRequest,
  ScanFolderResponse,
  SubtitleSource,
} from "../shared/types";
import { AppError, toErrorMessage } from "./errors";
import { LogStore } from "./log-store";
import { EdatribeSubtitleMatcher } from "./matchers/edatribe";
import { JimakuSubtitleMatcher } from "./matchers/jimaku";
import { DesktopVideoContext, SubtitleMatcher } from "./subtitle-matcher";
import { getVideoByPath, scanVideoFolder } from "./video-library";
import { openFolderInExplorer, pickFolder } from "./windows-picker";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const logStore = new LogStore();
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
      throw new AppError("请提供文件夹路径。", 400);
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
      throw new AppError("请提供文件夹路径。");
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

app.post("/api/match-video", async (request, response, next) => {
  try {
    const body = request.body as MatchVideoRequest;
    if (!body?.videoPath) {
      throw new AppError("请提供视频路径。");
    }
    const matcher = requireMatcher(body.source);
    const video = await getVideoByPath(body.videoPath);
    const context = toDesktopVideoContext(video);

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
      throw new AppError("请提供视频路径。");
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
    throw new AppError("不支持的字幕来源。");
  }
  return matcher;
}

function toDesktopVideoContext(video: Awaited<ReturnType<typeof getVideoByPath>>): DesktopVideoContext {
  return {
    fileName: video.fileName,
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
