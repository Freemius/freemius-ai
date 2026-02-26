/**
 * Copyright (c) 2026 Freemius Inc.
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

export default {
  useTabs: false,
  tabWidth: 2,
  printWidth: 80,
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  bracketSpacing: true,
  proseWrap: 'always',
  overrides: [
    {
      files: '*.json',
      options: {
        tabWidth: 2,
      },
    },
    {
      files: '*.{yaml,yml}',
      options: {
        tabWidth: 2,
      },
    },
    {
      files: '*.{md,mdx}',
      options: {
        parser: 'markdown',
        proseWrap: 'always',
      },
    },
  ],
};
