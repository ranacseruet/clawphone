# Architecture Decision Records

This directory contains ADRs (Architecture Decision Records) for clawphone — short documents that capture significant architectural decisions, the context that drove them, and the consequences that follow.

## Format

Each ADR follows the [Nygard format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):

- **Context** — what situation made a decision necessary
- **Decision** — what was chosen
- **Considered alternatives** — what else was evaluated and why it was rejected
- **Consequences** — what becomes true after this decision

## Immutability

ADRs are append-only. Once accepted, an ADR is never edited to reflect a change of mind. If a decision is reversed or superseded, a new ADR is written and the old one's status is updated to `Superseded by ADR-NNN`. This preserves the historical record of *why* past decisions were made.

Valid status values: `Draft` · `Accepted` · `Deprecated` · `Superseded by ADR-NNN`

## Index

| # | Title | Status |
|---|---|---|
| [001](./001-agent-adapter-abstraction.md) | Agent Adapter Abstraction | Accepted |
