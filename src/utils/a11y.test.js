import { describe, expect, it, vi } from 'vitest';

import { handleKeyboardActivation, isActivationKey, rowButtonProps } from './a11y.js';

const keyEvent = (key, target, currentTarget) => ({
  key,
  target: target ?? { closest: () => null },
  currentTarget: currentTarget ?? null,
  preventDefault: vi.fn(),
});

const clickEvent = (target, currentTarget) => ({
  target: target ?? { closest: () => null },
  currentTarget: currentTarget ?? null,
});

describe('isActivationKey', () => {
  it('accepts Enter and Space and nothing else', () => {
    expect(isActivationKey({ key: 'Enter' })).toBe(true);
    expect(isActivationKey({ key: ' ' })).toBe(true);
    expect(isActivationKey({ key: 'Tab' })).toBe(false);
    expect(isActivationKey({ key: 'a' })).toBe(false);
  });
});

describe('handleKeyboardActivation', () => {
  it('activates and suppresses the default scroll on Space', () => {
    const onActivate = vi.fn();
    const event = keyEvent(' ');
    handleKeyboardActivation(event, onActivate);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('ignores non-activation keys without touching the event', () => {
    const onActivate = vi.fn();
    const event = keyEvent('Tab');
    handleKeyboardActivation(event, onActivate);
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('tolerates a missing handler', () => {
    expect(() => handleKeyboardActivation(keyEvent('Enter'), undefined)).not.toThrow();
  });
});

describe('rowButtonProps', () => {
  // These props land on a <tr>. Declaring role="button" there replaces the
  // row's semantics: assistive tech stops announcing "row 3, Proyecto: QFF"
  // and announces a bare button instead, losing the column headers and the
  // position in the table. The row must stay a row and still be operable.
  it('does not override the table row semantics', () => {
    expect(rowButtonProps(vi.fn())).not.toHaveProperty('role');
  });

  it('keeps the row reachable and operable by keyboard', () => {
    const props = rowButtonProps(vi.fn());
    expect(props.tabIndex).toBe(0);
    expect(typeof props.onKeyDown).toBe('function');
    expect(typeof props.onClick).toBe('function');
  });

  it('activates on click and on Enter', () => {
    const onActivate = vi.fn();
    const props = rowButtonProps(onActivate);
    props.onClick(clickEvent());
    props.onKeyDown(keyEvent('Enter'));
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('lets a nested control handle its own activation', () => {
    const onActivate = vi.fn();
    const props = rowButtonProps(onActivate);
    const row = { id: 'row' };
    const nestedButton = { closest: (selector) => (selector.includes('button') ? {} : null) };

    props.onClick(clickEvent(nestedButton, row));
    props.onKeyDown(keyEvent('Enter', nestedButton, row));

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('still activates when the event comes from the row itself', () => {
    const onActivate = vi.fn();
    const props = rowButtonProps(onActivate);
    const row = { closest: () => ({}) };
    props.onClick(clickEvent(row, row));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('merges the caller className and keeps the pointer affordance', () => {
    expect(rowButtonProps(vi.fn(), 'hover:bg-x').className).toBe('cursor-pointer hover:bg-x');
    expect(rowButtonProps(vi.fn()).className).toBe('cursor-pointer');
  });
});
