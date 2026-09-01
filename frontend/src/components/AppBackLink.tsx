import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { canNavigateBack } from '../lib/appBack';

/** In-app Back: previous screen when we have SPA history, otherwise `to`. */
export function AppBackLink({
  to = '/',
  className,
  style,
  children = 'Back',
}: {
  to?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const navigate = useNavigate();

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (!canNavigateBack()) return;
    e.preventDefault();
    navigate(-1);
  };

  return (
    <Link to={to} className={className} style={style} onClick={onClick}>
      {children}
    </Link>
  );
}
