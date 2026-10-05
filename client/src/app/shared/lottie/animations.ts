// Hand-built Lottie animations (no external files or CDN needed).
type Vec = number[];
type Color = [number, number, number];

const PRIMARY: Color = [0.161, 0.322, 0.8];       // #2952cc
const PRIMARY_DARK: Color = [0.118, 0.247, 0.639]; // #1e3fa3
const PRIMARY_SOFT: Color = [0.933, 0.949, 0.992]; // #eef2fd
const SUCCESS: Color = [0.071, 0.502, 0.361];      // #12805c
const WARNING: Color = [0.906, 0.561, 0.0];        // #e78f00
const DANGER: Color = [0.784, 0.196, 0.184];       // #c8322f
const WHITE: Color = [1, 1, 1];

const EASE = { o: { x: [0.33], y: [0] }, i: { x: [0.2], y: [1] } };

const still = (k: unknown) => ({ a: 0, k });
const keys = (frames: [number, Vec][]) => ({
  a: 1,
  k: frames.map(([t, s], i) => (i < frames.length - 1 ? { t, s, ...EASE } : { t, s })),
});

const transform = () => ({
  ty: 'tr', p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100), sk: still(0), sa: still(0),
});
const group = (...items: object[]) => ({ ty: 'gr', it: [...items, transform()] });
const ellipse = (size: number, pos: Vec = [0, 0]) => ({ ty: 'el', d: 1, p: still(pos), s: still([size, size]) });
const path = (points: Vec[], closed = false) => ({
  ty: 'sh',
  ks: still({ c: closed, v: points, i: points.map(() => [0, 0]), o: points.map(() => [0, 0]) }),
});
const fill = (c: Color, opacity = 100) => ({ ty: 'fl', c: still([...c, 1]), o: still(opacity), r: 1 });
const stroke = (c: Color, width: number, opacity = 100) => ({
  ty: 'st', c: still([...c, 1]), o: still(opacity), w: still(width), lc: 2, lj: 2,
});
const trim = (start: object, end: object) => ({ ty: 'tm', s: start, e: end, o: still(0), m: 1 });

function layer(ind: number, shapes: object[], ks: Record<string, unknown> = {}, op = 600) {
  return {
    ddd: 0, ind, ty: 4, nm: `l${ind}`, sr: 1, ao: 0, ip: 0, op, st: 0, bm: 0, shapes,
    ks: { o: still(100), r: still(0), p: still([100, 100, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]), ...ks },
  };
}

function animation(name: string, op: number, layers: object[]) {
  return { v: '5.7.4', fr: 60, ip: 0, op, w: 200, h: 200, nm: name, ddd: 0, assets: [], layers };
}

// ---------- Sending: a paper plane flying with speed lines (loops) ----------

const LINEAR = { o: { x: [0.5], y: [0.5] }, i: { x: [0.5], y: [0.5] } };

// Repeats a keyframe cycle across the whole loop. Cycles start one period before frame 0
// so an offset cycle is already mid-way at frame 0 and the loop has no visible seam.
function repeat(period: number, offset: number, total: number, cycle: (start: number) => [number, Vec][]) {
  const frames: [number, Vec][] = [];
  for (let start = offset - period; start < total; start += period) frames.push(...cycle(start));
  return { a: 1, k: frames.map(([t, s]) => ({ t, s, ...LINEAR })) };
}

// A short streak that slides backwards and fades, behind the plane.
function speedLine(ind: number, y: number, length: number, offset: number) {
  return layer(ind, [group(path([[0, 0], [length, 0]]), stroke(PRIMARY, 6, 55))], {
    p: repeat(40, offset, 120, c => [[c, [92, y, 0]], [c + 40, [26, y, 0]]]),
    o: repeat(40, offset, 120, c => [[c, [0]], [c + 8, [100]], [c + 28, [100]], [c + 40, [0]]]),
  }, 120);
}

