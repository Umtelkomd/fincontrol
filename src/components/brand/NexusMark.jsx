const NexusMark = ({ size = 28, title, className = '' }) => {
  const labelled = Boolean(title);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden={labelled ? undefined : true}
      role={labelled ? 'img' : undefined}
      className={className}
    >
      {title && <title>{title}</title>}
      <rect x="6" y="6" width="6" height="28" fill="var(--color-fg-1)" />
      <rect x="28" y="6" width="6" height="28" fill="var(--color-fg-1)" />
      <path d="M12 8 L28 32 L28 26 L12 2 Z" fill="var(--color-accent)" />
    </svg>
  );
};

export default NexusMark;
