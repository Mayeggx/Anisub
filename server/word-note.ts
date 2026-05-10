import { AppError } from "./errors";
import {
  CreateWordNoteRequest,
  CreateWordNoteResponse,
  WordNoteLanguage,
  WordNoteResult,
} from "../shared/types";
import { readWordNoteConfig } from "./word-note-config";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type WordNotePayload = Record<string, unknown>;

export async function createWordNote(input: CreateWordNoteRequest): Promise<CreateWordNoteResponse> {
  const subtitle = input.subtitle?.trim();
  const targetWord = input.targetWord?.trim();
  const config = await readWordNoteConfig();
  const apiKey = config.openai.apiKey.trim();
  const baseUrl = config.openai.baseUrl.trim();
  const model = config.openai.modelName.trim();

  if (!subtitle) {
    throw new AppError("Missing subtitle.", 400);
  }
  if (!targetWord) {
    throw new AppError("Missing target word.", 400);
  }
  if (!apiKey || !baseUrl || !model) {
    throw new AppError("OpenAI config is incomplete. Please edit .anisub/config.ini first.", 400);
  }

  const mode = resolveWordMode(input.mode, targetWord);
  const prompt = buildPrompt(mode, subtitle, targetWord);
  const systemPrompt =
    mode === "jp"
      ? "你是专业的日语词典助手。请只返回 JSON。"
      : "You are a professional English dictionary assistant. Return JSON only.";
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
  if (!response.ok) {
    throw new AppError(payload.error?.message ?? `Word note request failed (${response.status}).`, 502);
  }

  const content = readMessageContent(payload);
  if (!content) {
    throw new AppError("Model returned empty content.", 502);
  }

  const parsed = parseWordNotePayload(content);
  const note = normalizeWordNoteResult(parsed, { subtitle, targetWord });

  return {
    mode,
    note,
  };
}

export function resolveWordMode(mode: CreateWordNoteRequest["mode"], targetWord: string): WordNoteLanguage {
  if (mode === "jp" || mode === "en") {
    return mode;
  }
  return /^[A-Za-z]/.test(targetWord) ? "en" : "jp";
}

function buildPrompt(mode: WordNoteLanguage, subtitle: string, targetWord: string): string {
  if (mode === "en") {
    return [
      "Please analyze the target word in the subtitle sentence and return ONE JSON object.",
      "Required JSON keys: 单词, 音标, 意义, 例句, 笔记",
      "Rules:",
      "1) 单词: return lemma/base form.",
      "2) 音标: IPA or common dictionary style.",
      "3) 意义: English definition only, do not repeat the word itself.",
      `4) 例句: keep original sentence and wrap the target word with <b>${targetWord}</b>.`,
      "5) 笔记: explain the meaning in Chinese based on context.",
      "Return JSON only. No markdown, no extra text.",
      "",
      "Example input:",
      "例句: The Demon Sword's wavelength seems to be... swelling",
      "单词: swelling",
      "Example output:",
      "{\"单词\":\"swell\",\"音标\":\"swel\",\"意义\":\"to increase in size, intensity, or power\",\"例句\":\"The Demon Sword's wavelength seems to be... <b>swelling</b>\",\"笔记\":\"这里的 swelling 指能量正在增强、膨胀，不是身体肿胀。\"}",
      "",
      "Current input:",
      `例句: ${subtitle}`,
      `单词: ${targetWord}`,
    ].join("\n");
  }

  return [
    "请根据字幕句子和目标单词，返回一个 JSON 对象。",
    "必须包含键：单词、音标、意义、例句、笔记",
    "要求：",
    "1) 单词：返回原型（如果是变形，返回原形）。",
    "2) 音标：给出日语读音。",
    "3) 意义：只写日文释义，不要重复单词本身。",
    `4) 例句：保留原句，并把目标词用 <b>${targetWord}</b> 包裹。`,
    "5) 笔记：用中文结合语境解释这个词在句中的意思。",
    "只返回 JSON，不要 markdown，不要额外说明。",
    "",
    "示例输入：",
    "例句：連絡先を忘れたって わめいてたろ",
    "单词：わめいて",
    "示例输出：",
    "{\"单词\":\"喚く\",\"音标\":\"わめく\",\"意义\":\"大声でさけぶ。騒ぎ立てる。\",\"例句\":\"連絡先を忘れたって <b>わめいて</b>たろ\",\"笔记\":\"这里表示因为忘记联系方式而情绪激动地大声叫嚷。\"}",
    "",
    "当前输入：",
    `例句：${subtitle}`,
    `单词：${targetWord}`,
  ].join("\n");
}

function readMessageContent(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? "")
      .join("")
      .trim();
  }
  return "";
}

function parseWordNotePayload(raw: string): WordNotePayload {
  const trimmed = raw.trim();
  const withoutFence =
    trimmed.startsWith("```") && trimmed.endsWith("```")
      ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
      : trimmed;

  try {
    return JSON.parse(withoutFence) as WordNotePayload;
  } catch {
    const jsonMatch = withoutFence.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new AppError("Model output is not valid JSON.", 502);
    }
    try {
      return JSON.parse(jsonMatch[0]) as WordNotePayload;
    } catch {
      throw new AppError("Model output JSON parse failed.", 502);
    }
  }
}

function normalizeWordNoteResult(
  payload: WordNotePayload,
  fallback: { subtitle: string; targetWord: string },
): WordNoteResult {
  const word = readText(payload, ["单词", "word", "lemma"]) || fallback.targetWord;
  const pronunciation = readText(payload, ["音标", "pronunciation", "reading"]);
  const meaning = readText(payload, ["意义", "meaning", "definition"]);
  const example = readText(payload, ["例句", "example", "sentence"]) || fallback.subtitle;
  const note = readText(payload, ["笔记", "note", "explanation"]);

  return {
    word,
    pronunciation,
    meaning,
    example,
    note,
  };
}

function readText(payload: WordNotePayload, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}
