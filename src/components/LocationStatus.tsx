import React from 'react';
import { GpsState } from '../lib/geolocation';

interface LocationStatusProps {
  gps: GpsState;
  radiusM: number;
  venueName: string;
  onRefresh: () => void;
}

export const LocationStatus: React.FC<LocationStatusProps> = ({
  gps,
  radiusM,
  venueName,
  onRefresh,
}) => {
  const fix = gps.fix;
  const inRange =
    fix?.distanceM !== null && fix?.distanceM !== undefined && fix.distanceM <= radiusM;

  let tone = 'neutral';
  if (gps.phase === 'locked') tone = inRange ? 'ok' : 'warn';
  else if (gps.phase === 'error') tone = 'error';
  else if (gps.isApproximateSuspected) tone = 'warn';

  const needsGuide =
    gps.isApproximateSuspected ||
    gps.errorCode === 'permission_denied' ||
    gps.errorCode === 'stale_only';

  return (
    <div className={`loc-row loc-row--${tone}`}>
      <div className="loc-row__top">
        <div className="loc-row__title">
          <span className={`dot dot--${tone}`} aria-hidden="true" />
          <span>
            {gps.phase === 'idle' && 'Location'}
            {gps.phase === 'acquiring' && 'Checking live GPS...'}
            {gps.phase === 'filtering_stale' && 'Refreshing stale location...'}
            {gps.phase === 'refining' && 'Refining GPS lock...'}
            {gps.phase === 'locked' && (inRange ? 'At venue' : 'Outside venue radius')}
            {gps.phase === 'error' && 'Location required'}
          </span>
        </div>
        <button
          type="button"
          className="link-btn"
          onClick={onRefresh}
          disabled={gps.phase === 'acquiring'}
        >
          {gps.phase === 'idle' ? 'Check now' : 'Refresh'}
        </button>
      </div>

      <p className="loc-row__detail">
        {gps.phase === 'locked' && fix ? (
          <>
            <span className="num">
              {fix.distanceM !== null ? `${fix.distanceM} m` : 'Locked'}
            </span>
            {fix.distanceM !== null && ` of ${radiusM} m allowed`} · accuracy{' '}
            <span className="num">±{fix.accuracyM} m</span> ·{' '}
            {fix.ageMs < 2000 ? 'live' : `${Math.round(fix.ageMs / 1000)}s ago`}
          </>
        ) : (
          gps.message
        )}
      </p>

      {gps.phase === 'locked' && !inRange && (
        <p className="loc-row__help">
          Move closer to {venueName} and tap Refresh.
        </p>
      )}

      {needsGuide && (
        <div className="loc-row__help">
          <strong>Enable Precise Location:</strong>
          <ul>
            <li>
              <strong>Android Chrome:</strong> Site icon in address bar → Permissions → Location →
              Use precise location.
            </li>
            <li>
              <strong>iPhone Safari:</strong> Settings → Privacy &amp; Security → Location Services
              → Safari Websites → Precise Location.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};
