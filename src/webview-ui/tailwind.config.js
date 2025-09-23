/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,svelte}",
  ],
  theme: {
    extend: {
      colors: {
        // VS Code theme integration
        'vscode-foreground': 'var(--vscode-foreground)',
        'vscode-background': 'var(--vscode-background)',
        'vscode-button-background': 'var(--vscode-button-background)',
        'vscode-button-foreground': 'var(--vscode-button-foreground)',
        'vscode-input-background': 'var(--vscode-input-background)',
        'vscode-input-foreground': 'var(--vscode-input-foreground)',
        'vscode-input-border': 'var(--vscode-input-border)',
        
        // Custom grays for modern dark theme
        gray: {
          850: '#1a1a1a',
          900: '#0d1117',
        }
      },
      fontFamily: {
        'sans': ['Inter', 'system-ui', 'sans-serif'],
        'mono': ['JetBrains Mono', 'Fira Code', 'monospace'],
      }
    },
  },
  plugins: [],
};