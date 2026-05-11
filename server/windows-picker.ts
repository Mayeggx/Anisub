import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import net, { Socket } from "node:net";
import path from "node:path";

import { VideoPlaybackStatus } from "../shared/types";
import { AppError } from "./errors";
import { videoPlaybackStatusStore } from "./video-playback-status-store";

export async function pickFolder(): Promise<string> {
  if (process.platform !== "win32") {
    throw new AppError("Folder picker is only supported on Windows.", 400);
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$dialog.Description = "Select the video folder"',
    "$dialog.ShowNewFolderButton = $false",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Output $dialog.SelectedPath",
    "}",
  ].join("; ");

  const output = await runPowerShell(script);
  const folderPath = output.trim();
  if (!folderPath) {
    throw new AppError("Folder selection was cancelled.", 400);
  }
  return folderPath;
}

export async function openFolderInExplorer(targetPath: string): Promise<string> {
  if (process.platform !== "win32") {
    throw new AppError("Opening folders is only supported on Windows.", 400);
  }

  const resolvedPath = path.resolve(normalizeInputPath(targetPath));
  const script = [
    `if (-not (Test-Path -LiteralPath '${escapePowerShell(resolvedPath)}' -PathType Container)) {`,
    "  exit 2",
    "}",
    `Start-Process explorer.exe -ArgumentList @('/e,','${escapePowerShell(resolvedPath)}')`,
  ].join("; ");

  try {
    await runPowerShell(script);
  } catch (error) {
    if (error instanceof AppError && error.status === 500) {
      throw new AppError("Failed to open folder. Please confirm the path exists.", 400);
    }
    throw error;
  }

  return resolvedPath;
}

export async function openVideoInPlayer(playerPath: string, videoPath: string): Promise<VideoPlaybackStatus> {
  if (process.platform !== "win32") {
    throw new AppError("Launching a local player is only supported on Windows.", 400);
  }

  const resolvedPlayerPath = path.resolve(normalizeInputPath(playerPath));
  const resolvedVideoPath = path.resolve(normalizeInputPath(videoPath));
  const playerExists = await pathExists(resolvedPlayerPath);
  if (!playerExists) {
    throw new AppError("Player executable was not found.", 400);
  }

  const videoExists = await pathExists(resolvedVideoPath);
  if (!videoExists) {
    throw new AppError("Video file was not found.", 400);
  }

  if (!path.basename(resolvedPlayerPath).toLowerCase().includes("mpv")) {
    throw new AppError("当前仅支持 mpv 播放器（路径需指向 mpv.exe）。", 400);
  }

  const ipcPath = `\\\\.\\pipe\\anisub-mpv-${randomUUID()}`;
  await spawnDetachedProcess(resolvedPlayerPath, [`--input-ipc-server=${ipcPath}`, resolvedVideoPath]);
  const playbackStatus = await videoPlaybackStatusStore.markAsPlayed(resolvedVideoPath);
  void watchMpvPlayback(ipcPath, resolvedVideoPath).catch((error) => {
    console.warn("Failed to monitor mpv playback:", error);
  });
  return playbackStatus;
}

export async function openTextFile(targetPath: string): Promise<string> {
  if (process.platform !== "win32") {
    throw new AppError("Opening config file is only supported on Windows.", 400);
  }

  const resolvedPath = path.resolve(normalizeInputPath(targetPath));
  const exists = await pathExistsAny(resolvedPath);
  if (!exists) {
    throw new AppError("Config file was not found.", 404);
  }

  await spawnDetachedProcess("notepad.exe", [resolvedPath]);
  return resolvedPath;
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-Command", script], {
      windowsHide: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new AppError(stderr.trim() || `PowerShell execution failed with exit code ${code}.`, 500));
        return;
      }
      resolve(stdout);
    });
  });
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeInputPath(value: string): string {
  return value
    .trim()
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
}

async function pathExists(targetPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("powershell", [
      "-NoProfile",
      "-Command",
      `if (Test-Path -LiteralPath '${escapePowerShell(targetPath)}' -PathType Leaf) { exit 0 } else { exit 1 }`,
    ], {
      windowsHide: true,
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function pathExistsAny(targetPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("powershell", [
      "-NoProfile",
      "-Command",
      `if (Test-Path -LiteralPath '${escapePowerShell(targetPath)}') { exit 0 } else { exit 1 }`,
    ], {
      windowsHide: true,
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function spawnDetachedProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });

    let settled = false;

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new AppError(`Failed to launch player: ${error.message}`, 400));
    });

    child.once("spawn", () => {
      child.unref();
      setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      }, 300);
    });

    child.once("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new AppError(`Player exited immediately with code ${code ?? "unknown"}.`, 400));
    });
  });
}

async function watchMpvPlayback(ipcPath: string, videoPath: string): Promise<void> {
  const socket = await connectToPipeWithRetry(ipcPath, 80, 100);
  await monitorMpvSocket(socket, videoPath);
}

async function monitorMpvSocket(socket: Socket, videoPath: string): Promise<void> {
  let buffer = "";
  let endFileHandled = false;

  await new Promise<void>((resolve) => {
    socket.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const message = line.trim();
        if (!message) {
          continue;
        }
        void handleMpvMessage(message);
      }
    });

    socket.once("error", () => resolve());
    socket.once("close", () => resolve());

    async function handleMpvMessage(message: string): Promise<void> {
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        return;
      }

      if (!payload || typeof payload !== "object") {
        return;
      }

      const event = (payload as { event?: unknown }).event;
      if (event !== "end-file" || endFileHandled) {
        return;
      }
      endFileHandled = true;

      const reason = (payload as { reason?: unknown }).reason;
      if (reason === "eof") {
        await videoPlaybackStatusStore.setStatus(videoPath, "已播放");
      }
      socket.end();
    }
  });
}

async function connectToPipeWithRetry(ipcPath: string, attempts: number, delayMs: number): Promise<Socket> {
  let lastError: unknown = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await connectToPipe(ipcPath);
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }
  throw new AppError(
    `Failed to connect to mpv IPC (${ipcPath}): ${
      lastError instanceof Error ? lastError.message : "unknown error"
    }`,
    500,
  );
}

function connectToPipe(ipcPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(ipcPath);
    const handleError = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", handleError);
    socket.once("connect", () => {
      socket.off("error", handleError);
      resolve(socket);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
