/*
 * Package-code authority for goal lifecycle consumers.
 *
 * Executable code is resolved relative to the installed extension, never from the target project.
 * The target remains data authority for docs/goal.md and .respawnpack/runtime/contract.json.
 */

const GOAL_CONTRACT_URL = new URL('../../../../scripts/goal-contract.mjs', import.meta.url);

async function loadPackageGoalContract() {
  const mod = await import(GOAL_CONTRACT_URL.href);
  return mod && (mod.default || mod);
}

export { GOAL_CONTRACT_URL, loadPackageGoalContract };
