import { useEffect, useRef } from 'react';

export function FinanceAnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const currencySymbols = ['$', '€', '£', '¥', '₦', '₵', 'GH₵', '₿', 'KES', 'ZAR', 'XOF', 'USDC'];
    const financeIcons = ['↗', '↘', '◆', '⬡', '⊕', '⟐'];

    interface FloatingSymbol {
      x: number; y: number; vx: number; vy: number;
      symbol: string; size: number; opacity: number; maxOpacity: number;
      rotation: number; rotationSpeed: number; color: string;
      pulsePhase: number; pulseSpeed: number; weight: string;
    }

    interface ChartLine {
      speed: number; opacity: number; color: string;
      yOffset: number; amplitude: number; frequency: number; phase: number;
      lineWidth: number;
    }

    interface GlowOrb {
      x: number; y: number; vx: number; vy: number;
      radius: number; color: string; opacity: number;
    }

    const colors = [
      'rgba(59, 130, 246, ',    // primary blue #3B82F6
      'rgba(59, 130, 246, ',    // primary blue (weighted)
      'rgba(30, 58, 95, ',      // navy #1E3A5F
      'rgba(37, 99, 235, ',     // deeper blue #2563EB
      'rgba(96, 165, 250, ',    // lighter blue #60A5FA
      'rgba(16, 185, 129, ',    // success teal #10B981
      'rgba(234, 179, 8, ',     // warning gold #EAB308
      'rgba(30, 64, 110, ',     // navy accent
    ];

    const symbols: FloatingSymbol[] = [];
    const symbolCount = Math.min(40, Math.floor(width * height / 18000));
    const allSymbols = [...currencySymbols, ...financeIcons];
    const weights = ['600', '700', '800', '900'];

    for (let i = 0; i < symbolCount; i++) {
      symbols.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.9,
        vy: -Math.random() * 0.4 - 0.1,
        symbol: allSymbols[Math.floor(Math.random() * allSymbols.length)],
        size: Math.random() * 36 + 20,
        opacity: Math.random() * 0.3,
        maxOpacity: Math.random() * 0.45 + 0.2,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.006,
        color: colors[Math.floor(Math.random() * colors.length)],
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.025 + 0.01,
        weight: weights[Math.floor(Math.random() * weights.length)],
      });
    }

    const chartLines: ChartLine[] = [];
    for (let i = 0; i < 5; i++) {
      chartLines.push({
        speed: Math.random() * 0.5 + 0.3,
        opacity: Math.random() * 0.25 + 0.1,
        color: colors[Math.floor(Math.random() * colors.length)],
        yOffset: height * (0.15 + Math.random() * 0.7),
        amplitude: Math.random() * 70 + 30,
        frequency: Math.random() * 0.008 + 0.003,
        phase: Math.random() * Math.PI * 2,
        lineWidth: Math.random() * 2 + 1.5,
      });
    }

    const orbs: GlowOrb[] = [];
    for (let i = 0; i < 6; i++) {
      orbs.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: Math.random() * 200 + 100,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: Math.random() * 0.1 + 0.04,
      });
    }

    let tick = 0;

    function draw() {
      tick++;
      ctx!.clearRect(0, 0, width, height);

      orbs.forEach(orb => {
        orb.x += orb.vx;
        orb.y += orb.vy;
        if (orb.x < -orb.radius) orb.x = width + orb.radius;
        if (orb.x > width + orb.radius) orb.x = -orb.radius;
        if (orb.y < -orb.radius) orb.y = height + orb.radius;
        if (orb.y > height + orb.radius) orb.y = -orb.radius;

        const gradient = ctx!.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.radius);
        gradient.addColorStop(0, `${orb.color}${orb.opacity * 2})`);
        gradient.addColorStop(0.5, `${orb.color}${orb.opacity})`);
        gradient.addColorStop(1, `${orb.color}0)`);
        ctx!.fillStyle = gradient;
        ctx!.beginPath();
        ctx!.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
        ctx!.fill();
      });

      chartLines.forEach(chart => {
        chart.phase += chart.speed * 0.01;

        ctx!.beginPath();
        ctx!.strokeStyle = `${chart.color}${chart.opacity})`;
        ctx!.lineWidth = chart.lineWidth;
        ctx!.lineCap = 'round';
        ctx!.lineJoin = 'round';

        for (let x = 0; x <= width; x += 2) {
          const y = chart.yOffset +
            Math.sin(x * chart.frequency + chart.phase) * chart.amplitude +
            Math.sin(x * chart.frequency * 2.3 + chart.phase * 1.7) * (chart.amplitude * 0.4) +
            Math.cos(x * chart.frequency * 0.7 + chart.phase * 0.5) * (chart.amplitude * 0.3);
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.stroke();

        const gradientFill = ctx!.createLinearGradient(0, chart.yOffset - chart.amplitude, 0, chart.yOffset + chart.amplitude * 2.5);
        gradientFill.addColorStop(0, `${chart.color}${chart.opacity * 0.25})`);
        gradientFill.addColorStop(1, `${chart.color}0)`);
        ctx!.fillStyle = gradientFill;
        ctx!.beginPath();
        for (let x = 0; x <= width; x += 2) {
          const y = chart.yOffset +
            Math.sin(x * chart.frequency + chart.phase) * chart.amplitude +
            Math.sin(x * chart.frequency * 2.3 + chart.phase * 1.7) * (chart.amplitude * 0.4) +
            Math.cos(x * chart.frequency * 0.7 + chart.phase * 0.5) * (chart.amplitude * 0.3);
          if (x === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.lineTo(width, height);
        ctx!.lineTo(0, height);
        ctx!.closePath();
        ctx!.fill();
      });

      symbols.forEach(s => {
        s.x += s.vx;
        s.y += s.vy;
        s.rotation += s.rotationSpeed;
        s.pulsePhase += s.pulseSpeed;

        if (s.opacity < s.maxOpacity) s.opacity += 0.005;

        const pulse = Math.sin(s.pulsePhase) * 0.2 + 1;
        const currentOpacity = s.opacity * pulse;

        if (s.y < -60) { s.y = height + 60; s.x = Math.random() * width; }
        if (s.x < -60) s.x = width + 60;
        if (s.x > width + 60) s.x = -60;

        ctx!.save();
        ctx!.translate(s.x, s.y);
        ctx!.rotate(s.rotation);

        const fontSize = s.size * pulse;
        ctx!.font = `${s.weight} ${fontSize}px "Inter", "SF Pro", system-ui, sans-serif`;
        ctx!.textAlign = 'center';
        ctx!.textBaseline = 'middle';

        ctx!.shadowColor = `${s.color}0.5)`;
        ctx!.shadowBlur = 20;
        ctx!.fillStyle = `${s.color}${currentOpacity})`;
        ctx!.fillText(s.symbol, 0, 0);

        ctx!.shadowBlur = 0;
        ctx!.strokeStyle = `${s.color}${currentOpacity * 0.4})`;
        ctx!.lineWidth = 1;
        ctx!.strokeText(s.symbol, 0, 0);

        ctx!.restore();
      });

      const gridOpacity = 0.05;
      ctx!.strokeStyle = `rgba(59, 130, 246, ${gridOpacity})`;
      ctx!.lineWidth = 0.5;
      const gridSize = 55;
      const gridOffset = (tick * 0.2) % gridSize;
      for (let x = -gridSize + gridOffset; x < width + gridSize; x += gridSize) {
        ctx!.beginPath();
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, height);
        ctx!.stroke();
      }
      for (let y = -gridSize + gridOffset; y < height + gridSize; y += gridSize) {
        ctx!.beginPath();
        ctx!.moveTo(0, y);
        ctx!.lineTo(width, y);
        ctx!.stroke();
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}
