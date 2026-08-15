# RespawnPi package decisions

These decisions govern the RespawnPi package. They are not entries in an installed target's decision ledger.

## respawn-pi:D-007 — Pi-only package

RespawnPi targets Pi's package, extension, skill, and lifecycle surfaces. Retired Claude-oriented installers and kernel paths are not part of the release.

## respawn-pi:D-009 — Evidence-bound claims

A completion claim names the command or public fence, immutable revision/tree, exit status, and artifact. An unavailable gate is `CANNOT_DETERMINE`, not PASS.

## respawn-pi:D-011 — Pi-aligned package agents

The package-owned agent bench uses the Pi-aligned `respawn-pi-subagent` single/parallel/chain contract. Package scope is the default; user/project scope is explicit. Child execution, output, concurrency, cwd, and cleanup are bounded.

## respawn-pi:D-012 — Bounded review convergence

Review expands once into a frozen finding batch, then permits at most two remediation cycles before returning control to the operator. Closure checks the same immutable snapshot rather than restarting discovery.

## respawn-pi:D-013 — Requirements and qualified evidence

Projects may adopt a strict `requirements.json` denominator and bounded evidence. High-risk rows require independent qualification. Projects without this authority receive an honest untracked STATE instead of invented completion counts.

## respawn-pi:D-016 — Native lifecycle and target-owned authority

Pi exclusively owns package registration, update, filtering, and removal. Project initialization is separate and explicit. Package code/schemas are implementation authority; each target owns its revision/tree, requirements/evidence, product docs, `D-*` namespace, generated STATE, and handoff.

Greenfield initialization creates only neutral templates. Brownfield initialization creates no product truth and routes through `/onboard`. Provider/model choice remains with Pi and the operator. Blocking repository policy is opt-in through the `guarded` profile.

## respawn-pi:D-019 — AGPL-3.0-or-later releases

RespawnPi-original code and documentation in this release use AGPL-3.0-or-later. Covered derivatives conveyed to others must follow the AGPL's notice, corresponding-source, and same-license terms. A modified version offered for remote network interaction must also offer its corresponding source to those users under section 13. Attributed third-party material retains its source license.
