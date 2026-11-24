import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onTokenScanned: (token: string) => void;
}

function extractToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const t = new URL(trimmed).searchParams.get('t')?.trim();
    if (t) return t;
  } catch {
    // Plain token format fallback
  }
  return /^\d+\.[A-Za-z0-9_-]{10,}$/.test(trimmed) ? trimmed : null;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  open,
  onClose,
  onTokenScanned,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let stopped = false;
    let stream: MediaStream | null = null;
    let rafId = 0;

    const cleanup = () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const start = async () => {
      setError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera is unavailable here. Use your phone Camera app to scan the venue QR.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped) {
          cleanup();
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const scan = () => {
          if (stopped) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (v && c && v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
            const w = Math.min(640, v.videoWidth);
            const h = Math.round((v.videoHeight / v.videoWidth) * w);
            if (c.width !== w || c.height !== h) {
              c.width = w;
              c.height = h;
            }
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, w, h);
              const decoded = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, {
                inversionAttempts: 'dontInvert',
              });
              const token = decoded?.data ? extractToken(decoded.data) : null;
              if (token) {
                cleanup();
                onTokenScanned(token);
                return;
              }
            }
          }
          rafId = requestAnimationFrame(scan);
        };
        rafId = requestAnimationFrame(scan);
      } catch {
        if (!stopped) {
          setError('Could not access camera. Allow camera permission or use your phone Camera app.');
        }
      }
    };

    void start();
    return cleanup;
  }, [open, onTokenScanned]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Scan venue QR code">
      <div className="modal">
        <div className="modal__head">
          <h3>Scan venue QR</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {error ? (
          <div className="banner banner--error">{error}</div>
        ) : (
          <div className="scanner-box">
            <video ref={videoRef} playsInline muted className="scanner-video" />
            <div className="scanner-guide" aria-hidden="true" />
            <canvas ref={canvasRef} hidden />
          </div>
        )}
        <p className="muted" style={{ textAlign: 'center' }}>
          Point your camera at the live QR displayed at the venue.
        </p>
        <button type="button" className="btn btn--secondary btn--full" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
};
