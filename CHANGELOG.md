# Changelog

This repository is a fork of [OpenBMB/PilotDeck](https://github.com/OpenBMB/PilotDeck).
It tracks `upstream/main`; local changes are rebased on top and recorded below.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## How this fork is maintained

- `origin` points at this fork; `upstream` points at `OpenBMB/PilotDeck`.
- Sync with upstream:
  `git fetch upstream && git rebase upstream/main && git push origin main`.
- Keep local changes small and listed here so rebases stay conflict-free.

## [Unreleased]

### Fixed

- **agent-loop: stop the infinite loop on a persistent context overflow**
  (`src/agent/loop/AgentLoop.ts`)

  The reactive `truncate_head_and_retry` branch had no attempt guard, while its
  siblings (`adjust_output_and_retry`, `compact_and_retry`,
  `strip_images_and_retry`) all had one. `ContextOverflowRecovery` keeps
  returning `truncate_head_and_retry` once a compact has already been attempted,
  so a persistent `context_overflow` re-called the model on every loop
  iteration, appended an empty assistant message each time, and never surfaced
  `turn_failed`. The retry is now capped at `MAX_TRUNCATE_HEAD_RECOVERIES`;
  past the cap the loop falls through to the existing error-surfacing path.

  Reproduction context: an Ollama model whose real context window is smaller
  than the catalog claims — for example `num_ctx=4096` on the model versus a
  ~9k-token agent prompt. The provider returns `exceed_context_size_error`,
  which is classified as `context_overflow`, and the turn loops.

### Added

- Regression test `tests/agent/loop/context-overflow-recovery.spec.ts`: drives a
  context runtime that always answers `truncate_head_and_retry` and asserts the
  loop terminates (3 model calls + `turn_failed`) instead of looping.
