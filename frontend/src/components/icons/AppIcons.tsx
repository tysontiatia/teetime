type IconProps = {
  size?: number;
  /** Stroke width; bumped slightly when `active` is true. */
  strokeWidth?: number;
  active?: boolean;
  className?: string;
};

function sw({ strokeWidth = 1.9, active }: Pick<IconProps, 'strokeWidth' | 'active'>) {
  return active ? strokeWidth + 0.3 : strokeWidth;
}

/** Primary nav + find surfaces — search / book tee times. */
export function FindIcon({ size = 18, strokeWidth = 1.9, active, className }: IconProps) {
  const w = sw({ strokeWidth, active });
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth={w} />
      <path d="M16.2 16.2L20 20" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
    </svg>
  );
}

/** Alerts nav, header, and course alert actions. */
export function AlertsIcon({ size = 18, strokeWidth = 1.9, active, className }: IconProps) {
  const w = sw({ strokeWidth, active });
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M18 9a6 6 0 10-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9ZM10 20a2.2 2.2 0 004 0"
        stroke="currentColor"
        strokeWidth={w}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Plan nav, shared rounds, and “plan a round” actions. */
export function PlanIcon({ size = 18, strokeWidth = 1.9, active, className }: IconProps) {
  const w = sw({ strokeWidth, active });
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 3v3M16 3v3" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
      <rect x="4" y="5" width="16" height="16" rx="2.5" stroke="currentColor" strokeWidth={w} />
      <path d="M4 10h16" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
      <path d="M8 14h3.5M13.5 14H17M8 17.5h3.5" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
    </svg>
  );
}
