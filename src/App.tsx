import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Database,
  FileText,
  Folder,
  HardDrive,
  Layers3,
  LibraryBig,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  WrapText,
} from "lucide-react";
import { type CSSProperties, type PointerEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { copySkill, copyText, isDesktopRuntime, readSkill, saveSkill, scanSkills } from "./tauriApi";
import type { ScanResult, SkillDocument, SkillIssue, SkillProvider, SkillRoot, SkillStatus, ThemeMode } from "./types";

type ProviderFilter = "all" | SkillProvider;
type InspectorTab = "preview" | "validation" | "backups";
type RailSection = "skills" | "safety" | "settings";
type PaneKey = "roots" | "library" | "inspector";
type PaneWidths = Record<PaneKey, number>;
type ToastState = {
  id: number;
  message: string;
  tone: "success" | "error";
};
type PaneVisibility = {
  inspectorOpen: boolean;
  libraryOpen: boolean;
  workspaceOpen: boolean;
};

const providerLabels: Record<ProviderFilter, string> = {
  all: "All providers",
  codex: "Codex",
  claude: "Claude",
};

const themeLabels: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const defaultPaneWidths: PaneWidths = {
  roots: 260,
  library: 300,
  inspector: 380,
};

const minEditorWidth = 280;

const paneLimits: Record<PaneKey, { min: number; max: number }> = {
  roots: { min: 220, max: 360 },
  library: { min: 240, max: 460 },
  inspector: { min: 300, max: 540 },
};

function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem("agent-skills-manager-theme");
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function getInitialWordWrap() {
  return localStorage.getItem("agent-skills-manager-word-wrap") === "true";
}

function getInitialInspectorOpen() {
  return window.innerWidth > 1180;
}

function getInitialPanelOpen(key: "workspace" | "library") {
  const stored = localStorage.getItem(`agent-skills-manager-${key}-open`);
  return stored === null ? true : stored === "true";
}

function getInitialPaneWidths(): PaneWidths {
  const stored = localStorage.getItem("agent-skills-manager-pane-widths");
  if (!stored) {
    return defaultPaneWidths;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<PaneWidths>;
    return {
      roots: clampPaneWidth("roots", parsed.roots ?? defaultPaneWidths.roots),
      library: clampPaneWidth("library", parsed.library ?? defaultPaneWidths.library),
      inspector: clampPaneWidth("inspector", parsed.inspector ?? defaultPaneWidths.inspector),
    };
  } catch {
    return defaultPaneWidths;
  }
}

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function clampPaneWidth(key: PaneKey, width: number) {
  const limits = paneLimits[key];
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
}

function fitPaneWidths(widths: PaneWidths, visibility: PaneVisibility, viewportWidth = window.innerWidth): PaneWidths {
  const next: PaneWidths = {
    roots: clampPaneWidth("roots", widths.roots),
    library: clampPaneWidth("library", widths.library),
    inspector: clampPaneWidth("inspector", widths.inspector),
  };

  const railWidth = viewportWidth <= 860 ? 60 : viewportWidth <= 1180 ? 68 : 76;
  const inspectorInGrid = viewportWidth > 1180 && visibility.inspectorOpen;
  const editorWidth = viewportWidth > 1180 ? minEditorWidth : 0;
  const usedWidth =
    railWidth +
    (visibility.workspaceOpen ? next.roots : 0) +
    (visibility.libraryOpen ? next.library : 0) +
    (inspectorInGrid ? next.inspector : 0);
  let overflow = usedWidth + editorWidth - viewportWidth;
  if (overflow <= 0) {
    return next;
  }

  const shrinkOrder: PaneKey[] = [
    ...(inspectorInGrid ? ["inspector" as const] : []),
    ...(visibility.libraryOpen ? ["library" as const] : []),
    ...(visibility.workspaceOpen ? ["roots" as const] : []),
  ];
  for (const key of shrinkOrder) {
    const shrinkBy = Math.min(next[key] - paneLimits[key].min, overflow);
    next[key] -= shrinkBy;
    overflow -= shrinkBy;
    if (overflow <= 0) {
      break;
    }
  }

  return next;
}

function skillMatchesFilters(
  skill: ScanResult["skills"][number],
  provider: ProviderFilter,
  rootId: string,
  rawQuery: string,
) {
  if (provider !== "all" && skill.provider !== provider) {
    return false;
  }
  if (rootId !== "all" && skill.rootId !== rootId) {
    return false;
  }

  const normalizedQuery = rawQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [skill.name, skill.description ?? "", skill.path]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function App() {
  const [scan, setScan] = useState<ScanResult>({ roots: [], skills: [] });
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [documentState, setDocumentState] = useState<SkillDocument | null>(null);
  const [baselineContent, setBaselineContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [rootFilter, setRootFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme);
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTab>("preview");
  const [activeRailSection, setActiveRailSection] = useState<RailSection>("skills");
  const [isInspectorOpen, setIsInspectorOpen] = useState(getInitialInspectorOpen);
  const [isSaveMenuOpen, setIsSaveMenuOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(() => getInitialPanelOpen("workspace"));
  const [isLibraryOpen, setIsLibraryOpen] = useState(() => getInitialPanelOpen("library"));
  const [isWordWrapEnabled, setIsWordWrapEnabled] = useState(getInitialWordWrap);
  const [paneWidths, setPaneWidths] = useState<PaneWidths>(getInitialPaneWidths);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<SkillProvider, boolean>>({
    codex: false,
    claude: false,
  });
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(getSystemTheme);
  const [message, setMessage] = useState("Ready");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveTheme = themeMode === "system" ? systemTheme : themeMode;
  const runtimeLabel = isDesktopRuntime ? "Local" : "Demo data";
  const shellClassName = [
    "app-shell",
    isInspectorOpen ? "" : "inspector-collapsed",
    isWorkspaceOpen ? "" : "workspace-collapsed",
    isLibraryOpen ? "" : "library-collapsed",
  ]
    .filter(Boolean)
    .join(" ");
  const appShellStyle = {
    "--roots-width": isWorkspaceOpen ? `${paneWidths.roots}px` : "0px",
    "--library-width": isLibraryOpen ? `${paneWidths.library}px` : "0px",
    "--inspector-width": isInspectorOpen ? `${paneWidths.inspector}px` : "0px",
  } as CSSProperties;
  const selectedSkill = useMemo(
    () => (selectedSkillId ? scan.skills.find((skill) => skill.id === selectedSkillId) ?? null : null),
    [scan.skills, selectedSkillId],
  );
  const isDirty = draftContent !== baselineContent;

  const loadDocument = useCallback(async (path: string) => {
    setError(null);
    const nextDocument = await readSkill(path);
    setDocumentState(nextDocument);
    setBaselineContent(nextDocument.content);
    setDraftContent(nextDocument.content);
  }, []);

  async function refreshSkills() {
    setIsLoading(true);
    setError(null);
    try {
      const nextScan = await scanSkills();
      setScan(nextScan);
      const nextVisibleSkills = nextScan.skills.filter((skill) =>
        skillMatchesFilters(skill, providerFilter, rootFilter, query),
      );
      const nextSelected = selectedSkillId
        ? nextVisibleSkills.find((skill) => skill.id === selectedSkillId) ?? nextVisibleSkills[0] ?? null
        : nextVisibleSkills[0] ?? null;
      setSelectedSkillId(nextSelected?.id ?? null);
      if (nextSelected) {
        await loadDocument(nextSelected.mainFilePath);
      } else {
        clearOpenDocument();
      }
      setMessage(`Scanned ${nextScan.skills.length} documents across ${nextScan.roots.length} roots`);
    } catch (caught) {
      setError(errorMessage(caught));
      setMessage("Scan failed");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refreshSkills();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setSystemTheme(getSystemTheme());
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    localStorage.setItem("agent-skills-manager-theme", themeMode);
  }, [effectiveTheme, themeMode]);

  useEffect(() => {
    localStorage.setItem("agent-skills-manager-word-wrap", String(isWordWrapEnabled));
  }, [isWordWrapEnabled]);

  useEffect(() => {
    localStorage.setItem("agent-skills-manager-workspace-open", String(isWorkspaceOpen));
  }, [isWorkspaceOpen]);

  useEffect(() => {
    localStorage.setItem("agent-skills-manager-library-open", String(isLibraryOpen));
  }, [isLibraryOpen]);

  useEffect(() => {
    const fitToViewport = () => {
      setPaneWidths((widths) =>
        fitPaneWidths(widths, {
          inspectorOpen: isInspectorOpen,
          libraryOpen: isLibraryOpen,
          workspaceOpen: isWorkspaceOpen,
        }),
      );
    };

    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, [isInspectorOpen, isLibraryOpen, isWorkspaceOpen]);

  useEffect(() => {
    localStorage.setItem("agent-skills-manager-pane-widths", JSON.stringify(paneWidths));
  }, [paneWidths]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const filteredSkills = useMemo(() => {
    return scan.skills.filter((skill) => skillMatchesFilters(skill, providerFilter, rootFilter, query));
  }, [providerFilter, query, rootFilter, scan.skills]);

  const groupedSkills = useMemo(() => {
    return filteredSkills.reduce<Record<SkillProvider, typeof filteredSkills>>(
      (groups, skill) => {
        groups[skill.provider].push(skill);
        return groups;
      },
      { codex: [], claude: [] },
    );
  }, [filteredSkills]);

  const rootById = useMemo(() => new Map(scan.roots.map((root) => [root.id, root])), [scan.roots]);
  const currentIssues = documentState?.issues.length ? documentState.issues : selectedSkill?.issues ?? [];
  const warningCount = scan.skills.filter((skill) => skill.kind === "skill" && skill.status !== "valid").length;
  const validCount = scan.skills.filter((skill) => skill.kind === "skill" && skill.status === "valid").length;
  const destinationRoot = useMemo(() => {
    if (!selectedSkill || selectedSkill.kind !== "skill") {
      return null;
    }

    const targetProvider: SkillProvider = selectedSkill.provider === "codex" ? "claude" : "codex";
    return scan.roots.find(
      (root) => root.provider === targetProvider && root.enabled && !root.duplicateOfRootId,
    ) ?? null;
  }, [scan.roots, selectedSkill]);
  const saveSyncLabel = destinationRoot ? `Save + sync to ${providerLabels[destinationRoot.provider]}` : "Save + sync";

  useEffect(() => {
    if (!selectedSkill || !destinationRoot) {
      setIsSaveMenuOpen(false);
    }
  }, [destinationRoot, selectedSkill]);

  function clearOpenDocument() {
    setSelectedSkillId(null);
    setDocumentState(null);
    setBaselineContent("");
    setDraftContent("");
  }

  function showToast(message: string, tone: ToastState["tone"] = "success") {
    setToast({ id: Date.now(), message, tone });
  }

  async function openFirstMatchingSkill(nextProvider: ProviderFilter, nextRootId: string, nextQuery: string) {
    const nextSkill = scan.skills.find((skill) => skillMatchesFilters(skill, nextProvider, nextRootId, nextQuery));

    if (!nextSkill) {
      clearOpenDocument();
      setMessage("No documents match these filters");
      return;
    }

    setSelectedSkillId(nextSkill.id);
    try {
      await loadDocument(nextSkill.mainFilePath);
      setMessage(`Opened ${nextSkill.name}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setMessage("Open failed");
    }
  }

  async function selectSkill(skillId: string) {
    if (skillId === selectedSkillId) {
      return;
    }
    if (isDirty && !window.confirm("Discard unsaved changes and open another document?")) {
      return;
    }

    const skill = scan.skills.find((item) => item.id === skillId);
    if (!skill) {
      return;
    }

    setSelectedSkillId(skillId);
    try {
      await loadDocument(skill.mainFilePath);
      setMessage(`Opened ${skill.name}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setMessage("Open failed");
    }
  }

  async function applyProviderFilter(nextProvider: ProviderFilter) {
    const selectedStillVisible = selectedSkill
      ? skillMatchesFilters(selectedSkill, nextProvider, rootFilter, query)
      : false;

    if (!selectedStillVisible && isDirty && !window.confirm("Discard unsaved changes and switch provider?")) {
      return;
    }

    setProviderFilter(nextProvider);
    if (!selectedStillVisible) {
      await openFirstMatchingSkill(nextProvider, rootFilter, query);
    }
  }

  async function applyRootFilter(nextRootId: string) {
    const selectedStillVisible = selectedSkill
      ? skillMatchesFilters(selectedSkill, providerFilter, nextRootId, query)
      : false;

    if (!selectedStillVisible && isDirty && !window.confirm("Discard unsaved changes and switch root?")) {
      return;
    }

    setRootFilter(nextRootId);
    if (!selectedStillVisible) {
      await openFirstMatchingSkill(providerFilter, nextRootId, query);
    }
  }

  async function applyQuery(nextQuery: string) {
    setQuery(nextQuery);

    const selectedStillVisible = selectedSkill
      ? skillMatchesFilters(selectedSkill, providerFilter, rootFilter, nextQuery)
      : false;

    if (selectedStillVisible) {
      return;
    }

    if (isDirty) {
      setMessage("Selected document is hidden by filters; save or clear filters to switch.");
      return;
    }

    await openFirstMatchingSkill(providerFilter, rootFilter, nextQuery);
  }

  async function handleSave() {
    if (!documentState || !isDirty) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await saveSkill(documentState.path, baselineContent, draftContent);
      setDocumentState(result.document);
      setBaselineContent(result.document.content);
      setDraftContent(result.document.content);
      setMessage(`Saved with backup: ${compactPath(result.backupPath)}`);
      await refreshSkills();
    } catch (caught) {
      setError(errorMessage(caught));
      setMessage("Save failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopy() {
    if (!selectedSkill || !destinationRoot) {
      return;
    }

    const confirmed = window.confirm(
      `Copy ${selectedSkill.name} to ${providerLabels[destinationRoot.provider]} root ${destinationRoot.label}?`,
    );
    if (!confirmed) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await copySkill(selectedSkill.path, destinationRoot.path, false);
      setMessage(`Copied ${result.filesCopied} files to ${compactPath(result.destinationPath)}`);
      showToast(`Copied to ${providerLabels[destinationRoot.provider]}`);
      await refreshSkills();
    } catch (caught) {
      setError(errorMessage(caught));
      setMessage("Copy failed");
      showToast("Copy failed", "error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveAndCopy() {
    if (!selectedSkill || !destinationRoot || (isDirty && !documentState)) {
      return;
    }

    const confirmed = window.confirm(
      `${isDirty ? "Save changes and copy" : "Copy"} ${selectedSkill.name} to ${providerLabels[destinationRoot.provider]} root ${destinationRoot.label}?`,
    );
    if (!confirmed) {
      return;
    }

    setIsSaveMenuOpen(false);
    setIsLoading(true);
    setError(null);
    try {
      if (isDirty && documentState) {
        const saveResult = await saveSkill(documentState.path, baselineContent, draftContent);
        setDocumentState(saveResult.document);
        setBaselineContent(saveResult.document.content);
        setDraftContent(saveResult.document.content);
      }

      const copyResult = await copySkill(selectedSkill.path, destinationRoot.path, false);
      setMessage(`Saved and synced ${copyResult.filesCopied} files to ${compactPath(copyResult.destinationPath)}`);
      showToast(`Saved and synced to ${providerLabels[destinationRoot.provider]}`);
      await refreshSkills();
    } catch (caught) {
      setError(errorMessage(caught));
      setMessage("Save + sync failed");
      showToast("Save + sync failed", "error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopySelectedPath() {
    if (!selectedSkill) {
      return;
    }

    try {
      await copyText(selectedSkill.mainFilePath);
      setError(null);
      setMessage(`Copied absolute path: ${selectedSkill.mainFilePath}`);
      showToast("Copied absolute path");
    } catch (caught) {
      setError(errorMessage(caught));
      setMessage("Could not copy path");
      showToast("Could not copy path", "error");
    }
  }

  function cycleThemeMode() {
    setThemeMode((currentTheme) => {
      if (currentTheme === "system") {
        return "light";
      }
      if (currentTheme === "light") {
        return "dark";
      }
      return "system";
    });
  }

  function toggleProviderGroup(provider: SkillProvider) {
    setCollapsedGroups((groups) => ({
      ...groups,
      [provider]: !groups[provider],
    }));
  }

  function showRailSection(section: RailSection) {
    setIsWorkspaceOpen(true);
    setActiveRailSection(section);
  }

  function startPaneResize(key: PaneKey, event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = paneWidths[key];

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = key === "inspector" ? startX - moveEvent.clientX : moveEvent.clientX - startX;
      setPaneWidths((widths) =>
        fitPaneWidths(
          {
            ...widths,
            [key]: clampPaneWidth(key, startWidth + delta),
          },
          {
            inspectorOpen: isInspectorOpen,
            libraryOpen: isLibraryOpen,
            workspaceOpen: isWorkspaceOpen,
          },
        ),
      );
    };

    const handlePointerUp = () => {
      document.body.classList.remove("is-resizing-pane");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    document.body.classList.add("is-resizing-pane");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void handleSave();
        return;
      }

      if (key === "\\") {
        event.preventDefault();
        setIsInspectorOpen((open) => !open);
        return;
      }

      if (event.shiftKey && key === "w") {
        event.preventDefault();
        setIsWordWrapEnabled((enabled) => !enabled);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <main className={shellClassName} style={appShellStyle}>
      <div className="app-topbar">
        <div className="toolbar-group layout-toolbar chrome-toolbar" aria-label="Layout controls">
          <button
            className={isWorkspaceOpen ? "icon-button active" : "icon-button"}
            type="button"
            onClick={() => setIsWorkspaceOpen((open) => !open)}
            aria-pressed={isWorkspaceOpen}
            aria-label={isWorkspaceOpen ? "Hide workspace panel" : "Show workspace panel"}
            title={isWorkspaceOpen ? "Hide workspace panel" : "Show workspace panel"}
          >
            {isWorkspaceOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button
            className={isLibraryOpen ? "icon-button active" : "icon-button"}
            type="button"
            onClick={() => setIsLibraryOpen((open) => !open)}
            aria-pressed={isLibraryOpen}
            aria-label={isLibraryOpen ? "Hide library" : "Show library"}
            title={isLibraryOpen ? "Hide library" : "Show library"}
          >
            <LibraryBig size={16} />
          </button>
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            className={isInspectorOpen ? "icon-button active inspector-toggle-button" : "icon-button inspector-toggle-button"}
            type="button"
            onClick={() => setIsInspectorOpen((open) => !open)}
            aria-pressed={isInspectorOpen}
            aria-label={isInspectorOpen ? "Hide inspector" : "Show inspector"}
            title={`${isInspectorOpen ? "Hide" : "Show"} inspector (Ctrl/Cmd+\\)`}
          >
            {isInspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
      </div>
      <aside className="icon-rail" aria-label="Primary navigation">
        <div className="brand-mark">
          <Layers3 size={22} />
        </div>
        <RailButton active={activeRailSection === "skills" && isWorkspaceOpen} icon={<Database size={19} />} label="Library" onClick={() => showRailSection("skills")} />
        <RailButton active={activeRailSection === "safety" && isWorkspaceOpen} icon={<ShieldCheck size={19} />} label="Safety" onClick={() => showRailSection("safety")} />
        <RailButton active={activeRailSection === "settings" && isWorkspaceOpen} icon={<Settings size={19} />} label="Settings" onClick={() => showRailSection("settings")} />
        <div className="rail-spacer" />
        <RailButton icon={effectiveTheme === "dark" ? <Moon size={19} /> : <Sun size={19} />} label={themeLabels[themeMode]} onClick={cycleThemeMode} />
      </aside>

      {isWorkspaceOpen ? (
      <section className={activeRailSection === "skills" ? "roots-panel" : "roots-panel mobile-visible"}>
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">{activeRailSection === "skills" ? "Workspace" : "Panel"}</p>
            <h1>{railSectionTitle(activeRailSection)}</h1>
          </div>
          <div className="panel-title-actions">
            <span className={isDesktopRuntime ? "status-pill" : "status-pill demo"}>
              <Circle size={8} fill="currentColor" />
              {runtimeLabel}
            </span>
          </div>
        </div>

        {activeRailSection === "skills" ? (
          <>
            <label className="field-label" htmlFor="provider-filter">
              Provider
            </label>
            <div className="select-wrap">
              <select
                id="provider-filter"
                value={providerFilter}
                onChange={(event) => {
                  applyProviderFilter(event.currentTarget.value as ProviderFilter);
                }}
              >
                <option value="all">All providers</option>
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
              <ChevronDown size={15} />
            </div>

            <label className="field-label" htmlFor="root-filter">
              Root
            </label>
            <div className="select-wrap">
              <select
                id="root-filter"
                value={rootFilter}
                onChange={(event) => {
                  applyRootFilter(event.currentTarget.value);
                }}
              >
                <option value="all">All roots</option>
                {scan.roots.map((root) => (
                  <option key={root.id} value={root.id}>
                    {root.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>

            <details className="workspace-details">
              <summary>
                <span>Configured roots</span>
                <strong>{scan.roots.length}</strong>
              </summary>
              <div className="root-list">
                {scan.roots.map((root) => (
                  <RootRow key={root.id} root={root} duplicateRoot={root.duplicateOfRootId ? rootById.get(root.duplicateOfRootId) : null} />
                ))}
              </div>
            </details>

            <details className="workspace-details">
              <summary>
                <span>Skill health</span>
                <strong>{warningCount}</strong>
              </summary>
              <div className="scan-summary">
                <div>
                  <strong>{validCount}</strong>
                  <span>valid</span>
                </div>
                <div>
                  <strong>{warningCount}</strong>
                  <span>needs review</span>
                </div>
              </div>
            </details>
          </>
        ) : null}

        {activeRailSection === "safety" ? (
          <div className="detail-stack">
            <div className="section-heading">Write Safety</div>
            <InfoCard title="Backups before save" body="Every save creates a backup before replacing the selected Markdown file." />
            <InfoCard title="Stale write guard" body="The app refuses to save when the file changed on disk after it was opened." />
            <InfoCard title="Sync is explicit" body="Copying to another provider asks for confirmation and does not overwrite an existing destination." />
            <InfoCard title="Current selection" body={currentIssues.length === 0 ? "Selected document has no reported validation issues." : `${currentIssues.length} validation ${currentIssues.length === 1 ? "issue needs" : "issues need"} review before syncing.`} />
          </div>
        ) : null}

        {activeRailSection === "settings" ? (
          <div className="detail-stack">
            <label className="field-label" htmlFor="panel-theme-select">
              Theme
            </label>
            <div className="select-wrap">
              <select id="panel-theme-select" value={themeMode} onChange={(event) => setThemeMode(event.currentTarget.value as ThemeMode)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
              <ChevronDown size={15} />
            </div>
            <div className="setting-row">
              <span>Word wrap editor lines</span>
              <div className="segmented-toggle" role="radiogroup" aria-label="Word wrap editor lines">
                <button
                  className={isWordWrapEnabled ? "" : "active"}
                  type="button"
                  role="radio"
                  aria-checked={!isWordWrapEnabled}
                  onClick={() => setIsWordWrapEnabled(false)}
                >
                  Off
                </button>
                <button
                  className={isWordWrapEnabled ? "active" : ""}
                  type="button"
                  role="radio"
                  aria-checked={isWordWrapEnabled}
                  onClick={() => setIsWordWrapEnabled(true)}
                >
                  On
                </button>
              </div>
            </div>
            <InfoCard title="Runtime" body={isDesktopRuntime ? "Desktop runtime is using real Markdown files and backup writes." : "Browser preview is using demo data. Launch Tauri to use real Markdown files."} />
            <InfoCard title="Shortcuts" body="Ctrl/Cmd+S saves, Ctrl/Cmd+\\ toggles the inspector, Ctrl/Cmd+Shift+W toggles word wrap." />
          </div>
        ) : null}
        <PaneResizeHandle side="right" label="Resize side panel" onPointerDown={(event) => startPaneResize("roots", event)} />
      </section>
      ) : null}

      {isLibraryOpen ? (
      <section className="library-panel">
        <div className="toolbar">
          <div className="select-wrap mobile-provider-filter">
            <select
              aria-label="Provider"
              value={providerFilter}
              onChange={(event) => {
                applyProviderFilter(event.currentTarget.value as ProviderFilter);
              }}
            >
              <option value="all">All providers</option>
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
            <ChevronDown size={15} />
          </div>
          <div className="search-box">
            <Search size={17} />
            <input value={query} onChange={(event) => applyQuery(event.currentTarget.value)} placeholder="Search library" />
          </div>
          <button className="secondary-button" type="button" onClick={refreshSkills} disabled={isLoading}>
            <RefreshCw size={16} />
            Rescan
          </button>
          <button className="icon-button" type="button" onClick={() => setIsLibraryOpen(false)} aria-label="Hide library" title="Hide library">
            <PanelLeftClose size={16} />
          </button>
        </div>

        <div className="library-header">
          <span>Library</span>
          <strong>{filteredSkills.length}</strong>
        </div>

        <SkillGroup
          label="Codex"
          provider="codex"
          skills={groupedSkills.codex}
          selectedSkillId={selectedSkillId}
          collapsed={collapsedGroups.codex}
          onToggle={toggleProviderGroup}
          onSelect={selectSkill}
        />
        <SkillGroup
          label="Claude"
          provider="claude"
          skills={groupedSkills.claude}
          selectedSkillId={selectedSkillId}
          collapsed={collapsedGroups.claude}
          onToggle={toggleProviderGroup}
          onSelect={selectSkill}
        />
        <PaneResizeHandle side="right" label="Resize library" onPointerDown={(event) => startPaneResize("library", event)} />
      </section>
      ) : null}

      <section className="editor-panel">
        <div className="editor-tabs">
          <div className="active-tab">
            <FileText size={15} />
            {selectedSkill?.kind === "agentDoc" ? selectedSkill.name : "SKILL.md"}
            {isDirty ? <span className="dirty-dot" /> : null}
          </div>
          <div className="editor-actions">
            <div className="toolbar-group action-group" aria-label="Document actions">
              <button
                className={isWordWrapEnabled ? "icon-button active editor-action-icon" : "icon-button editor-action-icon"}
                type="button"
                onClick={() => setIsWordWrapEnabled((enabled) => !enabled)}
                aria-pressed={isWordWrapEnabled}
                aria-label={isWordWrapEnabled ? "Disable word wrap" : "Enable word wrap"}
                title={`${isWordWrapEnabled ? "Disable" : "Enable"} word wrap (Ctrl/Cmd+Shift+W)`}
              >
                <WrapText size={16} />
              </button>
              <div className="save-menu-wrap">
                <button className={destinationRoot ? "secondary-button save-main-button" : "secondary-button save-main-button solo"} type="button" onClick={handleSave} disabled={!isDirty || isLoading} title="Save (Ctrl/Cmd+S)">
                  <Save size={16} />
                  Save
                </button>
                {destinationRoot ? (
                  <button
                    className={isSaveMenuOpen ? "secondary-button save-menu-button active" : "secondary-button save-menu-button"}
                    type="button"
                    onClick={() => setIsSaveMenuOpen((open) => !open)}
                    disabled={isLoading}
                    aria-expanded={isSaveMenuOpen}
                    aria-label="Show save options"
                    title="Show save options"
                  >
                    <ChevronDown size={15} />
                  </button>
                ) : null}
                {isSaveMenuOpen ? (
                  <div className="save-menu" role="menu">
                    <button className="save-menu-item" type="button" role="menuitem" onClick={handleSaveAndCopy}>
                      <Copy size={15} />
                      <span>{saveSyncLabel}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="breadcrumb">
          {selectedSkill ? (
            <>
              <span className="breadcrumb-path">
                {`${providerLabels[selectedSkill.provider]} / ${selectedSkill.name}${selectedSkill.kind === "skill" ? " / SKILL.md" : ""}`}
              </span>
              <button
                className="breadcrumb-copy-button"
                type="button"
                onClick={handleCopySelectedPath}
                aria-label="Copy absolute file path"
                title="Copy absolute file path"
              >
                <Copy size={14} />
              </button>
            </>
          ) : (
            "No document selected"
          )}
        </div>

        <div className="editor-surface">
          {documentState ? (
            <MarkdownEditor value={draftContent} theme={effectiveTheme} wordWrap={isWordWrapEnabled} onChange={setDraftContent} />
          ) : (
            <div className="empty-state">Select a document to inspect its Markdown file.</div>
          )}
        </div>

        <div className="status-bar" aria-live="polite">
          <span className="status-message">{message}</span>
          {error ? <strong>{error}</strong> : null}
          <span className="status-state">{isDirty ? "Modified" : "Saved"}</span>
          <span className="status-kind">Markdown</span>
        </div>
      </section>

      {isInspectorOpen ? (
      <aside className="inspector-panel">
        <PaneResizeHandle side="left" label="Resize inspector" onPointerDown={(event) => startPaneResize("inspector", event)} />
        <div className="inspector-tabs">
          <InspectorTabButton activeTab={activeInspectorTab} tab="preview" onSelect={setActiveInspectorTab}>
            Preview
          </InspectorTabButton>
          <InspectorTabButton activeTab={activeInspectorTab} tab="validation" onSelect={setActiveInspectorTab}>
            Validation ({currentIssues.length})
          </InspectorTabButton>
          <InspectorTabButton activeTab={activeInspectorTab} tab="backups" onSelect={setActiveInspectorTab}>
            Backups
          </InspectorTabButton>
        </div>

        {activeInspectorTab === "preview" ? (
          <div className="inspector-content">
            <div className="skill-meta">
              <div>
                <h2>{documentState?.name ?? selectedSkill?.name ?? "No document"}</h2>
                <p>{documentState?.description ?? selectedSkill?.description ?? "No description yet."}</p>
              </div>
              {selectedSkill ? <StatusBadge status={selectedSkill.status} /> : null}
            </div>

            <div className="meta-grid">
              <span>Provider</span>
              <strong>{selectedSkill ? providerLabels[selectedSkill.provider] : "-"}</strong>
              <span>Type</span>
              <strong>{selectedSkill ? (selectedSkill.kind === "agentDoc" ? "Agent doc" : "Skill") : "-"}</strong>
              <span>Root</span>
              <strong>{selectedSkill ? rootById.get(selectedSkill.rootId)?.label ?? "-" : "-"}</strong>
              <span>Link</span>
              <strong>{selectedSkill ? selectedSkill.linkState : "-"}</strong>
            </div>

            <div className="preview-frame">
              <MarkdownPreview content={draftContent} />
            </div>
          </div>
        ) : null}

        {activeInspectorTab === "validation" ? (
          <div className="inspector-content padded">
            <div className="validation-list">
              <div className="validation-heading">
                <span>Validation</span>
                {currentIssues.length === 0 ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              </div>
              {currentIssues.length === 0 ? (
                <p className="muted">No validation issues.</p>
              ) : (
                currentIssues.map((issue) => <IssueRow key={`${issue.code}-${issue.location}`} issue={issue} />)
              )}
            </div>
          </div>
        ) : null}

        {activeInspectorTab === "backups" ? (
          <div className="inspector-content padded">
            <div className="backup-panel">
              <div className="validation-heading">
                <span>Backups</span>
                <HardDrive size={16} />
              </div>
              <p className="muted">Saves create a backup before changing Markdown files.</p>
              {destinationRoot ? (
                <button className="wide-button" type="button" onClick={handleCopy} disabled={!selectedSkill}>
                  <Copy size={16} />
                  Copy to {providerLabels[destinationRoot.provider]}
                </button>
              ) : (
                <p className="muted">Agent docs are edited in place and are not synced as skill folders.</p>
              )}
            </div>
          </div>
        ) : null}
      </aside>
      ) : null}
      {isInspectorOpen ? (
        <button className="inspector-backdrop" type="button" aria-label="Close inspector" onClick={() => setIsInspectorOpen(false)} />
      ) : null}
      {toast ? <Toast key={toast.id} toast={toast} /> : null}
    </main>
  );
}

function Toast({ toast }: { toast: ToastState }) {
  return (
    <div className={`toast ${toast.tone}`} role="status" aria-live="polite">
      {toast.tone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      <span>{toast.message}</span>
    </div>
  );
}

function InspectorTabButton({
  activeTab,
  children,
  onSelect,
  tab,
}: {
  activeTab: InspectorTab;
  children: ReactNode;
  onSelect: (tab: InspectorTab) => void;
  tab: InspectorTab;
}) {
  return (
    <button
      className={activeTab === tab ? "inspector-tab active" : "inspector-tab"}
      type="button"
      role="tab"
      aria-selected={activeTab === tab}
      onClick={() => onSelect(tab)}
    >
      {children}
    </button>
  );
}

function railSectionTitle(section: RailSection) {
  if (section === "safety") {
    return "Safety";
  }
  if (section === "settings") {
    return "Settings";
  }
  return "Library";
}

function RailButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={active ? "rail-button active" : "rail-button"}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function RootRow({ root, duplicateRoot }: { root: SkillRoot; duplicateRoot?: SkillRoot | null }) {
  return (
    <div className={duplicateRoot ? "root-row duplicate" : "root-row"} title={root.path}>
      <Circle size={8} fill="currentColor" />
      <Folder size={16} />
      <div>
        <strong>{root.label}</strong>
        <span>{duplicateRoot ? `Same as ${duplicateRoot.label}` : providerLabels[root.provider]}</span>
      </div>
    </div>
  );
}

function InfoCard({ body, title }: { body: string; title: string }) {
  return (
    <div className="detail-card">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function PaneResizeHandle({
  label,
  onPointerDown,
  side,
}: {
  label: string;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  side: "left" | "right";
}) {
  return (
    <div
      className={`pane-resize-handle ${side}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={onPointerDown}
    />
  );
}

function SkillGroup({
  collapsed,
  label,
  onToggle,
  provider,
  skills,
  selectedSkillId,
  onSelect,
}: {
  collapsed: boolean;
  label: string;
  onToggle: (provider: SkillProvider) => void;
  provider: SkillProvider;
  skills: ScanResult["skills"];
  selectedSkillId: string | null;
  onSelect: (skillId: string) => void;
}) {
  if (skills.length === 0) {
    return null;
  }

  return (
    <div className="skill-group">
      <button className="skill-group-heading" type="button" onClick={() => onToggle(provider)} aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        <span>{label}</span>
        <strong>{skills.length}</strong>
      </button>
      {collapsed ? null : skills.map((skill) => (
        <button
          key={skill.id}
          className={skill.id === selectedSkillId ? "skill-row selected" : "skill-row"}
          type="button"
          onClick={() => onSelect(skill.id)}
          title={skill.mainFilePath}
        >
          <Circle size={8} fill="currentColor" />
          <FileText size={17} />
          <span>
            <strong>{skill.name}</strong>
            <small>{skill.kind === "agentDoc" ? "Agent doc" : "SKILL.md"}</small>
          </span>
          <SkillStatusIcon status={skill.status} />
        </button>
      ))}
    </div>
  );
}

function SkillStatusIcon({ status }: { status: SkillStatus }) {
  if (status === "valid") {
    return null;
  }

  if (status === "broken") {
    return <AlertTriangle className="status-icon broken" size={16} />;
  }

  return <AlertTriangle className="status-icon warning" size={16} />;
}

function StatusBadge({ status }: { status: SkillStatus }) {
  return (
    <span className={`status-badge ${status}`}>
      {status === "valid" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {status}
    </span>
  );
}

function IssueRow({ issue }: { issue: SkillIssue }) {
  return (
    <div className={`issue-row ${issue.severity}`}>
      <AlertTriangle size={15} />
      <div>
        <strong>{issue.message}</strong>
        <span>{issue.location ?? issue.code}</span>
      </div>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function compactPath(path: string) {
  const parts = path.split("/");
  return parts.length <= 3 ? path : `.../${parts.slice(-3).join("/")}`;
}

export default App;
