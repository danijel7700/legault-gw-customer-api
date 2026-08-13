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

pnpm typecheck  # tsc --noEmit (src/ including tests, and drizzle.config.ts)
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

| Endpoint                 | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `GET /health`            | Liveness, for the load balancer. No brand, no version.                    |
| `GET /health/ready`      | Readiness — can it reach PostgreSQL. No brand, no version.                |
| `GET /v1/health`         | Which SFCC org this brand is pointed at. Needs `x-brand`.                 |
| `GET /v1/member/profile` | The shopper's profile. Needs `x-brand`, `x-customer-id`, `Authorization`. |

```bash
curl -H 'x-brand: rens' -H 'x-customer-id: abk1p3xW9Yc5tRvQ' \
  -H "Authorization: Bearer $SHOPPER_ACCESS_TOKEN" \
  http://localhost:3000/v1/member/profile
```

```json
{
  "customerId": "ackKg3kKoZxrIRwKg0wWYYxraK",
  "customerNo": "DEV_MND_00114027",
  "login": "ada.lovelace@gmail.com",
  "email": "ada.lovelace@gmail.com",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "phone": "514-555-5555",
  "addresses": [
    {
      "addressId": "Home",
      "address1": "1 Rue Sainte-Catherine",
      "address2": "Apartment 49",
      "city": "Montreal",
      "stateCode": "QC",
      "postalCode": "A1B 2C3",
      "countryCode": "CA",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "fullName": "Ada Lovelace",
      "phone": "514 555 5555",
      "preferred": true
    }
  ],
  "paymentInstruments": [
    {
      "paymentInstrumentId": "3e9f4fd402f8e719cd6722f71b",
      "paymentMethodId": "CREDIT_CARD",
      "default": true,
      "paymentCard": {
        "cardType": "Visa",
        "maskedNumber": "4242********4242",
        "numberLastDigits": "4242",
        "expirationMonth": 12,
        "expirationYear": 2030,
        "holder": "Ada Lovelace",
        "creditCardExpired": false
      }
    }
  ]
}
```

Absent fields are omitted rather than sent as `null` — including `addresses` and `paymentInstruments`,
which are missing rather than `[]` when the customer has none. `customerId` is the only field always
present. In practice `birthday` and `preferredLocale` are unset on the dev orgs, so treat those two as
untested rather than reliable.

### The inbound header contract

| Header          | Required | Meaning                                                                  |
| --------------- | -------- | ------------------------------------------------------------------------ |
| `x-brand`       | yes      | `rens` or `mondou`. Selects the SFCC instance.                           |
| `x-customer-id` | yes      | Opaque SFCC customer id, resolved by the gateway from the shopper token. |
| `Authorization` | yes      | `Bearer <shopper SLAS access token>`. Forwarded verbatim to SCAPI.       |
| `x-request-id`  | no       | Adopted if it matches `/^[\w.:-]{1,128}$/`, else one is minted. Echoed.  |

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
- **Array paths for the nested PII.** Once the profile carried `addresses` and `paymentInstruments`,
  the flat `*.field` wildcards stopped being enough: a street address sits at `addresses[0].address1`,
  which no fixed-depth wildcard reaches. Those are spelled out as `addresses[*].address1` and friends,
  with the whole `paymentInstruments[*].paymentCard` object redacted wholesale rather than field by
  field — there is nothing inside it worth logging. pino validates these at construction, so a
  malformed path fails the boot rather than leaking silently.
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
      mappers/customer.mapper.ts    SCAPI shape -> CustomerProfile; drops the rest
      http/sfcc-http.ts             axios factory + upstream error normalisation
      clients/
        slas.client.ts              guest token: client_credentials, cached, single-flight
                                    (currently unreferenced — see below)
        customers.client.ts         Shopper Customers: getCustomer + error mapping
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
      controllers/customer.controller.ts   thin: validated headers -> service -> response
      services/customer.service.ts         resolves the provider and delegates
      validations/customer.validation.ts   zod schema over request headers
      types/customer.types.ts              THE CONTRACT: CustomerProfile, no SFCC
      routes/customer.routes.ts            GET /profile
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

`src/modules/customer/types/customer.types.ts` is the whole API surface of this module, and it names
no source system:

```ts
interface CustomerProfile {
  customerId: string;
  customerNo?: string;
  login?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string; // first of SFCC phoneMobile / phoneHome / phoneBusiness
  birthday?: string;
  preferredLocale?: string;
  addresses?: CustomerAddress[];
  paymentInstruments?: CustomerPaymentInstrument[];
}
```

A **curated superset**, not a minimal one: everything a member-account screen needs — identity,
contact, addresses and saved payment instruments — mapped field by field into types this module owns.
`customerId` is the only field always present. `addresses` and `paymentInstruments` are omitted
entirely when SFCC returns none rather than sent as `[]`, consistent with every other absent field.

