import React from 'react';
import { CheckInRecord } from '../lib/types';
import { formatDateLongLagos, formatTimeLagos } from '../lib/format';
import { Footer } from './Footer';

interface CheckInPassProps {
  record: CheckInRecord;
  venueName: string;
  onSignOut: () => void;
}

export const CheckInPass: React.FC<CheckInPassProps> = ({ record, venueName, onSignOut }) => (
  <section className="page page--pass">
    <div className="pass-top">
      <span className="pass-top__org">NYSC Surulere CDS</span>
      <span className="pass-top__state">
        {record.status === 'late' ? 'Late' : 'On time'}
      </span>
    </div>

    <div className="pass-number-block">
      <div className="pass-label">Arrival number</div>
      <div className="pass-number num">{record.number}</div>
    </div>

    <dl className="pass-receipt">
      <div className="pass-receipt__row">
        <dt>State code</dt>
        <dd className="mono">{record.code}</dd>
      </div>
      {record.name && (
        <div className="pass-receipt__row">
          <dt>Name</dt>
          <dd>{record.name}</dd>
        </div>
      )}
      <div className="pass-receipt__row">
        <dt>Clocked in</dt>
        <dd className="num">{formatTimeLagos(record.checkedInAtIso)}</dd>
      </div>
      <div className="pass-receipt__row">
        <dt>Date</dt>
        <dd>{formatDateLongLagos(record.checkedInAtIso)}</dd>
      </div>
      <div className="pass-receipt__row">
        <dt>Venue</dt>
        <dd>{venueName}</dd>
      </div>
      <div className="pass-receipt__row">
        <dt>Verification</dt>
        <dd>
          {record.method === 'manual'
            ? 'Exco manual'
            : [
                record.distanceM !== null ? `GPS (${record.distanceM} m)` : 'GPS',
                record.qrVerified ? 'Venue QR' : null,
              ]
                .filter(Boolean)
                .join(' + ')}
        </dd>
      </div>
    </dl>

    <p className="pass-note">Reopen this page anytime today to show your number.</p>

    <button type="button" className="link-btn link-btn--inv" onClick={onSignOut}>
      Sign out ({record.email || 'account'})
    </button>

    <Footer inverted />
  </section>
);
