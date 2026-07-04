// Input validation and normalization for snippet writes.
//
// The Rust desktop backend previously stored whatever it was handed, while the
// web API (app/api/snippets/route.ts) enforced length limits, a language
// whitelist, and tag/model normalization. That divergence let the desktop
// store rows the web app would reject (and vice-versa). This module mirrors the
// web rules so both runtimes persist identical, well-formed data.

use crate::db::{CreateSnippetInput, Snippet, UpdateSnippetInput};
use std::collections::HashSet;

const MAX_TITLE_LEN: usize = 255;
const MAX_MODEL_LEN: usize = 100;
const MAX_TAGS: usize = 20;
const TIMESTAMP_FMT: &str = "%Y-%m-%d %H:%M:%S";

/// Languages accepted by the app. Kept in sync with lib/languages.ts.
const VALID_LANGUAGES: &[&str] = &[
    "text", "markdown", "javascript", "typescript", "python", "java", "csharp",
    "cpp", "c", "go", "rust", "ruby", "php", "swift", "kotlin", "sql", "html",
    "css", "scss", "bash", "powershell", "yaml", "json", "xml", "toml",
    "dockerfile", "graphql", "lua", "r", "dart", "elixir", "haskell", "scala",
    "perl",
];

fn is_valid_language(lang: &str) -> bool {
    VALID_LANGUAGES.contains(&lang)
}

/// Truncate to at most `max` characters (Unicode scalar values), close enough
/// to JS `String.prototype.slice` for our limits and never splitting a char.
fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// trim → lowercase → drop empties → dedupe → cap at 20, matching the web route.
fn normalize_tags(tags: Option<Vec<String>>) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for t in tags.unwrap_or_default() {
        let cleaned = t.trim().to_lowercase();
        if cleaned.is_empty() {
            continue;
        }
        if seen.insert(cleaned.clone()) {
            out.push(cleaned);
            if out.len() >= MAX_TAGS {
                break;
            }
        }
    }
    out
}

fn normalize_model(model: Option<String>) -> String {
    model
        .map(|m| truncate_chars(m.trim(), MAX_MODEL_LEN))
        .unwrap_or_default()
}

/// Return `ts` if it parses as our stored timestamp format, else `fallback`.
fn valid_timestamp_or(ts: &str, fallback: &str) -> String {
    if chrono::NaiveDateTime::parse_from_str(ts, TIMESTAMP_FMT).is_ok() {
        ts.to_string()
    } else {
        fallback.to_string()
    }
}

/// Shared required-field / length / language checks. Mirrors the web POST which
/// rejects empty title or code and an unknown language, and caps the title.
fn validate_core(title: &str, code: &str, language: &str) -> Result<(), String> {
    if title.is_empty() || code.is_empty() {
        return Err("Title and code are required".to_string());
    }
    if title.chars().count() > MAX_TITLE_LEN {
        return Err("Title must be 255 characters or fewer".to_string());
    }
    if !is_valid_language(language) {
        return Err("Invalid language".to_string());
    }
    Ok(())
}

/// Validate and normalize a create payload, or return a user-facing error.
pub fn sanitize_create(mut input: CreateSnippetInput) -> Result<CreateSnippetInput, String> {
    validate_core(&input.title, &input.code, &input.language)?;
    input.tags = Some(normalize_tags(input.tags.take()));
    input.model = Some(normalize_model(input.model.take()));
    Ok(input)
}

/// Validate and normalize an update payload, or return a user-facing error.
pub fn sanitize_update(mut input: UpdateSnippetInput) -> Result<UpdateSnippetInput, String> {
    validate_core(&input.title, &input.code, &input.language)?;
    input.tags = Some(normalize_tags(input.tags.take()));
    input.model = Some(normalize_model(input.model.take()));
    Ok(input)
}

/// Validate and normalize a restore payload. Same field rules as create, plus
/// clamping a non-negative usage count (an out-of-range value could later
/// overflow to a REAL and break every read) and rejecting bogus timestamps that
/// would otherwise pin the row to the top of the sort forever.
pub fn sanitize_restore(mut s: Snippet) -> Result<Snippet, String> {
    validate_core(&s.title, &s.code, &s.language)?;
    s.tags = normalize_tags(Some(s.tags));
    s.model = truncate_chars(s.model.trim(), MAX_MODEL_LEN);
    s.copy_count = s.copy_count.clamp(0, i64::MAX - 1);

    let now = chrono::Utc::now().format(TIMESTAMP_FMT).to_string();
    s.created_at = valid_timestamp_or(&s.created_at, &now);
    s.updated_at = valid_timestamp_or(&s.updated_at, &now);
    s.last_used_at = s
        .last_used_at
        .filter(|ts| chrono::NaiveDateTime::parse_from_str(ts, TIMESTAMP_FMT).is_ok());
    Ok(s)
}