`phone` collapses three SFCC fields into one. The Customer object carries `phoneMobile`, `phoneHome`
and `phoneBusiness` separately and a profile may fill in any of them — the mondou dev customers use
`phoneMobile` and leave `phoneHome` empty, which is how reading a single field turned into a phone
that silently vanished. First one set wins, mobile first.

`CustomerAddress` and `CustomerPaymentInstrument` / `CustomerPaymentCard` are declared alongside it.
Both nested mappers exist for the same reason as the top-level one: SFCC types `addressId` and
`paymentInstrumentId` as optional, but they are how a caller addresses a single entry, so the contract
makes them required. Card data is reduced to what a "saved cards" list renders — type, masked number,
last digits, expiry, holder — and `paymentCard` is simply absent when SFCC omits it.

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
- **`c_*` custom attributes** — unbounded and instance-specific; forwarding them would make the
  public contract a function of SFCC configuration. A live mondou profile carries eight of them
  (`c_mPOSID`, `c_preferredStore`, `c_sscid`, `c_ssccid`, `c_sscSyncStatus`, `c_sscSyncResponseText`,
  `c_CCRateLimiterCount`, `c_CCRateLimiterTimestamp`) — sync bookkeeping and rate-limiter state, none
  of it a shopper's business.

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

### Error mapping for `getCustomer`

SCAPI errors are RFC 7807 problem+json, and the `type` URI's last segment is the stable key — the
HTTP status alone is not enough. `problemSlug()` extracts it.

| Upstream                                                                      | This API returns             |
| ----------------------------------------------------------------------------- | ---------------------------- |
| slug `invalid-customer` / `customer-not-found` / `resource-not-found`, or 404 | **404** `CUSTOMER_NOT_FOUND` |
| 401                                                                           | **401** `UNAUTHORIZED`       |
| 403                                                                           | **403** `SFCC_ACCESS_DENIED` |
| 400, or slug `invalid-customer-id` / `invalid-request-parameter`              | **400** `BAD_REQUEST`        |
| 5xx, timeout, connection error                                                | **502** `UPSTREAM_ERROR`     |

Two of those rows are worth explaining.

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

The 403 row is a **safety net, not the mismatch case**. An `x-customer-id` that disagrees with the
token does _not_ come back as 403 — SCAPI answers `400 invalid-customer`, so a mismatch lands on the
404 row above. 403 is reserved for a genuine SFCC refusal, most plausibly a scope violation once
profile writes are added. Do not read a 403 from this service as "wrong customer id."

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
delete it. Its addresses are reconciled by upserting the supplied ones; rows we hold that the payload
does not mention are **left alone**, because a partial payload must not silently delete history.

`normalizeEmail` and `normalizePostalCode` are applied at this boundary, on the way in, so nothing
above the repository has to remember. A placeholder email normalizes to `null` and can therefore never
be stored, matched on, or returned.

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

These are integration tests against a real PostgreSQL, not unit tests with a fake. `src/test-support/
test-db.ts` creates a scratch `core_customer_api_test` database, builds its own pool, and brings the
schema up with the **programmatic migrator** — `migrate(db, { migrationsFolder })`, replaying the same
SQL production gets, including the hand-written covering index that the TypeScript schema cannot
express and a push would get wrong. It never imports `client.ts`, avoiding both the module-load env
parse and the `pino-pretty` worker thread that would keep the runner alive.

Three pieces of wiring worth knowing:

- Tests stay inside `tsconfig.json`'s `include`, so eslint's `projectService` and `tsc --noEmit` both
  see them. They are kept out of `dist/` by `tsconfig.build.json`, which is what `pnpm build` uses.
  Excluding them from `tsconfig.json` instead would have needed an `allowDefaultProject` entry, and
  those globs cannot contain `**`.
- `no-floating-promises` is off for `*.test.ts`: `describe`/`it` return `Promise<void>` in @types/node,
  so every block would otherwise need a `void` prefix.
- `--test-concurrency=1`. Parallel writers against one schema trip the partial unique indexes.

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

Two things the first additions will hit:

- **A write operation** should reinstate the one-shot `CONCURRENT_MODIFICATION` retry that registration
  carried in the auth API; it was dropped here because this service currently only reads.
- **Addresses and profile writes need a scope change first.** The dev SLAS clients carry
  `sfcc.shopper-customers.login` / `.register`, which is enough for `getCustomer` but does not include
  `sfcc.shopper-myaccount.addresses.rw`. That is a SLAS Admin change, not a code change, and a missing
  scope looks exactly like an identity mismatch — both arrive as a 403.

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
