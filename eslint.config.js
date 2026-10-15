// ESLint flat config: the recommended rules, plus two idioms this codebase
// uses on purpose.
//   • `catch {}` with an empty body is how a best-effort step is written here
//     (a probe, a cleanup, a log line). It is always commented.
//   • An unused binding is allowed when its name starts with `_`.
import js from '@eslint/js';
import globals from 'globals';

const rules = {
  'no-console': 'off',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-inner-declarations': 'off',
};

export default [
  // runner/ is third-party Swift (see runner/README.md); var/ is run-time state.
  { ignores: ['node_modules/**', 'runner/**', 'var/**'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules,
  },
  {
    // The lifecycle simulator's stand-in binaries. CommonJS on purpose: they
    // are copied out of this "type": "module" package and run without an
    // extension, as `ios`, `ip`, `python3` and `tailscale`.
    files: ['device/test/sim/fakes/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
];
