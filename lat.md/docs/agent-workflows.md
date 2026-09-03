# Agent workflows

Lat gives coding agents durable project context and a validation loop that keeps that context synchronized with implementation.

## Setup

`lat init` configures supported agents interactively and can generate shared instructions, skills, MCP registrations, plugins, and lifecycle hooks.

Generated guidance follows one loop:

1. Search the graph and expand explicit `[[refs]]` before work.
2. Read exact sections instead of guessing from snippets.
3. Update `lat.md/` when architecture, behavior, tests, or plans materially change.
4. Run `lat check` before finishing.

## Context tools

Agents can use the CLI directly or the matching MCP tools for search, section inspection, reference lookup, expansion, and validation.

`lat expand` is useful at prompt boundaries: it resolves authored wiki links and appends their full context. `lat external show` lets an agent inspect a pinned upstream source before deciding whether it needs an editable checkout.

## Review

Knowledge diffs summarize semantic change, so reviewers can understand intent before descending into implementation details.

Required test specifications and `@lat:` comments make important coverage visible from either direction. Stop hooks can remind an agent when a large code change has no corresponding knowledge update without preventing projects from using Lat outside Git.
