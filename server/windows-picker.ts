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

  const resolvedPath = path.resolve(targetPath);
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

  const resolvedPlayerPath = path.resolve(playerPath);
  const resolvedVideoPath = path.resolve(videoPath);
  const script = [
    `if (-not (Test-Path -LiteralPath '${escapePowerShell(resolvedPlayerPath)}' -PathType Leaf)) {`,
    "  exit 2",
    "}",
    `if (-not (Test-Path -LiteralPath '${escapePowerShell(resolvedVideoPath)}' -PathType Leaf)) {`,
    "  exit 3",
    "}",
    `Start-Process -FilePath '${escapePowerShell(resolvedPlayerPath)}' -ArgumentList @('${escapePowerShell(resolvedVideoPath)}')`,
  ].join("; ");

  try {
    await runPowerShell(script);
  } catch (error) {
    if (error instanceof AppError && error.status === 500) {
      throw new AppError("Failed to launch player. Please confirm both paths exist.", 400);
    }
    throw error;
  }
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
