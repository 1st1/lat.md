---
lat:
  require-code-mention: true
---
# Hook

Functional tests for the Stop hook. Most run `lat hook claude Stop` as a subprocess with a fake `git` on PATH serving both `git diff --numstat` and `git ls-files` output; one exercises [[src/cli/hook.ts#analyzeDiff]] directly.

The fake `git` dispatches on the subcommand, so a single helper controls both the tracked diff and the untracked-file list. Tests in `tests/hook.test.ts`.

## Exits silently when check passes and no diff

When `lat check` passes and there is no git diff output, the hook produces no stdout and no stderr — the agent stops cleanly.

## Blocks when lat check fails

When `lat check` finds errors, the hook outputs a block decision with a reason mentioning `lat check` and the error count.

## Blocks when code diff is large but lat.md/ not updated

When check passes but `git diff --numstat` shows code changes above the threshold with no `lat.md/` changes, the hook blocks with a reminder to update `lat.md/`.

## Exits silently when lat.md/ changes are proportional

When code changes are large but `lat.md/` changes exceed the 5% ratio, the hook exits silently.

## Exits silently when code diff is below threshold

When code changes are below 5 lines, the ratio check is skipped and the hook exits silently.

## Blocks with both messages when check fails and diff needs sync

When `lat check` fails and the diff also needs sync, the block reason includes both "update `lat.md/`" and "run `lat check` until it passes".

## Exits silently on second pass when check passes

On the second pass (`stop_hook_active: true`), if `lat check` passes, the hook exits silently with no output.

## Prints stderr warning on second pass when check still fails

On the second pass, if `lat check` still fails, the hook prints a warning to stderr but does not block — the loop stops.

## Ignores non-code files in diff

Files that don't match `SOURCE_EXTENSIONS` (e.g. `.md`) are not counted toward code lines, so a large markdown-only diff does not trigger a sync reminder.

## Cursor stop hook returns follow-up work instead of a Claude block

When Cursor needs more work at stop time, the hook returns a `followup_message` payload instead of Claude's `decision: "block"` shape so the agent keeps going in Cursor's native hook format.

## Counts untracked lat.md/ and source files

[[src/cli/hook.ts#analyzeDiff]] counts untracked files (via `git ls-files`) alongside tracked changes, so a freshly scaffolded, never-committed `lat.md/` registers as updated.

Untracked `lat.md/` files count as lat.md lines and untracked source as code lines. Without this, an uncommitted `lat.md/` reads as zero churn and the sync reminder fires every turn (issue #61).
