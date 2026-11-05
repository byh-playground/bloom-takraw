import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const base = process.env.BASE_SHA;
if (!base || !/^[0-9a-f]{40}$/.test(base)) {
    throw new Error('BASE_SHA must be a commit SHA');
}

const output = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--diff-filter=ACMR', base + '...HEAD'],
    { encoding: 'utf8' },
);
const changed = output
    .split('\0')
    .filter(Boolean)
    .filter((file) => existsSync(file));
const prettier = changed.filter((file) => /\.(js|mjs|cjs|html?|css|json|md|markdown)$/i.test(file));
const eslint = changed.filter((file) => /\.(js|mjs|cjs|html?)$/i.test(file));

function check(command, args) {
    if (args.length === 0) return;
    execFileSync(
        process.execPath,
        [
            'node_modules/' +
                command +
                '/bin/' +
                (command === 'eslint' ? 'eslint.js' : 'prettier.cjs'),
            ...args,
        ],
        { stdio: 'inherit' },
    );
}
if (prettier.length) check('prettier', ['--check', '--ignore-unknown', ...prettier]);
if (eslint.length) check('eslint', ['--no-warn-ignored', ...eslint]);
console.log('Changed files: ' + changed.length);
