# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

- Runtime: Bun (not Node.js). Use `bun` for all commands.
- Run locally: `bun run src/cli.ts`
- No build step — TypeScript runs directly via Bun.

## Testing

- Run all tests: `bun test`
- Run a single test file: `bun test src/planner.test.ts`
- Tests use Bun's native test runner (`bun:test`)
- **TDD (red, green, refactor)**: Write failing test first, then minimal code to pass, then refactor. Extract logic to separate modules for testability.

## Lint & Format

- Lint: `bunx oxlint src/`
- Format: `bunx oxfmt --write src/`
- Check format: `bunx oxfmt --check src/`

## Code Style

- TypeScript strict mode
- Tab indentation
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, etc.
- Separate every statement with a blank line — each variable declaration, each call, each condition gets its own block. Don't stack statements together.

## Architecture

- CLI orchestrator that spawns parallel Claude Code agents to implement GitHub issues
- `cli.ts` — entry point and orchestration
- `branch.ts` — interactive branch selection prompt
- `planner.ts` — dependency graph extraction via Claude
- `worker.ts` — single issue implementation in isolated git worktree
- `config.ts` — config loading (CLI flags > ralph.config.ts > defaults)
- Workers run in `.ralph/<n>/` worktrees; merges happen serially to avoid conflicts
