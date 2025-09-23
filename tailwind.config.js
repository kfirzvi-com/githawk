/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/webview-ui/**/*.{html,js,svelte,ts}",
  ],
  theme: {
    extend: {
      colors: {
        // VS Code theme colors using CSS variables
        'vscode-foreground': 'var(--vscode-editor-foreground)',
        'vscode-background': 'var(--vscode-editor-background)',
        'vscode-sidebar': 'var(--vscode-sideBar-background)',
        'vscode-titlebar': 'var(--vscode-titleBar-activeBackground)',
        'vscode-border': 'var(--vscode-panel-border)',
        'vscode-hover': 'var(--vscode-list-hoverBackground)',
        'vscode-active': 'var(--vscode-list-activeSelectionBackground)',
        'vscode-button': 'var(--vscode-button-background)',
        'vscode-button-hover': 'var(--vscode-button-hoverBackground)',
        'vscode-description': 'var(--vscode-descriptionForeground)',
        'vscode-link': 'var(--vscode-textLink-foreground)',
        'vscode-badge': 'var(--vscode-badge-background)',
        'vscode-focus': 'var(--vscode-focusBorder)',
      },
      fontFamily: {
        'vscode': 'var(--vscode-font-family)',
        'vscode-editor': 'var(--vscode-editor-font-family)',
      }
    },
  },
  plugins: [],
}