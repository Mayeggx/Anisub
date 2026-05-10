import path from "node:path";
import { stat } from "node:fs/promises";
import sharp from "sharp";

import { AppError } from "./errors";
import { createWordNote, resolveWordMode } from "./word-note";
import { readWordNoteConfig } from "./word-note-config";
import { CreateAnkiWordCardRequest, CreateAnkiWordCardResponse, WordNoteResult } from "../shared/types";

type AnkiResponse<T> = {
  result: T;
  error: string | null;
};

type AnkiNoteInfo = {
  noteId: number;
  fields: Record<string, { value: string }>;
};

const ANKI_URL = "http://localhost:8765";

export async function createAnkiWordCard(input: CreateAnkiWordCardRequest): Promise<CreateAnkiWordCardResponse> {
  const imagePath = path.resolve(input.imagePath?.trim() ?? "");
  if (!imagePath) {
    throw new AppError("Missing image path.", 400);
  }
  const fileStat = await stat(imagePath).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new AppError("Image file does not exist.", 404);
  }

  const subtitle = input.subtitle?.trim();
  const targetWord = input.targetWord?.trim();
  if (!subtitle) {
    throw new AppError("Missing subtitle.", 400);
  }
  if (!targetWord) {
    throw new AppError("Missing target word.", 400);
  }

  const config = await readWordNoteConfig();
  const mode = resolveWordMode(input.mode, targetWord);
  const deckName = mode === "jp" ? config.anki.jpDeck : config.anki.enDeck;

  const wordNoteResponse = await createWordNote({
    subtitle,
    targetWord,
    mode: input.mode,
  });

  const mediaFileName = `${path.parse(imagePath).name}.jpg`;
  await storeMediaFile(imagePath, mediaFileName, {
    maxWidth: config.anki.maxWidth,
    maxHeight: config.anki.maxHeight,
    quality: config.anki.imageQuality,
  });

  const fields = buildFields(config.anki, wordNoteResponse.note, mediaFileName, mode);
  const wordValue = fields[config.anki.wordField] ?? "";
  const existingNoteId = await findExistingNoteId(wordValue, config.anki.wordField, deckName);

  if (existingNoteId !== null) {
    await updateExistingNote(existingNoteId, config.anki, wordNoteResponse.note, mediaFileName);
    return {
      status: "updated",
      mode,
      deckName,
      modelName: config.anki.modelName,
      noteId: existingNoteId,
      mediaFileName,
      wordNote: wordNoteResponse.note,
    };
  }

  const noteId = await addNote({
    deckName,
    modelName: config.anki.modelName,
    fields,
  });

  return {
    status: "created",
    mode,
    deckName,
    modelName: config.anki.modelName,
    noteId,
    mediaFileName,
    wordNote: wordNoteResponse.note,
  };
}

async function storeMediaFile(
  imagePath: string,
  fileName: string,
  resize: { maxWidth: number; maxHeight: number; quality: number },
): Promise<void> {
  const quality = clampInteger(resize.quality, 1, 100, 60);
  const width = clampInteger(resize.maxWidth, 1, 4096, 320);
  const height = clampInteger(resize.maxHeight, 1, 4096, 240);

  const data = await sharp(imagePath)
    .rotate()
    .resize({ width, height, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality })
    .toBuffer();

  const base64Data = data.toString("base64");
  await ankiRequest("storeMediaFile", { filename: fileName, data: base64Data });
}

function buildFields(
  anki: Awaited<ReturnType<typeof readWordNoteConfig>>["anki"],
  note: WordNoteResult,
  mediaFileName: string,
  mode: "jp" | "en",
): Record<string, string> {
  return {
    [anki.wordField]: note.word,
    [anki.pronunciationField]: note.pronunciation,
    [anki.meaningField]: note.meaning,
    [anki.noteField]: note.note,
    [anki.exampleField]: `${note.example}<br><img src="${mediaFileName}">`,
    [anki.voiceField]: buildVoiceValue(mode, note.word, note.pronunciation),
  };
}

function buildVoiceValue(mode: "jp" | "en", word: string, pronunciation: string): string {
  if (mode === "jp") {
    return `[sound:https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji=${encodeURIComponent(word)}&kana=${encodeURIComponent(pronunciation)}]`;
  }
  return `[sound:https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}]`;
}

async function findExistingNoteId(wordValue: string, wordField: string, deckName: string): Promise<number | null> {
  const normalizedWord = normalizeWordValue(wordValue);
  if (!normalizedWord) {
    return null;
  }

  const escapedWord = escapeAnkiQueryValue(normalizedWord);
  const queries = [`"${wordField}:${escapedWord}"`, `deck:"${deckName}" "${wordField}:${escapedWord}"`, `deck:"${deckName}"`];
  const seen = new Set<number>();

  for (const query of queries) {
    const found = await ankiRequest<number[]>("findNotes", { query });
    const noteIds = found.filter((id) => !seen.has(id));
    if (noteIds.length === 0) {
      continue;
    }
    noteIds.forEach((id) => seen.add(id));

    const infos = await ankiRequest<AnkiNoteInfo[]>("notesInfo", { notes: noteIds });
    for (const info of infos) {
      const currentWord = normalizeWordValue(info.fields?.[wordField]?.value ?? "");
      if (currentWord === normalizedWord) {
        return info.noteId;
      }
    }
  }

  return null;
}

async function updateExistingNote(
  noteId: number,
  anki: Awaited<ReturnType<typeof readWordNoteConfig>>["anki"],
  note: WordNoteResult,
  mediaFileName: string,
): Promise<void> {
  const noteInfos = await ankiRequest<AnkiNoteInfo[]>("notesInfo", { notes: [noteId] });
  if (!Array.isArray(noteInfos) || noteInfos.length === 0) {
    throw new AppError("Failed to load existing Anki note.", 502);
  }

  const current = noteInfos[0].fields ?? {};
  const currentExample = current[anki.exampleField]?.value ?? "";
  const currentNote = current[anki.noteField]?.value ?? "";
  const currentMeaning = current[anki.meaningField]?.value ?? "";

  const nextExample = `${currentExample}<br>2.${note.example}<br><img src="${mediaFileName}">`;
  const nextNote = `${currentNote}<br>例句2含义：${note.note}`;
  const nextMeaning = `${currentMeaning}<br>${note.meaning}`;

  await ankiRequest("updateNoteFields", {
    note: {
      id: noteId,
      fields: {
        [anki.exampleField]: nextExample,
        [anki.noteField]: nextNote,
        [anki.meaningField]: nextMeaning,
      },
    },
  });
}

async function addNote(input: {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
}): Promise<number> {
  const noteId = await ankiRequest<number | null>("addNote", {
    note: {
      deckName: input.deckName,
      modelName: input.modelName,
      fields: input.fields,
      options: { allowDuplicate: true },
    },
  });
  if (typeof noteId !== "number") {
    throw new AppError("AnkiConnect did not return a note ID.", 502);
  }
  return noteId;
}

async function ankiRequest<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const payload = {
    action,
    version: 6,
    params,
  };

  let response: Response;
  try {
    response = await fetch(ANKI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new AppError(`Cannot connect to AnkiConnect (${toMessage(error)}).`, 502);
  }

  const body = (await response.json().catch(() => null)) as AnkiResponse<T> | null;
  if (!response.ok || !body) {
    throw new AppError(`AnkiConnect request failed (${response.status}).`, 502);
  }
  if (body.error) {
    throw new AppError(`AnkiConnect error: ${body.error}`, 502);
  }
  return body.result;
}

function normalizeWordValue(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function escapeAnkiQueryValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}
