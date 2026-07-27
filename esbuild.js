const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => console.log('[watch] build started'));
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                if (location) {
                    console.error(
                        `    ${location.file}:${location.line}:${location.column}:`
                    );
                }
            });
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    const context = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node20',
        outfile: 'dist/extension.js',
        // Provided by the VS Code runtime, never bundled.
        external: ['vscode'],
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        logLevel: 'silent',
        plugins: [problemMatcherPlugin],
    });

    if (watch) {
        console.log('👀 Watching the extension host for changes…');
        await context.watch();
    } else {
        await context.rebuild();
        await context.dispose();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
