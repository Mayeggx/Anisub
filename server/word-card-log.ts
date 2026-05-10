import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

type WordCardLogRecord = {
  imagePath: string;
  noteId: number;
  updatedAt: string;
};

type WordCardLogFile = {
  records: WordCardLogRecord[];
};

const LOG_DIR = path.join(process.cwd(), ".anisub");
const LOG_PATH = path.join(LOG_DIR, "word-card-log.json");

export async function listWordCardLogRecords(): Promise<WordCardLogRecord[]> {
  const content = await readLogFile();
  return content.records;
}

export async function upsertWordCardLogRecord(record: WordCardLogRecord): Promise<void> {
  const content = await readLogFile();
  const map = new Map(content.records.map((item) => [normalizePath(item.imagePath), item]));
  map.set(normalizePath(record.imagePath), {
    imagePath: path.resolve(record.imagePath),
    noteId: record.noteId,
    updatedAt: record.updatedAt,
  });
  const next: WordCardLogFile = {
    records: Array.from(map.values()).sort((a, b) => a.imagePath.localeCompare(b.imagePath, "zh-CN")),
  };
  await writeLogFile(next);
}

async function readLogFile(): Promise<WordCardLogFile> {
  await mkdir(LOG_DIR, { recursive: true });
  const raw = await readFile(LOG_PATH, "utf-8").catch(() => "");
  if (!raw.trim()) {
    return { records: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WordCardLogFile>;
    if (!Array.isArray(parsed.records)) {
      return { records: [] };
    }
    const records = parsed.records
      .filter((item): item is WordCardLogRecord => Boolean(item && item.imagePath && item.updatedAt))
      .map((item) => ({
        imagePath: path.resolve(item.imagePath),
        noteId: Number.isFinite(item.noteId) ? item.noteId : 0,
        updatedAt: item.updatedAt,
      }));
    return { records };
  } catch {
    return { records: [] };
  }
}

async function writeLogFile(content: WordCardLogFile): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(LOG_PATH, `${JSON.stringify(content, null, 2)}\n`, "utf-8");
}

function normalizePath(targetPath: string): string {
  return path.resolve(targetPath).toLowerCase();
}
