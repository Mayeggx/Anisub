import { SubtitleCandidate, SubtitleDownloadResult, SubtitleSource } from "../shared/types";

export interface DesktopVideoContext {
  fileName: string;
  fullPath: string;
  folderPath: string;
}

export interface SubtitleMatcher {
  readonly source: SubtitleSource;
  findCandidates(video: DesktopVideoContext): Promise<SubtitleCandidate[]>;
  downloadCandidate(
    video: DesktopVideoContext,
    candidate: SubtitleCandidate,
  ): Promise<SubtitleDownloadResult>;
  matchAndDownload(video: DesktopVideoContext): Promise<SubtitleDownloadResult>;
}
