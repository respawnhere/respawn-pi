import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type GovernanceProfile = "continuity" | "guarded";

function projectDirOf(event: any, ctx: any): string {
  for (const value of [ctx?.cwd, event?.cwd, event?.input?.cwd, process.env.RESPAWN_PI_PROJECT_DIR, process.cwd()]) {
    if (typeof value === "string" && value) return value;
  }
  return process.cwd();
}

/**
 * Blocking repository policy is opt-in. Merely installing a Pi package is consent
 * to load its code, not consent to replace a project's push/shell/config policy.
 */
export function governanceProfile(event: any = {}, ctx: any = {}): GovernanceProfile {
  const override = process.env.RESPAWN_PI_GOVERNANCE_PROFILE;
  if (override === "guarded" || override === "continuity") return override;
  const file = join(projectDirOf(event, ctx), "respawnpack.config.json");
  try {
    if (!existsSync(file)) return "continuity";
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return "continuity";
    const doc = JSON.parse(readFileSync(file, "utf8"));
    return doc?.governance?.profile === "guarded" ? "guarded" : "continuity";
  } catch {
    return "continuity";
  }
}

export function guardedGovernanceEnabled(event: any = {}, ctx: any = {}): boolean {
  return governanceProfile(event, ctx) === "guarded";
}
