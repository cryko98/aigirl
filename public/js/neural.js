// Neurális háttér: lebegő csomópontok, kapcsolatok, impulzusok, egérre reagál.
export function startNeural(canvas) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;
  let nodes = [];
  let pulses = [];
  let mouse = { x: -9999, y: -9999 };
  let hue = 190;
  let energy = 0; // 0..1, "gondolkodás" esetén nő

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(160, (W * H) / 11000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25,
      r: 1 + Math.random() * 1.6, p: Math.random() * Math.PI * 2,
    }));
  }
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", e => { mouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
  resize();

  const LINK = 130;
  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    energy += (0 - energy) * 0.01;
    const speed = 1 + energy * 2.5;

    for (const n of nodes) {
      n.x += n.vx * speed; n.y += n.vy * speed;
      const dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 160 * 160) { const f = (1 - Math.sqrt(d2) / 160) * .06; n.x += dx * f; n.y += dy * f; }
      if (n.x < -20) n.x = W + 20; if (n.x > W + 20) n.x = -20;
      if (n.y < -20) n.y = H + 20; if (n.y > H + 20) n.y = -20;
    }

    // kapcsolatok
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d < LINK) {
          const alpha = (1 - d / LINK) * (0.18 + energy * 0.35);
          ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${alpha})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          if (Math.random() < 0.0006 * (1 + energy * 8)) pulses.push({ a, b, t: 0 });
        }
      }
    }

    // csomópontok
    for (const n of nodes) {
      const tw = 0.5 + 0.5 * Math.sin(t * 0.002 + n.p);
      ctx.fillStyle = `hsla(${hue}, 100%, 75%, ${0.35 + tw * 0.4})`;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    }

    // impulzusok
    pulses = pulses.filter(p => p.t < 1);
    for (const p of pulses) {
      p.t += 0.03;
      const x = p.a.x + (p.b.x - p.a.x) * p.t, y = p.a.y + (p.b.y - p.a.y) * p.t;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 8);
      g.addColorStop(0, `hsla(${hue}, 100%, 85%, .9)`); g.addColorStop(1, `hsla(${hue}, 100%, 70%, 0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setHue: h => { hue = h; },
    burst: (amt = 1) => { energy = Math.min(1, energy + amt); },
  };
}
