import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "warn",
    pedantic: "warn",
  },
  rules: {
    "eslint/no-unused-vars": "error",
    "typescript/no-explicit-any": "warn",
    "typescript/no-non-null-assertion": "warn",

    // Disabled — these don't fit the codebase structure
    "eslint/max-classes-per-file": "off", // CRDTMap+CRDTList and schemas are co-located by design
    "eslint/max-lines-per-function": "off", // composables and WS handlers are naturally large
    "eslint/no-inline-comments": "off", // inline comments are fine
    "eslint/require-await": "off", // async methods needed for interface conformance
  },
  ignorePatterns: ["dist/", "node_modules/", "playground/", ".nuxt/"],
});
