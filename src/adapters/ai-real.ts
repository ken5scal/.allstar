import type { AiAdapter } from "./interfaces.js";

export function createAiRealStubAdapter(): AiAdapter {
  return {
    async summarize() {
      throw new Error("ai real provider not implemented; use provider: mock");
    },
  };
}
