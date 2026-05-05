import type { ObsflowConfig } from "./types.js";
import type { VaultAdapter } from "./adapters/interfaces.js";

/** Ensure managed / create_if_missing / managed Obsidian Bases exist on disk. */
export async function ensureVaultBases(
  cfg: ObsflowConfig,
  vault: VaultAdapter,
): Promise<void> {
  for (const b of cfg.bases) {
    if (b.mode === "reference") continue;
    await vault.upsertBase(b);
  }
}
