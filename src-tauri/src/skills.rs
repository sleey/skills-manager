use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillProvider {
    Codex,
    Claude,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RootSource {
    Auto,
    Custom,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRoot {
    pub id: String,
    pub provider: SkillProvider,
    pub label: String,
    pub path: String,
    pub resolved_path: Option<String>,
    pub source: RootSource,
    pub enabled: bool,
    pub duplicate_of_root_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueSeverity {
    Warning,
    Error,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillIssue {
    pub severity: IssueSeverity,
    pub code: String,
    pub message: String,
    pub location: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillStatus {
    Valid,
    Warning,
    Broken,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkState {
    Normal,
    Symlink,
    Junction,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillKind {
    Skill,
    AgentDoc,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub kind: SkillKind,
    pub id: String,
    pub provider: SkillProvider,
    pub root_id: String,
    pub name: String,
    pub description: Option<String>,
    pub path: String,
    pub main_file_path: String,
    pub status: SkillStatus,
    pub link_state: LinkState,
    pub issues: Vec<SkillIssue>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub roots: Vec<SkillRoot>,
    pub skills: Vec<SkillSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDocument {
    pub path: String,
    pub content: String,
    pub name: String,
    pub description: Option<String>,
    pub issues: Vec<SkillIssue>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub path: String,
    pub backup_path: String,
    pub document: SkillDocument,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub source_path: String,
    pub destination_path: String,
    pub files_copied: usize,
}

pub fn parse_skill_content(
    content: &str,
    fallback_name: &str,
) -> (String, Option<String>, Vec<SkillIssue>) {
    let mut issues = Vec::new();
    let mut name = fallback_name.to_string();
    let mut description = None;

    let Some(frontmatter) = extract_frontmatter(content) else {
        issues.push(warning(
            "missing-frontmatter",
            "SKILL.md should start with YAML frontmatter.",
            Some("metadata"),
        ));
        issues.push(warning(
            "missing-description",
            "Skill description is missing from frontmatter.",
            Some("metadata.description"),
        ));
        return (name, description, issues);
    };

    match serde_yaml::from_str::<serde_yaml::Value>(&frontmatter) {
        Ok(value) => {
            if let Some(parsed_name) = yaml_string(&value, "name") {
                name = parsed_name;
            } else {
                issues.push(warning(
                    "missing-name",
                    "Skill name is missing from frontmatter.",
                    Some("metadata.name"),
                ));
            }

            if let Some(parsed_description) = yaml_string(&value, "description") {
                description = Some(parsed_description);
            } else {
                issues.push(warning(
                    "missing-description",
                    "Skill description is missing from frontmatter.",
                    Some("metadata.description"),
                ));
            }
        }
        Err(error) => issues.push(SkillIssue {
            severity: IssueSeverity::Error,
            code: "invalid-frontmatter".to_string(),
            message: format!("Skill frontmatter could not be parsed: {error}"),
            location: Some("metadata".to_string()),
        }),
    }

    (name, description, issues)
}

pub fn mark_duplicate_roots(roots: Vec<SkillRoot>) -> Vec<SkillRoot> {
    let mut seen: HashMap<String, String> = HashMap::new();

    roots
        .into_iter()
        .map(|mut root| {
            let key = root
                .resolved_path
                .clone()
                .unwrap_or_else(|| root.path.clone());

            if let Some(first_id) = seen.get(&key) {
                root.duplicate_of_root_id = Some(first_id.clone());
            } else {
                seen.insert(key, root.id.clone());
            }

            root
        })
        .collect()
}

pub fn scan_existing_roots(roots: &[SkillRoot]) -> Result<Vec<SkillSummary>, String> {
    let mut skills = Vec::new();

    for root in roots
        .iter()
        .filter(|root| root.enabled && root.duplicate_of_root_id.is_none())
    {
        let root_path = Path::new(&root.path);
        if !root_path.is_dir() {
            continue;
        }

        for entry in fs::read_dir(root_path)
            .map_err(|error| format!("Failed to read root {}: {error}", root.path))?
        {
            let entry = entry
                .map_err(|error| format!("Failed to read skill entry in {}: {error}", root.path))?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let fallback_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown-skill")
                .to_string();
            if fallback_name == ".system" {
                continue;
            }

            let main_file_path = path.join("SKILL.md");
            let mut issues = Vec::new();
            let mut name = fallback_name.clone();
            let mut description = None;

            if main_file_path.exists() {
                let content = fs::read_to_string(&main_file_path).map_err(|error| {
                    format!("Failed to read {}: {error}", main_file_path.display())
                })?;
                let parsed = parse_skill_content(&content, &fallback_name);
                name = parsed.0;
                description = parsed.1;
                issues = parsed.2;
            } else {
                issues.push(SkillIssue {
                    severity: IssueSeverity::Error,
                    code: "missing-skill-md".to_string(),
                    message: "Skill folder is missing SKILL.md.".to_string(),
                    location: Some("SKILL.md".to_string()),
                });
            }

            let link_state = link_state_for_path(&path);
            skills.push(SkillSummary {
                kind: SkillKind::Skill,
                id: format!("{}:{}:{}", provider_key(&root.provider), root.id, name),
                provider: root.provider.clone(),
                root_id: root.id.clone(),
                name,
                description,
                path: path.to_string_lossy().to_string(),
                main_file_path: main_file_path.to_string_lossy().to_string(),
                status: status_for_issues(&issues),
                link_state,
                issues,
            });
        }
    }

    skills.sort_by(|a, b| {
        provider_key(&a.provider)
            .cmp(provider_key(&b.provider))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(skills)
}

pub fn scan_agent_docs(roots: &[SkillRoot]) -> Result<Vec<SkillSummary>, String> {
    let mut docs = Vec::new();
    let mut seen_paths = HashSet::new();

    for root in roots.iter().filter(|root| root.enabled) {
        let Some(file_name) = agent_doc_file_name(&root.provider) else {
            continue;
        };
        let Some(parent_dir) = Path::new(&root.path).parent() else {
            continue;
        };
        let doc_path = parent_dir.join(file_name);
        if !doc_path.is_file() {
            continue;
        }

        let path_key = doc_path
            .canonicalize()
            .unwrap_or_else(|_| doc_path.clone())
            .to_string_lossy()
            .to_string();
        if !seen_paths.insert(path_key) {
            continue;
        }

        docs.push(SkillSummary {
            kind: SkillKind::AgentDoc,
            id: format!(
                "{}:{}:{}",
                provider_key(&root.provider),
                root.id,
                file_name.to_lowercase()
            ),
            provider: root.provider.clone(),
            root_id: root.id.clone(),
            name: file_name.to_string(),
            description: Some(agent_doc_description(&root.provider).to_string()),
            path: parent_dir.to_string_lossy().to_string(),
            main_file_path: doc_path.to_string_lossy().to_string(),
            status: SkillStatus::Valid,
            link_state: link_state_for_path(&doc_path),
            issues: Vec::new(),
        });
    }

    docs.sort_by(|a, b| {
        provider_key(&a.provider)
            .cmp(provider_key(&b.provider))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(docs)
}

pub fn read_skill_file(path: &Path) -> Result<SkillDocument, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.md");
    if file_name == "AGENTS.md" || file_name == "CLAUDE.md" {
        return Ok(SkillDocument {
            path: path.to_string_lossy().to_string(),
            content,
            name: file_name.to_string(),
            description: Some("Agent instructions".to_string()),
            issues: Vec::new(),
        });
    }

    let fallback_name = path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("unknown-skill");
    let (name, description, issues) = parse_skill_content(&content, fallback_name);

    Ok(SkillDocument {
        path: path.to_string_lossy().to_string(),
        content,
        name,
        description,
        issues,
    })
}

pub fn save_skill_file(
    path: &Path,
    expected_content: &str,
    new_content: &str,
    backup_root: &Path,
) -> Result<SaveResult, String> {
    let current_content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {} before save: {error}", path.display()))?;
    if current_content != expected_content {
        return Err(format!(
            "{} changed on disk. Reload before saving.",
            path.display()
        ));
    }

    fs::create_dir_all(backup_root).map_err(|error| {
        format!(
            "Failed to create backup directory {}: {error}",
            backup_root.display()
        )
    })?;

    let backup_path = backup_root.join(backup_file_name(path));
    fs::write(&backup_path, current_content)
        .map_err(|error| format!("Failed to write backup {}: {error}", backup_path.display()))?;

    fs::write(path, new_content)
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;
    let document = read_skill_file(path)?;

    Ok(SaveResult {
        path: path.to_string_lossy().to_string(),
        backup_path: backup_path.to_string_lossy().to_string(),
        document,
    })
}

pub fn copy_skill_dir(
    source_path: &Path,
    destination_root: &Path,
    overwrite: bool,
) -> Result<CopyResult, String> {
    if !source_path.is_dir() {
        return Err(format!(
            "Source skill directory does not exist: {}",
            source_path.display()
        ));
    }

    let skill_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            format!(
                "Source skill path has no folder name: {}",
                source_path.display()
            )
        })?;
    let destination_path = destination_root.join(skill_name);

    if destination_path.exists() {
        if !overwrite {
            return Err(format!(
                "Destination already exists: {}",
                destination_path.display()
            ));
        }
        fs::remove_dir_all(&destination_path).map_err(|error| {
            format!(
                "Failed to remove existing {}: {error}",
                destination_path.display()
            )
        })?;
    }

    fs::create_dir_all(&destination_path).map_err(|error| {
        format!(
            "Failed to create destination {}: {error}",
            destination_path.display()
        )
    })?;

    let mut files_copied = 0;
    for entry in WalkDir::new(source_path) {
        let entry =
            entry.map_err(|error| format!("Failed to walk {}: {error}", source_path.display()))?;
        let relative_path = entry
            .path()
            .strip_prefix(source_path)
            .map_err(|error| format!("Failed to calculate copy path: {error}"))?;
        let target = destination_path.join(relative_path);

        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|error| {
                format!("Failed to create directory {}: {error}", target.display())
            })?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Failed to create directory {}: {error}", parent.display())
                })?;
            }
            fs::copy(entry.path(), &target).map_err(|error| {
                format!(
                    "Failed to copy {} to {}: {error}",
                    entry.path().display(),
                    target.display()
                )
            })?;
            files_copied += 1;
        }
    }

    Ok(CopyResult {
        source_path: source_path.to_string_lossy().to_string(),
        destination_path: destination_path.to_string_lossy().to_string(),
        files_copied,
    })
}

pub fn suggested_roots() -> Vec<SkillRoot> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };

    vec![
        suggested_root(
            "codex-codex",
            SkillProvider::Codex,
            "~/.codex/skills",
            home.join(".codex/skills"),
        ),
        suggested_root(
            "codex-agent",
            SkillProvider::Codex,
            "~/.agent/skills",
            home.join(".agent/skills"),
        ),
        suggested_root(
            "codex-agents-legacy",
            SkillProvider::Codex,
            "~/.agents/skills",
            home.join(".agents/skills"),
        ),
        suggested_root(
            "claude-user",
            SkillProvider::Claude,
            "~/.claude/skills",
            home.join(".claude/skills"),
        ),
    ]
}

fn suggested_root(id: &str, provider: SkillProvider, label: &str, path: PathBuf) -> SkillRoot {
    SkillRoot {
        id: id.to_string(),
        provider,
        label: label.to_string(),
        resolved_path: path
            .canonicalize()
            .ok()
            .map(|path| path.to_string_lossy().to_string()),
        path: path.to_string_lossy().to_string(),
        source: RootSource::Auto,
        enabled: true,
        duplicate_of_root_id: None,
    }
}

fn extract_frontmatter(content: &str) -> Option<String> {
    let normalized = content.replace("\r\n", "\n");
    let mut lines = normalized.lines();
    if lines.next()? != "---" {
        return None;
    }

    let mut frontmatter = Vec::new();
    for line in lines {
        if line == "---" {
            return Some(frontmatter.join("\n"));
        }
        frontmatter.push(line);
    }

    None
}

fn yaml_string(value: &serde_yaml::Value, key: &str) -> Option<String> {
    value
        .as_mapping()?
        .get(serde_yaml::Value::String(key.to_string()))?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn warning(code: &str, message: &str, location: Option<&str>) -> SkillIssue {
    SkillIssue {
        severity: IssueSeverity::Warning,
        code: code.to_string(),
        message: message.to_string(),
        location: location.map(ToOwned::to_owned),
    }
}

fn status_for_issues(issues: &[SkillIssue]) -> SkillStatus {
    if issues
        .iter()
        .any(|issue| issue.severity == IssueSeverity::Error)
    {
        SkillStatus::Broken
    } else if issues
        .iter()
        .any(|issue| issue.severity == IssueSeverity::Warning)
    {
        SkillStatus::Warning
    } else {
        SkillStatus::Valid
    }
}

fn provider_key(provider: &SkillProvider) -> &'static str {
    match provider {
        SkillProvider::Codex => "codex",
        SkillProvider::Claude => "claude",
    }
}

fn agent_doc_file_name(provider: &SkillProvider) -> Option<&'static str> {
    match provider {
        SkillProvider::Codex => Some("AGENTS.md"),
        SkillProvider::Claude => Some("CLAUDE.md"),
    }
}

fn agent_doc_description(provider: &SkillProvider) -> &'static str {
    match provider {
        SkillProvider::Codex => "Global Codex instructions",
        SkillProvider::Claude => "Global Claude instructions",
    }
}

