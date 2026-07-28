/**
 * Mocha entry point for the multi-repository session, loaded inside the VS Code
 * extension host.
 *
 * A copy of ../suite/index.cjs rather than a shared module: VS Code requires
 * this file by path and does not run it through the project's bundler, so it has
 * to stand alone.
 */
const path = require('node:path');
const Mocha = require('mocha');
const fs = require('node:fs');

function run() {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60_000 });
    const suiteDir = __dirname;

    for (const file of fs.readdirSync(suiteDir)) {
        if (file.endsWith('.test.cjs')) {
            mocha.addFile(path.join(suiteDir, file));
        }
    }

    return new Promise((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} integration test(s) failed`));
                } else {
                    resolve();
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { run };
