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

export interface ImageItem {
  fileName: string;
  fullPath: string;
  folderPath: string;
  subtitleText: string;
  added: boolean;
  addedAt?: string;
}

export interface ScanImageFolderRequest {
  folderPath: string;
}

export interface ScanImageFolderResponse {
  folderPath: string;
  images: ImageItem[];
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

export interface PlayVideoRequest {
  videoPath: string;
  playerPath: string;
}

export interface PlayVideoResponse {
  videoPath: string;
  playerPath: string;
}

export type WordNoteMode = "auto" | "jp" | "en";
export type WordNoteLanguage = "jp" | "en";

export interface CreateWordNoteRequest {
  subtitle: string;
  targetWord: string;
  mode: WordNoteMode;
}

export interface WordNoteResult {
  word: string;
  pronunciation: string;
  meaning: string;
  example: string;
  note: string;
}

export interface CreateWordNoteResponse {
  mode: WordNoteLanguage;
  note: WordNoteResult;
}

export interface WordNoteOpenAIConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
}

export interface WordNoteAnkiConfig {
  jpDeck: string;
  enDeck: string;
  modelName: string;
  wordField: string;
  pronunciationField: string;
  meaningField: string;
  noteField: string;
  exampleField: string;
  voiceField: string;
  maxWidth: number;
  maxHeight: number;
  imageQuality: number;
}

export interface WordNoteConfig {
  openai: WordNoteOpenAIConfig;
  anki: WordNoteAnkiConfig;
}

export interface WordNoteConfigResponse {
  configPath: string;
  config: WordNoteConfig;
}

export interface OpenConfigFileRequest {
  configPath: string;
}

export interface OpenConfigFileResponse {
  openedPath: string;
}

export interface CreateAnkiWordCardRequest {
  imagePath: string;
  subtitle: string;
  targetWord: string;
  mode: WordNoteMode;
}

export interface CreateAnkiWordCardResponse {
  status: "created" | "updated";
  mode: WordNoteLanguage;
  deckName: string;
  modelName: string;
  noteId: number;
  mediaFileName: string;
  wordNote: WordNoteResult;
}