// A soft cloud drifting right to left across the circle.
function cloud(ind: number, y: number, scale: number, offset: number) {
  return layer(ind, [
    group(ellipse(22, [-12, 4]), ellipse(30, [4, -2]), ellipse(20, [18, 5]), fill(WHITE)),
  ], {
    s: still([scale, scale, 100]),
    p: repeat(120, offset, 120, c => [[c, [168, y, 0]], [c + 120, [32, y, 0]]]),
    o: repeat(120, offset, 120, c => [[c, [0]], [c + 20, [100]], [c + 100, [100]], [c + 120, [0]]]),
  }, 120);
}

export const SENDING_ANIMATION = animation('sending', 120, [
  layer(1, [
    group(path([[-36, -2], [36, -28], [-6, 8]], true), fill(PRIMARY)),
    group(path([[-6, 8], [36, -28], [8, 28]], true), fill(PRIMARY_DARK)),
    group(path([[-6, 8], [8, 28], [-2, 30]], true), fill(PRIMARY_DARK, 70)),
  ], {
    p: keys([[0, [112, 96, 0]], [30, [118, 88, 0]], [60, [112, 96, 0]], [90, [106, 102, 0]], [120, [112, 96, 0]]]),
    r: keys([[0, [-6]], [30, [-11]], [60, [-6]], [90, [-1]], [120, [-6]]]),
  }, 120),
  speedLine(2, 84, 26, 0),
  speedLine(3, 100, 36, 14),
  speedLine(4, 116, 22, 27),
  cloud(5, 62, 90, 0),
  cloud(6, 142, 70, 60),
  layer(7, [group(ellipse(160), fill(PRIMARY_SOFT))], {
    s: keys([[0, [100, 100, 100]], [60, [104, 104, 100]], [120, [100, 100, 100]]]),
  }, 120),
]);

// ---------- Results: circle draws in, mark draws on top, small burst ----------

function burst(startInd: number, color: Color) {
  return Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    const at = (r: number) => [100 + Math.cos(angle) * r, 100 + Math.sin(angle) * r, 0];
    return layer(startInd + i, [group(ellipse(i % 2 ? 8 : 11), fill(color))], {
      p: keys([[24, at(50)], [54, at(92)]]),
      o: keys([[24, [0]], [28, [100]], [54, [0]]]),
      s: keys([[24, [60, 60, 100]], [54, [100, 100, 100]]]),
    }, 120);
  });
}

function resultAnimation(name: string, color: Color, mark: object[]) {
  return animation(name, 120, [
    layer(1, mark, {
      // Hidden until the circle has grown in behind it.
      o: { a: 1, k: [{ t: 0, s: [0], h: 1 }, { t: 21, s: [100] }] },
      s: keys([[22, [80, 80, 100]], [40, [110, 110, 100]], [52, [100, 100, 100]]]),
    }, 120),
    layer(2, [group(ellipse(116), fill(color))], {
      s: keys([[0, [0, 0, 100]], [18, [112, 112, 100]], [28, [100, 100, 100]]]),
    }, 120),
    layer(3, [group(ellipse(150), fill(color, 18))], {
      s: keys([[6, [0, 0, 100]], [30, [100, 100, 100]]]),
    }, 120),
    ...burst(10, color),
  ]);
}

const drawOn = (start: number, end: number) => trim(still(0), keys([[start, [0]], [end, [100]]]));

export const SUCCESS_ANIMATION = resultAnimation('success', SUCCESS, [
  group(path([[-24, 2], [-7, 19], [25, -15]]), drawOn(22, 46), stroke(WHITE, 11)),
]);

export const WARNING_ANIMATION = resultAnimation('warning', WARNING, [
  group(path([[0, -26], [0, 6]]), drawOn(22, 40), stroke(WHITE, 11)),
  group(ellipse(12, [0, 24]), fill(WHITE)),
]);

export const ERROR_ANIMATION = resultAnimation('error', DANGER, [
  group(path([[-18, -18], [18, 18]]), drawOn(22, 38), stroke(WHITE, 11)),
  group(path([[18, -18], [-18, 18]]), drawOn(32, 48), stroke(WHITE, 11)),
]);
