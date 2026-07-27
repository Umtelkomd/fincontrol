/**
 * Shared person-name matcher.
 *
 * These cases are the CONTRACT the payroll importer already relies on
 * (`resolveEmployeeIdsByPersNr` name fallback) plus the containment rules
 * `useEmployees.findByText` needs. Extracting the matcher here is only safe if
 * both behaviours are pinned, so they are pinned here.
 */
import { describe, expect, it } from 'vitest';
import { nameMatches, nameTokens, normalizeName } from './nameMatching.js';

const EMPLOYEE = {
  fullName: 'Juan Dios Lesmes Linares',
  firstName: 'Juan',
  lastName: 'Lesmes Linares',
  aliases: [],
};

describe('normalizeName', () => {
  it('trims and lowercases', () => {
    expect(normalizeName('  Klaus WAGNER ')).toBe('klaus wagner');
  });

  it('returns an empty string for nullish input instead of "null"', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName(0)).toBe('');
  });
});

describe('nameTokens', () => {
  it('splits on punctuation and whitespace', () => {
    expect(nameTokens('Lesmes Linares, J.')).toEqual(['lesmes', 'linares', 'j']);
  });

  it('keeps accented letters inside a token', () => {
    expect(nameTokens('José Romero')).toEqual(['josé', 'romero']);
  });

  it('returns an empty array for blank input', () => {
    expect(nameTokens('   ')).toEqual([]);
    expect(nameTokens(null)).toEqual([]);
  });
});

describe('nameMatches', () => {
  it('matches the full name', () => {
    expect(nameMatches(EMPLOYEE, 'Juan Dios Lesmes Linares')).toBe(true);
  });

  it('matches a last-name fragment both ways', () => {
    // "Wagner" ⊂ "Klaus Wagner" and "Lesmes Linares, J." ⊃ "Lesmes Linares"
    expect(nameMatches({ fullName: 'Klaus Wagner', lastName: 'Wagner' }, 'Wagner')).toBe(true);
    expect(nameMatches(EMPLOYEE, 'Lesmes Linares, J.')).toBe(true);
  });

  it('matches an alias', () => {
    expect(nameMatches({ fullName: 'José Romero Lesmes', aliases: ['J. Romero'] }, 'J. Romero')).toBe(true);
  });

  it('is case insensitive', () => {
    expect(nameMatches(EMPLOYEE, 'JUAN DIOS LESMES LINARES')).toBe(true);
  });

  it('does not match an unrelated name', () => {
    expect(nameMatches(EMPLOYEE, 'Nadie Conocido')).toBe(false);
  });

  it('never matches on blank text', () => {
    expect(nameMatches(EMPLOYEE, '')).toBe(false);
    expect(nameMatches(EMPLOYEE, null)).toBe(false);
  });

  it('tolerates a missing or malformed employee record', () => {
    expect(nameMatches(null, 'Juan')).toBe(false);
    expect(nameMatches({}, 'Juan')).toBe(false);
    expect(nameMatches({ fullName: 'Juan', aliases: 'not-an-array' }, 'Juan')).toBe(true);
  });
});
