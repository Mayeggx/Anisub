import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import { WordNoteConfig } from "../shared/types";

const CONFIG_DIR = path.join(process.cwd(), ".anisub");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.ini");

const DEFAULT_CONFIG: WordNoteConfig = {
  openai: {
    apiKey: "",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelName: "qwen-plus",
  },
  anki: {
    jpDeck: "日本語::エンタメ::テレビアニメーション",
    enDeck: "English Vocabulary::A English Daily",
    modelName: "划词助手Antimoon模板",
    wordField: "单词",
    pronunciationField: "音标",
    meaningField: "释义",
    noteField: "笔记",
    exampleField: "例句",
    voiceField: "发音",
    maxWidth: 320,
    maxHeight: 240,
    imageQuality: 60,
  },
};

export async function getWordNoteConfigPath(): Promise<string> {
  await ensureConfigExists();
  return CONFIG_PATH;
}

export async function readWordNoteConfig(): Promise<WordNoteConfig> {
  await ensureConfigExists();
  const raw = await readFile(CONFIG_PATH, "utf-8");
  const parsed = parseIni(raw);

  return {
    openai: {
      apiKey: parsed.openai.api_key ?? DEFAULT_CONFIG.openai.apiKey,
      baseUrl: parsed.openai.base_url ?? DEFAULT_CONFIG.openai.baseUrl,
      modelName: parsed.openai.model_name ?? DEFAULT_CONFIG.openai.modelName,
    },
    anki: {
      jpDeck: parsed.anki.jp_deck ?? DEFAULT_CONFIG.anki.jpDeck,
      enDeck: parsed.anki.en_deck ?? DEFAULT_CONFIG.anki.enDeck,
      modelName: parsed.anki.model_name ?? DEFAULT_CONFIG.anki.modelName,
      wordField: parsed.anki.word_field ?? DEFAULT_CONFIG.anki.wordField,
      pronunciationField: parsed.anki.pronunciation_field ?? DEFAULT_CONFIG.anki.pronunciationField,
      meaningField: parsed.anki.meaning_field ?? DEFAULT_CONFIG.anki.meaningField,
      noteField: parsed.anki.note_field ?? DEFAULT_CONFIG.anki.noteField,
      exampleField: parsed.anki.example_field ?? DEFAULT_CONFIG.anki.exampleField,
      voiceField: parsed.anki.voice_field ?? DEFAULT_CONFIG.anki.voiceField,
      maxWidth: parseInteger(parsed.anki.max_width, DEFAULT_CONFIG.anki.maxWidth),
      maxHeight: parseInteger(parsed.anki.max_height, DEFAULT_CONFIG.anki.maxHeight),
      imageQuality: parseInteger(parsed.anki.image_quality, DEFAULT_CONFIG.anki.imageQuality),
    },
  };
}

async function ensureConfigExists(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const existing = await stat(CONFIG_PATH).catch(() => null);
  if (!existing?.isFile()) {
    await writeFile(CONFIG_PATH, buildDefaultIni(), "utf-8");
  }
}

function buildDefaultIni(): string {
  return [
    "[openai]",
    `api_key = ${DEFAULT_CONFIG.openai.apiKey}`,
    `base_url = ${DEFAULT_CONFIG.openai.baseUrl}`,
    `model_name = ${DEFAULT_CONFIG.openai.modelName}`,
    "",
    "[anki]",
    `jp_deck = ${DEFAULT_CONFIG.anki.jpDeck}`,
    `en_deck = ${DEFAULT_CONFIG.anki.enDeck}`,
    `model_name = ${DEFAULT_CONFIG.anki.modelName}`,
    `word_field = ${DEFAULT_CONFIG.anki.wordField}`,
    `pronunciation_field = ${DEFAULT_CONFIG.anki.pronunciationField}`,
    `meaning_field = ${DEFAULT_CONFIG.anki.meaningField}`,
    `note_field = ${DEFAULT_CONFIG.anki.noteField}`,
    `example_field = ${DEFAULT_CONFIG.anki.exampleField}`,
    `voice_field = ${DEFAULT_CONFIG.anki.voiceField}`,
    `max_width = ${DEFAULT_CONFIG.anki.maxWidth}`,
    `max_height = ${DEFAULT_CONFIG.anki.maxHeight}`,
    `image_quality = ${DEFAULT_CONFIG.anki.imageQuality}`,
    "",
  ].join("\n");
}

type ParsedIni = {
  openai: Partial<Record<"api_key" | "base_url" | "model_name", string>>;
  anki: Partial<
    Record<
      | "jp_deck"
      | "en_deck"
      | "model_name"
      | "word_field"
      | "pronunciation_field"
      | "meaning_field"
      | "note_field"
      | "example_field"
      | "voice_field"
      | "max_width"
      | "max_height"
      | "image_quality",
      string
    >
  >;
};

function parseIni(raw: string): ParsedIni {
  const result: ParsedIni = {
    openai: {},
    anki: {},
  };
  let section = "";

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      section = trimmed.slice(1, -1).trim().toLowerCase();
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (section === "openai" && (key === "api_key" || key === "base_url" || key === "model_name")) {
      result.openai[key] = value;
    }
    if (
      section === "anki" &&
      (key === "jp_deck" ||
        key === "en_deck" ||
        key === "model_name" ||
        key === "word_field" ||
        key === "pronunciation_field" ||
        key === "meaning_field" ||
        key === "note_field" ||
        key === "example_field" ||
        key === "voice_field" ||
        key === "max_width" ||
        key === "max_height" ||
        key === "image_quality")
    ) {
      result.anki[key] = value;
    }
  }

  return result;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}
