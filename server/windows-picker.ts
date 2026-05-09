import { spawn } from "node:child_process";
import path from "node:path";

import { AppError } from "./errors";

export async function pickFolder(): Promise<string> {
  if (process.platform !== "win32") {
    throw new AppError("当前仅支持在 Windows 上使用本地目录选择器。", 400);
  }

  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$dialog.Description = "选择视频所在文件夹"',
    "$dialog.ShowNewFolderButton = $false",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Output $dialog.SelectedPath",
    "}",
  ].join("; ");

  const output = await runPowerShell(script);
  const folderPath = output.trim();
  if (!folderPath) {
    throw new AppError("已取消选择文件夹。", 400);
  }
  return folderPath;
}

export async function openFolderInExplorer(targetPath: string): Promise<string> {
  if (process.platform !== "win32") {
    throw new AppError("当前仅支持在 Windows 中打开文件夹。", 400);
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
      throw new AppError("打开文件夹失败，请确认路径存在。", 400);
    }
    throw error;
  }

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
        reject(new AppError(stderr.trim() || `PowerShell 执行失败，退出码 ${code}。`, 500));
        return;
      }
      resolve(stdout);
    });
  });
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}
