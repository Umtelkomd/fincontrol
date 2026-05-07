/**
 * NEXUS.OS — Button
 *
 * Variants:
 *   primary   → Accent #FF4D2E on ink, the only "filled" CTA
 *   secondary → Surface raised + border, neutral
 *   ghost     → Transparent + border, lower emphasis
 *   danger    → Outline accent, irreversible actions
 *
 * Sizes: sm (28px tall) · md (36px tall, default)
 *
 * Rules:
 *   - Never use arbitrary filled color solids — use this component.
 *   - Icons are 14px (sm) or 16px (md).
 *   - Loading state replaces icon with spinner, disables the button.
 */
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

const VARIANT = {
  primary:   'nx-btn nx-btn-primary',
  secondary: 'nx-btn nx-btn-secondary',
  ghost:     'nx-btn nx-btn-ghost',
  danger:    'nx-btn nx-btn-danger',
};

const SIZE = {
  sm: 'nx-btn-sm',
  md: '',
};

const ICON_SIZE = { sm: 12, md: 14 };

const Button = forwardRef(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    disabled = false,
    children,
    className = '',
    type = 'button',
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;
  const iconSize = ICON_SIZE[size];

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={`${VARIANT[variant] || VARIANT.secondary} ${SIZE[size] || ''} ${
        isDisabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : (
        Icon && <Icon size={iconSize} />
      )}
      {children && <span>{children}</span>}
      {!loading && IconRight && <IconRight size={iconSize} />}
    </button>
  );
});

export default Button;
