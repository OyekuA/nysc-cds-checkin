import React from 'react';

interface FooterProps {
  inverted?: boolean;
  showAdminLink?: boolean;
}

export const Footer: React.FC<FooterProps> = ({ inverted = false, showAdminLink = false }) => (
  <footer className={`footer${inverted ? ' footer--inv' : ''}`}>
    <div>Courtesy of NYSC 2026/2027 ICT Excos</div>
    <div>Designed by Alozor Kingsley · Sponsored by Seamflux Technologies</div>
    {showAdminLink && (
      <div className="footer__links">
        <a href="/admin">Exco Admin</a>
      </div>
    )}
  </footer>
);
