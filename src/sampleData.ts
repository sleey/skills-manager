import type { ScanResult, SkillDocument } from "./types";

const demoHome = "/Users/demo";

export const sampleScan: ScanResult = {
  roots: [
    {
      id: "codex-codex",
      provider: "codex",
      label: "~/.codex/skills",
      path: `${demoHome}/.codex/skills`,
      resolvedPath: `${demoHome}/.agent/skills`,
      source: "auto",
      enabled: true,
      duplicateOfRootId: "codex-agent",
    },
    {
      id: "codex-agent",
      provider: "codex",
      label: "~/.agent/skills",
      path: `${demoHome}/.agent/skills`,
      resolvedPath: `${demoHome}/.agent/skills`,
      source: "auto",
      enabled: true,
      duplicateOfRootId: null,
    },
    {
      id: "claude-user",
      provider: "claude",
      label: "~/.claude/skills",
      path: `${demoHome}/.claude/skills`,
      resolvedPath: `${demoHome}/.claude/skills`,
      source: "auto",
      enabled: true,
      duplicateOfRootId: null,
    },
  ],
  skills: [
    {
      kind: "agentDoc",
      id: "codex:codex-agent:agents.md",
      provider: "codex",
      rootId: "codex-agent",
      name: "AGENTS.md",
      description: "Global Codex instructions",
      path: `${demoHome}/.agent`,
      mainFilePath: `${demoHome}/.agent/AGENTS.md`,
      status: "valid",
      linkState: "normal",
      issues: [],
    },
    {
      id: "codex:codex-agent:api-design",
      kind: "skill",
      provider: "codex",
      rootId: "codex-agent",
      name: "api-design",
      description: "Design robust, consistent, and well-documented APIs.",
      path: `${demoHome}/.agent/skills/api-design`,
      mainFilePath: `${demoHome}/.agent/skills/api-design/SKILL.md`,
      status: "valid",
      linkState: "normal",
      issues: [],
    },
    {
      id: "codex:codex-agent:code-review",
      kind: "skill",
      provider: "codex",
      rootId: "codex-agent",
      name: "code-review",
      description: "Review code for correctness, regressions, and missing tests.",
      path: `${demoHome}/.agent/skills/code-review`,
      mainFilePath: `${demoHome}/.agent/skills/code-review/SKILL.md`,
      status: "warning",
      linkState: "normal",
      issues: [
        {
          severity: "warning",
          code: "missing-reference",
          message: "Referenced file references/checklist.md is missing.",
          location: "references/checklist.md",
        },
      ],
    },
    {
      id: "codex:codex-agent:notebook-doodle-reference-image",
      kind: "skill",
      provider: "codex",
      rootId: "codex-agent",
      name: "notebook-doodle-reference-image",
      description: "Generate transparent notebook-doodle assets from references.",
      path: `${demoHome}/.agent/skills/notebook-doodle-reference-image`,
      mainFilePath: `${demoHome}/.agent/skills/notebook-doodle-reference-image/SKILL.md`,
      status: "valid",
      linkState: "normal",
      issues: [],
    },
    {
      kind: "agentDoc",
      id: "claude:claude-user:claude.md",
      provider: "claude",
      rootId: "claude-user",
      name: "CLAUDE.md",
      description: "Global Claude instructions",
      path: `${demoHome}/.claude`,
      mainFilePath: `${demoHome}/.claude/CLAUDE.md`,
      status: "valid",
      linkState: "normal",
      issues: [],
    },
    {
      id: "claude:claude-user:prompt-engineering",
      kind: "skill",
      provider: "claude",
      rootId: "claude-user",
      name: "prompt-engineering",
      description: "Shape prompts and reusable instructions for Claude workflows.",
      path: `${demoHome}/.claude/skills/prompt-engineering`,
      mainFilePath: `${demoHome}/.claude/skills/prompt-engineering/SKILL.md`,
      status: "valid",
      linkState: "symlink",
      issues: [],
    },
    {
      id: "claude:claude-user:data-analysis",
      kind: "skill",
      provider: "claude",
      rootId: "claude-user",
      name: "data-analysis",
      description: null,
      path: `${demoHome}/.claude/skills/data-analysis`,
      mainFilePath: `${demoHome}/.claude/skills/data-analysis/SKILL.md`,
      status: "warning",
      linkState: "normal",
      issues: [
        {
          severity: "warning",
          code: "missing-description",
          message: "Skill description is missing from frontmatter.",
          location: "metadata.description",
        },
      ],
    },
  ],
};

export const sampleDocuments: Record<string, SkillDocument> = {
  [`${demoHome}/.agent/AGENTS.md`]: {
    path: `${demoHome}/.agent/AGENTS.md`,
    name: "AGENTS.md",
    description: "Global Codex instructions",
    issues: [],
    content: `# AGENTS.md

Shared instructions for Codex sessions on this machine.

- Prefer small, verifiable changes.
- Read local project instructions before editing.
- Keep user-owned files safe.
`,
  },
  [`${demoHome}/.claude/CLAUDE.md`]: {
    path: `${demoHome}/.claude/CLAUDE.md`,
    name: "CLAUDE.md",
    description: "Global Claude instructions",
    issues: [],
    content: `# CLAUDE.md

Shared instructions for Claude Code sessions on this machine.

- Keep responses concise.
- Confirm risky file operations.
- Prefer project-local conventions.
`,
  },
  [`${demoHome}/.agent/skills/api-design/SKILL.md`]: {
    path: `${demoHome}/.agent/skills/api-design/SKILL.md`,
    name: "api-design",
    description: "Design robust, consistent, and well-documented APIs.",
    issues: [],
    content: `---
name: api-design
description: Design robust, consistent, and well-documented APIs.
provider: codex
tags: [api, design, rest, openapi]
---

## Purpose

Define clear, consistent API contracts and ensure they are easy to use, maintain, and evolve.

## When To Use

- Starting a new API
- Evolving an existing API
- Reviewing or documenting endpoints
- Aligning on error handling and status codes

## Process

1. Clarify resources and operations.
2. Define request and response schemas.
3. Specify errors and status codes.
4. Validate with examples.
5. Document with OpenAPI.

\`\`\`yaml
paths:
  /skills:
    get:
      summary: List available skills
\`\`\`
`,
  },
};

for (const skill of sampleScan.skills) {
  if (!sampleDocuments[skill.mainFilePath]) {
    sampleDocuments[skill.mainFilePath] = {
      path: skill.mainFilePath,
      name: skill.name,
      description: skill.description,
      issues: skill.issues,
      content: `---
name: ${skill.name}
${skill.description ? `description: ${skill.description}` : ""}
---

## Purpose

${skill.description ?? "This skill still needs a short description."}

## Notes

- Keep scope narrow.
- Prefer concrete local verification.
`,
    };
  }
}
