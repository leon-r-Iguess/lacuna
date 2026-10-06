# Security

## How Lacuna handles your data

- API keys are stored locally in `.obsidian/plugins/lacuna/data.json` and are only sent to the provider they belong to.
- Note, PDF and image content is sent only to the AI provider you selected, only when you create or evaluate a quiz, update a progress note manually (error-pattern analysis) or build a topic list.
- There is no telemetry and no server of our own.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's
[private vulnerability reporting](../../security/advisories/new) instead.

If you accidentally posted an API key anywhere (issue, screenshot, commit), revoke it at your provider immediately and create a new one.
