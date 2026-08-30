#!/usr/bin/env python3
"""Decides whether a Bash command would move HEAD off the plan's branch.

Splits the raw string on shell separators FIRST, then tokenizes each fragment with
shlex. Order matters: shlex does not treat `;` or an unspaced `&&` as a delimiter, so
`echo hi; git checkout main` tokenizes to `['echo', 'hi;', 'git', ...]` and a
tokenize-then-split design reads the whole line as one non-git command.

Tokenizing rather than regex-matching the raw string is what removes the quoting class
of bypass: `-c user.name="John Doe"`, `-c "user.name=John Doe"` and `-c 'user.name=John
Doe'` are three spellings of one command, and a regex needs a case for each.

Reads the hook payload on stdin, prints the PreToolUse decision on stdout. Malformed
input allows the command: a guard that blocks on its own bug is worse than no guard.
"""

import json
import re
import shlex
import sys

# Subcommands that move HEAD or discard the working tree wholesale. Path-scoped reverts
# (`checkout -- <path>`, `restore <path>`) are absent deliberately: they cannot move
# HEAD, and reverting a file the tooling touched is routine work.
BRANCH_MOVING = {"checkout", "switch", "rebase"}
CLEAN = "clean"
# `worktree list`/`lock`/`unlock` and a bare `reset` (unstage only) move neither HEAD
# nor the tree, so only the mutating members are listed.
DESTRUCTIVE_SUBCOMMANDS = {
    "worktree": {"add", "remove", "move", "prune"},
    # `save` is the long-standing alias for `push`.
    "stash": {"push", "save", "pop", "apply", "drop", "clear", "branch", "create", "store"},
}
# Subcommands whose no-argument form is itself the destructive one.
BARE_IS_DESTRUCTIVE = {"stash"}
# Modes that make `reset` move HEAD or overwrite the tree; a bare or path-scoped reset
# only unstages, and denying that strands routine work.
RESET_MODES = {"--hard", "--mixed", "--soft", "--merge", "--keep"}
# git global options that take a value, so the value is never read as a subcommand.
VALUE_OPTIONS = {"-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
# Rebase controls that end or advance an in-progress rebase rather than starting one.
# Denying --abort would trap the session inside the broken rebase it needs to escape.
REBASE_RECOVERY = {"--abort", "--continue", "--skip", "--quit", "--edit-todo"}

SHELL_WRAPPERS = {"sh", "bash", "zsh", "dash", "env", "xargs", "nohup", "time", "sudo"}
# Unescaped shell separators, longest first so `&&` is not split as two `&`.
SEPARATOR_PATTERN = re.compile(r"(?<!\\)(?:&&|\|\||[;|&\n])")
# Grouping and control-flow tokens that wrap a real command.
GROUPING = {"(", ")", "{", "}", "then", "else", "elif", "do", "done", "fi", "!"}
# shlex keeps a bracket glued to the word it touches, so `(git` arrives as one token.
GROUPING_CHARS = "(){}"


def program_name(token):
    """The bare program name: `/usr/bin/git` and `git` are the same program."""
    return token.rsplit("/", 1)[-1]


def strip_grouping(command):
    """Drops subshell/control-flow tokens so `(git checkout main)` is seen as a command."""
    stripped = []
    for token in command:
        token = token.strip(GROUPING_CHARS)
        if token and token not in GROUPING:
            stripped.append(token)
    return stripped


def moves_head(command, want_branch):
    """True when this one command would move HEAD off want_branch."""
    command = strip_grouping(command)
    if not command:
        return False

    # A wrapper hides the real command in one of two shapes, and both must be handled:
    #   nested  — `sh -c "git checkout main"`, the command inside ONE quoted token
    #   sibling — `sudo git checkout main`, the command as the tokens that follow
    if program_name(command[0]) in SHELL_WRAPPERS:
        rest = command[1:]
        for position, token in enumerate(rest):
            # `FOO=1` is an env assignment, not the program; keep looking.
            if token.startswith("-") or "=" in program_name(token):
                continue
            try:
                inner = shlex.split(token)
            except ValueError:
                inner = token.split()
            if len(inner) > 1 and any(
                moves_head(part, want_branch) for part in split_fragment(token)
            ):
                return True
            # The tail is re-classified from the top, so a wrapper wrapping a wrapper
            # (`sudo env git ...`) resolves by the same path.
            return moves_head(rest[position:], want_branch)
        return False

    if program_name(command[0]) != "git":
        return False

    index = 1
    while index < len(command):
        token = command[index]
        if token in VALUE_OPTIONS:
            index += 2  # skip the option AND its value
            continue
        if token.startswith("-"):
            index += 1  # `--git-dir=/x`, or a valueless global flag
            continue
        break
    if index >= len(command):
        return False

    subcommand = command[index]
    args = command[index + 1 :]

    if subcommand == CLEAN:
        # -n/--dry-run only prints what would be removed.
        return not any(a in ("-n", "--dry-run") for a in args)
    if subcommand in DESTRUCTIVE_SUBCOMMANDS:
        # Bare `git stash` is `stash push` spelled shorter, and so is `git stash -u`:
        # a leading FLAG means no subcommand was named, not that one was.
        if not args or args[0].startswith("-"):
            return subcommand in BARE_IS_DESTRUCTIVE
        return args[0] in DESTRUCTIVE_SUBCOMMANDS[subcommand]
    if subcommand == "reset":
        # A bare or path-scoped reset unstages. A mode flag, or a ref with no path
        # after it, moves HEAD.
        if any(a in RESET_MODES for a in args):
            return True
        if "--" in args:
            return False
        refs = [a for a in args if not a.startswith("-")]
        return len(refs) == 1 and refs[0] != "HEAD"
    if subcommand == "restore":
        return any(a.startswith("--source") for a in args)
    if subcommand not in BRANCH_MOVING:
        return False

    if subcommand == "rebase":
        # Ending an in-progress rebase is the recovery path, not a violation.
        return not any(a in REBASE_RECOVERY for a in args)

    # `--` separates refs from paths. A ref BEFORE it still moves HEAD
    # (`git checkout main --`), so only the tokens preceding it are refs.
    head = args[: args.index("--")] if "--" in args else args
    # `-` means "the previous branch" — a ref that happens to look like a flag.
    refs = [a for a in head if not a.startswith("-") or a == "-"]
    if not refs:
        return False
    # Returning to the plan's own branch is the recovery path. Every ref must be that
    # branch: `git checkout feature-branch main` resolves to main and would otherwise
    # launder a second ref past a check of refs[0] alone.
    return any(ref != want_branch for ref in refs)


def split_fragment(text):
    """Splits one command string into per-command token lists."""
    fragments = []
    for piece in SEPARATOR_PATTERN.split(text):
        piece = piece.strip()
        if not piece:
            continue
        try:
            tokens = shlex.split(piece, comments=False)
        except ValueError:
            tokens = piece.split()
        if tokens:
            fragments.append(tokens)
    return fragments


def main():
    try:
        payload = json.load(sys.stdin)
        command_text = payload.get("tool_input", {}).get("command", "")
        want_branch = sys.argv[1]
    except Exception:
        print(json.dumps({"continue": True}))
        return

    if any(moves_head(cmd, want_branch) for cmd in split_fragment(command_text)):
        reason = (
            f"Refused: this would move HEAD off '{want_branch}', the branch an active "
            "plan in .claude/state/current-plan.json is being delivered on. A subagent "
            "sharing this working tree has already stranded the parent session once.\n\n"
            "Read any ref without moving HEAD:\n"
            "  git show <ref>:<path>\n"
            "  git diff <base>...<branch>\n"
            "  git log <base>..<branch>\n"
            "  git grep <pattern> <ref> -- <path>\n\n"
            "If you genuinely need to switch, clear or pause the plan state first."
        )
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": reason,
                    }
                }
            )
        )
        return

    print(json.dumps({"continue": True}))


if __name__ == "__main__":
    main()
