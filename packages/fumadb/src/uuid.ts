import { randomUUID } from "node:crypto";

/**
 * Generate a UUID v4 using Node.js crypto module
 * @returns A UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateUUID(): string {
  return randomUUID();
}

/**
 * Alias for generateUUID
 */
export { generateUUID as createUUID };
