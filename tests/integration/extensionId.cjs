/**
 * The extension's identifier, as VS Code knows it: `<publisher>.<name>`.
 *
 * Derived from the manifest rather than written out, because it was previously
 * hardcoded in four test files — so changing the publisher broke every
 * integration test with a null-dereference on `getExtension(...)` rather than
 * anything that named the cause.
 *
 * CommonJS because VS Code's test runner requires these files directly, without
 * going through the project's bundler.
 */
const manifest = require('../../package.json');

module.exports = {
    EXTENSION_ID: `${manifest.publisher}.${manifest.name}`,
};
