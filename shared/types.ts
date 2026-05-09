export type SubtitleSource = "jimaku" | "edatribe";
export type MatchMode = "auto" | "candidate";

export interface VideoItem {
  fileName: string;
  fullPath: string;
  folderPath: string;
  hasSubtitle: boolean;
  subtitlePath?: string;
  subtitleStatus: string;
}

export interface SubtitleCandidate {
  seriesTitle: string;
  episode: number | null;
  originalSubtitleName: string;
  downloadUrl: string;
}

export interface SubtitleDownloadResult {
  savedFileName: string;
  savedPath: string;
  seriesTitle: string;
  episode: number | null;
  originalSubtitleName: string;
  source: SubtitleSource;
}

export interface MatchLogItem {
  id: string;
  timestamp: string;
  source: SubtitleSource;
  videoFileName: string;
  seriesTitle: string;
  episode: number | null;
  originalSubtitleName: string;
  savedFileName: string;
  savedPath: string;
}

export interface ScanFolderRequest {
  folderPath: string;
}

export interface ScanFolderResponse {
  folderPath: string;
  videos: VideoItem[];
}

export interface MatchVideoRequest {
  videoPath: string;
  source: SubtitleSource;
  mode: MatchMode;
}

export interface MatchVideoDownloadedResponse {
  kind: "downloaded";
  video: VideoItem;
  result: SubtitleDownloadResult;
  log: MatchLogItem;
}

export interface MatchVideoCandidatesResponse {
  kind: "candidates";
  video: VideoItem;
  candidates: SubtitleCandidate[];
}

export type MatchVideoResponse =
  | MatchVideoDownloadedResponse
  | MatchVideoCandidatesResponse;

export interface DownloadCandidateRequest {
  videoPath: string;
  source: SubtitleSource;
  candidate: SubtitleCandidate;
}

export interface DownloadCandidateResponse {
  video: VideoItem;
  result: SubtitleDownloadResult;
  log: MatchLogItem;
}

export interface LogsResponse {
  logs: MatchLogItem[];
}

export interface PickFolderResponse {
  folderPath: string;
}

export interface OpenFolderRequest {
  folderPath: string;
}

export interface OpenFolderResponse {
  openedPath: string;
}
