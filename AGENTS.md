# Working in this repository

## This is NOT the Next.js you know

This project runs Next.js 16. APIs, conventions, and file structure differ from older training data:
`proxy.ts` replaces `middleware.ts`; `params`, `searchParams`, `cookies()` and `headers()` are async;
Turbopack is the build. Read the relevant guide in `node_modules/next/dist/docs/` before writing
Next.js code and heed deprecation notices.

## Ground rules

- Product name: **HOKU Insider**. Internal identifiers (repo `hoku-constellation`, domain
  `constellation.hoku.fm`, launchd labels `fm.hoku.constellation.*`, env and database names) keep the
  old name on purpose. Do not rename them.
- Colors: black, white, grays, and red for links. Define colors only in `app/globals.css`.
- Database access goes through `lib/db` (`Db` interface). Library functions take `Db` as the first
  argument. Route handlers and server components obtain it with `getServiceDb()` or `getUserClient()`.
- Ingestion code (`lib/import`, `scripts/import`, `workers`) never imports analytics code and vice versa.
- Every importer is idempotent: re-running on the same source data inserts zero documents and zero edges.
- Fetch politely: `lib/import/http.ts` only (identifying User-Agent, one request per second per host,
  robots.txt respected). Never work around a login, CAPTCHA, or terms of service.
- Tests: `npm test` (Vitest on PGlite). Add a fixture test for every parser or importer you write.
- Commit after each verified step; one commit per importer, message `ingest(<source-key>): <summary>`.
