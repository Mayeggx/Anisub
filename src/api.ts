import {
  DownloadCandidateRequest,
  DownloadCandidateResponse,
  LogsResponse,
  MatchVideoRequest,
  MatchVideoResponse,
  OpenFolderRequest,
  OpenFolderResponse,
  PickFolderResponse,
  PlayVideoRequest,
  PlayVideoResponse,
  ScanFolderRequest,
  ScanFolderResponse,
} from "../shared/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `请求失败 (${response.status})`);
  }
  return payload as T;
}

export function pickFolder(): Promise<PickFolderResponse> {
  return request("/api/pick-folder", { method: "POST" });
}

export function openFolder(body: OpenFolderRequest): Promise<OpenFolderResponse> {
  return request("/api/open-folder", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function scanFolder(body: ScanFolderRequest): Promise<ScanFolderResponse> {
  return request("/api/scan-folder", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchLogs(): Promise<LogsResponse> {
  return request("/api/logs");
}

export function playVideo(body: PlayVideoRequest): Promise<PlayVideoResponse> {
  return request("/api/play-video", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function matchVideo(body: MatchVideoRequest): Promise<MatchVideoResponse> {
  return request("/api/match-video", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function downloadCandidate(
  body: DownloadCandidateRequest,
): Promise<DownloadCandidateResponse> {
  return request("/api/download-candidate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
