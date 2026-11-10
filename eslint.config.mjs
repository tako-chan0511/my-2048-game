import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended, ...tseslint.configs.recommended, ...vue.configs['flat/essential'],
  { files: ['**/*.{ts,vue,mjs}'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tseslint.parser } }, rules: { 'vue/multi-word-component-names': 'off' } },
  { files: ['src/core/**/*.ts'], rules: {
    'no-restricted-imports': ['error', { patterns: ['vue', 'vue/*', '../components/*', '../composables/*', '../services/*'] }],
    'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'Date', 'performance', 'crypto'],
    'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use explicit seeded RNG state.' }],
  } },
)
