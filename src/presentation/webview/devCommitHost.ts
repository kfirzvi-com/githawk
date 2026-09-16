import type {
    CommitViewToHostMessage,
    HostToCommitViewMessage,
} from '../../application/dto/messages';
import type { WorkingTreeStatus } from '../../domain/models/WorkingTreeStatus';
import { HARNESS_TO_HOST_EVENT } from './vscodeApi';

/**
 * Stands in for the extension host behind the commit box when the page runs
 * standalone: `?dirty=staged,unstaged,untracked,conflicted` sets the counts,
 * `?tools=0` takes the tool row away, and Generate answers after a pause with
 * a canned message, so the busy state and the arrival can both be seen.
 */
export function startCommitHost(): void {
    const parameters = new URLSearchParams(window.location.search);
    const status = parseDirty(parameters.get('dirty'));
    const tools =
        parameters.get('tools') === '0'
            ? []
            : ['Claude Code', 'Codex', 'Gemini CLI', 'opencode'];

    let draft = parameters.get('draft') ?? '';
    let busy = false;
    let selectedTool: string | null = tools[0] ?? null;

    const state = () =>
        post({
            type: 'commit:state',
            status,
            tools,
            selectedTool,
            draft,
            busy,
        });

    /*
     * Announced as well as answered. The page posts `commit:ready` as it
     * mounts, and this host is imported afterwards — so the request has gone
     * by before anyone is listening, exactly as the real host's would be if
     * the box were rebuilt before the provider was.
     */
    state();

    window.addEventListener(HARNESS_TO_HOST_EVENT, (event) => {
        const message = (event as CustomEvent<CommitViewToHostMessage>).detail;
        switch (message.type) {
            case 'commit:ready':
                state();
                break;
            case 'commit:draft':
                draft = message.message;
                break;
            case 'commit:selectTool':
                selectedTool = message.tool;
                break;
            case 'commit:generate':
                busy = true;
                state();
                setTimeout(() => {
                    busy = false;
                    draft = `Stage and unstage files from the Changes view\n\nThe uncommitted changeset is now grouped the way git keeps it, so a\ncommit can be assembled where the files are listed.`;
                    post({ type: 'commit:generated', message: draft });
                    state();
                }, 600);
                break;
            case 'commit:submit':
                busy = true;
                state();
                setTimeout(() => {
                    busy = false;
                    draft = '';
                    post({ type: 'commit:committed' });
                    state();
                }, 300);
                break;
            case 'commit:stageAll':
                status.staged += status.unstaged + status.untracked;
                status.unstaged = 0;
                status.untracked = 0;
                state();
                break;
        }
    });
}

/**
 * `?dirty=staged,unstaged,untracked,conflicted`, each optional and zero when
 * left out. No parameter at all means a plausible default rather than a clean
 * tree, because a clean tree has no box to look at.
 */
function parseDirty(spec: string | null): WorkingTreeStatus {
    if (spec === null) {
        return { staged: 2, unstaged: 1, untracked: 1, conflicted: 0 };
    }

    const [staged = 0, unstaged = 0, untracked = 0, conflicted = 0] = spec
        .split(',')
        .map((part) => {
            const value = Number(part.trim());
            return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
        });
    return { staged, unstaged, untracked, conflicted };
}

function post(message: HostToCommitViewMessage): void {
    window.postMessage(message, '*');
}
