import { GitAction, isDestructive } from '../../domain/models/GitAction';
import { IGitWriter } from '../../domain/repositories/IGitWriter';

export interface ActionOutcome {
    action: GitAction;
    succeeded: boolean;
    /** git's explanation when it refused. */
    message?: string;
}

/**
 * Runs one mutating action.
 *
 * Confirmation is not decided here: the host owns that, because only the host can
 * present a modal and because a confirmation the user never sees is worse than
 * none. What this does guarantee is that a destructive action cannot be run
 * without the caller having stated it was confirmed.
 */
export class PerformGitActionUseCase {
    constructor(private readonly writer: IGitWriter) {}

    async execute(
        action: GitAction,
        options: { confirmed: boolean } = { confirmed: false }
    ): Promise<ActionOutcome> {
        if (isDestructive(action) && !options.confirmed) {
            throw new Error(
                `Refusing to run ${action.type} without explicit confirmation`
            );
        }

        try {
            await this.writer.perform(action);
            return { action, succeeded: true };
        } catch (error) {
            return {
                action,
                succeeded: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
