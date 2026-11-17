import js from '@eslint/js';
import { builtinModules } from 'node:module';

const featureFiles = [
  'src/browser/**/*.js',
  'src/server/{pagePublishing,policies,consentWording}.js',
  'src/utils/{adminAccess,checkout,policies,publicContent,consentWordingStore,consentWordingClient}.js',
  'scripts/test-unit.mjs',
  'tests/browser/**/*.js',
  'playwright.config.js',
  'eslint.config.js'
];
const globals = Object.fromEntries([
  'AbortController', 'AbortSignal', 'Buffer', 'Headers', 'Request', 'Response', 'URL',
  'clearTimeout', 'console', 'fetch', 'globalThis', 'localStorage', 'process', 'setImmediate', 'setTimeout', 'window'
].map((name) => [name, 'readonly']));
const browserOnlyImports = [
  'node:*',
  '**/server/**',
  'firebase-admin',
  'firebase-admin/**',
  '@google-cloud/**',
  '**/utils/policies.js'
];

export default [
  { ignores: ['node_modules/**', 'dist/**', 'venv/**', 'test-results/**', 'playwright-report/**'] },
  {
    files: featureFiles,
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        ignoreRestSiblings: true
      }]
    }
  },
  {
    files: ['src/browser/**/*.js'],
    ignores: ['**/*.test.js'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: builtinModules,
        patterns: [{
          group: browserOnlyImports,
          message: 'Browser modules must not import server infrastructure or Node-only policy hashing.'
        }]
      }]
    }
  },
  {
    files: ['src/utils/{adminAccess,checkout,publicContent,consentWordingStore}.js'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: builtinModules,
        patterns: [{
          group: [...browserOnlyImports, 'react', '**/browser/**', '**/consentWordingClient*'],
          message: 'Shared rules must remain independent of React, browser state and server infrastructure.'
        }]
      }]
    }
  }
];
