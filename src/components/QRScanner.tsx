import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import './QRScanner.css';

interface Props {
  onResult: (text: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const scanner = new QrScanner(
      video,
      (result) => {
        const text = typeof result === 'string' ? result : result.data;
        onResult(text);
        scanner.stop();
      },
      {
        returnDetailedScanResult: true,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        preferredCamera: 'environment',
      }
    );
    scannerRef.current = scanner;

    scanner.start().catch((err: Error) => {
      setError('Não foi possível acessar a câmera: ' + (err.message || err));
    });

    return () => {
      scanner.stop();
      scanner.destroy();
    };
  }, [onResult]);

  const handleClose = () => {
    if (scannerRef.current) {
      scannerRef.current.stop();
      scannerRef.current.destroy();
    }
    onClose();
  };

  return (
    <div className="qr-scanner-overlay" onClick={handleClose}>
      <div className="qr-scanner-card" onClick={(e) => e.stopPropagation()}>
        <div className="qr-scanner-header">
          <h3>📷 Ler QR Code</h3>
          <button className="qr-scanner-close" onClick={handleClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="qr-scanner-video-wrap">
          <video ref={videoRef} className="qr-scanner-video" playsInline muted />
          {error && <div className="qr-scanner-error">{error}</div>}
        </div>
        <p className="qr-scanner-hint">
          Aponte a câmera para um QR Code com nsec ou ncryptsec.
        </p>
      </div>
    </div>
  );
}
