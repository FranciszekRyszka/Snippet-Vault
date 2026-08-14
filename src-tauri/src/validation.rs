// Input validation and normalization for snippet writes.
//
// The Rust desktop backend previously stored whatever it was handed, while the
// web API (app/api/snippets/route.ts) enforced length limits, a language
// whitelist, and tag/model normalization. That divergence let the desktop
// store rows the web app would reject (and vice-versa). This module mirrors the
// web rules so both runtimes persist identical, well-formed data.

use crate::db::{CreateSnippetInput, Snippet, SyncRecord, UpdateSnippetInput};
use std::collections::HashSet;

const MAX_TITLE_LEN: usize = 255;
const MAX_MODEL_LEN: usize = 100;
const MAX_TAGS: usize = 20;
// Match the server's sync ingress caps (app/api/sync/route.ts) so both
// directions bound the same fields to the same sizes.
const MAX_CODE_LEN: usize = 500_000;
const MAX_DESC_LEN: usize = 100_000;
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

/// Coerce an entry kind to the allowed set. Anything that isn't exactly "code"
/// (missing, empty, unknown value from a newer/hostile peer) becomes "prompt" —
/// the safe default for a *prompt* vault. Never rejects.
fn normalize_kind(kind: Option<String>) -> String {
    match kind.as_deref().map(str::trim) {
        Some("code") => "code".to_string(),
        _ => "prompt".to_string(),
    }
}

/// The per-prompt color palette. Kept in sync with lib/prompt-colors.ts and the
/// web `sanitizeColor` allow-list (lib/api-utils.ts).
const VALID_COLORS: &[&str] = &[
    "red", "orange", "amber", "green", "teal", "blue", "violet", "pink",
];

/// Coerce a color to the allowed palette. Anything outside it (missing, empty,
/// unknown value from a newer/hostile peer) becomes "" — no color. Never rejects.
fn normalize_color(color: Option<String>) -> String {
    match color.as_deref().map(str::trim) {
        Some(c) if VALID_COLORS.contains(&c) => c.to_string(),
        _ => String::new(),
    }
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
    input.kind = Some(normalize_kind(input.kind.take()));
    input.color = Some(normalize_color(input.color.take()));
    Ok(input)
}

/// Validate and normalize an update payload, or return a user-facing error.
pub fn sanitize_update(mut input: UpdateSnippetInput) -> Result<UpdateSnippetInput, String> {
    validate_core(&input.title, &input.code, &input.language)?;
    input.tags = Some(normalize_tags(input.tags.take()));
    input.model = Some(normalize_model(input.model.take()));
    input.kind = Some(normalize_kind(input.kind.take()));
    input.color = Some(normalize_color(input.color.take()));
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
    s.kind = normalize_kind(Some(s.kind));
    s.color = normalize_color(Some(s.color));
    s.copy_count = s.copy_count.clamp(0, i64::MAX - 1);

    let now = chrono::Utc::now().format(TIMESTAMP_FMT).to_string();
    s.created_at = valid_timestamp_or(&s.created_at, &now);
    s.updated_at = valid_timestamp_or(&s.updated_at, &now);
    s.last_used_at = s
        .last_used_at
        .filter(|ts| chrono::NaiveDateTime::parse_from_str(ts, TIMESTAMP_FMT).is_ok());
    Ok(s)
}

/// Clamp an untrusted record received *from* the sync server before it's written
/// to the local database. Mirrors the server's own ingress normalization
/// (app/api/sync/route.ts `normalizeIncoming`) so a malicious or MITM'd server
/// can't poison local rows with over-long fields or — the important one — a
/// bogus `updated_at` that, under the string-compared newest-wins merge, would
/// win forever and could never be overwritten by a legitimate later edit.
///
/// Unlike create/update this never *rejects* a record (sync must tolerate peers
/// on newer app versions, e.g. unknown languages) — it only bounds values. An
/// invalid timestamp falls back to "now", which still loses to any genuinely
/// newer edit, so it degrades gracefully instead of pinning the row.
pub fn sanitize_sync_record(mut r: SyncRecord) -> SyncRecord {
    let now = chrono::Utc::now().format(TIMESTAMP_FMT).to_string();
    r.title = truncate_chars(&r.title, MAX_TITLE_LEN);
    r.description = truncate_chars(&r.description, MAX_DESC_LEN);
    r.code = truncate_chars(&r.code, MAX_CODE_LEN);
    r.model = truncate_chars(r.model.trim(), MAX_MODEL_LEN);
    r.kind = normalize_kind(Some(r.kind));
    r.color = normalize_color(Some(r.color));
    r.tags = normalize_tags(Some(r.tags));
    r.copy_count = r.copy_count.clamp(0, i64::MAX - 1);
    r.created_at = valid_timestamp_or(&r.created_at, &now);
    r.updated_at = valid_timestamp_or(&r.updated_at, &now);
    r.last_used_at = r
        .last_used_at
        .filter(|ts| chrono::NaiveDateTime::parse_from_str(ts, TIMESTAMP_FMT).is_ok());
    r
}
