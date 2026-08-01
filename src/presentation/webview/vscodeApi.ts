import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
} from '../../application/dto/messages';

export interface VsCodeApi {
    postMessage(message: WebviewToHostMessage): void;
    getState(): unknown;
    setState(state: unknown): void;
}

type AcquireVsCodeApi = () => VsCodeApi;

const acquire = (globalThis as { acquireVsCodeApi?: AcquireVsCodeApi })
    .acquireVsCodeApi;

/** False when the page is running standalone in the dev harness. */
export const isHostedInVsCode = typeof acquire === 'function';

/**
 * `acquireVsCodeApi` may only be called once per page, so the handle is
 * memoised. Standalone, it degrades to a logger so the UI stays interactive.
 */
/** Dispatched instead of posting, so the dev harness can answer requests. */
export const HARNESS_TO_HOST_EVENT = 'githawk:to-host';

const api: VsCodeApi = isHostedInVsCode
    ? acquire!()
    : {
          postMessage: (message) => {
              // Structured-clone first, exactly as the real host does. Without
              // this the harness accepts payloads VS Code would reject — which is
              // how a Proxy-carrying message passed here and failed there.
              const cloned = structuredClone(message);
              console.info('[harness] webview → host', cloned);
              // Re-emitted as a DOM event rather than window.postMessage, which
              // the webview's own host-message listener would pick up as if the
              // host had sent it.
              window.dispatchEvent(
                  new CustomEvent(HARNESS_TO_HOST_EVENT, { detail: cloned })
              );
          },
          getState: () => undefined,
          setState: () => undefined,
      };

/**
 * Sends a message to the extension host.
 *
 * The payload is deep-copied first, and that is not defensive padding — it is a
 * correctness requirement. Svelte 5's `$state` wraps arrays and objects in a
 * Proxy, and `vscode.postMessage` structured-clones what it is given.
 * Structured clone throws DataCloneError on a Proxy, so posting a piece of state
 * directly fails silently from the caller's point of view: the message simply
 * never arrives.
 *
 * This bit once already. A multi-commit comparison did nothing in VS Code while
 * working in the browser harness, because the harness's stand-in postMessage
 * dispatches an event and never clones. Copying here fixes the whole class of
 * bug rather than each call site, and every message type is JSON-shaped by
 * design, so a JSON round trip is a faithful copy.
 */
export function postToHost(message: WebviewToHostMessage): void {
    api.postMessage(toPlainObject(message));
}

export function toPlainObject<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Reads one key out of the webview's persisted state.
 *
 * VS Code keeps this across a panel being hidden and rebuilt, and across a
 * window reload, which is the difference between a layout preference and a
 * layout preference that resets every morning. Standalone in the harness both
 * of these are no-ops, so the dev page always starts from the defaults.
 */
export function readWebviewState(key: string): unknown {
    const state = api.getState();
    return typeof state === 'object' && state !== null
        ? (state as Record<string, unknown>)[key]
        : undefined;
}

/**
 * Writes one key, preserving the rest. setState replaces the whole object, so
 * writing a key naively is how the *other* keys quietly disappear.
 */
export function writeWebviewState(key: string, value: unknown): void {
    const state = api.getState();
    const existing =
        typeof state === 'object' && state !== null
            ? (state as Record<string, unknown>)
            : {};

    // Plain-copied for the same reason messages are: state can be a Svelte
    // proxy, and what is stored must be structured-cloneable.
    api.setState({ ...existing, [key]: toPlainObject(value) });
}

/** Subscribes to host messages. Returns an unsubscribe function. */
export function onHostMessage(
    handler: (message: HostToWebviewMessage) => void
): () => void {
    const listener = (event: MessageEvent<HostToWebviewMessage>) =>
        handler(event.data);

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
}
