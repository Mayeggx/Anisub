import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { MatchLogItem } from "../shared/types";

const storageDir = path.resolve(process.cwd(), ".anisub");
const logsPath = path.join(storageDir, "logs.json");

export class LogStore {
  private logs: MatchLogItem[] = [];
  private loaded = false;

  async list(): Promise<MatchLogItem[]> {
    await this.ensureLoaded();
    return [...this.logs];
  }

  async append(item: MatchLogItem): Promise<void> {
    await this.ensureLoaded();
    this.logs = [item, ...this.logs].slice(0, 200);
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    await mkdir(storageDir, { recursive: true });
    const raw = await readFile(logsPath, "utf8").catch(() => "[]");
    try {
      const parsed = JSON.parse(raw) as MatchLogItem[];
      this.logs = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.logs = [];
    }
  }

  private async persist(): Promise<void> {
    await writeFile(logsPath, JSON.stringify(this.logs, null, 2), "utf8");
  }
}
