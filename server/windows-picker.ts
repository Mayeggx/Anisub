import { spawn } from "node:child_process";
import path from "node:path";

import { AppError } from "./errors";

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

export async function openVideoInPlayer(playerPath: string, videoPath: string): Promise<void> {
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

  await spawnDetachedProcess(resolvedPlayerPath, [resolvedVideoPath]);
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
