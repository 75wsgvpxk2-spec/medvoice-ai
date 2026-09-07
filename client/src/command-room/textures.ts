import {
  CanvasTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * The room's backplates, drawn rather than downloaded.
 *
 * §37 asks for generated environment art. Generating it in a canvas at load
 * time instead of shipping image files keeps the whole room inside the bundle
 * the clinic already downloads: no second network round trip on a connection
 * that may be the reason this product exists, and nothing to go missing from a
 * public folder. They are also honest about what they are — light, sky and
 * glass, with no clinical data painted into them (§35).
 */

function makeCanvas(width: number, height: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

function finish(context: CanvasRenderingContext2D): Texture {
  const texture = new CanvasTexture(context.canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Daylight beyond the glass.
 *
 * A pale Caribbean sky over a low, hazy skyline — far enough away and washed
 * out enough that the eye reads "outside, and bright" and then goes back to
 * the room, which is where the work is.
 */
export function makeSkyTexture(): Texture | null {
  const ctx = makeCanvas(1024, 512);
  if (!ctx) return null;

  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#a9d9f2');
  sky.addColorStop(0.42, '#cfeafa');
  sky.addColorStop(0.74, '#eaf7fe');
  sky.addColorStop(1, '#f7fcff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1024, 512);

  // A soft sun high on the left, the same direction the key light comes from.
  const sun = ctx.createRadialGradient(230, 120, 10, 230, 120, 260);
  sun.addColorStop(0, 'rgba(255,255,255,0.95)');
  sun.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, 1024, 512);

  // Haze-blue towers. Deterministic, so the skyline does not reshuffle itself
  // every time the room mounts.
  let seed = 1337;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let layer = 0; layer < 2; layer += 1) {
    const base = 470 - layer * 8;
    ctx.fillStyle = layer === 0 ? 'rgba(150,193,220,0.30)' : 'rgba(120,172,206,0.38)';
    let x = -40;
    while (x < 1064) {
      const width = 26 + random() * 58;
      const height = 30 + random() * (layer === 0 ? 96 : 132);
      ctx.fillRect(x, base - height, width, height + 60);
      x += width + 8 + random() * 22;
    }
  }

  // The water line, and the light coming off it.
  const sea = ctx.createLinearGradient(0, 466, 0, 512);
  sea.addColorStop(0, 'rgba(146,199,226,0.55)');
  sea.addColorStop(1, 'rgba(206,235,248,0.65)');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 466, 1024, 46);

  return finish(ctx);
}

/**
 * The floor.
 *
 * Light polished stone with a very faint square joint pattern. The joints do
 * the same job the grid does in the reference images — they give the eye
 * something to measure depth against — without turning the floor into a
 * spaceship deck.
 */
export function makeFloorTexture(): Texture | null {
  const ctx = makeCanvas(512, 512);
  if (!ctx) return null;

  ctx.fillStyle = '#eef6fb';
  ctx.fillRect(0, 0, 512, 512);

  // Gentle mottling, so a large flat plane does not band.
  for (let i = 0; i < 900; i += 1) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.08})`;
    ctx.fillRect(x, y, 12 + Math.random() * 40, 12 + Math.random() * 40);
  }

  ctx.strokeStyle = 'rgba(150,190,214,0.30)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, 510.5, 510.5);

  const texture = finish(ctx);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(9, 11);
  return texture;
}

/**
 * The frosted face of a glass panel.
 *
 * A vertical wash with a bright top edge: enough to read as glass catching the
 * daylight, cheap enough to sit on nine panels at once.
 */
export function makeGlassTexture(): Texture | null {
  const ctx = makeCanvas(256, 256);
  if (!ctx) return null;

  const wash = ctx.createLinearGradient(0, 0, 0, 256);
  wash.addColorStop(0, 'rgba(255,255,255,1)');
  wash.addColorStop(0.35, 'rgba(233,246,253,1)');
  wash.addColorStop(1, 'rgba(206,234,248,1)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 256, 256);

  const sheen = ctx.createLinearGradient(0, 0, 256, 256);
  sheen.addColorStop(0, 'rgba(255,255,255,0.55)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.28)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 256, 256);

  return finish(ctx);
}

/**
 * The scan grid the patient hologram is built out of.
 *
 * Horizontal lines only, fading top and bottom. §39: the hologram is an
 * information metaphor, so its surface is a readout, not anatomy.
 */
export function makeHologramTexture(): Texture | null {
  const ctx = makeCanvas(128, 512);
  if (!ctx) return null;

  ctx.fillStyle = 'rgba(96,190,236,0.10)';
  ctx.fillRect(0, 0, 128, 512);

  ctx.strokeStyle = 'rgba(148,220,255,0.55)';
  ctx.lineWidth = 1;
  for (let y = 0; y < 512; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(128, y + 0.5);
    ctx.stroke();
  }

  const fade = ctx.createLinearGradient(0, 0, 0, 512);
  fade.addColorStop(0, 'rgba(255,255,255,0.55)');
  fade.addColorStop(0.25, 'rgba(255,255,255,0)');
  fade.addColorStop(0.8, 'rgba(255,255,255,0)');
  fade.addColorStop(1, 'rgba(255,255,255,0.35)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 128, 512);

  return finish(ctx);
}

/**
 * The MedVoice mark, for the face of the core.
 *
 * The same microphone-and-waveform as the application's own logo, drawn white
 * on transparency so it can sit on the sphere and take the light with it. It
 * is redrawn here rather than rasterised from the SVG component because the
 * component paints with CSS custom properties, which mean nothing inside a
 * canvas.
 */
export function makeMarkTexture(): Texture | null {
  const ctx = makeCanvas(512, 512);
  if (!ctx) return null;

  ctx.clearRect(0, 0, 512, 512);
  ctx.translate(256, 256);
  ctx.scale(7.4, 7.4);
  ctx.translate(-29, -29);

  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = 'rgba(255,255,255,0.96)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Microphone capsule.
  ctx.beginPath();
  ctx.roundRect(17, 4, 24, 34, 12);
  ctx.fill();

  // The waveform inside it — the voice half of the name, knocked out.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(22, 22);
  ctx.lineTo(24.5, 22);
  ctx.lineTo(26.5, 15.5);
  ctx.lineTo(29, 29.5);
  ctx.lineTo(31.5, 18.5);
  ctx.lineTo(33.5, 24.5);
  ctx.lineTo(36, 24.5);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  // Cradle and stand.
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(29, 26, 19, 0, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(29, 45);
  ctx.lineTo(29, 53);
  ctx.moveTo(19, 55);
  ctx.lineTo(39, 55);
  ctx.stroke();

  return finish(ctx);
}

/**
 * The room's own reflections.
 *
 * An equirectangular strip of what this room looks like from the inside —
 * bright ceiling, pale walls, darker floor, one warm window. Feeding it to the
 * scene as an environment map is what puts real reflections in the polished
 * floor and a soft highlight along every metal edge, and it costs one 512×256
 * canvas instead of a multi-megabyte HDR downloaded from somewhere else.
 */
export function makeEnvironmentTexture(): Texture | null {
  const ctx = makeCanvas(512, 256);
  if (!ctx) return null;

  const vertical = ctx.createLinearGradient(0, 0, 0, 256);
  vertical.addColorStop(0, '#ffffff');
  vertical.addColorStop(0.34, '#f0f6fb');
  vertical.addColorStop(0.5, '#dae3ea');
  vertical.addColorStop(0.62, '#b9c4cd');
  vertical.addColorStop(1, '#8f9ba5');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, 512, 256);

  // The window, roughly where the key light comes from, so the highlights it
  // leaves on the floor and the plinth point the right way.
  const window = ctx.createRadialGradient(150, 96, 8, 150, 96, 130);
  window.addColorStop(0, 'rgba(255,253,244,1)');
  window.addColorStop(0.5, 'rgba(226,240,250,0.85)');
  window.addColorStop(1, 'rgba(226,240,250,0)');
  ctx.fillStyle = window;
  ctx.fillRect(0, 0, 512, 256);

  // The ceiling coves, as two bright bands.
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(0, 24, 512, 10);
  ctx.fillRect(0, 52, 512, 6);

  const texture = finish(ctx);
  texture.mapping = EquirectangularReflectionMapping;
  return texture;
}

/**
 * Painted plaster.
 *
 * Almost nothing — a faint mottle and a very soft vertical gradient. Its whole
 * job is to stop a nine-metre wall reading as one flat fill, which is the
 * single thing that makes a rendered room look like a diagram.
 */
export function makeWallTexture(): Texture | null {
  const ctx = makeCanvas(512, 512);
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 2600; i += 1) {
    const shade = 236 + Math.random() * 19;
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade + 4},${0.25 + Math.random() * 0.35})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 7, 2 + Math.random() * 7);
  }

  const texture = finish(ctx);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 3);
  return texture;
}
