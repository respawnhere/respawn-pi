# Observability basics

How RespawnPack designs what a running system tells you about itself. The through-line: **the questions an incident asks should already have answers by the time someone asks them.** This covers the design half only: structured logging, symptom-based alerting, and dashboard conventions decided before anything breaks. Heavy instrumentation frameworks (RED/USE metrics, full OpenTelemetry tracing) are deliberately out of scope: most targets this pack ships to don't run at a scale where that ceremony pays for itself. The depth here scales by blast radius, the same way [`performance-standards.md`](performance-standards.md) Rule 0 does.

`/build` writes to this standard at its implementation step. It is the runtime-facing sibling of `performance-standards.md`: that standard keeps a system fast, this one keeps it legible when it isn't.

## 1. Log structure, not sentences

Every log line is a stable set of key=value pairs or a JSON object, not a hand-written sentence a `printf` happened to produce. Keys stay the same across changes to the wording around them, and each event is one line; a multi-line, stack-trace-style dump defeats every log aggregator's line-based parsing. Two log lines for the same event, worded differently by whoever last touched the code, is printf-drift: it makes the event impossible to query as one thing.

## 2. Log the decision, not the mechanics

"Entered function" and "loop iteration 4" tell no one anything they'd page someone over. Log what was decided, rejected, or retried, and the id it happened to: `{"event":"payment.retry","order_id":"...","attempt":2,"reason":"gateway_timeout"}` answers a question; "processing order" does not. If a reader can't reconstruct *why* the system did what it did from the log alone, the log recorded mechanics instead of the decision.

## 3. Alert on symptoms, not causes

Page on what a user feels (error rate, latency, saturation), not on the internal cause of the moment (a specific queue depth, a specific pod restarting). A symptom-based alert stays valid as the implementation changes underneath it; cause-based alerts multiply forever and page people for causes that never reach a user.

## 4. Design dashboards around the questions an incident asks

"What changed right before this started", "is it getting worse or better", and "who's affected and how many" are the three questions every incident opens with. Build the dashboard to answer them at a glance (a deploy marker on the timeline, a trend line, a breakdown by segment) instead of a wall of every metric that happens to exist.

## 5. Thread a correlation id across every service boundary

One request touching three services needs one id that appears in all three logs, generated at the edge and passed through every hop (a header, a queue message attribute, a job payload field). Without it, reconstructing one user's request across a distributed system means grepping timestamps and hoping.

## The one-line test

Instrument at build time, not after the first incident. Ask **"if this breaks at 2 a.m., does the log line say what was decided, or just that a function ran?"** That's `/build`'s implementation step, not a follow-up ticket.