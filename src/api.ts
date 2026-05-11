import {
  CreateAnkiWordCardRequest,
  CreateAnkiWordCardResponse,
  CreateWordNoteRequest,
  CreateWordNoteResponse,
  DownloadCandidateRequest,
  DownloadCandidateResponse,
  LogsResponse,
  MatchVideoRequest,
  MatchVideoResponse,
  OffsetSubtitleRequest,
  OffsetSubtitleResponse,
  OpenConfigFileResponse,
  OpenWordNoteLogResponse,
  OpenFolderRequest,
  OpenFolderResponse,
  PickFolderResponse,
  PlayVideoRequest,
  PlayVideoResponse,
  RemoteSyncEntryActionRequest,
  RemoteSyncStateResponse,
  ScanImageFolderRequest,
  ScanImageFolderResponse,
  ScanFolderRequest,
  ScanFolderResponse,
  SaveRemoteSyncConfigRequest,
  WordNoteConfigResponse,
  UpdateRemoteSyncImageCompressionRequest,
  CreateRemoteSyncEntryRequest,
} from "../shared/types";

type RequestOptions = {
  signal?: AbortSignal;
};

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

export function matchVideo(body: MatchVideoRequest, options?: RequestOptions): Promise<MatchVideoResponse> {
  return request("/api/match-video", {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
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

export function offsetSubtitle(body: OffsetSubtitleRequest, options?: RequestOptions): Promise<OffsetSubtitleResponse> {
  return request("/api/offset-subtitle", {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export function createWordNote(body: CreateWordNoteRequest): Promise<CreateWordNoteResponse> {
  return request("/api/word-note", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function scanImageFolder(body: ScanImageFolderRequest): Promise<ScanImageFolderResponse> {
  return request("/api/scan-image-folder", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchWordNoteConfig(): Promise<WordNoteConfigResponse> {
  return request("/api/word-note-config");
}

export function openWordNoteConfig(): Promise<OpenConfigFileResponse> {
  return request("/api/open-word-note-config", {
    method: "POST",
  });
}

export function createAnkiWordCard(body: CreateAnkiWordCardRequest): Promise<CreateAnkiWordCardResponse> {
  return request("/api/create-anki-word-card", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function openWordNoteLog(): Promise<OpenWordNoteLogResponse> {
  return request("/api/open-word-note-log", {
    method: "POST",
  });
}

export function fetchRemoteSyncState(): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/state");
}

export function refreshRemoteSyncEntries(): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/refresh", {
    method: "POST",
  });
}

export function saveRemoteSyncConfig(body: SaveRemoteSyncConfigRequest): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/config", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateRemoteSyncImageCompression(
  body: UpdateRemoteSyncImageCompressionRequest,
): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/image-compression", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createRemoteSyncEntry(body: CreateRemoteSyncEntryRequest): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/create-entry", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function remoteSyncPull(): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/pull", {
    method: "POST",
  });
}

export function remoteSyncPush(body: RemoteSyncEntryActionRequest): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/push", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function remoteSyncClear(body: RemoteSyncEntryActionRequest): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/clear", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function remoteSyncDelete(body: RemoteSyncEntryActionRequest): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/delete", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function clearRemoteSyncLogs(): Promise<RemoteSyncStateResponse> {
  return request("/api/remote-sync/clear-logs", {
    method: "POST",
  });
}
