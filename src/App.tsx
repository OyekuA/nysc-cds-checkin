import React, { Suspense, lazy } from 'react';
import { CheckInPage } from './pages/CheckInPage';

const AdminPage = lazy(() =>
  import('./pages/AdminPage').then((m) => ({ default: m.AdminPage }))
);
const QrDisplayPage = lazy(() =>
  import('./pages/QrDisplayPage').then((m) => ({ default: m.QrDisplayPage }))
);

function resolveRoute(): 'checkin' | 'admin' | 'qr' {
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  if (path.endsWith('/admin') || path.endsWith('/admin.html')) return 'admin';
  if (path.endsWith('/qr') || path.endsWith('/qr.html')) return 'qr';
  return 'checkin';
}

const PageLoader: React.FC = () => (
  <div className="auth-gate">
    <div className="center-state">
      <div className="spinner" />
      <p className="muted">Loading...</p>
    </div>
  </div>
);

export const App: React.FC = () => {
  const route = resolveRoute();
  if (route === 'admin') {
    return (
      <Suspense fallback={<PageLoader />}>
        <AdminPage />
      </Suspense>
    );
  }
  if (route === 'qr') {
    return (
      <Suspense fallback={<PageLoader />}>
        <QrDisplayPage />
      </Suspense>
    );
  }
  return <CheckInPage />;
};
