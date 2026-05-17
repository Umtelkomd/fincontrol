import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.atl']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^Icon$' }],
      // React Compiler lint rules are too aggressive for the current modal/data-loading patterns.
      // Keep exhaustive-deps warnings active, but do not block deploy readiness on compiler optimization hints.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  {
    files: ['scripts/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        firebase: 'readonly',
      },
    },
  },
  {
    files: ['src/components/ui/nexus/**/*.{js,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/\\b(nd-|n-label|n-mono|n-tag)\\b|var\\(--(surface|surface-raised|text-primary|text-secondary|text-disabled|accent|border|success|warning|error|info)\\)/]',
          message: 'NEXUS components must use canonical utilities and --color-* tokens, not compatibility aliases.',
        },
        {
          selector: 'TemplateElement[value.raw=/\\b(nd-|n-label|n-mono|n-tag)\\b|var\\(--(surface|surface-raised|text-primary|text-secondary|text-disabled|accent|border|success|warning|error|info)\\)/]',
          message: 'NEXUS components must use canonical utilities and --color-* tokens, not compatibility aliases.',
        },
      ],
    },
  },
])
