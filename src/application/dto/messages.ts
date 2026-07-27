import { GitGraphDto } from './GitGraphDto';

/**
 * Every message crossing the webview boundary, in both directions.
 *
 * Discriminated unions mean an unhandled message type is a compile error rather
 * than a silent no-op — which is how the previous `{parents}` vs `{parentHashes}`
 * mismatch survived unnoticed.
 */
export type HostToWebviewMessage =
    | { type: 'graph:loaded'; graph: GitGraphDto }
    | { type: 'graph:error'; message: string };

export type WebviewToHostMessage =
    | { type: 'graph:refresh' }
    | { type: 'commit:select'; hash: string }
    | { type: 'branch:switch'; name: string }
    | { type: 'branch:checkoutRemote'; name: string };
