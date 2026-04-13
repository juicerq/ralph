# @juicerq/swarm

Orchestrate Claude Code agents to implement GitHub issues in parallel.

## Workflow

Swarm is the final step of an AI-powered development workflow:

1. **`/grill-me`** — Design review. Get grilled about every aspect of your plan until reaching shared understanding
2. **`/write-a-prd`** — PRD creation. Turn the validated design into a detailed product requirements document
3. **`/prd-to-issues`** — Issue breakdown. Break the PRD into independently-implementable GitHub issues
4. **`bunx @juicerq/swarm`** — Automated implementation. Swarm picks up the issues and implements them in parallel

## Usage

```bash
bunx @juicerq/swarm
```

Swarm will:
1. Fetch open issues with the configured label (default: `swarm`)
   - If none found and running in a TTY, opens an interactive selector to pick from all open issues
2. Run a planner agent (Opus) to analyze dependencies and order issues
3. Spawn parallel Claude Code agents to implement each issue in isolated git worktrees
4. Merge completed work back to the current branch
5. Auto-resolve merge conflicts using Claude Code

### CLI Flags

```bash
bunx @juicerq/swarm --label my-label --concurrency 5 --model sonnet
```

| Flag | Default | Description |
|------|---------|-------------|
| `--label` | `swarm` | GitHub issue label to filter |
| `--concurrency` | `1` | Max parallel agents |
| `--model` | `opus` | Default model (planner may override per issue) |
| `--prompt` | built-in | Extra instructions for implementer agents |

### Configuration

Optional `swarm.config.ts` in your project root:

```ts
import type { Config } from "@juicerq/swarm"

export default {
  label: "swarm",
  concurrency: 1,
  model: "opus",
  prompt: "Run bun typecheck and bun test before committing.",
} satisfies Config
```

Priority: CLI flags > swarm.config.ts > defaults

## How it works

```
bunx @juicerq/swarm
  |
  1. Load config (defaults -> swarm.config.ts -> CLI flags)
  2. gh issue list --label <label> --state open
  3. Planner (Opus) analyzes dependencies, assigns model per issue
  |    opus = complex tasks | sonnet = trivial tasks
  4. For each issue (up to --concurrency):
  |    git worktree add .swarm/<number> -b swarm/<number>
  |    claude -p --model <model> (runs in worktree)
  |    git merge swarm/<number> (back to current branch)
  |    cleanup worktree + branch
  5. Resolve merge conflicts with Claude Code
  6. Summary: success/fail per issue
```

On unresolvable conflict, the branch is preserved for manual resolution.
On failure, the branch is preserved for inspection.

## Requirements

- [Bun](https://bun.sh)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- [GitHub CLI](https://cli.github.com) (`gh`)
- Git
