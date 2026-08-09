"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getLanguageLabel } from "@/lib/languages";
import { Braces, Code2, FileText } from "lucide-react";
import type { Snippet } from "@/lib/tauri-api";
import { extractVars } from "@/lib/prompt-vars";

// Cmd/Ctrl-K quick launcher: fuzzy-search the whole library by title, tag,
// language, or model and copy an entry without opening the full detail view.
// Selecting a prompt with {{variables}} hands off to the fill dialog (via the
// dashboard) instead of copying the raw body.
export function CommandPalette({
  open,
  onOpenChange,
  snippets,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snippets: Snippet[];
  // Copy this entry (dashboard decides raw-copy vs. fill-variables dialog).
  onCopy: (snippet: Snippet) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search prompts to copy…" />
      <CommandList>
        <CommandEmpty>No matching prompts.</CommandEmpty>
        <CommandGroup heading="Prompts & snippets">
          {snippets.map((snippet) => {
            const isCode = snippet.kind === "code";
            const hasVars = !isCode && extractVars(snippet.code).length > 0;
            const tags = snippet.tags ?? [];
            return (
              <CommandItem
                key={snippet.id}
                // The id keeps the value unique (cmdk dedupes by value, and two
                // prompts can share a title); tags/model/language ride along as
                // keywords so fuzzy matching finds a prompt by more than title.
                value={`${snippet.title} ${snippet.id}`}
                keywords={[...tags, snippet.language, snippet.model, snippet.kind]}
                onSelect={() => {
                  onOpenChange(false);
                  onCopy(snippet);
                }}
              >
                {isCode ? <Code2 /> : <FileText />}
                <span className="min-w-0 flex-1 truncate">{snippet.title}</span>
                {hasVars && (
                  <Braces className="ml-1 shrink-0 text-muted-foreground" />
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {getLanguageLabel(snippet.language)}
                </span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
