// Filter registry. Each filter paints onto the compositing canvas AFTER the mirrored video,
// so it shows in the live mirror AND in the recording. k = intensity 0..1, th = theme palette.
export const THEMES = {
  cyber: { a: '#ff2d9b', b: '#8a2be2', c: '#c9ccd4', glow: '#ff2d9b' },
  luxe:  { a: '#ffb3d9', b: '#f5e6ee', c: '#e8e8ee', glow: '#ff9ccf' },
};
const sparkle = (x, h, w, n, th, k, t, g = '✦') => {
  x.save(); x.globalCompositeOperation = 'lighter'; x.textAlign = 'center';
  for (let i = 0; i < n * k; i++) {
    const s = (i * 9301 + 49297) % 233280 / 233280, px = s * w, py = (((i * 7919) % 1000) / 1000 * h + t * 0.03 * (20 + i % 40)) % h;
    x.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t / 400 + i)); x.font = 10 + (i % 5) * 7 + 'px serif';
    x.fillStyle = i % 2 ? '#fff' : th.a; x.fillText(g, px, py);
  } x.restore();
};
const tint = (x, w, h, col, a, mode = 'soft-light') => { x.save(); x.globalCompositeOperation = mode; x.globalAlpha = a; x.fillStyle = col; x.fillRect(0, 0, w, h); x.restore(); };

export const FILTERS = {
  original: { label: 'ORIGINAL', css: 'none', draw() {} },
  venom: { label: 'PINK VENOM', css: 'saturate(1.4) contrast(1.05)', glyph: '✦',
    draw(x, w, h, k, t, th) { tint(x, w, h, th.a, .5 * k); sparkle(x, h, w, 90, th, k, t); } },
  shutdown: { label: 'SHUT DOWN', css: 'grayscale(1) contrast(1.3) brightness(1.1)', glyph: '◈',
    draw(x, w, h, k, t, th) {
      const g = x.createLinearGradient(0, 0, w, h); const p = (t / 4000) % 1;
      g.addColorStop(Math.max(0, p - .2), '#fff0'); g.addColorStop(p, '#fffd'); g.addColorStop(Math.min(1, p + .2), '#fff0');
      x.save(); x.globalCompositeOperation = 'overlay'; x.globalAlpha = k; x.fillStyle = g; x.fillRect(0, 0, w, h); x.restore();
      tint(x, w, h, th.c, .25 * k); } },
  butterfly: { label: 'BUTTERFLY', css: 'saturate(1.2) brightness(1.1)', glyph: '🦋',
    draw(x, w, h, k, t, th) { tint(x, w, h, th.a, .3 * k); sparkle(x, h, w, 14, th, k, t, '🦋'); sparkle(x, h, w, 40, th, k, t, '·'); } },
  killthislove: { label: 'KILL THIS LOVE', css: 'saturate(1.6) contrast(1.2) hue-rotate(-12deg)', glyph: '▮',
    draw(x, w, h, k, t, th, cv) {
      tint(x, w, h, '#ff1744', .35 * k);
      if (Math.random() < .3 * k) { const y = Math.random() * h, s = 8 + Math.random() * 50; x.drawImage(cv, 0, y, w, s, (Math.random() - .5) * 60 * k, y, w, s); }
      x.save(); x.globalCompositeOperation = 'screen'; x.globalAlpha = .25 * k; x.fillStyle = '#0ff'; x.fillRect((Math.random() - .5) * 8 * k, 0, w, h); x.restore(); } },
  howyoulikethat: { label: 'HOW YOU LIKE THAT', css: 'contrast(1.2) saturate(1.5) hue-rotate(20deg)', glyph: '✧',
    draw(x, w, h, k, t, th) {
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, th.a); g.addColorStop(1, th.b);
      tint(x, w, h, '#000', .25 * k, 'multiply');
      x.save(); x.globalCompositeOperation = 'color-dodge'; x.globalAlpha = .3 * k; x.fillStyle = g; x.fillRect(0, 0, w, h); x.restore();
      const v = x.createRadialGradient(w / 2, h / 2, h * .3, w / 2, h / 2, h * .8); v.addColorStop(0, '#0000'); v.addColorStop(1, '#000a'); x.fillStyle = v; x.fillRect(0, 0, w, h); } },
  diamond: { label: 'DIAMOND', css: 'brightness(1.15) contrast(1.1)', glyph: '◆',
    draw(x, w, h, k, t, th) { tint(x, w, h, '#fff', .15 * k); sparkle(x, h, w, 40, th, k, t, '◆'); sparkle(x, h, w, 60, th, k, t, '✧'); } },
};
