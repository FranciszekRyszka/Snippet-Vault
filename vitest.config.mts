import { defineConfig } from "vitest/config";

// Scope vitest to the co-located unit tests under lib/. The HTTP integration
// suite (test/api.test.mjs) is a node:test file that needs a running server, so
// it's run separately via `node test/run-api-tests.mjs` — excluding test/ here
// keeps vitest from trying to execute it.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
  },
});
