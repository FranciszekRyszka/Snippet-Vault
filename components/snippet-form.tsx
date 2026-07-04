"use client";

import React from "react";

import { useState, useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";
import { LANGUAGES } from "@/lib/languages";
import { MODEL_SUGGESTIONS } from "@/lib/models";
import { getPromptStats, formatCount } from "@/lib/prompt-stats";
import type { Snippet } from "@/lib/tauri-api";

type SnippetFormProps = {
  snippet?: Snippet | null;
  onSave: (data: {
    title: string;
    description: string;
    code: string;
    language: string;
    tags: string[];
    model: string;
  }) => void;
  onCancel: () => void;
  saving: boolean;
  allTags?: string[];
};

export function SnippetForm({
  snippet,
  onSave,
  onCancel,
  saving,
  allTags = [],
}: SnippetFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("text");
  const [model, setModel] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const suggestionBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Existing tags that match what's being typed and aren't already added
  const suggestions = useMemo(() => {
    const query = tagInput.trim().toLowerCase();
    return allTags
      .filter((t) => !tags.includes(t))
      .filter((t) => (query ? t.includes(query) : true))
      .slice(0, 8);
  }, [allTags, tags, tagInput]);

  useEffect(() => {
    if (snippet) {
      setTitle(snippet.title);
      setDescription(snippet.description || "");
      setCode(snippet.code);
      setLanguage(snippet.language);
      setModel(snippet.model || "");
      setTags(snippet.tags || []);
    } else {
      setTitle("");
      setDescription("");
      setCode("");
      setLanguage("text");
      setModel("");
      setTags([]);
    }
    setTagInput("");
  }, [snippet]);

  const addTag = (value: string) => {
    const cleaned = value.trim().toLowerCase();
    if (cleaned && !tags.includes(cleaned) && tags.length < 20) {
      setTags([...tags, cleaned]);
    }
    setTagInput("");
    setShowSuggestions(false);
    setHighlightedIndex(0);
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const hasSuggestions = showSuggestions && suggestions.length > 0;

    if (e.key === "ArrowDown" && hasSuggestions) {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && hasSuggestions) {
      e.preventDefault();
      setHighlightedIndex(
        (i) => (i - 1 + suggestions.length) % suggestions.length
      );
    } else if (e.key === "Escape" && showSuggestions) {
      e.preventDefault();
      setShowSuggestions(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // If a suggestion is highlighted, pick it; otherwise use the raw input
      if (hasSuggestions) {
        addTag(suggestions[highlightedIndex]);
      } else {
        addTag(tagInput);
      }
    } else if (e.key === "," || e.key === "Tab") {
      if (hasSuggestions && e.key === "Tab") {
        e.preventDefault();
        addTag(suggestions[highlightedIndex]);
      } else if (tagInput.trim()) {
        e.preventDefault();
        addTag(tagInput);
      }
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Guard against a double-submit: the button's `disabled` only applies after
    // a re-render, so a fast second click/Enter could fire onSave twice.
    if (saving) return;
    if (!title.trim() || !code.trim()) return;
    // Add any remaining tag input, keeping the same dedupe + 20-tag cap the tag
    // editor enforces so a trailing entry can't slip past the limit.
    const finalTags = (
      tagInput.trim()
        ? [...tags, tagInput.trim().toLowerCase()].filter(
            (t, i, arr) => arr.indexOf(t) === i
          )
        : tags
    ).slice(0, 20);
    onSave({
      title: title.trim(),
      description: description.trim(),
      code,
      language,
      tags: finalTags,
      model: model.trim(),
    });
  };

  const isEditing = !!snippet;
  const stats = getPromptStats(code);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/20 backdrop-blur-sm pt-12 pb-12">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-lg mx-4">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {isEditing ? "Edit Prompt" : "New Prompt"}
          </h2>
          <button
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="snippet-title"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Title <span className="text-destructive">*</span>
            </label>
            <input
              id="snippet-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Blog post outline generator"
              maxLength={255}
              required
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="snippet-description"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Description
            </label>
            <input
              id="snippet-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of this prompt..."
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="snippet-language"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Language
            </label>
            <select
              id="snippet-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="snippet-model"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Model / target{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <input
              id="snippet-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="model-suggestions"
              maxLength={100}
              placeholder="e.g. Claude Opus 4.8, GPT-4o, Midjourney…"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <datalist id="model-suggestions">
              {MODEL_SUGGESTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div>
            <label
              htmlFor="snippet-tags"
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Tags{" "}
              <span className="font-normal text-muted-foreground">
                (press Enter or comma to add)
              </span>
            </label>
            <div className="relative">
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-primary/60 transition-colors hover:bg-primary/20 hover:text-primary"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  id="snippet-tags"
                  type="text"
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value);
                    setShowSuggestions(true);
                    setHighlightedIndex(0);
                  }}
                  onKeyDown={handleTagKeyDown}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => {
                    // Delay so a suggestion click registers before the list hides
                    suggestionBlurTimeout.current = setTimeout(() => {
                      setShowSuggestions(false);
                      if (tagInput.trim()) addTag(tagInput);
                    }, 120);
                  }}
                  role="combobox"
                  aria-expanded={showSuggestions && suggestions.length > 0}
                  aria-autocomplete="list"
                  autoComplete="off"
                  placeholder={
                    tags.length === 0 ? "e.g. react, hooks, cleanup" : ""
                  }
                  className="min-w-[120px] flex-1 border-none bg-transparent py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-52 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-lg">
                  {suggestions.map((suggestion, index) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        // onMouseDown fires before the input's onBlur, so the
                        // click is not swallowed by the blur handler
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (suggestionBlurTimeout.current) {
                            clearTimeout(suggestionBlurTimeout.current);
                          }
                          addTag(suggestion);
                        }}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        className={`flex w-full items-center px-3 py-1.5 text-left text-sm text-popover-foreground transition-colors ${
                          index === highlightedIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50"
                        }`}
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {tags.length >= 20 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Maximum of 20 tags reached.
              </p>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label
                htmlFor="snippet-code"
                className="block text-sm font-medium text-foreground"
              >
                Prompt <span className="text-destructive">*</span>
              </label>
              {code.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {formatCount(stats.chars)} characters · ~
                  {formatCount(stats.tokens)} tokens
                </span>
              )}
            </div>
            <textarea
              id="snippet-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Write or paste your prompt here..."
              required
              rows={12}
              className="w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border bg-transparent px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim() || !code.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving
                ? "Saving..."
                : isEditing
                  ? "Update Prompt"
                  : "Save Prompt"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
