# Contributing

Thanks for your interest in improving this repository.

## What to contribute

We welcome:

- New or improved integration guides
- Fixes to examples, scripts, or docs
- Clarifications, typo fixes, and structural improvements

## Before you start

1. Open an issue for significant changes so we can align on scope.
2. Keep contributions focused and small where possible.
3. Prefer updates that are practical, reproducible, and easy to follow.

## Pull request guidelines

1. Fork the repository and create a focused branch.
2. Make your change with clear commit messages.
3. Update documentation when behavior or usage changes.
4. Submit a pull request with:
    - What changed
    - Why it changed
    - Any relevant screenshots or logs (if applicable)

## Style expectations

- Keep docs concise and actionable.
- Use clear headings and step-by-step instructions for guides.
- Prefer examples that are easy to copy and verify.

## VS Code setup

To keep formatting consistent across contributions:

1. Install the Prettier extension (`esbenp.prettier-vscode`).
2. Add these settings in your local VS Code user or workspace settings:

```json
{
    "[typescript]": {
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.formatOnSave": true
    },
    "[markdown]": {
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "editor.formatOnSave": true
    }
}
```

3. Enable `Format on Save` if it is disabled in your local user settings.

You can also run formatting from the command line:

- `npm run format`
- `npm run format:check`

## Reporting issues

When opening an issue, include:

- Expected behavior
- Actual behavior
- Reproduction steps
- Environment details (tooling/platform)

## Code of conduct

Be respectful and constructive in all discussions and reviews.
