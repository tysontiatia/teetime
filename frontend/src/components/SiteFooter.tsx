import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { StayLogo } from '../stay/StayLogo';

const INSTAGRAM_URL = 'https://www.instagram.com/teetimehq/';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      {children}
    </svg>
  );
}

function InstagramIcon() {
  return (
    <Icon>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" />
    </Icon>
  );
}

function TikTokIcon() {
  return (
    <Icon>
      <path d="M14 6.5c.7 2.4 2.2 3.8 4.5 4.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 6.2v8.4a3.6 3.6 0 1 1-3.6-3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

function XIcon() {
  return (
    <Icon>
      <path d="M5 5l14 14M19 5 5 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </Icon>
  );
}

function FacebookIcon() {
  return (
    <Icon>
      <path d="M14 8h2.2V5.2H14c-2.3 0-3.6 1.4-3.6 3.6V11H8.2v2.8H10.4V20h2.8v-6.2h2.3L16 11h-2.8V9.1c0-.7.3-1.1.8-1.1Z" fill="currentColor" />
    </Icon>
  );
}

function YouTubeIcon() {
  return (
    <Icon>
      <rect x="3" y="6.5" width="18" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11 9.5v5l4.5-2.5L11 9.5Z" fill="currentColor" />
    </Icon>
  );
}

function Soon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="stay-social is-soon" role="img" aria-label={`${label}, coming soon`} title="Coming soon">
      {children}
    </span>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="stay-foot">
      <div className="stay-foot-grid">
        <div className="stay-foot-brand">
          <StayLogo />
          <p>Live tee times from every course, in one Find. Book direct.</p>
          <div className="stay-socials">
            <a className="stay-social" href={INSTAGRAM_URL} target="_blank" rel="noreferrer" aria-label="Instagram">
              <InstagramIcon />
            </a>
            <Soon label="TikTok"><TikTokIcon /></Soon>
            <Soon label="X"><XIcon /></Soon>
            <Soon label="Facebook"><FacebookIcon /></Soon>
            <Soon label="YouTube"><YouTubeIcon /></Soon>
          </div>
        </div>
        <nav aria-label="Explore">
          <h2>Explore</h2>
          <Link to="/">Find tee times</Link>
          <Link to="/search">Search</Link>
          <a href="/tee-times">Tee times by city</a>
          <a href="/#states">Request your state</a>
        </nav>
        <nav aria-label="Product">
          <h2>Product</h2>
          <Link to="/account">Alerts</Link>
          <Link to="/plan">Plan a round</Link>
          <a href="/#faq">FAQ</a>
          <a href="mailto:support@tee-time.io">Contact</a>
        </nav>
        <nav aria-label="Legal">
          <h2>Legal</h2>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
        </nav>
      </div>
      <div className="stay-foot-note">
        <span>© {year} Tee-Time.io</span>
        <span>Not affiliated with any booking provider.</span>
        <span>Made with ❤️ in Salt Lake City</span>
      </div>
    </footer>
  );
}
