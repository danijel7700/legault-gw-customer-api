Customer domain API. It sits **behind the private ALB** and is called by the auth API gateway, never
by the mobile app directly.

The gateway owns authentication: it validates the shopper's SLAS token and forwards the request with
the identity it resolved in headers — `x-brand` and `x-customer-id` — plus the shopper's SLAS access
token as `Authorization: Bearer`. This service authenticates nobody. It reads those headers, resolves
the brand's SFCC configuration, and calls SCAPI **as the shopper**, passing that token through
unchanged.

The API serves two brands — `rens` and `mondou` — backed by two separate SFCC instances.

Built so far: configuration, the middleware pipeline, error handling, per-brand SFCC config
resolution, health endpoints, the SFCC provider (Shopper Customers on a forwarded shopper token, plus
a SLAS guest-token client kept for future anonymous operations), and the customer module with one
endpoint — `GET /v1/member/profile`.

## Requirements

- Node `^20.9.0 || >=22`. `.nvmrc` pins 22 as the recommended version, but the whole toolchain —
  build, dev, lint, format — runs on Node 20.9+ as well.
- pnpm 10

## Running

```bash
pnpm install
cp .env.example .env

pnpm dev        # tsx watch, hot reload, pretty logs
pnpm build      # tsc -> dist/
pnpm start      # node dist/server.js
pnpm clean      # rm -rf dist

pnpm typecheck  # tsc --noEmit (src/, tests and drizzle.config.ts — one project)
pnpm lint       # eslint
pnpm format     # prettier --write
pnpm check      # typecheck + lint + format:check
pnpm test       # node:test against a real PostgreSQL — needs the DB_* block

pnpm db:generate  # drizzle-kit: schemas/ -> a migration
pnpm db:migrate   # apply pending migrations
pnpm db:studio    # browse the database
```

