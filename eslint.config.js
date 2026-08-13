import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// import.meta.dirname needs Node >= 20.11; this form works everywhere.
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['drizzle.config.ts'],
        },
        tsconfigRootDir: rootDir,
      },
    },
    rules: {
      // TypeScript resolves identifiers itself; no-undef only produces false
      // positives on Node globals and type-only names.
      'no-undef': 'off',

      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'all'],

      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: false, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],

      // Enforces the layering: config is the only reader of process.env.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Do not read process.env directly — import `config` from config/env.config.ts.',
        },
      ],
    },
  },

  {
    files: [
      'src/config/env.config.ts',
      'src/config/ssm-bootstrap.ts',
      'src/shared/logger/logger.ts',
      'src/database/config.ts',
      'src/test-support/test-db.ts',
    ],
    rules: { 'no-restricted-properties': 'off' },
  },

  {
    files: ['src/**/*.test.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },

  {
    // Enforces the provider boundary: everything that makes an SFCC call — the
    // clients, the SCAPI types, the mappers, the token handling — lives in a
    // subfolder of providers/sfcc, and the only importable entry point is
    // providers/sfcc/index.ts. Without this the boundary is a convention, and
    // the first import that shortcuts it puts SLAS field names in a controller.
    files: ['src/**/*.ts'],
    ignores: ['src/providers/sfcc/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/providers/sfcc/*/**'],
              message:
                'SFCC internals are an implementation detail. Import getSfccProvider from ' +
                'providers/sfcc/index.ts and depend on the SfccProvider contract.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
