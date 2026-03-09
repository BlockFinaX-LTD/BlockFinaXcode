import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
}

export function QRCodeComponent({ value, size = 200, className = '' }: QRCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !value) return;

    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    }, () => {
    });
  }, [value, size]);

  if (!value) {
    return (
      <div 
        className={`bg-slate-200 dark:bg-slate-600 rounded-lg flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-slate-500 text-sm">No data</span>
      </div>
    );
  }

  return (
    <canvas 
      ref={canvasRef}
      className={`rounded-lg ${className}`}
    />
  );
}
