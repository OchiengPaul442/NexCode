import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * ESLint configuration for NexCode.
 *
 * NC-030: Adds real ESLint linting beyond TypeScript compilation.
 * Type-aware rules prioritized per audit requirements:
 * - no-floating-promises (error)
 * - no-misused-promises (error)
 * - switch-exhaustiveness-check (error)
 * - consistent-type-imports (warn, auto-fixable)
 * - no-unsafe-* family (warn)
 * - prefer-optional-chain, prefer-nullish-coalescing (warn)
 */

// Shared type-aware rule overrides for production source
const typeAwareProductionRules = {
  // Audit-required: enforce no floating promises
  "@typescript-eslint/no-floating-promises": "error",

  // Audit-required: enforce proper promise handling
  "@typescript-eslint/no-misused-promises": [
    "error",
    { checksVoidReturn: { attributes: false } },
  ],

  // Audit-required: enforce exhaustive switches
  "@typescript-eslint/switch-exhaustiveness-check": [
    "error",
    { allowDefaultCaseForExhaustiveSwitch: true },
  ],

  // Audit-required: consistent type imports (auto-fixable)
  "@typescript-eslint/consistent-type-imports": [
    "warn",
    { prefer: "type-imports", fixStyle: "inline-type-imports" },
  ],

  // Type safety: warn on unsafe any usage
  "@typescript-eslint/no-unsafe-argument": "warn",
  "@typescript-eslint/no-unsafe-assignment": "warn",
  "@typescript-eslint/no-unsafe-member-access": "warn",
  "@typescript-eslint/no-unsafe-return": "warn",
  "@typescript-eslint/no-unsafe-call": "warn",

  // Disable no-explicit-any: too strict for existing codebase with many `any` types
  "@typescript-eslint/no-explicit-any": "off",

  // Code quality: warn on style issues
  "@typescript-eslint/prefer-optional-chain": "warn",
  "@typescript-eslint/no-unnecessary-type-assertion": "warn",
  "@typescript-eslint/prefer-nullish-coalescing": "warn",

  // Allow underscore-prefixed unused variables and arguments
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
};

// Relaxed rules for test files (any usage common in mocks/fixtures)
const typeAwareTestRules = {
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": [
    "error",
    { checksVoidReturn: { attributes: false } },
  ],
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/consistent-type-imports": [
    "warn",
    { prefer: "type-imports", fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
};

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/extension/media/**",
      "**/*.d.ts",
      "extension/src/test/**",
    ],
  },

  // Base recommended rules (non-type-aware)
  eslint.configs.recommended,
  tseslint.configs.recommended,

  // agent-core production source: type-aware
  {
    files: ["agent-core/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typeAwareProductionRules,
  },

  // extension production source: type-aware
  {
    files: ["extension/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typeAwareProductionRules,
  },

  // Test files: relaxed any rules
  {
    files: ["agent-core/tests/**/*.ts", "extension/**/*.test.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typeAwareTestRules,
  },

  // Webview TypeScript/React: type-aware
  {
    files: ["extension/webview/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typeAwareProductionRules,
  },

  // Build scripts and tools: non-type-aware
  {
    files: ["tools/**/*.mjs", "tools/**/*.js"],
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  }
);
