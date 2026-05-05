import { randomUUID } from "node:crypto";

/** All new correlation and record IDs use Web Crypto–compatible UUIDs. */
export function newId(): string {
  return randomUUID();
}
