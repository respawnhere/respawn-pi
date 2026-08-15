# Performance standards

How RespawnPack writes code that stays fast when real users arrive. The through-line: **the failures that kill products at their first traffic spike are cheap to prevent at write time and brutal to retrofit.** A page that works with ten seed rows and dies with ten thousand real ones was broken the day it was written; the load only revealed it.

`/loadout` models scale at plan time; `/build` writes to this standard; `/review` checks diffs against it; `/ship` gates hot paths. It is the scale sibling of [`coding-standards.md`](coding-standards.md): that one keeps code legible, this one keeps it alive under load.

## Rule 0: proportionality

Full rigor goes to **hot paths** (anything on the request path users wait on) and **growth surfaces** (anything whose cost grows with users or data). A one-off admin script or a lookup table capped at fifty rows does not need this ceremony. For anything cold, measure before optimizing: a profile beats a hunch.

## Data access

**1. Never query inside a loop over rows.** An `await` on a query inside a `for` over query results is one round trip per row: the N+1. Batch it, join it, or use the ORM's include/relation loading (Prisma `include`, SQLAlchemy `selectinload`/`joinedload`, Django `select_related`/`prefetch_related`, Rails `includes`). A list page doing N+1 over 10,000 rows makes 10,001 round trips to render one screen. For the "first/latest child per parent" shape, a single `DISTINCT ON` or window function is often one round trip and beats per-parent eager-loading; some ORMs (Prisma among them) have no equivalent, so reach for raw SQL there.

**2. Select the columns the caller needs on hot or wide tables.** `SELECT *` on rows carrying JSONB blobs, vectors, or long text drags megabytes the screen never renders, through the database, the wire, and the ORM. A five-column lookup table does not need the discipline; a hot feed query over a wide table does.

**3. Paginate every list that can grow.** Every list endpoint takes a limit (`take` / `LIMIT`) from day one, cursor-based where the set grows without bound, because offset pagination re-scans everything it skips. The unpaginated feed that "worked in beta" is the classic first-spike outage.

**4. Index what you filter and sort by.** Every foreign key is covered by an index (a composite index whose leading columns match the FK counts) and every hot `WHERE` / `ORDER BY` column gets one; run `EXPLAIN` on any new query aimed at a hot table before shipping it. Postgres does not index foreign keys automatically; an uncovered FK means full scans of the child table on joins and on parent deletes. The counterweight: each index taxes every write, so skip one only deliberately (a tiny static lookup table), never by omission.

**5. Pool connections; never open one per request.** On serverless and edge runtimes, each instance opening its own database connection exhausts the connection limit at the first spike. Use the platform pooler for runtime traffic (Supabase: transaction-mode pooling on port `6543`) and a singleton client per process. Transaction mode rejects server-side prepared statements, and that breaks any driver that relies on them, not just Prisma: match your driver's prepared-statement setting to the pooler mode (Prisma adds `?pgbouncer=true`; asyncpg disables its cache with `statement_cache_size=0`). Migrations and long-lived servers stay on the direct or session connection (`5432`; `directUrl` in Prisma).

**6. Write deliberately.** Multi-step invariants go in a transaction. Prefer one atomic statement (`UPDATE ... SET count = count + 1`) over read-modify-write, which silently loses updates under concurrency. Bulk inserts are batched (Prisma `createMany`, SQLAlchemy `add_all()` / `session.execute(insert(Model), [...])`, Django `bulk_create`, or engine-level `COPY`), never looped. Any write that can be retried needs idempotency (a key, or an upsert), or retries become duplicates.

## Network and payload

**7. Shape the payload; let the platform compress it.** Do not hand-compress JSON in application code. Cloudflare and Vercel compress at the edge automatically; on bare hosts, enable compression once in the server or framework config. The win that is yours to take: send only what the client renders. Trim fields at the boundary, and make "include related records" a deliberate per-endpoint choice.

**8. Cache with intent.** Public, stable GETs get cache headers and the CDN; per-user reads get stale-while-revalidate where staleness is tolerable. Say explicitly what must be fresh (a wallet balance) and what may lag seconds (a follower count). "No caching anywhere" is also a decision, and it is usually the wrong default for public reads.

**9. Kill request waterfalls.** Five sequential fetches to paint one screen cost five round trips of latency; fetch independent data in parallel, or expose one endpoint that returns what the screen needs. The waterfall you cannot feel on localhost is two seconds on a phone.

## Frontend

**10. Static-first hosting.** Prerender everything that is not per-user (marketing pages, docs, public profiles) and serve it from the CDN; render dynamically only what is genuinely per-user. A server render per anonymous pageview of an unchanging page pays compute for nothing and adds latency for nothing.

**11. Optimistic UI on interactive mutations.** Update the interface immediately, reconcile on the server response, roll back with a visible message on failure. Likes, votes, sends, and toggles should feel instant; a spinner on a 50 ms action is a self-inflicted wound. Reads get skeletons and cached-then-revalidate, so navigation never paints a blank screen.

**12. Ship less JavaScript.** Code-split by route, keep server dependencies out of the client bundle, and watch the bundle delta in review: enforce it as a CI budget where practical, so a regression fails the build instead of waiting for a reviewer to notice. Defer or lazy-load anything not needed for first paint (below-the-fold widgets, modals, rarely-visited routes), and size and format images for the viewport that renders them (responsive `srcset`/`sizes`, modern formats over an unconverted PNG). A dependency that adds tens of kilobytes to first load needs a stated reason. Startup cost is a tax every user pays on every visit.

**13. Profile re-renders before you fight them.** Scope state to the component that changes it, not a shared ancestor that re-renders everything below it on every keystroke. Keep props referentially stable for memoized children: a new inline object or callback on every render defeats the memo it's passed to. Key lists by a stable identity, never by array index, or the reconciler misattributes state across reordered items. Profile before reaching for `memo`/`useCallback`: wrapping everything in them speculatively is its own tax, and it can cost more than the re-render it was guarding against.

**14. No layout thrash on the hot rendering path.** Batch DOM reads and writes; interleaving them (read a layout value, write a style, read again) forces the browser to recalculate layout synchronously on every pass instead of once. Animate compositor properties only, `transform` and `opacity`, never `width`, `height`, `top`, or `left`: the full motion system lives in [`design-standards/02-visual-system.md`](design-standards/02-visual-system.md) rule 8, and this is its performance consequence.

## Architecture

**15. Every external call gets a timeout and a degrade path.** A third-party API with no timeout makes its latency your latency and its outage your outage: the single-dependency bottleneck. Decide per call what happens when it is slow or down (fail fast, fall back, queue for later), and never let a non-critical call (analytics, email) block the critical path.

**16. Queue heavy work off the request path.** Anything meaningfully slower than the response the user is waiting on (media processing, fan-out, bulk email, report generation) gets enqueued for a worker, and the request returns an acknowledgment. Web servers doing batch work fall over together, taking the interactive traffic with them.

**17. Name the hot path and verify it against production truth where you can.** Know the two or three queries and routes that will carry most of the traffic; they get the `EXPLAIN`, the index check, and the load thought, at plan time and again at ship time. Check the live system instead of assuming, wherever that path is reachable: a read-only review lens has no MCP or database access of its own, so that check is a human or `/db-ops` task. Where wired, the Supabase MCP's advisors report unindexed foreign keys and index hygiene from the running database, and `EXPLAIN` or `pg_stat_statements` through `execute_sql` surfaces the slow queries the advisors do not.

## The one-line test

Before shipping a change on a hot path, ask: **"what happens when this runs against a million rows and ten thousand concurrent users?"** If the answer is a shrug, that is the check to run before it ships.
