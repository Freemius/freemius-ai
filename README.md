# Freemius AI Integrations and Skills

This repository contains practical resources for building with Freemius in
AI-assisted development workflows.

## What is included

1. Vibe coding platform integration examples
   - **Lovable**
     - [SaaS application with subscription-based feature access](./lovable-integration/subscription/README.md)
   - **Sticklight**
     - [SaaS application with subscription-based feature access](./sticklight-integration/subscription/README.md)
   - **Bolt**
     - [SaaS application with subscription-based feature access](./bolt-integration/subscription/README.md)
2. Shareable AI agent skills — in [`skills/`](./skills/)
   - **`freemius-core`** — server-side billing backbone (entitlement table,
     checkout creation, purchase processing, webhooks).
   - **`freemius-checkout`** — React checkout / pricing UI (Checkout Provider,
     Subscribe + Topup pricing tables, Paywall, custom buttons).
   - **`freemius-customer-portal`** — self-service subscription management
     (upgrade, cancel + retention coupon, billing, invoices).
   - **`freemius-troubleshooting`** — symptom → cause → fix diagnostics.
3. Runnable example — [`tech/hono/`](./tech/hono/)
   - **DocVault**, a Hono + React + Prisma SaaS built with these skills:
     server-side Freemius checkout, webhook-synced entitlements, a 402 paywall
     on a premium feature, credit/top-up metering, and a customer portal.

## Installing the skills

Install with the [Skills CLI](https://skills.sh/) (works with Claude Code,
Cursor, Codex, and 70+ agents).

```bash
# Install all skills into Claude Code
npx skills add https://github.com/freemius/freemius-ai -a claude-code

# Install a specific skill
npx skills add https://github.com/freemius/freemius-ai -a claude-code --skill freemius-core
```

`-a claude-code` targets Claude Code explicitly (it is **not** a default agent
in the interactive picker). Add `-g` for a global install (`~/.claude/skills/`,
available in all projects) and `-y` to skip prompts. You can also run
`npx skills add https://github.com/freemius/freemius-ai` for the interactive
agent picker.

Each skill is a directory under [`skills/`](./skills/) with a `SKILL.md` (YAML
frontmatter: `name`, `description`) plus a progressive-disclosure `references/`
folder.

## Running the example

```bash
cd tech/hono
npm install
cp .env.example .env   # fill Freemius keys + product/plan ids
npm run build
```

See [`tech/hono/README.md`](./tech/hono/README.md) for setup (env + Dashboard
config) and [`tech/hono/DEPLOY.md`](./tech/hono/DEPLOY.md) for deployment.

## Getting started

Start with the official
[Freemius AI documentation](https://freemius.com/help/documentation/ai/). Then
explore this repository as mentioned in the documentation itself.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md)
before opening a pull request.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).

## Support

For questions, bug reports, or suggestions, please open an issue in this
repository.
