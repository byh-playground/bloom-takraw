import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';

export default [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/vendor/**',
            '**/third_party/**',
            '**/*.min.js',
            '**/*.generated.js',
            '**/*.gen.js',
            '**/assets/atlases/**',
            '**/assets/generated/**',
            'scripts/vendor/**',
            'sw.js',
            'artifacts/**',
        ],
    },
    {
        files: ['**/*.{js,mjs}', '**/*.{html,htm}'],
        ignores: [
            'eslint.config.mjs',
            'tools/**',
            'scripts/**',
            'tests/**',
            'playwright.config.js',
            'src/presentation/highlight-worker.js',
        ],
        rules: js.configs.recommended.rules,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.browser,
        },
    },
    {
        files: ['**/*.{html,htm}'],
        plugins: { html },
    },
    {
        files: [
            'eslint.config.mjs',
            'tools/**/*.{js,mjs}',
            'scripts/**/*.{js,mjs}',
            'tests/**/*.{js,mjs}',
            'playwright.config.js',
        ],
        rules: js.configs.recommended.rules,
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        // page.evaluate 안에서 도는 코드는 브라우저에서 실행되므로 시험 파일에도 브라우저 전역을 준다.
        files: ['tests/**/*.{js,mjs}'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['src/presentation/highlight-worker.js'],
        rules: js.configs.recommended.rules,
        languageOptions: { globals: globals.serviceworker },
    },
    {
        files: ['**/*.cjs'],
        rules: js.configs.recommended.rules,
        languageOptions: {
            sourceType: 'commonjs',
            globals: globals.node,
        },
    },
];
