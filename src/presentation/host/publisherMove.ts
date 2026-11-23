/**
 * GitHawk moved from the `kfirzvi-com` publisher to `praktical`, under a
 * different name in each registry. The Marketplace keeps an extension's name
 * unique across publishers and `githawk` is still held by the old identifier,
 * so there it is `githawk-graph`; Open VSX has no such rule and keeps `githawk`.
 *
 * Kept free of `vscode` so the rules can be unit-tested.
 */
export const OLD_ID = 'kfirzvi-com.githawk';

/** Tried in this order: the first is only on the Marketplace, the second only on Open VSX. */
export const NEW_IDS = ['praktical.githawk-graph', 'praktical.githawk'] as const;

/** Only the old identifier offers the switch; under either new one it stays silent. */
export function offersMove(extensionId: string): boolean {
    return extensionId.toLowerCase() === OLD_ID;
}
