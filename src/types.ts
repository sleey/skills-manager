export type SkillProvider = "codex" | "claude";

export type RootSource = "auto" | "custom";

export type SkillStatus = "valid" | "warning" | "broken";

export type IssueSeverity = "warning" | "error";

export type LinkState = "normal" | "symlink" | "junction" | "unknown";

export type ThemeMode = "system" | "light" | "dark";

export type SkillKind = "skill" | "agentDoc";

export type SkillRoot = {
  id: string;
  provider: SkillProvider;
  label: string;
  path: string;
  resolvedPath?: string | null;
  source: RootSource;
  enabled: boolean;
  duplicateOfRootId?: string | null;
};

export type SkillIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  location?: string | null;
};

export type SkillSummary = {
  kind: SkillKind;
  id: string;
  provider: SkillProvider;
  rootId: string;
  name: string;
  description?: string | null;
  path: string;
  mainFilePath: string;
  status: SkillStatus;
  linkState: LinkState;
  issues: SkillIssue[];
};

export type ScanResult = {
  roots: SkillRoot[];
  skills: SkillSummary[];
};

export type SkillDocument = {
  path: string;
  content: string;
  name: string;
  description?: string | null;
  issues: SkillIssue[];
};

export type SaveResult = {
  path: string;
  backupPath: string;
  document: SkillDocument;
};

export type CopyResult = {
  sourcePath: string;
  destinationPath: string;
  filesCopied: number;
};
