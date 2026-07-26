export const isActivationKey = (event) => event.key === 'Enter' || event.key === ' ';

export const handleKeyboardActivation = (event, onActivate) => {
  if (!isActivationKey(event)) return;
  event.preventDefault();
  onActivate?.(event);
};

const isFromInteractiveDescendant = (event) => {
  if (event.target === event.currentTarget) return false;
  return Boolean(
    event.target.closest?.('button, a, input, select, textarea, [role="button"], [role="link"]'),
  );
};

/**
 * Makes a table row clickable without destroying it.
 *
 * These props land on a <tr>, so no role is set: role="button" would replace
 * the row semantics and assistive tech would announce a bare button instead of
 * "row 3, Proyecto: QFF", dropping the column headers and the position in the
 * table. The row stays a row, and tabIndex plus the key handler keep it
 * operable without a mouse.
 */
export const rowButtonProps = (onActivate, className = '') => ({
  tabIndex: 0,
  onClick: (event) => {
    if (isFromInteractiveDescendant(event)) return;
    onActivate?.(event);
  },
  onKeyDown: (event) => {
    if (isFromInteractiveDescendant(event)) return;
    handleKeyboardActivation(event, onActivate);
  },
  className: `cursor-pointer ${className}`.trim(),
});
