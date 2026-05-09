import { decode } from "html-entities";

import { ParsedVideo, SubtitleNameHeuristics } from "./subtitle-heuristics";

export function decodeHtml(text: string): string {
  return decode(text);
}

export function tokenOverlap(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter((item) => item.length >= 2));
  const rightTokens = new Set(right.split(" ").filter((item) => item.length >= 2));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of rightTokens) {
    if (leftTokens.has(token)) {
      intersection += 1;
    }
  }
  return intersection / rightTokens.size;
}

export function containsSeason(text: string, season: number): boolean {
  const lower = text.toLowerCase();
  return (
    new RegExp(`\\bs(?:eason)?\\s*0?${season}\\b`, "i").test(lower) ||
    new RegExp(`\\b${season}(?:st|nd|rd|th)\\s+season\\b`, "i").test(lower) ||
    new RegExp(`\\bpart\\s*0?${season}\\b`, "i").test(lower)
  );
}

export function scoreSubtitleFile(parsed: ParsedVideo, fileName: string): number {
  const ext = extensionOf(fileName);
  const extScore = (() => {
    switch (ext) {
      case ".srt":
        return 50;
      case ".ass":
        return 45;
      case ".ssa":
        return 40;
      case ".vtt":
        return 35;
      case ".sup":
        return 20;
      case ".7z":
      case ".zip":
      case ".rar":
        return 12;
      default:
        return 10;
    }
  })();

  const titleScore = Math.floor(
    tokenOverlap(
      SubtitleNameHeuristics.normalize(fileName),
      SubtitleNameHeuristics.normalize(parsed.baseTitle),
    ) * 40,
  );
  const seasonScore = parsed.season !== null && containsSeason(fileName, parsed.season) ? 8 : 0;
  return extScore + titleScore + seasonScore;
}

export function extensionOf(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }
  return name.slice(dotIndex).toLowerCase();
}

export function withoutExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex <= 0 ? name : name.slice(0, dotIndex);
}
