type Props = { size?: number };

// DocVault mark: a document sheet with a vault/lock motif, in the brand gradient.
export function Logo({ size = 28 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="dv-g" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0" stopColor="#6753ff" />
          <stop offset="1" stopColor="#902af5" />
        </linearGradient>
      </defs>
      <rect x="4" y="2" width="24" height="28" rx="5" fill="url(#dv-g)" />
      <rect
        x="8.5"
        y="6.5"
        width="15"
        height="2.2"
        rx="1.1"
        fill="#fff"
        opacity="0.85"
      />
      <rect
        x="8.5"
        y="11"
        width="11"
        height="2.2"
        rx="1.1"
        fill="#fff"
        opacity="0.6"
      />
      <circle cx="16" cy="21" r="5.2" fill="#fff" />
      <circle cx="16" cy="20" r="2.1" fill="url(#dv-g)" />
      <rect x="15" y="20.5" width="2" height="3.6" rx="1" fill="url(#dv-g)" />
    </svg>
  );
}
