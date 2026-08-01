import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.angular/**",
      "**/storybook-static/**",
      "**/*.tsbuildinfo",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { sonarjs },
    rules: {
      "prefer-destructuring": "error",
      "prefer-object-spread": "error",
      "prefer-spread": "error",
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          enforceConst: true,
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
        },
      ],
      "sonarjs/no-duplicate-string": "error",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/*.stories.tsx"],
    rules: {
      "@typescript-eslint/no-magic-numbers": "off",
      "sonarjs/no-duplicate-string": "off",
    },
  },
  eslintConfigPrettier,
);
