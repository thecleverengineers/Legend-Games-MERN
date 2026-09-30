import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["src/**", "client/dist/**", "**/node_modules/**"] },
  js.configs.recommended,
  {
    files: ["server/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.node },
    rules: { "no-unused-vars": "off" },
  },
  {
    files: ["client/src/**/*.{js,jsx}", "client/vite.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    rules: { "no-unused-vars": "off" },
  },
];
