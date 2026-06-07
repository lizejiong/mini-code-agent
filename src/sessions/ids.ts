import { randomUUID } from 'node:crypto';

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createSessionId(): string {
  return randomUUID();
}

export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}
