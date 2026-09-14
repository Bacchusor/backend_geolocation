import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/**', 'apps/admin/public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/admin/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  prettier,
);
