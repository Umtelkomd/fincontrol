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

export const rowButtonProps = (onActivate, className = '') => ({
  role: 'button',
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
