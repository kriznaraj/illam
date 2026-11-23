import { describe, it, expect } from 'vitest';
import { avatarColour, avatarInitial } from '../avatar';

describe('avatarInitial', () => {
  it('uses the first letter of the name, upper-cased', () => {
    expect(avatarInitial('alice', 'alice@example.com')).toBe('A');
    expect(avatarInitial('Bob Kumar', null)).toBe('B');
  });

  it('falls back to the email when there is no name', () => {
    expect(avatarInitial(null, 'priya@example.com')).toBe('P');
    expect(avatarInitial('   ', 'zara@example.com')).toBe('Z');
  });

  it('keeps a letter from any script, not just English', () => {
    expect(avatarInitial('இளங்கோ', null)).toBe('இ');
  });

  it('shows a neutral mark when there is nothing to go on', () => {
    expect(avatarInitial(null, null)).toBe('?');
  });
});

describe('avatarColour', () => {
  it('gives the same person the same colour every time', () => {
    expect(avatarColour('alice@example.com')).toBe(avatarColour('alice@example.com'));
  });

  it('tends to give different people different colours', () => {
    const colours = new Set(['alice', 'bob', 'carol', 'dev', 'esha', 'farah'].map(avatarColour));
    expect(colours.size).toBeGreaterThan(3);
  });
});
