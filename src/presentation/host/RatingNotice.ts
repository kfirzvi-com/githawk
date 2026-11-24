import * as vscode from 'vscode';
import {
    INITIAL_RATING_STATE,
    RatingFlow,
    dayOf,
    type RatingAnswer,
    type RatingState,
} from './ratingPrompt';

/**
 * Connects `RatingFlow` to the editor: the state lives in `globalState`, the
 * question is an information message, and "Rate" opens the browser.
 */
export class RatingNotice {
    private static readonly KEY = 'gitHawk.rating';
    private static readonly RATE = 'Rate GitHawk';
    private static readonly LATER = 'Later';
    private static readonly NEVER = "Don't Ask Again";

    private readonly flow: RatingFlow;

    constructor(state: vscode.Memento, extensionId: string) {
        this.flow = new RatingFlow(extensionId, {
            read: () => state.get<RatingState>(RatingNotice.KEY, INITIAL_RATING_STATE),
            write: async (next) => state.update(RatingNotice.KEY, next),
            ask: () => RatingNotice.ask(),
            open: async (url) => {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            },
            today: () => dayOf(new Date()),
        });
    }

    onGraphShown(): Promise<void> {
        return this.flow.onGraphShown();
    }

    rate(): Promise<void> {
        return this.flow.rate();
    }

    private static async ask(): Promise<RatingAnswer> {
        const choice = await vscode.window.showInformationMessage(
            'Enjoying GitHawk? A rating in the store helps other people find it.',
            RatingNotice.RATE,
            RatingNotice.LATER,
            RatingNotice.NEVER
        );
        if (choice === RatingNotice.RATE) {
            return 'rate';
        }
        return choice === RatingNotice.NEVER ? 'never' : 'later';
    }
}