fn kind_order(kind: &SkillKind) -> u8 {
    match kind {
        SkillKind::AgentDoc => 0,
        SkillKind::Skill => 1,
    }
}

fn link_state_for_path(path: &Path) -> LinkState {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => LinkState::Symlink,
        Ok(_) => LinkState::Normal,
        Err(_) => LinkState::Unknown,
    }
}

fn backup_file_name(path: &Path) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let parent = path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("skill");
    let file = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("SKILL.md");
    format!(
        "{}-{}-{}.bak",
        sanitize_filename(parent),
        sanitize_filename(file),
        timestamp
    )
}

fn sanitize_filename(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => character,
            _ => '-',
        })
        .collect()
}

#[tauri::command]
pub fn scan_skills() -> Result<ScanResult, String> {
    let roots = mark_duplicate_roots(suggested_roots());
    let mut skills = scan_existing_roots(&roots)?;
    skills.extend(scan_agent_docs(&roots)?);
    skills.sort_by(|a, b| {
        provider_key(&a.provider)
            .cmp(provider_key(&b.provider))
            .then_with(|| kind_order(&a.kind).cmp(&kind_order(&b.kind)))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(ScanResult { roots, skills })
}

#[tauri::command]
pub fn read_skill(path: String) -> Result<SkillDocument, String> {
    read_skill_file(Path::new(&path))
}

#[tauri::command]
pub fn save_skill(
    path: String,
    expected_content: String,
    new_content: String,
) -> Result<SaveResult, String> {
    let backup_root = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("agent-skills-manager")
        .join("backups");
    save_skill_file(
        Path::new(&path),
        &expected_content,
        &new_content,
        &backup_root,
    )
}

#[tauri::command]
pub fn copy_skill(
    source_path: String,
    destination_root: String,
    overwrite: bool,
) -> Result<CopyResult, String> {
    copy_skill_dir(
        Path::new(&source_path),
        Path::new(&destination_root),
        overwrite,
    )
}

#[tauri::command]
pub fn copy_text(text: String) -> Result<(), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|error| format!("Failed to open clipboard: {error}"))?;
    clipboard
        .set_text(text)
        .map_err(|error| format!("Failed to write clipboard: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn root(id: &str, path: &Path) -> SkillRoot {
        SkillRoot {
            id: id.to_string(),
            provider: SkillProvider::Codex,
            label: id.to_string(),
            path: path.to_string_lossy().to_string(),
            resolved_path: Some(path.to_string_lossy().to_string()),
            source: RootSource::Auto,
            enabled: true,
            duplicate_of_root_id: None,
        }
    }

    #[test]
    fn parse_skill_content_extracts_name_and_description_from_frontmatter() {
        let content =
            "---\nname: api-design\ndescription: Design robust APIs.\n---\n\n## Purpose\nBody";

        let (name, description, issues) = parse_skill_content(content, "fallback");

        assert_eq!(name, "api-design");
        assert_eq!(description.as_deref(), Some("Design robust APIs."));
        assert!(issues.is_empty(), "valid frontmatter should not warn");
    }

    #[test]
    fn mark_duplicate_roots_keeps_first_resolved_path_active() {
        let temp = tempdir().unwrap();
        let shared = temp.path().join("skills");
        fs::create_dir(&shared).unwrap();

        let roots = mark_duplicate_roots(vec![
            root("codex-link", &shared),
            root("agent-root", &shared),
        ]);

        assert_eq!(roots[0].duplicate_of_root_id, None);
        assert_eq!(roots[1].duplicate_of_root_id.as_deref(), Some("codex-link"));
    }

    #[test]
    fn scan_existing_roots_finds_skill_and_reports_missing_description() {
        let temp = tempdir().unwrap();
        let skill_dir = temp.path().join("code-review");
        fs::create_dir(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: code-review\n---\n\nReview code.",
        )
        .unwrap();

        let skills = scan_existing_roots(&[root("codex", temp.path())]).unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "code-review");
        assert_eq!(skills[0].status, SkillStatus::Warning);
        assert!(skills[0]
            .issues
            .iter()
            .any(|issue| issue.code == "missing-description"));
    }

    #[test]
    fn scan_existing_roots_ignores_system_skill_directory() {
        let temp = tempdir().unwrap();
        let system_dir = temp.path().join(".system");
        let skill_dir = temp.path().join("code-review");
        fs::create_dir(&system_dir).unwrap();
        fs::create_dir(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: code-review\ndescription: Review code.\n---\n\nReview code.",
        )
        .unwrap();

        let skills = scan_existing_roots(&[root("codex", temp.path())]).unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "code-review");
        assert!(skills.iter().all(|skill| skill.name != ".system"));
    }

    #[test]
    fn scan_agent_docs_finds_provider_instruction_file_next_to_skills_root() {
        let temp = tempdir().unwrap();
        let skills_dir = temp.path().join("skills");
        fs::create_dir(&skills_dir).unwrap();
        fs::write(temp.path().join("AGENTS.md"), "# Shared Codex instructions").unwrap();

        let docs = scan_agent_docs(&[root("codex", &skills_dir)]).unwrap();

        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].kind, SkillKind::AgentDoc);
        assert_eq!(docs[0].name, "AGENTS.md");
        assert_eq!(
            docs[0].main_file_path,
            temp.path().join("AGENTS.md").to_string_lossy().to_string()
        );
        assert!(docs[0].issues.is_empty());
    }

    #[test]
    fn save_skill_file_creates_backup_and_refuses_stale_content() {
        let temp = tempdir().unwrap();
        let skill_path = temp.path().join("SKILL.md");
        let backup_root = temp.path().join("backups");
        fs::write(&skill_path, "---\nname: demo\n---\nold").unwrap();

        let result = save_skill_file(
            &skill_path,
            "---\nname: demo\n---\nold",
            "---\nname: demo\n---\nnew",
            &backup_root,
        )
        .unwrap();

        assert!(PathBuf::from(&result.backup_path).exists());
        assert_eq!(
            fs::read_to_string(&skill_path).unwrap(),
            "---\nname: demo\n---\nnew"
        );

        let stale = save_skill_file(&skill_path, "old", "newer", &backup_root).unwrap_err();
        assert!(stale.contains("changed on disk"));
    }

    #[test]
    fn copy_skill_dir_refuses_existing_destination_without_overwrite() {
        let temp = tempdir().unwrap();
        let source = temp.path().join("source").join("demo");
        let destination_root = temp.path().join("dest");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(destination_root.join("demo")).unwrap();
        fs::write(source.join("SKILL.md"), "---\nname: demo\n---\nbody").unwrap();

        let err = copy_skill_dir(&source, &destination_root, false).unwrap_err();

        assert!(err.contains("already exists"));
    }
}
