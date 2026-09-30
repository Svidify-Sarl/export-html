const eslint = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**"],
  },
  eslint.configs.recommended,
  {
    files: ["src/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        fetch: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        fetch: "readonly",
        TextDecoder: "readonly",
      },
    },
  },
];
