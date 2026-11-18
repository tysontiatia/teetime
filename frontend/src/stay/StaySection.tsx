import { SiteFooter } from '../components/SiteFooter';
import { StayAccount, StayPrimaryNav } from './StayHeader';
import { StayLogo } from './StayLogo';
import './stay.css';

export function StaySection({ title, children }: { title: string; children: string }) {
  return (
    <div className="stay">
      <header className="stay-header">
        <div className="stay-top">
          <StayLogo />
          <nav className="stay-top-center" aria-label="Primary">
            <StayPrimaryNav />
          </nav>
          <StayAccount />
          <h1 className="stay-phone-title">{title}</h1>
        </div>
      </header>
      <main className="stay-main">
        <h1 className="stay-section-title">{title}</h1>
        <p className="stay-section-copy">{children}</p>
      </main>
      <SiteFooter />
    </div>
  );
}
