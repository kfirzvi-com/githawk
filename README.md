# Git Graph VS Code Extension

A VS Code extension for Git management with a graph visualization feature similar to JetBrains IDEs.

## Development Setup

This extension uses a modern development setup with:
- **Extension Host**: TypeScript + esbuild bundling
- **Webview UI**: Svelte 5 + Vite with Hot Module Replacement (HMR)
- **Styling**: Tailwind CSS with VS Code theme integration

### Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   cd src/webview-ui && npm install
   ```

2. **Start development mode**:
   ```bash
   npm run dev
   ```
   This runs both:
   - Extension build watcher (Node.js + esbuild)
   - Vite dev server with HMR (http://localhost:5173)

3. **Open VS Code and test**:
   - Press `F5` to launch Extension Development Host
   - Use `Cmd+9` to open the Git Graph panel
   - Make changes to webview components and see instant HMR updates

### Development vs Production

- **Development**: Webview loads from Vite dev server (localhost:5173) with HMR
- **Production**: Webview loads from bundled assets in `dist/webview-ui/`

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
