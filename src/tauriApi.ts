import { invoke } from "@tauri-apps/api/core";
import { sampleDocuments, sampleScan } from "./sampleData";
import type { CopyResult, SaveResult, ScanResult, SkillDocument } from "./types";

export const isDesktopRuntime = "__TAURI_INTERNALS__" in window;

export async function scanSkills(): Promise<ScanResult> {
  if (!isDesktopRuntime) {
    return sampleScan;
  }

  return invoke<ScanResult>("scan_skills");
}

export async function readSkill(path: string): Promise<SkillDocument> {
  if (!isDesktopRuntime) {
    return sampleDocuments[path] ?? sampleDocuments[Object.keys(sampleDocuments)[0]];
  }

  return invoke<SkillDocument>("read_skill", { path });
}

export async function saveSkill(
  path: string,
  expectedContent: string,
  newContent: string,
): Promise<SaveResult> {
  if (!isDesktopRuntime) {
    const document: SkillDocument = {
      ...(sampleDocuments[path] ?? {
        path,
        name: "demo",
        description: null,
        issues: [],
        content: "",
      }),
      content: newContent,
    };

    sampleDocuments[path] = document;

    return {
      path,
      backupPath: `/tmp/agent-skills-manager/backups/${document.name}-SKILL.md.bak`,
      document,
    };
  }

  return invoke<SaveResult>("save_skill", {
    path,
    expectedContent,
    newContent,
  });
}

export async function copySkill(
  sourcePath: string,
  destinationRoot: string,
  overwrite: boolean,
): Promise<CopyResult> {
  if (!isDesktopRuntime) {
    return {
      sourcePath,
      destinationPath: `${destinationRoot}/${sourcePath.split("/").pop() ?? "skill"}`,
      filesCopied: 3,
    };
  }

  return invoke<CopyResult>("copy_skill", {
    sourcePath,
    destinationRoot,
    overwrite,
  });
}

export async function copyText(text: string): Promise<void> {
  if (!isDesktopRuntime) {
    await copyTextToWebClipboard(text);
    return;
  }

  return invoke<void>("copy_text", { text });
}

async function copyTextToWebClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back below when the browser denies the async clipboard API.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}
