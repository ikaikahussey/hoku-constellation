import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // HOKU Insider design system: colors come from app/globals.css tokens only.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["components/brand/Wordmark.tsx", "app/api/og/route.tsx", "app/manifest.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#(?:[0-9a-fA-F]{3}){1,2}\\b|\\brgba?\\(|\\bhsla?\\(/]",
          message: "Color literals belong in app/globals.css @theme tokens (use var(--color-*) or a token class).",
        },
        {
          selector: "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3}){1,2}\\b|\\brgba?\\(/]",
          message: "Color literals belong in app/globals.css @theme tokens.",
        },
        {
          selector: "Literal[value=/\\b(?:text|bg|border|fill|stroke)-(?:navy|gold|slate|zinc|red|amber|yellow|green|blue|indigo|purple|pink)(?:-\\d{2,3})?\\b/]",
          message: "Legacy palette utility; use ink/paper/link/muted/rule/gray-400/gray-300/gray-100.",
        },
      ],
    },
  },
]);

export default eslintConfig;
