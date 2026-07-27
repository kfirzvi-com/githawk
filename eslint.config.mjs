import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';

/**
 * The dependency rule is enforced here rather than by convention:
 *
 *   domain          → nothing
 *   application     → domain
 *   infrastructure  → domain, application
 *   presentation    → domain, application
 *   composition     → anything (extension.ts, the dev harness bootstrap)
 *
 * `vscode` may only be imported by the host presentation layer and by the
 * composition root, which is what keeps the domain runnable in a browser and
 * in Vitest.
 */
export default [
    {
        ignores: ['dist/**', 'node_modules/**', '.vscode-test/**'],
    },
    {
        files: ['**/*.ts'],
        plugins: {
            '@typescript-eslint': typescriptEslint,
            boundaries,
        },
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        settings: {
            // Without a TS-aware resolver, extensionless imports fail to
            // resolve and boundaries/element-types silently skips them — the
            // rule appears to pass while enforcing nothing.
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: ['tsconfig.host.json', 'tsconfig.webview.json'],
                    noWarnOnMultipleProjects: true,
                },
            },
            'boundaries/include': ['src/**/*.ts'],
            'boundaries/elements': [
                // Order matters: the first pattern that matches wins, so the
                // composition-root entries must precede their tiers.
                { type: 'composition', pattern: 'src/extension.ts', mode: 'file' },
                {
                    type: 'composition',
                    pattern: 'src/presentation/webview/devFixtureHost.ts',
                    mode: 'file',
                },
                { type: 'domain', pattern: 'src/domain/**' },
                { type: 'application', pattern: 'src/application/**' },
                { type: 'infrastructure', pattern: 'src/infrastructure/**' },
                { type: 'presentation', pattern: 'src/presentation/**' },
            ],
        },
        rules: {
            'boundaries/element-types': [
                'error',
                {
                    default: 'disallow',
                    rules: [
                        { from: ['domain'], allow: ['domain'] },
                        { from: ['application'], allow: ['domain', 'application'] },
                        {
                            from: ['infrastructure'],
                            allow: ['domain', 'application', 'infrastructure'],
                        },
                        {
                            from: ['presentation'],
                            allow: ['domain', 'application', 'presentation'],
                        },
                        {
                            from: ['composition'],
                            allow: [
                                'domain',
                                'application',
                                'infrastructure',
                                'presentation',
                            ],
                        },
                    ],
                },
            ],
            'boundaries/external': [
                'error',
                {
                    default: 'allow',
                    rules: [
                        {
                            from: ['domain', 'application', 'infrastructure'],
                            disallow: ['vscode'],
                            message:
                                'The ${file.type} tier must stay runnable outside VS Code. Depend on a port instead.',
                        },
                        {
                            from: ['presentation'],
                            disallow: ['vscode'],
                            message:
                                'Only src/presentation/host may import vscode; the webview cannot.',
                        },
                    ],
                },
            ],
            curly: 'warn',
            eqeqeq: 'warn',
            'no-throw-literal': 'warn',
            semi: 'warn',
        },
    },
    {
        // The host half of presentation is the one place `vscode` belongs.
        files: ['src/presentation/host/**/*.ts'],
        rules: {
            'boundaries/external': 'off',
        },
    },
    {
        files: ['**/*.test.ts', 'src/domain/testing/**/*.ts'],
        rules: {
            // Test helpers legitimately reach across tiers to build fixtures.
            'boundaries/element-types': 'off',
        },
    },
];
