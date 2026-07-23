# Stack & porting gotchas (Prisma, Vite, Hono)

The Freemius docs assume Next.js. The reference app runs on Hono + Vite +
Prisma, which surfaces a few predictable stumbles when porting.

## Prisma 7 dropped the classic `datasource url` — pin Prisma 6

**Symptom:** after installing the latest Prisma, `prisma generate` or the client
demands a **driver adapter**, rejects a plain `url = env("DATABASE_URL")` in the
`datasource` block, or errors at runtime about a missing adapter.

**Root cause:** Prisma 7 forces driver adapters and removed the classic
`datasource { url }` connection path. That's extra ceremony a simple prototype
doesn't need.

**Fix:** pin Prisma 6 for a straightforward Postgres prototype:

```jsonc
// package.json — the reference app uses these
"@prisma/client": "^6.3.0",
"prisma": "^6.3.0"
```

With Prisma 6 the familiar schema works as-is:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

If you must be on Prisma 7, you have to adopt the driver-adapter setup — out of
scope for the reference app, and unnecessary for this use case.

## `process.env.NEXT_PUBLIC_*` is `undefined` in the browser

**Symptom:** a frontend value read via `process.env.NEXT_PUBLIC_FOO` (or any
`process.env`) is `undefined` at runtime in the Vite app.

**Root cause:** Vite does not polyfill `process.env` in the browser and uses a
different public-env convention than Next.js.

**Fix:** use `import.meta.env.VITE_*`. Only `VITE_`-prefixed vars are exposed to
the client; **never** prefix a secret with `VITE_`. Freemius secret/API keys
stay server-side and are read with `process.env` in the Hono server only. See
`freemius-core` → `references/vite-hono-notes.md`.

## `@/...` / `@shared/...` import cannot be resolved

**Symptom:** Vite or `tsc` can't resolve an `@`/`@shared` path alias.

**Root cause:** the alias must be declared in **both** `vite.config.ts`
(`resolve.alias`) and the relevant `tsconfig` (`compilerOptions.paths`); having
it in only one place fails either the dev/build or the typecheck.

**Fix:** declare it in both. The reference app aliases `@shared` to `src/shared`
so server and web share `types.ts`. See `freemius-checkout` →
`references/vite-hono-porting.md`.

## The two server endpoints the Next.js docs hide

**Symptom:** porting a Next.js example, you can't find where the server pieces
go because the docs colocate them in route handlers / server components.

**Root cause:** on Hono there are two explicit server endpoints the Starter Kit
examples assume implicitly:

- `POST /api/checkout` (+ `GET /api/checkout/pricing`) — server-creates the
  `CheckoutSerialized` that primes the overlay, and serves pricing data.
- `GET|POST /api/portal` — the single headless Customer Portal endpoint (data +
  token-signed actions).

**Fix:** map Next.js "server data loading" → Hono routes; keep all SDK calls in
plain-TS services behind those routes. See `freemius-core` →
`references/vite-hono-notes.md` and `freemius-checkout` →
`references/vite-hono-porting.md`.

## Installed via `npx skills add` but Claude Code (CLI) can't see the skills

**Symptom:** you ran `npx skills add <source>`, the install reported success,
but Claude Code (CLI) doesn't list the skills and their slash commands are
missing.

**Root cause:** the installer asks **which agents to install to**, and its
"always included" default list **does not include Claude Code**. If you don't
explicitly select it, the skills land in the canonical `~/.agents/skills/` but
no symlink is created into `~/.claude/skills/`, so Claude Code never discovers
them (matches vercel-labs/skills #851).

**Fix:** re-run and explicitly select **Claude Code** in the agent prompt, or
pass it non-interactively:

```bash
npx skills add <source> -a claude-code                       # all skills
npx skills add <source> -a claude-code --skill freemius-core # one skill
```

When asked copy vs symlink, choose **Symlink** (recommended). If a skill is
still missing, symlink it manually:

```bash
ln -s ~/.agents/skills/<name> ~/.claude/skills/<name>
```

**Desktop is a different surface — the CLI route does not apply.** The
`npx skills add … -a claude-code` command targets **Claude Code only**. On
**Claude Desktop / the Claude.ai app** there is no CLI install: import each of
the four Skills independently as a per-Skill `.zip` via **Customize → Skills →
"+" → Upload a skill** (upload `freemius-core` first so the other three resolve
their references to it). Prerequisite: enable **Code execution & file creation**
under **Settings → Capabilities**. The two routes are not interchangeable.
