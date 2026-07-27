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
              console.info('[harness] webview → host', message);
              // Re-emitted as a DOM event rather than window.postMessage, which
              // the webview's own host-message listener would pick up as if the
              // host had sent it.
              window.dispatchEvent(
                  new CustomEvent(HARNESS_TO_HOST_EVENT, { detail: message })
              );
          },
          getState: () => undefined,
          setState: () => undefined,
      };

export function postToHost(message: WebviewToHostMessage): void {
    api.postMessage(message);
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
