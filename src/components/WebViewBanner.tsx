import React, { useState } from 'react';
import { InAppBrowserInfo, buildAndroidChromeIntentUrl } from '../lib/auth';

interface WebViewBannerProps {
  info: InAppBrowserInfo;
}

export const WebViewBanner: React.FC<WebViewBannerProps> = ({ info }) => {
  const [copied, setCopied] = useState(false);
  if (!info.isInApp) return null;

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this link and open it in Chrome or Safari:', currentUrl);
    }
  };

  return (
    <div className="banner banner--warn" role="alert">
      <strong>Open in {info.isIOS ? 'Safari' : 'Chrome'} to sign in</strong>
      <p>
        Google blocks sign-in inside {info.appName || 'in-app browsers'}.{' '}
        {info.isIOS
          ? 'Tap the Safari icon or ⋯ menu and choose Open in Safari.'
          : 'Tap the ⋮ menu and choose Open in Chrome.'}
      </p>
      <div className="inline-actions">
        {info.isAndroid && (
          <a className="btn btn--sm btn--primary" href={buildAndroidChromeIntentUrl(currentUrl)}>
            Open in Chrome
          </a>
        )}
        <button type="button" className="btn btn--sm btn--secondary" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  );
};
