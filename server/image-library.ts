import path from "node:path";
import { readdir, stat } from "node:fs/promises";

import { ImageItem } from "../shared/types";
import { IMAGE_EXTENSIONS } from "./constants";
import { AppError } from "./errors";

export async function scanImageFolder(folderPath: string): Promise<ImageItem[]> {
  const normalized = path.resolve(folderPath);
  const folderStat = await stat(normalized).catch(() => null);
  if (!folderStat?.isDirectory()) {
    throw new AppError("Target image folder does not exist or is inaccessible.", 404);
  }

  const entries = await readdir(normalized, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) => IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    .map((entry) => ({
      fileName: entry.name,
      fullPath: path.join(normalized, entry.name),
      folderPath: normalized,
      subtitleText: path.parse(entry.name).name,
    }));
}

export async function isSupportedImageFile(filePath: string): Promise<boolean> {
  const normalized = path.resolve(filePath);
  const fileStat = await stat(normalized).catch(() => null);
  if (!fileStat?.isFile()) {
    return false;
  }
  return IMAGE_EXTENSIONS.has(path.extname(normalized).toLowerCase());
}