The `db:*` scripts need a reachable PostgreSQL and the `DB_*` block set — see
[The database layer](#the-database-layer) for local setup and the migration workflow.

## The API surface

| Endpoint                                 | Purpose                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `GET /health`                            | Liveness, for the load balancer. No brand, no version.                    |
| `GET /health/ready`                      | Readiness — can it reach PostgreSQL. No brand, no version.                |
| `GET /v1/health`                         | Which SFCC org this brand is pointed at. Needs `x-brand`.                 |
| `GET /v1/member/profile`                 | The shopper's profile. Needs `x-brand`, `x-customer-id`, `Authorization`. |
| `PATCH /v1/member/profile`               | Updates it. Same headers, plus a JSON body.                               |
| `POST /v1/member/addresses`              | Adds an address. Answers `201`.                                           |
| `PATCH /v1/member/addresses/:id`         | Updates one, renaming included.                                           |
| `DELETE /v1/member/addresses/:id`        | Removes one. Answers `204`.                                               |
| `PUT /v1/member/addresses/:id/preferred` | Makes one the preferred address.                                          |

All the `/member` routes take the same three headers.

```bash
curl -H 'x-brand: rens' -H 'x-customer-id: abk1p3xW9Yc5tRvQ' \
  -H "Authorization: Bearer $SHOPPER_ACCESS_TOKEN" \
  http://localhost:3000/v1/member/profile
```

```json
{
  "email": "ada.lovelace@gmail.com",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "phone": "514-555-5555",
  "birthday": "1815-12-10",
  "preferredLocale": "en",
  "postalCode": "A1B2C3",
  "preferredStore": "liberty-village",
  "addresses": [
    {
      "id": "9f8c1e02-4a3b-4c5d-8e6f-1a2b3c4d5e6f",
      "addressId": "Home",
      "address1": "1 Rue Sainte-Catherine",
      "address2": "Apartment 49",
      "city": "Montreal",
      "stateCode": "QC",
      "postalCode": "A1B2C3",
      "countryCode": "CA",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "fullName": "Ada Lovelace",
      "phone": "514 555 5555",
      "preferred": true
    }
  ]
}
```

**This is served from our own database**, not from SFCC — see
[The read-through](#the-read-through). Three consequences worth knowing:

- **No `paymentInstruments`.** Card data is deliberately not stored, so it cannot be returned.
  A field that appeared only on a cache miss would be worse than no field at all.
- **`preferredLocale` carries a bare language** (`en` / `fr`), not the SFCC locale (`en-CA`). The
  column is `$type<Language>()`; the locale is normalized on the way in and the original is not kept.
- **`postalCode` is stored uppercase without spaces** (`A1B2C3`), by `normalizePostalCode`. This
  applies to both the account-level `postalCode` and the per-address one. SFCC is left holding
  whatever the caller sent (`A1B 2C3`) — a write does not impose this store's format on a system
  other consumers read, so the two disagree on spacing by design.

Absent fields are omitted rather than sent as `null`; `addresses` is `[]` rather than missing when the
customer has none. In practice `birthday` and `preferredLocale` are unset on the dev orgs, so treat
those two as untested rather than reliable.

### Updating the profile

```bash
curl -X PATCH -H 'x-brand: rens' -H 'x-customer-id: abk1p3xW9Yc5tRvQ' \
  -H "Authorization: Bearer $SHOPPER_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"phone":"514-555-0000","phoneType":"home","preferredStore":"liberty-village"}' \
  http://localhost:3000/v1/member/profile
```

Answers `200` with the same body shape `GET` returns — the updated profile, no success envelope.

Every field is optional and follows one rule: **absent leaves the value alone, `null` clears it, a
value sets it.** `lastName` is no exception; the column dropped its `NOT NULL` in migration `0001`.
An empty patch is a `400`, as is a key the schema does not know — on a write, silently stripping a
misspelled field would answer `200` having changed nothing.

| Field            | Type                 | Notes                                                      |
| ---------------- | -------------------- | ---------------------------------------------------------- |
| `firstName`      | `string \| null`     | Trimmed, 1-40 chars. `''` and `'   '` are rejected.        |
| `lastName`       | `string \| null`     | Trimmed, 1-80 chars.                                       |
| `phone`          | `string \| null`     | See below.                                                 |
| `phoneType`      | `'mobile' \| 'home'` | Only meaningful beside a `phone`; alone it is a `400`.     |
| `postalCode`     | `string \| null`     | Sent to SFCC verbatim, normalized on the way to the store. |
| `preferredStore` | `string \| null`     | Free string — Rens uses slugs, Mondou store numbers.       |

**`phone` is a switch, not two fields.** The contract exposes one number where SFCC and the store
both keep two columns, so writing one clears the other: `phoneType: 'home'` sets `phoneHome` and
clears `phoneMobile`, and vice versa. Without that, the response mapper's `phoneMobile ?? phoneHome`
would keep handing back the number nobody just wrote. An absent `phoneType` means `mobile`, which is
the column that mapper prefers anyway. `phone: null` clears both, and a `phoneType` alongside it is
accepted and ignored — clearing has no direction.

Blank strings are rejected rather than stored: `null` is how a field is cleared, and `'   '` is
almost always a client bug. Note this is enforced by the write schema only — nothing normalizes
whitespace at the repository boundary, so a name arriving through SFCC provisioning is still stored
as sent.

### The address endpoints

```bash
curl -X POST -H 'x-brand: rens' -H 'x-customer-id: abk1p3xW9Yc5tRvQ' \
  -H "Authorization: Bearer $SHOPPER_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"label":"Home","firstName":"Ada","lastName":"Lovelace",
       "street1":"1 Rue Sainte-Catherine","city":"Montreal","stateCode":"QC",
       "postalCode":"H2X1Y4","phone":"514-555-1111"}' \
  http://localhost:3000/v1/member/addresses
```

`POST` answers `201` with the created address, `PATCH` and `PUT /preferred` answer `200` with the
updated one, and `DELETE` answers `204` with no body. All four move the customer's `version`, so the
ETag changes on an address write just as it does on a profile write.

**A `DELETE` can change which address is preferred.** Removing the preferred one promotes the oldest
remaining in its place, and the `204` carries no body to show it — re-read the profile to see which
address took over.

**`:id` is our own row id, not the SFCC address name.** It is the `id` on every address in the
profile response, and it is a uuid — the route rejects anything else with a 400 rather than looking
it up and finding nothing. The service translates it into the SFCC name when it calls upstream,
using the row it has to load anyway.

**The request says `label`, the response says `addressId`.** They are the same thing: the address's
name at SFCC, which is unique per customer. The asymmetry is deliberate — `addressId` is what the
profile response has always called it, and renaming that field would break every existing reader.

**`label` is editable, and changing it renames the address.** SFCC takes an `addressId` in the patch
body that differs from the one in the URL as a rename, and the local row's `sfcc_address_id` moves in
the same write. A name the customer already uses comes back as a **409**, not a 500.

| Field                                                                                   | POST                       | PATCH                  |
| --------------------------------------------------------------------------------------- | -------------------------- | ---------------------- |
| `label`, `firstName`, `lastName`, `street1`, `city`, `stateCode`, `postalCode`, `phone` | required                   | optional, not nullable |
| `street2`, `phoneType`                                                                  | optional, nullable         | optional, nullable     |
| `countryCode`                                                                           | optional, defaults to `CA` | optional, not nullable |

`PATCH` is three-state like the profile patch — absent leaves the value alone, `null` clears it, a
value sets it — but **only `street2` and `phoneType` can be cleared**. Clearing a city or a postal
code would leave an address nothing could be delivered to, so `null` on those is a 400.

Two things SFCC forces that the client is not made to know about:

- **Every address `PATCH` must carry `addressId`, `countryCode` and `lastName`**, changing or not.
  They are filled from the stored row, and a client-supplied value wins.
- **A `PUT /preferred` is that same `PATCH`** with `preferred: true`. SFCC has no dedicated endpoint
  and demotes the previous preferred address itself, so it is one upstream call. It does **not**
  promote a replacement when the preferred address is deleted, which is why that case sends a second
  `PATCH` of its own.

If the stored row is missing one of those three fields, the request is a **422** rather than a patch
padded with empty strings. It means the row was provisioned incompletely, which is a thing worth
finding out about rather than papering over.

### The inbound header contract

| Header          | Required | Meaning                                                                                          |
| --------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `x-brand`       | yes      | `rens` or `mondou`. Selects the SFCC instance.                                                   |
| `x-customer-id` | yes      | Opaque SFCC customer id, resolved by the gateway from the shopper token.                         |
| `Authorization` | yes      | `Bearer <shopper SLAS access token>`. Forwarded verbatim to SCAPI.                               |
| `Content-Type`  | on write | `application/json`. Without it Express 5 leaves `req.body` undefined and the schema answers 400. |
| `x-request-id`  | no       | Adopted if it matches `/^[\w.:-]{1,128}$/`, else one is minted. Echoed.                          |

All three required headers are the gateway's to inject, which is why they are validated at the edge
like any other untrusted input rather than trusted because they came from inside: a request that
reaches this service without them either bypassed the gateway or the gateway is misconfigured, and
both are 400s. That is also why a missing or malformed `Authorization` header is a **400**, not a
401 — a 401 would describe the shopper's session, and what actually went wrong is the call.

`x-brand` is resolved by `validateBrand` for every versioned route, so a handler only ever runs with
`req.brandConfig` already narrowed to a known brand. `x-customer-id` and `Authorization` are checked
by one zod schema over `req.headers` — the id non-empty, ≤ 128 chars, `[\w.~-]` only; the token
matched against `/^Bearer\s+\S+$/i`, ≤ 4096 chars, with the scheme stripped — and both reach the
controller as a single `CustomerIdentity`, so each header name exists in exactly one file.

A route that also has a body chains a second `validate(schema, 'body')`. The middleware writes each
source under its own key on `req.validated` rather than replacing what the previous call put there,
so `PATCH /profile` reads both back through `getValidated`.

**This service never verifies the token.** It has no JWKS fetch and no signature check, because SCAPI
verifies it on every call: a forged, expired or wrong-tenant token fails closed upstream. The same
property covers `x-customer-id` — SCAPI binds each my-account read to the customer inside the token,
so an id that does not match the bearer is refused rather than served (as a 404, not a 403; see the
error mapping). A spoofed header cannot read another shopper's profile even though this service
authenticates nobody.

Note the asymmetry with the auth API this service was forked from: **the brand is a header here, not
a path segment.** Routes are `/:version/...`, not `/:version/:brand/...`, because the caller is the
gateway rather than a client composing URLs.

## Configuration

`.env` is loaded by `src/config/load-env.ts` via `dotenv`, not by Node's `--env-file` flag. The flag
would be one less dependency, but it needs Node ≥ 20.12 and would put a version requirement in the
npm scripts; loading in code keeps `dev` and `start` running on any supported Node. Three rules:

- **Missing `.env` is fine for the variables that have defaults.** `NODE_ENV`, `PORT` and `LOG_LEVEL`
  all fall back, so no file is needed to start reading the schema — but the SFCC credentials and the
  `DB_*` block are required and have none, so a real boot needs them present.
- **The real environment wins.** A variable already set in the shell, or by ECS/Kubernetes,
  overrides the value in `.env` (`override: false`). Nothing in a stray file can shadow platform
  config.
- **Unknown keys are ignored.** zod strips anything not in the schema, so a stale entry in someone's
  `.env` cannot break startup.

`load-env.ts` runs its side effect on import and is imported by the two modules that read
`process.env` — `env.config.ts` and `shared/logger/logger.ts`. ESM evaluates a module's dependencies
before its body, so the file is always loaded before either reads a variable. That ordering matters:
`logger.ts` reads `LOG_LEVEL` at module load, well before `bootstrap()` runs, so calling a loader
from inside `bootstrap()` would be too late.

Variables are validated by `src/config/validations/env.validation.ts` at boot. An invalid value stops
the process before it listens, listing every problem at once:

```
Invalid environment configuration:
  - NODE_ENV: Invalid option: expected one of "development"|"test"|"production"
  - PORT: Invalid input: expected number, received NaN
```

Adding a variable is three edits: the name in `src/config/constants/env-keys.constant.ts`, a rule in
the zod schema, a field on `Config`. Nothing outside `src/config/`, `src/shared/logger/logger.ts` and
`src/database/config.ts` may read `process.env` — an ESLint rule enforces it.

The `DB_*` block is the one exception to that ritual: the keys are registered in
`env-keys.constant.ts` like everything else, but they are validated by `src/database/config.ts`
rather than by `envSchema`, and they do not appear on `Config`. The database layer needs to be
loadable by `drizzle-kit`, which runs outside the app process and has no business supplying SFCC
credentials to generate a migration. See [The database layer](#the-database-layer) — including why
`DB_*` cannot be resolved through `ssm-bootstrap`.

`NODE_ENV` deliberately does not encode the deploy environment. It has three values —
`development`, `test`, `production` — and drives log formatting, nothing else. Staging runs
`NODE_ENV=production` like any other real deployment; what makes it staging is the SFCC identifiers
it is given, not a value the code branches on.

**The env contract is unchanged from the auth API**, deliberately — same variables, same names, same
credentials, so the same SSM tree and task-definition shape work. Three of them are now accepted but
unused: `CORS_ORIGINS` (nothing browser-facing reaches this service behind a private ALB) and
`RENS_REDIRECT_URI` / `MONDOU_REDIRECT_URI` (only the SLAS PKCE login flow needed a redirect URI, and
that flow lives in the auth API). They stay required so a deployment cannot drift from the auth API's
configuration, and so restoring a SLAS flow here needs no config work.

### Where the values come from

The app reads `process.env` and nothing else. How the variables get there is an infrastructure
concern it does not encode:

- **Locally** — `.env`, loaded by `load-env.ts`. SSM is never contacted.
- **Staging / production** — `src/config/ssm-bootstrap.ts` resolves each variable from SSM
  Parameter Store at boot. `bootstrap()` awaits it before `loadConfig()` — the last point at which
  `process.env` can still be populated.

`resolveAppSsmSecrets()` is gated on `NODE_ENV === 'production'` and a set `APP_SSM_PREFIX`. The
`NODE_ENV` guard is the local-dev safety net: a developer who exports `APP_SSM_PREFIX` while running
terragrunt still cannot make their machine reach AWS. Three further properties are worth knowing:

- **Atomic apply.** Every parameter is fetched before any `process.env` write happens, so a failed
  batch leaves the environment untouched rather than half-applied — the boot then fails on a
  missing variable rather than starting with a partial config.
- **SSM wins.** If a variable is already set, the SSM value overwrites it and logs a name-only
  warning. This is the opposite of `load-env.ts`'s `override: false`, and deliberate: in production
  the parameter store is the source of truth.
- **Names only, never values.** Warnings and errors carry the env var and parameter name. A
  decrypted `SecureString` never reaches a log line.

The parameter name is the kebab form of the env key, built in the path itself — `RENS_SLAS_CLIENT_SECRET`
reads `${APP_SSM_PREFIX}/rens-slas-client-secret`. There is no separate name transform to keep in
sync; adding a variable to the list in `server.ts` is the only step.

| SSM type         | Parameters                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| **SecureString** | `rens-slas-client-id`, `rens-slas-client-secret`, `mondou-slas-client-id`, `mondou-slas-client-secret` |
| **String**       | `rens-short-code`, `rens-org-id`, `rens-site-id`, and the three `mondou-` equivalents                  |

Set as **literal env vars in the task definition**, not resolved from SSM: `APP_SSM_PREFIX`,
`AWS_REGION`, `NODE_ENV`, `PORT`, `LOG_LEVEL`, and the two redirect URIs.

The `DB_*` variables also come from the task definition — the plain ones in `environment`,
`DB_PASSWORD` in `secrets` so the ECS agent injects it from Secrets Manager. They cannot go through
`resolveAppSsmSecrets()`: the database layer parses its env at module load, which ESM evaluates before
`bootstrap()`'s body runs, so SSM resolution would come too late.

There is no `Dockerfile` and nothing under `.github/` in this repo yet — packaging and CI/CD are the
infrastructure team's and will land later.

## Per-brand SFCC configuration

Unchanged from the auth API, including the credentials themselves. Each brand has its own SFCC
instance, and dev, staging and production are three more, so every per-brand value is configuration:

- **Secrets in env** — the SLAS `clientId` / `clientSecret` pair per brand, required at boot.
- **Identifiers in env** — `shortCode`, `orgId`, `siteId` and `redirectUri`, as `RENS_SHORT_CODE`,
  `RENS_ORG_ID`, … per brand. Not sensitive, but environment-specific: an `orgId` is
  `f_ecom_blfp_dev` on dev and something else on staging. `getBrandIdentifiers()` assembles them from
  the validated config — a function rather than a constant, because `config` throws until
  `loadConfig()` has run and that module is evaluated long before.
- **All required, none defaulted** — a missing variable stops the process at boot. A default would
  let a typo in a task definition point production traffic at the dev SFCC org, which fails silently
  and looks like working software.
- **URLs derived once** — `buildBrandUrls()` in `src/config/brand.config.ts` is the only place SFCC
  URLs are assembled, so `scapiBaseUrl`, `slasBaseUrl` and `shopperCustomersBaseUrl` follow the
  identifiers automatically.

`Config.slas` and `Config.sfcc` are typed `Readonly<Record<Brand, …>>`, so adding a brand to `BRANDS`
is a compile error until its credentials and identifiers are wired. The resolved map is memoised on
first use, not built at import time — everything in it comes from `config`, which is only readable
after `loadConfig()`.

### Keeping credentials and PII out of logs and responses

- `toPublicBrandConfig()` — the explicit slice the health endpoint returns.
- `BrandConfig.toJSON()` — the actual guarantee for credentials. Redact paths only match a fixed
  depth, so a config nested three levels inside a log payload would slip past `*.clientSecret`.
  `JSON.stringify` honours `toJSON`, and both pino and `res.json()` go through it, so `clientId` and
  `clientSecret` cannot be serialised at any depth. They remain readable as properties, which is
  what the SLAS client needs.
- pino `redact` paths, in `src/shared/logger/constants/redact-paths.constant.ts` — the credential
  pair, `access_token`, and a **PII group** this service adds because it now handles customer data:
  `email`, `firstName`, `lastName`, `phone`, `phoneMobile`, `phoneHome`, `phoneBusiness`, `birthday`.
  `req.headers.authorization` was already listed before it carried a shopper token, so forwarding one
  needed no new path. `x-customer-id` is deliberately _not_ redacted — it is opaque and it is the
  correlation key you need when reading logs.
- **Array paths for the nested PII.** Once the profile carried `addresses`, the flat `*.field`
  wildcards stopped being enough: a street address sits at `addresses[0].address1`, which no
  fixed-depth wildcard reaches. Those are spelled out as `addresses[*].address1` and friends. pino
  validates these at construction, so a malformed path fails the boot rather than leaking silently.
  The `paymentInstruments[*].paymentCard` paths are now vestigial — the contract no longer carries
  them — but they cost nothing and would matter again if card data ever passed through.
- **The redact paths do not reach the store's shapes.** `birthDate`, `postalCode`, `street1`, `city`
  and an external id `value` (an email, when the id type is `placeholderEmail`) are all uncovered, and
  a `Customer` aggregate nests PII three levels deep where `*.field` cannot reach. This is why the
  repository and the service log identifiers only, and never attach a driver error as `cause` — a
  `DrizzleQueryError` message carries the failing SQL _and its bound parameters_.
- `SENSITIVE_KEY` in `src/providers/sfcc/constants/sfcc-http.constant.ts` — upstream error bodies are
  scrubbed key-by-key _before_ being flattened to a string, because pino's `redact` works on object
  paths and cannot reach inside a string that already exists. It matches on substrings, so `phone`
  covers all three phone fields and `card` covers the whole payment card; `address`, `postal` and
  `holder` were added alongside them.

## Health endpoints

Three, for three different audiences.

`GET /health` is the load balancer's. It is mounted at the root in `createApiRouter()`, ahead of the
`/:version` mount, and carries no brand, no version and no SFCC identifiers:

```
GET http://localhost:3000/health   ->   { "status": "ok", "uptime": 42 }
```

Unversioned on purpose — a target group must not be coupled to the lifetime of an API version, and
the per-brand response below is config that should not land in access logs every few seconds. A flat
200 is the honest signal: `bootstrap()` runs `loadConfig()` before `listen()`, so an open port
already proves configuration resolved.

`GET /health/ready` is readiness rather than liveness: it runs `SELECT 1` through the PostgreSQL pool
and answers `200 { "status": "ok", "database": "up" }`, or the standard `503` error envelope when the
database is unreachable. The pool connects lazily, so this is the first place a bad host or a wrong
password actually surfaces. Kept separate from `/health` deliberately — a target group must not
deregister a healthy task because the database blipped.

`GET /v1/health` is for humans — it resolves `x-brand` and echoes which SFCC instance that brand is
pointed at, the fastest way to confirm an environment is wired to the org you think it is:

```bash
curl -H 'x-brand: rens' http://localhost:3000/v1/health
```

```json
{
  "status": "ok",
  "version": "v1",
  "brand": "rens",
  "sfcc": { "shortCode": "a8vicfzo", "orgId": "f_ecom_blfp_dev", "siteId": "CA" },
  "timestamp": "2026-08-12T21:54:53.199Z"
}
```

## Request flow

A request enters the pipeline in `src/app.ts` and passes through, in order: **helmet** (security
headers), **cors**, **request-context** (mints or adopts an `x-request-id`, attaches a
request-scoped pino child logger, echoes the id on the response), **pino-http** (one structured
access-log line per request, correlated by that same id), the **JSON body parser** (100 kb ceiling),
and then the **API router**, which matches `/:version/...` and runs `validateVersion` and
`validateBrand` before dispatching to the router for that version — so a module controller only ever
executes with the version narrowed to `ApiVersion` and `req.brandConfig` resolved. `GET /health` is
the one exception, mounted at the root ahead of the version segment.

Anything unmatched falls to the **404 handler**, which throws a `NotFoundError` rather than
returning a response, and every error — thrown by a guard, rejected from an async handler via
`asyncHandler`, or raised by the body parser — converges on the **central error handler**, the only
place in the codebase that turns an error into a response. It logs the original error against the
request id, then replies with `{ error: { code, message, requestId, details? } }`: operational errors
(4xx, and upstream 502/503) keep their status and message, while anything non-operational becomes a
flat 500 with a generic message so internals never reach the caller.

Note that request-context and pino-http sit **ahead** of the body parser. `express.json()` rejects
malformed and oversized payloads by throwing, and nothing mounted after it runs for those requests —
with the parser first, every 400 and 413 came back with `"requestId": "unknown"` and produced no
access-log line at all.

## Boot sequence

`src/server.ts`, in this order:

1. `resolveAppSsmSecrets()` — a no-op unless `NODE_ENV=production` and `APP_SSM_PREFIX` is set.
   This is the last point at which `process.env` can still be populated before validation reads it.
2. `loadConfig()` — validates `process.env` with zod and freezes the result. Invalid config kills
   the process with every problem listed at once.
3. `createApp()` — builds the Express app. Does not listen, so tests can drive it in-process.
4. `listen()`, then `keepAliveTimeout` / `headersTimeout`, then SIGTERM/SIGINT handlers that drain
   connections with a 10 s force-exit backstop, then the PostgreSQL pool.

The app imports `config`, which throws if read before step 2.

**Step 0, before any of this:** ESM evaluates the module graph, and `src/database/config.ts` validates
the `DB_*` block as it is loaded. Missing database config therefore fails earlier than missing app
config — before step 1, so SSM cannot supply it. Constructing the pool opens no connection (`pg` dials
lazily), so a wrong host or password surfaces at `/health/ready`, not at boot.

Shutdown runs in the same order in reverse: the HTTP server stops accepting connections, in-flight
queries finish, then `closeDatabase()` drains the pool, then the process exits. ECS sends `SIGTERM` on
every deploy, so this path runs on every deploy.

Step 1 means the port is closed for the duration of the SSM round-trips, so a deployment needs a
health-check grace period. Step 4's timeouts are 65 s and 66 s: both must sit above the load
balancer's idle timeout (60 s on an ALB by default), because Node's 5 s default lets the balancer
reuse a connection the server has just closed — the usual source of intermittent 502s.

## Structure

Feature-first, with layer folders nested inside each module — NestJS's shape, Express's mechanics.
`shared/` is the single home for reusable code; a feature owns one directory. `providers/` is the
third kind of thing: adapters onto external source systems, one folder per system, reachable only
through a single entry point.

```
src/
  app.ts                            express app: middleware order, routes, error handlers
  server.ts                         entry point: ssm -> config -> app -> listen, shutdown

  shared/                           everything reusable
    constants/api.constant.ts       API_VERSIONS, BRANDS
    types/                          api, request-context, validation, error-response
    utils/                          api guards, async-handler, get-validated
    errors/
      constants/error-code.constant.ts
      http-error.ts                 base class + isHttpError
      client-errors.ts              400 / 401 / 403 / 404 / 409 / 413
      server-errors.ts              500 / 502 / 503
      index.ts                      barrel — the one import site for errors
    logger/
      constants/redact-paths.constant.ts
      logger.ts                     configured pino instance
    middlewares/                    request-context, validate, validate-version,
                                    validate-brand (x-brand), not-found, error-handler

  providers/
    sfcc/                           everything SFCC knows, and nothing outside knows it
      index.ts                      THE ENTRY POINT — getSfccProvider + SfccProvider
      sfcc.provider.ts              domain operations, composed from the clients;
                                    memoised per brand
      mappers/customer.mapper.ts    SCAPI shape <-> contract shape; drops the rest
      http/sfcc-http.ts             axios factory + upstream error normalisation
      clients/
        slas.client.ts              guest token: client_credentials, cached, single-flight
                                    (currently unreferenced — see below)
        customers.client.ts         Shopper Customers: the customer and address
                                    calls, shared error mapping, one-shot 409 retry
      constants/                    slas, customers, sfcc-http
      types/                        slas, customers, sfcc-http
      errors/                       sfcc-request (502), customer (mapped 4xx)
      utils/                        with-guest-token, upstream-status, basic-auth,
                                    scrub-sensitive, problem-slug

  database/                         PostgreSQL: the connection, not the data
    index.ts                        THE ENTRY POINT — db, closeDatabase, checkDatabaseConnection
    config.ts                       DB_* parsing; own zod parse so drizzle-kit can load it
    client.ts                       pg Pool + drizzle instance + drain + SELECT 1 probe
    schemas/                        table definitions, one folder per domain
      index.ts                      one line per domain
      customer/                     enums/ tables/ types/ utils/
    migrations/                     drizzle-kit output; committed, applied by db:migrate

  config/
    constants/                      env-keys, node-envs, log-levels, brand-identifiers
    types/                          env.types (Config…), brand.types (BrandConfig…)
    validations/env.validation.ts   zod schema for process.env
    load-env.ts                     .env -> process.env, on import
    env.config.ts                   loadConfig, getConfig, frozen `config`
    brand.config.ts                 per-brand SFCC config: URLs, resolution
    ssm-bootstrap.ts                SSM Parameter Store -> process.env, production only

  modules/
    customer/
      controllers/customer.controller.ts   thin: validated input -> service -> response
      services/customer.service.ts         read-through and the write-throughs
      validations/
        customer.validation.ts             zod: identity headers + the profile body
        customer-address.validation.ts     zod: the :id param + both address bodies
      types/customer.types.ts              THE CONTRACT: CustomerProfile, no SFCC
      mappers/
        customer.mapper.ts                 rows -> domain types
        customer-profile.mapper.ts         stored aggregate -> CustomerProfile
        sfcc-customer.mapper.ts            SFCC record -> upsert input / degraded response
        customer-update.mapper.ts          update request -> patch + SFCC update
        customer-address.mapper.ts         address requests <-> SFCC, the required-field fill
      routes/customer.routes.ts            /profile and /addresses
      index.ts                             module barrel — router + contract types
    health/
      controllers/ types/ routes/ index.ts

  routes/
    api.routes.ts                   version registry; mounts /:version
    v1.routes.ts                    the v1 surface: /health, /member

  types/express.d.ts                Request augmentation (ctx, validated, brandConfig)
```

File suffixes follow NestJS: `*.controller.ts`, `*.service.ts`, `*.validation.ts`, `*.middleware.ts`,
`*.constant.ts`, `*.types.ts`, `*.util.ts`, `*.error.ts`, `*.mapper.ts`, `*.config.ts`.

The splitting rule is uniform: **a module exports one main thing.** Constants go to `constants/`,
type declarations to `types/`, standalone helpers to `utils/`, error classes to `errors/`. Cohesive
class hierarchies stay together — the `HttpError` tree is one file, not ten.

Barrels exist only where they earn it: `shared/errors/index.ts`, `providers/sfcc/index.ts` and each
module's `index.ts`. There is deliberately no top-level `shared/index.ts`, which would pull the whole
tree into every importer and invite cycles.

## The customer module

### The contract

`src/modules/customer/types/customer.types.ts` is the API surface of this module, and it names
no source system:

```ts
interface CustomerProfile {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string; // phoneMobile ?? phoneHome, re-collapsed for the response
  birthday?: string;
  preferredLocale?: string; // a bare language: 'en' | 'fr'
  postalCode?: string; // account-level, from c_postalCode
  preferredStore?: string; // from c_preferredStore
  addresses?: CustomerAddress[];
}

interface UpdateMemberProfileRequest {
  firstName?: string | null; // absent leaves alone, null clears, value sets
  lastName?: string | null;
  phone?: string | null;
  phoneType?: 'mobile' | 'home'; // which column; setting one clears the other
  postalCode?: string | null;
  preferredStore?: string | null;
}
```

That file declares the module's contracts, and the distinctions matter:

- **`CustomerProfile`** — what both profile endpoints return, built from our own stored aggregate.
- **`UpdateMemberProfileRequest`** — what `PATCH /profile` accepts. Deliberately a subset of the
  profile: `email` and `birthday` are identity, not preferences, and changing them is not this
  endpoint's job.
- **`CreateMemberAddressRequest` / `UpdateMemberAddressRequest`** — the address bodies. They say
  `label` where the response says `addressId`; both mean the address's name at SFCC.
- **`SfccAddressCreate` / `SfccAddressUpdate`** — what the provider applies upstream, still in
  module vocabulary (`street1`, not `address1`).
- **`SfccCustomerRecord`** — what the SFCC provider reports, and what provisioning writes from. It
  keeps the identifiers the response omits (`customerId`, `customerNo`, `login`), the phones SFCC
  records separately, and the four `c_*` attributes Core stores, renamed to `postalCode`,
  `preferredStore`, `sfscAccountId`, `sfscPersonContactId` and address `phoneType` so no
  SFCC-instance naming survives the boundary.
- **`SfccCustomerUpdate`** — the write-direction mirror of the record: the patch the provider applies
  upstream, with the single `phone` already expanded into the two columns SFCC keeps apart. Declared
  here with the consumer for the same reason the record is — the provider does not get to define the
  shapes it is handed.

The provider returns the record; shaping it into a response is this module's business, not the
provider's. That split is what lets the response be served from the database while the record stays
faithful to SFCC.

`phone` collapses three SFCC fields into one _for the response only_ — the store keeps `phone_home`
and `phone_mobile` in separate columns. The Customer object carries `phoneMobile`, `phoneHome` and
`phoneBusiness` separately and a profile may fill in any of them; the mondou dev customers use
`phoneMobile` and leave `phoneHome` empty, which is how reading a single field turned into a phone
that silently vanished. First one set wins, mobile first.

The write direction is the same collapse run backwards, and it is why `PATCH` clears the column it
did not write. If `phoneType: 'home'` only set `phone_home`, the `phoneMobile ?? phoneHome` above
would keep returning the old mobile — the caller would move their number and read back the one they
replaced, forever, because a cache hit never refreshes. That expansion lives in
`mappers/customer-update.mapper.ts`, next to the collapse it inverts, and not in the provider: the
provider has no way to see why one number becomes two.

`CustomerAddress` is declared alongside. Its mapper exists for the same reason as the top-level one:
SFCC types `addressId` as optional, but it names the entry, so the contract makes it required. Note
the store does the opposite — `sfcc_address_id` is nullable there precisely so that
`customer_address_sfcc_id_uq` (partial on `IS NOT NULL`) does not collide every unidentified address
on `('', customerId)`.

It carries **two** ids, and they are not interchangeable: `id` is our row id and what the address
endpoints take in the URL, while `addressId` is the SFCC name a caller sets through `label`. `id` is
optional on the contract because the degraded paths — the profile read that could not provision, and
an address write SFCC accepted but we failed to store — map from an SFCC record with no row behind
it. Omitting the field there is honest; inventing one would not be.

**Payment instruments are no longer part of the contract.** They were, when every request went
straight to SFCC. Now that the response is served from our database and card data is deliberately not
stored, the field cannot be produced on a hit — and a field that appeared only on a miss would be
worse than none. `CustomerPaymentCard` / `CustomerPaymentInstrument` and their mappers are gone;
`GetCustomerResponse` still declares `paymentInstruments` because SCAPI does send it, and we simply
stop mapping it.

What SFCC also returns and this API **does not**:

- **`hashedLogin`, `hasPassword`, `authType`, `enabled`** — credential and account-state internals.
- **`lastLoginTime`, `previousLoginTime`, `lastVisitTime`, `previousVisitTime`, `creationDate`,
  `lastModified`** — behavioural telemetry the caller has no use for.
- **`c_phoneType` on addresses, `c_defaultCard` / `c_issuerId` / `c_maskedCreditCard` on payment
  instruments** — the same `c_*` rule applies inside the nested objects. The standard `paymentCard`
  fields already carry the masked number and last digits, so nothing is lost by dropping the custom
  duplicates.
- **`gender`, `salutation`, `title`, `jobTitle`, `companyName`, `note`** — unused or sensitive;
  `note` is an internal CSR field that can contain free text about the customer.
- **Most `c_*` custom attributes** — unbounded and instance-specific; forwarding them wholesale would
  make the public contract a function of SFCC configuration. A live mondou profile carries nine
  (`c_mPOSID`, `c_postalCode`, `c_preferredStore`, `c_sscid`, `c_ssccid`, `c_sscSyncStatus`,
  `c_sscSyncResponseText`, `c_CCRateLimiterCount`, `c_CCRateLimiterTimestamp`). Four are mapped and
  **renamed** on the way through — `c_postalCode`, `c_preferredStore` and the two SFSC ids — so the
  contract names none of them. The rest are sync bookkeeping and rate-limiter state, none of it a
  shopper's business.

The omission is enforced twice: `GetCustomerResponse` in `providers/sfcc/types/customers.types.ts`
never declares those fields, and `toCustomerProfile` builds its result field by field — including the
nested `toCustomerAddress`, `toPaymentInstrument` and `toPaymentCard`. A `...response` spread anywhere
in the mapper would defeat both, as would a `console.log(response)`: that prints the whole payload,
`hashedLogin` and all, past every redact path in the service.

`customerId` is an **opaque, provider-issued identifier** — a string key with no structure to parse.
`customerNo` is _not_ opaque and looks it: `DEV_MND_00114027` bakes in environment, brand and sequence.
Treat it as a display string, never as something to parse or match on. The client throws a 502 if a
response arrives without a `customerId` at all, which is the assertion that SFCC returned a real
customer rather than an empty 200.

### The read-through

`getCustomer` reads our own database first and calls SFCC only when we hold no record:

```
findByExternalId(brand, 'SFCC', 'customerId', x-customer-id)
  hit  -> map the stored aggregate to CustomerProfile, return.  No SFCC call at all.
  miss -> provider.getCustomer() -> toUpsertInput() -> repo.upsertFromSfcc() -> return
```

The lookup key is the `x-customer-id` header, resolved through
`customer_external_id_uq` as an index-only scan — the index whose hand-written
`INCLUDE (customer_id)` exists for exactly this query.

`upsertFromSfcc` rather than `create`: it is built for lazy provisioning and already handles two
first-time requests racing, via a savepoint and a single re-resolve.

**What provisioning writes.** The profile, every address SFCC returned, and up to four external ids:

| System | idType            | Source                                                                   |
| ------ | ----------------- | ------------------------------------------------------------------------ |
| `SFCC` | `customerId`      | the `x-customer-id` header — the authenticated identity, not the payload |
| `SFCC` | `customerNo`      | `customerNo`                                                             |
| `SFSC` | `accountId`       | `c_sscid` — Mondou in practice                                           |
| `SFSC` | `personContactId` | `c_ssccid` — Mondou in practice                                          |

A Ren's customer therefore usually gets two, a Mondou customer four. Absent ids are not written.

**What has no SFCC source and stays null:** `gender` and `salutation` — both SFSC-sourced, and no
amount of widening the provider produces them. The account-level `postal_code` used to be on this
list; it now comes from `c_postalCode`. `birth_date` and `language` come from `birthday` /
`preferredLocale`, which the README notes are unset on the dev orgs.

**A read never refreshes on a hit.** A profile edited in SFCC after provisioning will not be
reflected by `GET`. That is deliberate for now — a TTL or an explicit refresh endpoint is a separate
decision, not a side effect of reading. `PATCH` is the one thing that updates a stored row: it
refreshes the fields it was given, and on the provisioning branch it writes the whole record.

**A missing `lastName` is stored as NULL, not rejected.** `customer.last_name` is nullable
(migration `0001`) because SCAPI types it optional, and a customer we cannot name is still a customer
we have to be able to store. Note that nothing normalizes whitespace at this boundary: a `lastName`
of `'   '` arriving from SFCC is stored verbatim, so "SFCC sent nothing" and "SFCC sent spaces" are
two different states here. Only the `PATCH` schema rejects blanks, and only for values a client
sends.

**If the database write fails**, it is logged at `error` and the SFCC data is served anyway. The
caller asked for a profile and we have one; provisioning is a side effect of answering, so an Aurora
blip must not take down a read that could be served. The next request retries the write.

### The address writes

All four run the same three steps: **resolve the customer, call SFCC, mirror locally.**

The resolve is a read — `resolveStoredCustomer`, the read-through above with the response mapping
stripped off. It comes first because the `:id` is ours and SFCC only knows the address by name, and
because `POST` needs the customer row to exist before anything can hang off it. A shopper who has
never fetched their profile is provisioned here rather than getting a spurious 404. The aggregate
eager-loads its addresses, so translating `:id` costs no extra query — the row is already in hand,
and a `:id` that is not in it is a 404.

**A local failure does not fail the request** — the opposite of the profile write, deliberately.
There, a stored row that contradicts the 200 would be served by every subsequent read, forever. Here
the change did land upstream, rolling it back is not an option, and the next profile read
re-provisions from SFCC if the row is stale. So the failure is logged and the endpoint answers from
what SFCC reported.

That log line is careful about one thing: **it never carries the request body or a raw driver
error.** A drizzle failure puts its bound parameters in the message, and on this path those are the
customer's name, street and phone. Only an error we authored is passed through as `err`; anything
else is reduced to its name and pg code, which still separates a unique violation from a dropped
connection.

`PATCH` and `POST` both mirror **from the SFCC response, never from the request**. The response
carries the whole address while a patch carries only what changed, and the address write is a full
replacement — a patch-shaped input would null every field the caller left alone. The one field that
needs care is `preferred`: SFCC omitting it would demote the row, so it falls back to the stored flag
on an update and to `false` on a create.

`DELETE` is idempotent at both ends. SFCC answering 404 counts as removed — it is the state that was
asked for — and `repo.deleteAddress` already ignores a row that is not there, moving the version only
when something actually was.

**Deleting the preferred address promotes the oldest one left**, in the same transaction as the
delete, so a shopper who removes their default gets a new one rather than none. The promotion is then
mirrored to SFCC with a `PATCH preferred: true`, because SFCC demotes a previous preferred on an
explicit promote but has no notion of choosing a replacement on a delete — a replacement we picked is
ours to announce. That mirror is **best-effort**: the delete already succeeded and owes a 204, and
the update mapper throws a 422 for a row stored without the fields SFCC demands, so failing a good
delete with a 422 about a _different_ address would be indefensible. A failure is logged and the two
disagree until something re-provisions.

The repository is bound to `db` here, in a lazy module-level memo mirroring `getSfccProvider` and
`getBrandConfigMap`. `createCustomerRepository(db)` has exactly one production call site, which is
what keeps the repository itself injectable and testable against a scratch database.

### The write-through

`updateProfile` runs the read-through backwards — upstream first, then the store:

```
provider.updateCustomer(identity, toSfccCustomerUpdate(request))   <- SFCC refuses => nothing local changed
findByExternalId(brand, 'SFCC', 'customerId', x-customer-id)
  hit          -> repo.updateProfile(id, patch, { modifiedBy: 'CORE_API' })
  miss         -> repo.upsertFromSfcc(toUpsertInput(..., record))
                    created     -> done; a fresh row has nothing to clear
                    not created -> repo.updateProfile(id, patch, ...) as well
```

**SFCC is written first** because it is the system of record. If it refuses, nothing here has changed
and the caller sees why.

**The store patch is derived from the request, not from what SFCC echoed back.** A response-derived
patch cannot tell a field SFCC cleared from one it never had, nor from a custom attribute this site
silently dropped — and that last case would write NULL over a value the caller had just asked to set.
The request maps 1:1 onto `buildProfilePatch`'s contract, which is what that function exists for.

**Why the miss branch can still need a second write.** `upsertFromSfcc` does not mean "create": it
resolves by external id, then by email, and only then inserts. A customer provisioned by
`MOBILE_APP` with no SFCC link yet lands on the email branch — an existing row. That path runs
`buildUpsertProfileSet`, whose `!= null` guards **cannot clear a column**, so every field the request
asked to clear would quietly keep its old value. The follow-up `updateProfile` applies the exact
patch semantics. It costs one extra version bump on a path that runs at most once per customer.

**`modifiedBy` is `CORE_API`, not `SFCC`.** The change came through this API; SFCC is a second sink
we also wrote to. That keeps `lastModifiedBy = 'SFCC'` meaning what it means everywhere else — an
SFCC-sourced refresh. `source` is never touched by an update, so the row's origin survives either
way.

**If the database write fails, the request fails** — the opposite of the read path, deliberately.
There, provisioning is a side effect of answering a question we can already answer. Here a `200`
would claim a change that the very next `GET` contradicts, permanently, because a read never
refreshes on a hit. `PATCH` is idempotent, so the honest error is also the actionable one: a retry
converges both systems. The failure is logged saying exactly that — SFCC accepted the update and the
store did not — and the original error is rethrown unchanged, so a `404`/`409`/`412` from the
repository keeps its meaning.

## The SFCC provider

`src/providers/sfcc/` is an adapter onto SFCC as a third-party system, not onto "auth" or "customer".
Everything SCAPI — URLs, snake_case field names, tokens, RFC 7807 problem slugs — lives inside it, and
the rest of the app imports exactly one thing:

```ts
import { getSfccProvider } from '../../../providers/sfcc/index.js';

interface SfccProvider {
  getCustomer(identity: CustomerIdentity): Promise<CustomerProfile>;
}
```

`CustomerIdentity` carries both the `customerId` and the shopper's `accessToken`, and — like
`CustomerProfile` — it is the consumer's type, declared in `modules/customer/types/`.

Four layers, each with one job:

- **`modules/customer/`** — routes, the header schema, a thin controller, and a service that resolves
  the brand's provider and delegates. No SFCC vocabulary, no upstream error handling.
- **`sfcc.provider.ts`** — the domain operations, composed from the clients. Memoised per brand in a
  module-level `Map`, which is what makes the axios instances — and the guest-token cache, when
  something uses it again — outlive a single request.
- **`clients/`** — one file per SCAPI API. Each exports an interface plus a `createXClient(brandConfig)`
  factory returning closures over an axios instance; the request functions are module-private. No
  classes.
- **`mappers/`** — pure wire-shape → contract translation, dropping everything the contract does not
  expose.

Note the direction of the dependency: the **contract types live with the consumer**
(`modules/customer/types/`), not the implementation. The provider has no say in the shapes it must
return, so it cannot widen what the API exposes.

Two things keep the boundary from eroding:

```bash
# 1. Nothing outside providers/sfcc/ (and config/, which owns the credentials and URLs) names an
#    SFCC concept.
grep -rniE 'slas|scapi|phonehome|guest_?token|shopper' src --include='*.ts' \
  | grep -v 'src/providers/sfcc/' | grep -v 'src/config/'
# -> empty
```

2. An ESLint `no-restricted-imports` rule fails the build on any import of `providers/sfcc/*/**` from
   outside the provider folder, so `index.ts` and `sfcc.provider.ts` are the only reachable modules.
   The grep is a check; the lint rule is the enforcement.

### Which token calls SCAPI, and why it is the shopper's

`getCustomer` runs on the **shopper's own SLAS access token**, forwarded by the gateway. Not a token
this service mints — and this is a constraint of SCAPI, not a preference.

SLAS packs shopper identity into the access token's `isb` claim:

```
uido:ecom::upn:<login>::uidn:<name>::gcid:<guestId>::rcid:<registeredId>::chid:<site>
```

SCAPI enforces that the `{customerId}` in the path is the customer bound to the token. A
`client_credentials` guest token carries a `gcid` and **no `rcid`** — measured on the rens dev org, a
guest token's claim is exactly:

```
uido:slas::upn:Guest::uidn:Guest User::gcid:abxbEWkHIUwXcRw0tFlqYYwHdG::chid:CA
```

So it can never match a registered customer id, and no scope grant changes that — the scopes on that
same token (`sfcc.shopper-customers.login sfcc.shopper-standard sfcc.shopper-customers.register`) are
already the ones `getCustomer` needs. `POST /customers` (registration, in the auth API) is the
deliberate exception: it exists to be called by an anonymous shopper, which is why a guest token is the
correct token _there_ and useless _here_. Every my-account endpoint likely to follow — addresses,
payment instruments, product lists, baskets, orders — reads the same way.

**The failure is disguised, which is what makes it cost an afternoon.** SCAPI does not answer 401 or
403 for this. A guest token against a registered customer id returns `400 invalid-customer`, which
this service's mapper — correctly, for its own reasons — turns into **404 `CUSTOMER_NOT_FOUND`**. So
the symptom is "customer profile not found" for a customer that plainly exists. A guest token against
its _own_ `gcid` returns `404 customer-not-found`, because a guest leaves no retrievable profile
either. Neither response mentions tokens.

So the provider passes the forwarded token straight to the client and does **not** retry:

- **No token cache, no single-flight, nothing to refresh.** Each request brings its own credential.
  This service cannot refresh a token it did not issue, so a 401 is the caller's to resolve — see the
  error table below.
- **`clientId` / `clientSecret` are not used on this path.** They authenticate the guest grant only.

### The guest-token client is still here, and currently unused

`clients/slas.client.ts` and `utils/with-guest-token.util.ts` remain in the tree and are referenced by
nothing. They are kept, not dead-ended: registration and password-reset are the operations that
legitimately need a guest token, and both are plausible additions here. The grant is already verified
against both brands, and the env contract keeps `<BRAND>_SLAS_CLIENT_ID` / `_SLAS_CLIENT_SECRET`
required regardless, so deleting the client would buy no config simplification and cost a rewrite.

What they give you when that day comes: `POST {slasBaseUrl}/token` with `grant_type=client_credentials`
and Basic auth `clientId:clientSecret`, cached until `expires_in` minus 60 s
(`TOKEN_EXPIRY_SKEW_MS`, falling back to 1800 s), single-flight on a cold cache, and a one-shot
force-refresh on a 401 via `withGuestToken`. All state lives in the closure returned by
`createSlasClient`, which the per-brand provider memoisation keeps alive across requests. A rejection
on that token call is always a 502: the grant sends no shopper credentials, so a 401 can only mean
this service's own SLAS client is misconfigured.

### Error mapping for the customer and address calls

SCAPI errors are RFC 7807 problem+json, and the `type` URI's last segment is the stable key — the
HTTP status alone is not enough. `problemSlug()` extracts it.

| Upstream                                                                      | This API returns             |
| ----------------------------------------------------------------------------- | ---------------------------- |
| slug `invalid-customer` / `customer-not-found` / `resource-not-found`, or 404 | **404** `CUSTOMER_NOT_FOUND` |
| 401                                                                           | **401** `UNAUTHORIZED`       |
| 403                                                                           | **403** `SFCC_ACCESS_DENIED` |
| 400, or slug `invalid-customer-id` / `invalid-request-parameter`              | **400** `BAD_REQUEST`        |
| slug `address-already-exists` — address writes, **no retry**                  | **409** `CONFLICT`           |
| 409 or slug `concurrent-modification`, **after one retry** (writes only)      | **409** `CONFLICT`           |
| 404 on an address `DELETE`                                                    | **204** — already removed    |
| 5xx, timeout, connection error                                                | **502** `UPSTREAM_ERROR`     |

The first four rows are `mapCustomerError`, shared by every verb: a read and a write fail identically
for a missing customer, an expired token, a refused scope and a malformed id, so it is one table
rather than several that drift.

**The 409 rows are the writes' own, and the order between them matters.** SFCC guards the customer
with its own optimistic lock, so a write can lose to a concurrent one — an order placement, a SFSC
sync. That is transient by definition, so the write is reissued exactly once. A second collision is
real contention and 409 is the honest answer; a loop would just hold the request open while something
else keeps winning. Same shape as the repository's one-shot re-resolve and `withGuestToken`'s
one-shot 401 refresh.

A rename collision arrives as a 409 too, which is why `isRenameConflict` is checked **first** and
matches on the slug alone: a bare status check would send a name collision into the retry, where it
collides again to no purpose. It is a permanent condition, so it maps straight to a 409 the caller
can act on.

**A 404 on an address `DELETE` is success.** The address is gone, which is what was asked for, and
this is the one place the shared 404 row is deliberately not applied — the same idempotency the local
delete already has.

Three of the rows above are worth explaining.

**`invalid-customer` maps to 404, not 400.** SFCC answers `400 Invalid Customer` — not 404 — for a
customer id that does not resolve. The id has already passed a format check at the edge by the time
the call is made, so "SFCC will not resolve this id" is far more useful to the caller as a 404 than
as a generic bad request. Verified against the rens and mondou dev orgs.

**401 and 403 are deliberately not collapsed**, and this reversed when the bearer became the shopper's
token. While the call went out on this service's own guest token, both had to become 403: a 401 would
have told the gateway the shopper's session was dead when the token SFCC rejected was _ours_. Now the
401 is the useful one — it means a dead or expired shopper session, and the gateway should refresh or
re-login. Verified end to end: a syntactically valid but bogus bearer produces an upstream 401 and this
service answers `401 UNAUTHORIZED`.

The 403 row is **not the mismatch case**, and on the write path it is now genuinely reachable. An
`x-customer-id` that disagrees with the token does _not_ come back as 403 — SCAPI answers
`400 invalid-customer`, so a mismatch lands on the 404 row above. 403 means a real SFCC refusal, and
for `PATCH` the overwhelmingly likely cause is the missing my-account write scope on the SLAS client
(see [Extending it](#extending-it)). Do not read a 403 from this service as "wrong customer id."

SFCC's own `detail` is never forwarded to the caller in any of these cases; it goes to the logs via
`upstreamBody`.

### What is verified against live SFCC, and what is not

Probed against the rens and mondou dev orgs with the real SLAS credentials:

- **The guest-token grant works on both brands.** `client_credentials` returns an `access_token` with
  `expires_in: 1800`.
- **`shopperCustomersBaseUrl` is correct** and `GET /customers/{customerId}?siteId=…` is reached.
- **Caching and single-flight work** on the guest-token client. Four requests, one token fetch; three
  concurrent requests on a cold cache produce one `/token` call.
- **An unresolvable customer id comes back as `400 invalid-customer`**, which is what the 404 mapping
  above is built on.
- **No credential or PII value reaches a log line.** The forwarded bearer never appears in the access
  log — `req.headers.authorization` was already in `REDACT_PATHS` before it carried a shopper token, so
  the new header needed no redaction work. Only the field name and the validation message do.
- **A guest token cannot read a registered customer's profile — resolved.** This was the one open
  question in the original build, and the answer is no, for a structural reason rather than a
  configuration one. Measured directly against the rens dev org: the guest token's `isb` has no `rcid`,
  and `getCustomer` answers `400 invalid-customer` for a registered id and `404 customer-not-found` for
  the token's own `gcid`. The scopes were never the problem.
- **The header contract and the 401 mapping work end to end.** Missing `Authorization` → 400 naming
  `authorization`; a non-Bearer value → 400 `must be a Bearer token`; a bogus Bearer → upstream 401 →
  **401 `UNAUTHORIZED`**.

Still unverified:

- **A 200 on the happy path.** Every failure mode above is confirmed, but no registered shopper's
  profile has been read through this service yet — that needs a real login. `sfcc-slas/scripts/whoami.js`
  performs one and prints both the access token and the resolved `customerId`; feed those to the curl
  in [The API surface](#the-api-surface). The `sfcc-slas` POC does call `getCustomer` successfully with
  a registered token against both dev tenants, so the remaining risk is in this service's wiring, not in
  the SCAPI contract.
- **What a mismatched `x-customer-id` returns for a _registered_ token.** Expected to be
  `400 invalid-customer` → 404, matching the guest-token result, but not yet measured. It fails closed
  either way; only the status shape is in question.
- **Every write path — the profile `PATCH` and all four address endpoints.** Nothing has reached SFCC
  yet, because the dev SLAS clients lack the my-account write scopes — every attempt returns 403
  until those are granted. Four specific unknowns behind it:
  - **The SCAPI rename-conflict slug.** `ADDRESS_ALREADY_EXISTS_SLUGS` carries two plausible
    spellings and the 409 status is the backstop, but neither has been seen from a real tenant. If
    the real slug is a third spelling, a rename collision goes through the concurrent-modification
    retry once before still ending up a 409 — wasteful, not wrong.
  - **The clear sentinel.** `null` is what OCAPI documents for custom attributes; whether it clears a
    _standard_ field or comes back as a type violation is unmeasured, and it decides whether clearing
    works at all. It is isolated to `CLEAR_VALUE` in `providers/sfcc/mappers/customer.mapper.ts` plus
    one assertion in that mapper's test, so flipping it to `''` is a one-line change that fails the
    test first.
  - **Whether `c_postalCode` is defined on both sites' customer object.** If it is not, SFCC accepts
    the patch and silently drops the attribute. The service logs nothing about that today.
  - **The `concurrent-modification` slug.** The 409 status is documented; the exact slug SCAPI sends
    is a guess, so `CONCURRENT_MODIFICATION_SLUGS` carries both spellings. The status row catches it
    regardless.

## The database layer

PostgreSQL (Aurora in every deployed environment) through [Drizzle ORM](https://orm.drizzle.team), in
`src/database/`. The connection, the tooling and the customer schema live here — one `pg` pool, one
Drizzle instance, a readiness probe, a shutdown hook, the drizzle-kit scripts, and the table
definitions. No repositories and no queries yet: nothing in here reads or writes a row.

```
database/
  index.ts      THE ENTRY POINT — db, closeDatabase, checkDatabaseConnection
  config.ts     DB_* parsing and validation; fails fast at module load
  client.ts     pg Pool + drizzle instance + drain + SELECT 1 probe
  schemas/      table definitions, one folder per domain
    index.ts    one line per domain — the barrel drizzle() and drizzle-kit read
    customer/   enums/ tables/ types/ utils/, each behind its own barrel
  migrations/   drizzle-kit output; committed, applied by db:migrate
```

### Schemas are grouped by domain

`schemas/customer/` is the shape every domain follows: `enums/`, `tables/`, `types/`, `utils/`, each
with an `index.ts`, and a domain barrel re-exporting all four. Imports elsewhere go through a folder,
never at an individual file.

**Adding a domain** — `loyalty/`, `pets/` — is a new folder plus one line in `schemas/index.ts`. It is
invisible to both `drizzle()` and drizzle-kit until that line exists, because `drizzle.config.ts`
points at a single file rather than a glob. Nothing else is edited: no shared enum file, no central
table registry.

Within a domain, **one file per table** (`customer.table.ts`), with `relations()` in
`tables/relations.ts`. Enums live in exactly one place — `enums/` — and are imported both by the tables
for `$type<T>()` and by the hand-written interfaces in `types/`. There is deliberately no second set
of enums under `types/`.

`types/` holds the domain interfaces the API layer will speak, decoupled from Drizzle, plus
`inferred.types.ts` for the `InferSelectModel` / `InferInsertModel` row aliases. Stored fields are
`| null`, never `?` — in the store a field always exists, it may have no value; `?` is reserved for
update DTOs, where `undefined` means "don't touch" and `null` means "clear".

Note `Brand`, `CustomerProfile` and `CustomerAddress` exist both here and in
`src/modules/customer/types/` — the latter is the SFCC-facing API contract with different nullability.
They never collide in practice because imports are per-folder; a mapper that needs both aliases on
import. `brand` deliberately stores the same lowercase `'rens' | 'mondou'` as the `x-brand` header, so
there is no case mapping anywhere.

### Enums are `text`, never `pgEnum`

Every enum column is `text('col').$type<Language>()` with the union defined in `enums/`. Adding a value
to a Postgres enum is painful in a migration, and these lists will grow — `EXTERNAL_SYSTEMS` already
has NAV and SFMC entries that are not in use yet. With `text`, a new value is a code change and no
migration at all. TypeScript `enum` is separately ruled out: `erasableSyntaxOnly` rejects it, so the
`as const` idiom is mandatory here as everywhere else in the repo.

The one column left untyped is `customer_external_id.id_type`. `EXTERNAL_ID_TYPES` enumerates the
known values and `ExternalId.idType` uses that union, but the column stays plain `text` so the NAV and
SFMC types can start arriving without a schema change.

### The partial indexes, and one hand-written index

Four indexes carry real semantics, and they live in the table files' array callback:

| Index                           | Enforces                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `customer_brand_email_uq`       | one customer per brand per email, `WHERE email IS NOT NULL` so NAV in-store members with no email coexist |
| `customer_external_id_uq`       | the identity map the whole service resolves through                                                       |
| `customer_address_preferred_uq` | one preferred address per customer, `WHERE is_preferred`                                                  |
| `customer_address_sfcc_id_uq`   | no duplicate address rows on re-sync, `WHERE sfcc_address_id IS NOT NULL`                                 |

**`customer_address_preferred_uq` is a unique _index_, and Postgres cannot defer one to commit
time.** That is why every preferred swap clears the old flag before setting the new one, inside a
single transaction — the ordering is a correctness requirement, not a style choice. When
`setPreferredFlag` finds no such row `setPreferredAddress` throws, which rolls the clear back with it,
so a bad id cannot strand a customer with no preferred address at all.

A delete of the preferred row promotes a replacement in that same transaction, and needs no clear
first — the delete has already freed the index. Doing it as a second round trip would leave a window
with no preferred address and could race another writer.

**The replacement is the oldest remaining, by `created_at` then `id`.** The second key is
load-bearing rather than defensive: `defaultNow()` is `now()`, which in Postgres is the _transaction_
timestamp, so every address written by one `create` or one provisioning run carries an identical
`created_at`. Without a tiebreak the winner would vary between runs. Among tied rows a random uuid is
arbitrary, but it is at least the same answer twice. This is the only `ORDER BY` in the repository.

**Predicates must be written as literal SQL with bare snake_case column names** —
`sql\`email IS NOT NULL\``, not `sql\`${t.email} IS NOT NULL\``. drizzle-kit serializes index *columns*
with its `"indexes"` invokeSource but the *where* predicate without it, so an interpolated column
renders as `"customer"."email"`, which Postgres rejects inside `CREATE INDEX ... WHERE`. An
interpolated value becomes `$1` with the parameters discarded.

**`INCLUDE (customer_id)` on `customer_external_id_uq` is hand-written into
`migrations/0000_*.sql`.** drizzle-orm 0.45.2 has no DSL for covering indexes — no `.include()`, and
`.with()` only emits `WITH (k=v)` storage parameters. The `INCLUDE` makes the resolve lookup an
index-only scan, and that is the index every authenticated request hits.

This is safe but needs to be understood: `db:generate` diffs the last `meta/*_snapshot.json` against
the TypeScript schema and **never opens a connection**, so the hand-written clause is in neither side
of the diff and can never be dropped. Verified — a second `db:generate` reports no changes. The
trade-off is that Drizzle will never manage that index either, and **`drizzle-kit push` would break
it**: push does introspect, and it reads an `INCLUDE` column as an ordinary trailing key column. The
absence of a `db:push` script is now load-bearing, not just a preference.

`drizzle.config.ts` sits at the repo root because that is where drizzle-kit looks for it. It hands the
CLI the dialect, the schema path, the output directory, and a DSN composed by `buildConnectionString`
from the same `DB_*` variables the app uses — one source of truth for the credentials.

Nine discrete variables, matching the convention in the sibling services, deliberately not a single
`DATABASE_URL`:

| Variable                | Required | Default                                         |
| ----------------------- | -------- | ----------------------------------------------- |
| `DB_HOST`               | yes      | —                                               |
| `DB_PORT`               | yes      | —                                               |
| `DB_USERNAME`           | yes      | —                                               |
| `DB_PASSWORD`           | yes      | —                                               |
| `DB_NAME`               | yes      | —                                               |
| `DB_SSL`                | no       | `true` when `NODE_ENV=production`, else `false` |
| `DB_POOL_MAX`           | no       | `10`                                            |
| `DB_IDLE_TIMEOUT_MS`    | no       | `30000`                                         |
| `DB_CONNECT_TIMEOUT_MS` | no       | `5000`                                          |

There is **no default for the host, the credentials or the database name** — a missing one throws
before the process listens, naming the variable:

```
Invalid database configuration:
  - DB_HOST: Invalid input: expected string, received undefined
```

A blank value is not the same as an absent one: `DB_SSL=` is a parse error, not a fallback. Leave the
optional variables out of `.env` entirely to take their defaults.

When `DB_SSL` is true the pool passes `ssl: { rejectUnauthorized: false }`. Aurora terminates TLS with
an AWS-issued chain that is not in Node's trust store, so verification is off — the transport is still
encrypted. `DB_POOL_MAX` is **per container**: it multiplies by task count against Aurora's
`max_connections`, so ten connections across twenty tasks is two hundred.

### Why this layer parses its own env

Everywhere else in this service, env goes through `src/config/` and is read off the frozen `config`
object. This layer does not — `src/database/config.ts` runs its own dotenv-backed zod parse at module
load, and it is the fourth file on the ESLint `process.env` allow-list.

The reason is `drizzle.config.ts`, which runs **outside the app process**. Going through `loadConfig()`
would mean every SFCC variable had to be present just to generate a migration, and the `config` proxy
throws when read before `bootstrap()` has called it. A self-contained parse keeps `pnpm db:generate`
working with nothing but the `DB_*` block set.

Two rules follow from drizzle-kit executing these files in its own process, and both are invisible in
the code because they are absences:

- **`database/config.ts` must never import the logger.** Outside production, pino attaches a
  `pino-pretty` transport, which spawns a worker thread; a live worker keeps the event loop alive, so
  `db:generate` would hang instead of exiting and `db:studio` would interleave log lines into its
  output. `config.ts` throws plain `Error`s only. (`client.ts` may use the logger — it is app-process
  only.)
- **Nothing reachable from `database/schemas/index.ts` may import `client.ts` or the logger**, for the
  same reason: drizzle-kit loads the schema barrel directly, so every table, enum and util file behind
  it runs inside the drizzle-kit process too.

### `DB_*` cannot come through `ssm-bootstrap`

ESM evaluates the whole module graph before `bootstrap()`'s body runs, and `client.ts` is reachable
from `app.ts`. So `database/config.ts` parses **before** `resolveAppSsmSecrets()` has populated
`process.env`. Adding `DB_*` to the lists in `server.ts` cannot work.

The variables have to be in the environment at exec time: the ECS task-definition `environment` block
for the plain values, `secrets` — injected by the agent from Secrets Manager — for `DB_PASSWORD`.
Nothing database-related belongs in a committed `.env`. If a deployment ever genuinely has to source
credentials through `ssm-bootstrap`, the fix is to make `db` lazy behind a `getDb()` and move the parse
inside it.

### Local setup

Point `DB_*` at any local PostgreSQL 16. With the shared `legault-core-postgres` container, which
publishes on **5433**:

```bash
docker exec legault-core-postgres psql -U legault -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE postgres WITH LOGIN CREATEDB PASSWORD '<local-only-password>'"

docker exec legault-core-postgres psql -U legault -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE core_customer_api OWNER postgres"
```

`CREATEDB` rather than `SUPERUSER` — the app only needs to own its own database. Then in `.env`, which
is gitignored and the only place the password lives:

```dotenv
DB_HOST=localhost
DB_PORT=5433
DB_USERNAME=postgres
DB_PASSWORD=<local-only-password>
DB_NAME=core_customer_api
DB_SSL=false
```

Confirm it with `curl localhost:3000/health/ready`.

### Migrations

```bash
pnpm db:generate   # diff schemas/ against the last snapshot, write SQL to migrations/
pnpm db:migrate    # apply pending migrations
pnpm db:studio     # browse the database
```

Edit `schemas/`, run `db:generate`, **read the emitted SQL**, commit it alongside the schema change,
then `db:migrate`. Reading the SQL is not optional: it is where you catch a partial-index predicate
that serialized wrong, or a column rename that drizzle-kit decided was a drop plus an add.

There is deliberately **no `db:push` script**. `drizzle-kit push` diffs straight against a live
database with no migration file, which is fine on a laptop and unreviewable in production. One path,
one artefact: every schema change reaches every database as a committed migration.

Migrations are not part of the runtime image — `tsc` emits TypeScript output only, so
`migrations/*.sql` never reaches `dist/`. `db:migrate` runs from a checkout with devDependencies
installed (a CI job or a one-off task), and the app does **not** migrate at boot.

**Adding a table** is one file under the domain's `tables/`, re-exported from that folder's barrel,
then `db:generate`. `schemas` is threaded through `drizzle()`, so `db.query.<table>` — the relational
query API — picks it up as soon as the barrel exports it. No change to `client.ts`. Add the
`relations()` entry in `tables/relations.ts` at the same time, or the table is queryable but not
joinable.

### The pool

One instance for the process, created at module load. `new Pool()` opens no connection — `pg` dials
lazily — so a wrong host or password surfaces at `/health/ready`, not at boot. An `error` listener
catches idle clients dropped by the server (an Aurora failover, an idle timeout), which would otherwise
be an unhandled `error` event and take the process down; the pool discards the client and opens a new
one on demand.

The pool itself is never exported. Callers get `db`; a per-request pool is the classic way to exhaust
`max_connections`.

`closeDatabase()` drains it from `registerShutdownHandlers` in `server.ts`, **after** the HTTP server
has stopped accepting connections, so in-flight queries finish. ECS sends `SIGTERM` on every deploy, so
this runs on every deploy. It is idempotent — `pool.end()` rejects if called twice.

## The customer repository

`src/modules/customer/repositories/customer.repository.ts` is the only code in the app that touches
the database. It returns domain types (`Customer`, `CustomerAddress`, `ExternalId`) and never a
Drizzle row, so no caller above it sees a row shape or an ORM type.

```
modules/customer/
  repositories/
    customer.repository.ts             THE ENTRY POINT — createCustomerRepository(db)
    customer.queries.ts                customer row + the aggregate read
    customer-address.queries.ts        customer_address rows
    customer-external-id.queries.ts    customer_external_id rows
    types/customer.repository.types.ts input types + the Db alias
    utils/pg-error.util.ts             unique-violation inspection
  mappers/customer.mapper.ts           rows -> domain types
  errors/customer.error.ts             the three typed failures
```

**One repository, three tables.** `customer_external_id` and `customer_address` have no independent
life — they are always read and written through a customer, which is what guarantees the parent's
`version` moves and the one-preferred-address invariant holds. So the `*.queries.ts` modules are
**internal**: they hold the per-table SQL, `customer.repository.ts` owns the aggregate logic
(transactions, resolution order, the public contract), and the module barrel exports only
`createCustomerRepository`. Splitting them into peer repositories would hand callers a way around
those invariants.

**It takes its `db` rather than importing the singleton.** `createCustomerRepository(db)` is what makes
the layer testable at all: `database/client.ts` builds its pool at module load from env, and under
static ESM imports that cannot be re-pointed afterwards, so a test that imported the singleton would
silently run against the dev database. The same parameter type accepts a transaction handle
(`PgTransaction extends PgDatabase`), which is how the query modules compose without a union type —
each takes a `Db` and neither knows nor cares whether it is inside a transaction.

### Patch semantics

`updateProfile` is the one place `?` and `null` differ: an absent key leaves the column untouched, an
explicit `null` clears it, a value sets it. The SET object is built by walking the keys the caller sent
— **never by spreading**, which cannot tell an absent key from one set to `undefined`.

`upsertFromSfcc` is the opposite: present fields overwrite, absent fields are left alone, and it never
clears a column. A source system omitting a field has no opinion about it, which is not a request to
delete it. That now includes `lastName` — it used to be written unconditionally, back when the column
was NOT NULL, which meant a source with no surname would clobber a good stored value. Its addresses
are reconciled by upserting the supplied ones; rows we hold that the payload does not mention are
**left alone**, because a partial payload must not silently delete history.

`normalizeEmail`, `normalizeLanguage` and `normalizePostalCode` are applied at this boundary, on the
way in, so nothing
above the repository has to remember. A placeholder email normalizes to `null` and can therefore never
be stored, matched on, or returned.

**This is why `PATCH /v1/member/profile` does not simply call `upsertFromSfcc` with what SFCC echoed
back.** The upsert cannot clear a column, so a request that asked to clear a phone would clear it
upstream and silently keep the old value here — and a read never refreshes on a hit, so that value
would be served forever. The write path uses `updateProfile` for exactly the semantics described
above, and reaches for the upsert only to provision a row it does not yet hold. See
[The write-through](#the-write-through).

There is **no name normalizer**. `firstName`, `lastName`, `salutation` and `preferredStore` are
written verbatim, so a whitespace-only value from a source system is stored as whitespace. The
`PATCH` schema trims and rejects blanks at the edge, which covers everything a client sends but not
what arrives through SFCC provisioning.

**Addresses have no sparse patch at all.** `addressValues` emits all twelve columns, so an upsert is
a full replacement and any field the input omits is nulled. That is why the address endpoints mirror
from the SFCC response rather than the request — the response is complete, a patch is not.

**`upsertAddress` matches on `id` first, then `sfccAddressId`.** The order is load-bearing. A rename
arrives as `{ id, sfccAddressId: <the new name> }`, and matching by name would find nothing and
insert a second row — or find the _sibling_ that already holds that name and overwrite it. The SFCC
sync path supplies no `id`, so it still resolves by name and still collapses a re-sync onto the row
it belongs to.

### Concurrency

`updateProfile` takes an optional `expectedVersion` and carries it into the `WHERE`. Zero rows affected
is ambiguous, so it re-reads to answer whether the row is gone (`CustomerNotFoundError`, 404) or the
version moved (`CustomerVersionConflictError`, 412).

`upsertFromSfcc` resolves external ids, then email, then creates. Two first-time requests for the same
customer can race, so the insert runs inside a **nested transaction** — a `SAVEPOINT`. That matters:
a `23505` aborts the entire transaction it occurs in, so without the savepoint the recovery path could
not run any further statements. On catching one it re-resolves **once**, keyed off the constraint name,
and returns the row the other transaction committed. There is no retry loop.

Detecting that `23505` needs care: drizzle wraps every driver error in `DrizzleQueryError`, so the pg
error and its `code` are one level down in `cause`.

### Errors and PII

Three typed errors, all `HttpError` subclasses so `errorHandler` maps them without a special case:

| Error                          | Status | Code                        |
| ------------------------------ | ------ | --------------------------- |
| `CustomerNotFoundError`        | 404    | `CUSTOMER_RECORD_NOT_FOUND` |
| `CustomerVersionConflictError` | 412    | `CUSTOMER_VERSION_CONFLICT` |
| `DuplicateExternalIdError`     | 409    | `DUPLICATE_EXTERNAL_ID`     |

`CUSTOMER_RECORD_NOT_FOUND` is deliberately distinct from `CUSTOMER_NOT_FOUND`, which the SFCC provider
emits: the lazy-provisioning path has to tell "we hold no row yet" from "no such shopper upstream".

**No repository error carries a drizzle or pg error as `cause`.** `DrizzleQueryError`'s message is the
failing SQL plus its bound parameters — which include the customer's email — and `err.cause` is not
scrubbed by the error handler. Only the constraint name and the customer id ever escape. For the same
reason nothing here logs a row or an aggregate: `REDACT_PATHS` does not cover `birthDate`, `postalCode`,
`street1`, `city`, or an external id `value` (which is an email when the id type is `placeholderEmail`),
and it cannot reach three levels deep into `customer.profile.email`.

`DuplicateExternalIdError` is raised when a supplied id already resolves to a different customer. When
a payload's ids disagree with each other, which one resolution picks is arbitrary and does not matter —
linking then finds one of the others pointing elsewhere and fails closed. Merging is never implicit.

## Tests

`node:test` and `node:assert/strict`, no framework:

```bash
pnpm test
```

Two kinds, and only one of them needs a database.

The **mapper and validation tests** — `mappers/*.test.ts` in both the customer module and the SFCC
provider, plus the two `validations/*.test.ts` — are pure unit tests with no I/O. They carry most of
the write coverage, because most of those endpoints are field-by-field mapping: the phone switch in
every direction, `null` reaching the store as a clear, the SCAPI `c_*` renames, the address
required-field fill and its 422, and the `preferred` fallback that stops an address demoting itself.
Several assertions exist to fail loudly rather than to describe behaviour — one pins `CLEAR_VALUE` so
a sandbox finding cannot change the wire format silently, one holds `toUpdateProfileInput` to the six
fields it may touch, and one checks that no required address field is ever filled with `''`.

Those tests assert **key presence**, not just value: `assert.equal('phoneMobile' in update, false)`.
An absent key and a key set to `undefined` are the same to `deepEqual` and opposite everywhere
downstream, since both `buildProfilePatch` and the SCAPI body branch on `!== undefined`.

The **repository tests** are integration tests against a real PostgreSQL, not unit tests with a fake.
`src/test-support/test-db.ts` creates a scratch `core_customer_api_test` database, builds its own
pool, and brings the schema up with the **programmatic migrator** — `migrate(db, { migrationsFolder })`,
replaying the same SQL production gets, including the hand-written covering index that the TypeScript
schema cannot express and a push would get wrong. It never imports `client.ts`, avoiding both the
module-load env parse and the `pino-pretty` worker thread that would keep the runner alive.

**The service layer has no test**, and cannot get one as written: `customer.service.ts` imports
`getSfccProvider` directly and memoises the real `db`, so there is no seam to substitute either.
Injecting the provider the way `db` is injected into the repository would make the write-through's
branching testable. Worth doing; not done.

Three pieces of wiring worth knowing:

- **Two tsconfigs, one job each.** `tsconfig.json` never emits and includes **every** `.ts` file —
  `src/`, the tests, the harness and `drizzle.config.ts` — so the editor, eslint's `projectService`
  and `pnpm typecheck` all resolve the whole repo from a single program. `tsconfig.build.json` is the
  only one that emits, and the only one that sets `rootDir`; it excludes the tests and the harness so
  they never reach `dist/`.
- `no-floating-promises` is off for `*.test.ts`: `describe`/`it` return `Promise<void>` in @types/node,
  so every block would otherwise need a `void` prefix.
- `--test-concurrency=1`. Parallel writers against one schema trip the partial unique indexes.

**Do not reintroduce `allowDefaultProject`.** An earlier version used it so `drizzle.config.ts` could
be linted while sitting outside `include`. The failure mode is nasty and CLI-invisible: any file the
project service drops into the inferred project loses its imports, so every member access on a
properly-typed value reports _"a type that cannot be resolved"_. The editor fills with hundreds of
phantom errors while `pnpm lint` stays green. Keeping one all-inclusive non-emitting project is what
prevents it — and it is why `rootDir` moved to the build project, since a root-level file under
`rootDir: ./src` is a TS6059 error.

`pnpm check` deliberately does **not** run them — it stays hermetic, and the tests need a database.

## Extending it

**A new SCAPI call.** Four edits, none of them structural:

1. The response type in `providers/sfcc/types/<api>.types.ts` — declare only the fields you intend to
   expose.
2. The request and its error mapper on the relevant client in `providers/sfcc/clients/`.
3. A mapper in `providers/sfcc/mappers/`.
4. One method on `SfccProvider` and its factory body in `sfcc.provider.ts`. Decide the token: a
   my-account call takes the shopper's `accessToken` off the identity, an anonymous one wraps in
   `withGuestToken`. Anything scoped to a `{customerId}` is the former.

For a **write**, add a request type in step 1 and a write-direction mapper in step 3 — built key by
key like the read one, so an absent key stays absent. `updateCustomer` in `clients/customers.client.ts`
is the worked example. Two more things:

- **The one-shot `CONCURRENT_MODIFICATION` retry is in place**, reinstating what registration carried
  in the auth API. Wrap the send in `retryOnceOnConcurrentModification`; do not turn it into a loop.
  If the call has its own permanent 409 — a name collision, say — give it a slug predicate and check
  that _before_ the retry, the way `isRenameConflict` does.
- **Profile and address writes need a scope change first.** The dev SLAS clients carry
  `sfcc.shopper-customers.login` / `.register`, which is enough for `getCustomer` but not for a
  my-account write — profile writes need `sfcc.shopper-myaccount.rw`, addresses
  `sfcc.shopper-myaccount.addresses.rw`. That is a SLAS Admin change, not a code change, and a missing
  scope looks exactly like an identity mismatch — both arrive as a 403. **This currently blocks any
  end-to-end verification of `PATCH /v1/member/profile` and all four address endpoints.**

**A route with a path parameter.** `validate(schema, 'params')` already works — `ValidationSource`
covers it and the middleware is source-generic. Declare it on the route rather than through `use`:
`req.params` only carries the parameter inside the layer whose path matched it. Read it back with
`getValidated<T>(req, 'params')` rather than off `req.params`, which the `VersionedParams` index
signature types as `string | string[]`. `customerRouter` has the worked example on
`/addresses/:id`.

**A new module.** Create `src/modules/<name>/` with `controllers/`, `services/`, `validations/`,
`types/` and `routes/`, give the router `Router({ mergeParams: true })` so it can see `:version`, add
an `index.ts` barrel exporting the router, then one `use` line in `src/routes/v1.routes.ts`. Copy
`src/modules/customer/` for the shape.

**A new brand.** Add it to `BRANDS` in `src/shared/constants/api.constant.ts`, then follow the
compile errors: `Config.slas` and `Config.sfcc` are total maps over `Brand`, so TypeScript will
require its credentials and identifiers. Add its six env vars — `<BRAND>_SLAS_CLIENT_ID`,
`_SLAS_CLIENT_SECRET`, `_SHORT_CODE`, `_ORG_ID`, `_SITE_ID`, `_REDIRECT_URI` — to `ENVS`, the zod
schema and `.env.example`, and a branch in `getBrandIdentifiers()`. Routing, validation and
resolution need no changes.

**A new API version.** Add it to `API_VERSIONS`, create `src/routes/v2.routes.ts`, add one entry to
`VERSION_ROUTERS` in `src/routes/api.routes.ts`. The `Record<ApiVersion, Router>` type makes a
forgotten router a compile error. v1 is untouched.

**Validation on a route.** `router.get('/', validate(schema, 'headers'), handler)` — the source is
`'body' | 'params' | 'query' | 'headers'`. Read the result with `getValidated<T>(req, 'headers')`. The
middleware writes to `req.validated[source]` and deliberately does not mutate `req.body` / `req.query`
/ `req.params`: in Express 5 `req.query` is a getter and `req.params` is recomputed per router layer,
so writing back is only sometimes observable downstream.

**Errors.** Throw an `HttpError` subclass (`BadRequestError`, `NotFoundError`, `UpstreamError`, …).
Never call `res.status().json()` on an error path. Wrap async handlers in `asyncHandler` so rejections
reach the central handler.

## Toolchain notes

Two deliberate version pins. Both are worth revisiting later; neither should need a code change.

**TypeScript is pinned to 6.x, not 7.** TypeScript 7 is the native Go compiler and its npm package
no longer exports the JavaScript compiler API — `import('typescript')` yields only
`{ version, versionMajorMinor }`. typescript-eslint (8.66, latest) declares
`typescript: ">=4.8.4 <6.1.0"` and cannot run against it, which would mean giving up type-aware
linting entirely. Revisit once typescript-eslint ships TS 7 support.

**ESLint is pinned to 9.x, not 10.** ESLint 10's default formatter uses `util.styleText`, which needs
Node ≥ 20.12, so it cannot run on Node 20.9–20.11. ESLint 9 declares
`^18.18.0 || ^20.9.0 || >=21.1.0` and keeps the project usable across the whole supported Node range.
Same flat config, same typescript-eslint rules. Revisit when the Node floor moves to 22.
