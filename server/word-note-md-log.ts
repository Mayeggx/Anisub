import path from "node:path";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

import { CreateAnkiWordCardResponse } from "../shared/types";

const LOG_DIR = path.join(process.cwd(), ".anisub");
const LOG_PATH = path.join(LOG_DIR, "word-note-log.md");

type AppendWordNoteLogInput = {
  imagePath: string;
  subtitle: string;
  targetWord: string;
  result: CreateAnkiWordCardResponse;
};

export async function appendWordNoteMarkdownLog(input: AppendWordNoteLogInput): Promise<string> {
  await mkdir(LOG_DIR, { recursive: true });
  const hasContent = await readFile(LOG_PATH, "utf-8")
    .then((content) => content.trim().length > 0)
    .catch(() => false);

  const timestamp = new Date().toISOString();
  const title = `## ${timestamp}`;
  const statusText = input.result.status === "updated" ? "updated" : "created";
  const lines = [
    `- status: ${statusText}`,
    `- noteId: ${input.result.noteId}`,
    `- mode: ${input.result.mode}`,
    `- deck: ${toInline(input.result.deckName)}`,
    `- model: ${toInline(input.result.modelName)}`,
    `- imagePath: ${toInline(path.resolve(input.imagePath))}`,
    `- subtitle: ${toInline(input.subtitle)}`,
    `- targetWord: ${toInline(input.targetWord)}`,
    `- word: ${toInline(input.result.wordNote.word)}`,
    `- pronunciation: ${toInline(input.result.wordNote.pronunciation)}`,
    `- meaning: ${toInline(input.result.wordNote.meaning)}`,
    `- example: ${toInline(input.result.wordNote.example)}`,
    `- note: ${toInline(input.result.wordNote.note)}`,
  ];

  const prefix = hasContent ? "\n\n" : "# Anisub Word Note Log\n";
  await appendFile(LOG_PATH, `${prefix}${title}\n${lines.join("\n")}\n`, "utf-8");
  return LOG_PATH;
}

export function getWordNoteMarkdownLogPath(): string {
  return LOG_PATH;
}

export async function ensureWordNoteMarkdownLogFile(): Promise<string> {
  await mkdir(LOG_DIR, { recursive: true });
  const hasContent = await readFile(LOG_PATH, "utf-8")
    .then((content) => content.trim().length > 0)
    .catch(() => false);
  if (!hasContent) {
    await writeFile(LOG_PATH, "# Anisub Word Note Log\n", "utf-8");
  }
  return LOG_PATH;
}

function toInline(value: string): string {
  return value.trim().replaceAll(/\r?\n/g, " / ");
}
