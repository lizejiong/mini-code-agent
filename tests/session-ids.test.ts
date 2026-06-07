import { describe, expect, test } from 'vitest';
import { createSessionId, isSessionId } from '../src/sessions/ids.js';

describe('session ids', () => {
  test('creates uuid session ids', () => {
    expect(createSessionId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test('accepts uuid-like ids and rejects unsafe ids', () => {
    expect(isSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isSessionId('abc/def')).toBe(false);
    expect(isSessionId('')).toBe(false);
  });
});
