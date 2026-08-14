// A small fixed palette for tagging a prompt with a color, purely for fast
// visual scanning of the grid/list. Stored as a lowercase name in the `color`
// column ("" = no color); the hex is resolved here for rendering. The allowed
// names are kept in sync with the validators in lib/api-utils.ts
// (`sanitizeColor`) and src-tauri/src/validation.rs (`normalize_color`).

export type PromptColor =
  | ""
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "blue"
  | "violet"
  | "pink";

// The palette, in picker order. Hex values are the Tailwind 500 shades, chosen
// to read on both the light and dark card backgrounds. Used as inline styles so
// there's no dynamic-Tailwind-class purge concern.
export const PROMPT_COLORS: {
  value: Exclude<PromptColor, "">;
  label: string;
  hex: string;
}[] = [
  { value: "red", label: "Red", hex: "#ef4444" },
  { value: "orange", label: "Orange", hex: "#f97316" },
  { value: "amber", label: "Amber", hex: "#f59e0b" },
  { value: "green", label: "Green", hex: "#22c55e" },
  { value: "teal", label: "Teal", hex: "#14b8a6" },
  { value: "blue", label: "Blue", hex: "#3b82f6" },
  { value: "violet", label: "Violet", hex: "#8b5cf6" },
  { value: "pink", label: "Pink", hex: "#ec4899" },
];

const HEX_BY_VALUE = new Map(PROMPT_COLORS.map((c) => [c.value, c.hex]));

// The hex for a stored color name, or null for "" / an unknown value (so the
// caller renders no accent).
export function colorHex(color: string | null | undefined): string | null {
  if (!color) return null;
  return HEX_BY_VALUE.get(color as Exclude<PromptColor, "">) ?? null;
}

// The human label for a stored color name (for tooltips / aria), or "None".
export function colorLabel(color: string | null | undefined): string {
  if (!color) return "None";
  return PROMPT_COLORS.find((c) => c.value === color)?.label ?? "None";
}
