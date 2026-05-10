import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { AppError } from "./errors";

const SRT_EXTENSIONS = new Set([".srt"]);
const ASS_EXTENSIONS = new Set([".ass"]);

export type SubtitleFormat = "srt" | "ass";

export async function offsetSubtitleFile(subtitlePath: string, offsetMs: number): Promise<SubtitleFormat> {
  const normalizedPath = path.resolve(subtitlePath);
  const extension = path.extname(normalizedPath).toLowerCase();
  const format = resolveFormat(extension);

  const original = await readFile(normalizedPath, "utf8").catch(() => null);
  if (original === null) {
    throw new AppError("Subtitle file does not exist or cannot be read.", 404);
  }

  const shifted = format === "srt" ? shiftSrtTimestamps(original, offsetMs) : shiftAssTimestamps(original, offsetMs);
  await writeFile(normalizedPath, shifted, "utf8");
  return format;
}

function resolveFormat(extension: string): SubtitleFormat {
  if (SRT_EXTENSIONS.has(extension)) {
    return "srt";
  }
  if (ASS_EXTENSIONS.has(extension)) {
    return "ass";
  }
  throw new AppError("Only .srt and .ass subtitle files are supported.", 400);
}

function shiftSrtTimestamps(content: string, offsetMs: number): string {
  const timestampRegex = /\b(\d{2}):(\d{2}):(\d{2}),(\d{3})\b/g;
  return content.replace(timestampRegex, (_match, hh, mm, ss, mmm) => {
    const raw = toSrtMilliseconds(Number(hh), Number(mm), Number(ss), Number(mmm));
    return fromSrtMilliseconds(raw + offsetMs);
  });
}

function toSrtMilliseconds(hours: number, minutes: number, seconds: number, milliseconds: number): number {
  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + milliseconds;
}

function fromSrtMilliseconds(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  const totalSeconds = Math.floor(safe / 1000);
  const ms = safe % 1000;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function shiftAssTimestamps(content: string, offsetMs: number): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const shiftedLines = lines.map((line) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("Dialogue:")) {
      return line;
    }
    const leadingSpacesLength = line.length - trimmed.length;
    const leadingSpaces = line.slice(0, leadingSpacesLength);
    const payload = trimmed.slice("Dialogue:".length);
    const fields = splitAssDialogueFields(payload);
    if (!fields) {
      return line;
    }

    const startMs = parseAssTimeToMilliseconds(fields[1].trim());
    const endMs = parseAssTimeToMilliseconds(fields[2].trim());
    if (startMs === null || endMs === null) {
      return line;
    }

    fields[1] = formatAssMilliseconds(startMs + offsetMs);
    fields[2] = formatAssMilliseconds(endMs + offsetMs);
    return `${leadingSpaces}Dialogue:${fields.join(",")}`;
  });
  return shiftedLines.join(newline);
}

function splitAssDialogueFields(payload: string): string[] | null {
  const fields: string[] = [];
  let current = "";
  let commaCount = 0;
  for (let index = 0; index < payload.length; index += 1) {
    const char = payload[index];
    if (char === "," && commaCount < 9) {
      fields.push(current);
      current = "";
      commaCount += 1;
      continue;
    }
    current += char;
  }
  fields.push(current);
  if (fields.length < 10) {
    return null;
  }
  return fields;
}

function parseAssTimeToMilliseconds(value: string): number | null {
  const match = value.match(/^(\d+):([0-5]\d):([0-5]\d)\.(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const centiseconds = Number(match[4]);
  return ((((hours * 60) + minutes) * 60) + seconds) * 1000 + centiseconds * 10;
}

function formatAssMilliseconds(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  const totalCentiseconds = Math.round(safe / 10);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}
