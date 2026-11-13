// Orbe de partículas (canvas). Diseño de la maqueta aprobada, sin cambios visuales.
// El estado visual lo fija main.js con setVisual(): idle | listening | thinking | speaking | permission | error
const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let state = "idle";
export function setVisual(v) { state = v; }

export function initOrb(cv) {
  var ctx = cv.getContext("2d");
  var W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  window.addEventListener("resize", resize); resize();
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv); // el lienzo cambia de tamaño sin que cambie la ventana (hojas, giro, teclado)

    var N = 1100, pts = [];
    var ga = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      var y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = ga * i;
      pts.push({ x: Math.cos(th) * rr, y: y, z: Math.sin(th) * rr, k: Math.sin(i * 12.9898) * 0.5 + 0.5 });
    }
    var P = {
      idle:       { c: [63, 216, 255], spin: 0.18, amp: 0.02, ring: 0.25, glow: 0.5, pulse: 0.5 },
      listening:  { c: [90, 235, 255], spin: 0.3,  amp: 0.16, ring: 0.5,  glow: 0.8, pulse: 0 },
      thinking:   { c: [63, 190, 255], spin: 0.9,  amp: 0.07, ring: 2.4,  glow: 1.0, pulse: 0 },
      speaking:   { c: [120, 240, 255], spin: 0.3, amp: 0.12, ring: 0.6,  glow: 0.95, pulse: 1 },
      permission: { c: [255, 178, 63], spin: 0.12, amp: 0.03, ring: 0.2,  glow: 0.7, pulse: 0.6 },
      error:      { c: [255, 77, 94],  spin: 0.05, amp: 0.05, ring: 0.1,  glow: 0.4, pulse: 0.3 }
    };
    var cur = JSON.parse(JSON.stringify(P.idle));
    function lerp(a, b, t) { return a + (b - a) * t; }
    var yaw = 0, ringT = 0, last = performance.now();
  
    function ringPoints(tilt, rot, R, out) {
      var ct = Math.cos(tilt), st = Math.sin(tilt);
      for (var a = 0; a <= 120; a++) {
        var t = a / 120 * Math.PI * 2;
        var x = Math.cos(t), z = Math.sin(t), y = 0;
        var y1 = y * ct - z * st, z1 = y * st + z * ct;
        var cr = Math.cos(rot), sr = Math.sin(rot);
        var x2 = x * cr + z1 * sr, z2 = -x * sr + z1 * cr;
        out.push([x2 * R, y1 * R, z2 * R]);
      }
    }
  
    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      var tg = P[state], k = 1 - Math.pow(0.02, dt);
      for (var q = 0; q < 3; q++) cur.c[q] = lerp(cur.c[q], tg.c[q], k);
      cur.spin = lerp(cur.spin, tg.spin, k); cur.amp = lerp(cur.amp, tg.amp, k);
      cur.ring = lerp(cur.ring, tg.ring, k); cur.glow = lerp(cur.glow, tg.glow, k);
      var sp = reduce ? 0.25 : 1;
      yaw += dt * cur.spin * sp; ringT += dt * cur.ring * sp;
      var T = now / 1000;
  
      var lvl = 0;
      if (state === "listening") lvl = 0.45 + 0.35 * Math.sin(T * 7) * Math.sin(T * 2.3) + 0.2 * Math.sin(T * 17.3);
      else if (state === "speaking") lvl = 0.5 + 0.5 * Math.abs(Math.sin(T * 5.1) * Math.sin(T * 1.7 + 1));
      else if (state === "thinking") lvl = 0.3 + 0.3 * Math.sin(T * 3);
      else if (state === "idle" || state === "permission") lvl = 0.5 + 0.5 * Math.sin(T * 1.3);
      else lvl = 0.2 + 0.2 * Math.sin(T * 0.8);
      if (reduce) lvl = 0.4;
      lvl = Math.max(0, Math.min(1, lvl));
  
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var cx = W / 2, cy = H / 2 - H * 0.02, R = Math.min(W, H) * 0.25;
      var col = Math.round(cur.c[0]) + "," + Math.round(cur.c[1]) + "," + Math.round(cur.c[2]);
      ctx.globalCompositeOperation = "lighter";
  
      /* halo */
      var gr = R * (1.9 + 0.25 * lvl * cur.glow);
      var g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, gr);
      g.addColorStop(0, "rgba(" + col + "," + (0.30 * cur.glow) + ")");
      g.addColorStop(0.5, "rgba(" + col + "," + (0.08 * cur.glow) + ")");
      g.addColorStop(1, "rgba(" + col + ",0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  
      /* anillo exterior con marcas */
      var Ro = R * 1.95;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(" + col + ",0.35)";
      for (var t = 0; t < 90; t++) {
        var a = t / 90 * Math.PI * 2 + ringT * 0.15;
        var l = t % 5 === 0 ? 10 : 5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * Ro, cy + Math.sin(a) * Ro);
        ctx.lineTo(cx + Math.cos(a) * (Ro - l), cy + Math.sin(a) * (Ro - l));
        ctx.stroke();
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgba(" + col + ",0.75)";
      ctx.beginPath(); ctx.arc(cx, cy, Ro + 10, ringT * 0.5, ringT * 0.5 + 1.1); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, Ro + 10, ringT * 0.5 + Math.PI, ringT * 0.5 + Math.PI + 0.6); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(" + col + ",0.3)";
      ctx.beginPath(); ctx.arc(cx, cy, Ro + 22, -ringT * 0.35, -ringT * 0.35 + 2.2); ctx.stroke();
      ctx.setLineDash([2, 7]);
      ctx.beginPath(); ctx.arc(cx, cy, Ro - 18, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
  
      /* esfera de partículas */
      var cyw = Math.cos(yaw), syw = Math.sin(yaw), tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
      for (var i = 0; i < N; i++) {
        var p = pts[i];
        var wob = 1 + cur.amp * lvl * (Math.sin(i * 0.37 + T * 6) * 0.6 + Math.sin(i * 1.7 + T * 3) * 0.4 + 0.3);
        var x = p.x * wob, y = p.y * wob, z = p.z * wob;
        var x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
        var y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
        var per = 1 / (1.9 - z2 * 0.8);
        var sx = cx + x1 * R * per * 1.7, sy = cy + y2 * R * per * 1.7;
        var depth = (z2 + 1) / 2;
        var al = (0.12 + 0.88 * depth) * (0.5 + 0.5 * p.k) * cur.glow;
        var s = (0.5 + 1.6 * depth) * (0.8 + 0.4 * p.k);
        ctx.fillStyle = "rgba(" + col + "," + al.toFixed(3) + ")";
        ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
      }
  
      /* anillos 3D */
      var rp = [];
      for (var rI = 0; rI < 3; rI++) {
        rp.length = 0;
        ringPoints(0.5 + rI * 0.9, ringT * (rI % 2 ? -1 : 1) * (0.6 + rI * 0.35), R * (1.18 + rI * 0.16 + 0.04 * lvl), rp);
        for (var j = 1; j < rp.length; j++) {
          var a0 = rp[j - 1], b0 = rp[j];
          var d = (b0[2] / (R * 1.5) + 1) / 2;
          function pr(v) { var yy = v[1] * ct - v[2] * st, zz = v[1] * st + v[2] * ct; var pp = 1 / (1.9 - zz / R * 0.8); return [cx + v[0] * pp * 1.7, cy + yy * pp * 1.7]; }
          var A = pr(a0), B = pr(b0);
          ctx.strokeStyle = "rgba(" + col + "," + (0.12 + 0.6 * Math.max(0, Math.min(1, d))).toFixed(3) + ")";
          ctx.lineWidth = rI === 0 ? 1.6 : 1;
          ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
        }
      }
  
      /* núcleo */
      var cr = R * (0.28 + 0.1 * lvl);
      var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 2.2);
      cg.addColorStop(0, "rgba(255,255,255," + (0.55 * cur.glow) + ")");
      cg.addColorStop(0.25, "rgba(" + col + "," + (0.5 * cur.glow) + ")");
      cg.addColorStop(1, "rgba(" + col + ",0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr * 2.2, 0, Math.PI * 2); ctx.fill();
  
      /* línea de escaneo suave */
      ctx.globalCompositeOperation = "source-over";
      if (!reduce) {
        var sy2 = ((T * 60) % (H + 80)) - 40;
        var sg = ctx.createLinearGradient(0, sy2 - 30, 0, sy2 + 30);
        sg.addColorStop(0, "rgba(" + col + ",0)"); sg.addColorStop(0.5, "rgba(" + col + ",0.05)"); sg.addColorStop(1, "rgba(" + col + ",0)");
        ctx.fillStyle = sg; ctx.fillRect(0, sy2 - 30, W, 60);
      }
      requestAnimationFrame(frame);
    }
  
    requestAnimationFrame(frame);
}
