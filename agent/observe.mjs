// observe.mjs — what the model is shown at each step: a screenshot and the element list.
//
// The screenshot is resized to 768 px wide, JPEG quality 85: legible for the
// model, small for the link to the phone and the context (an iPhone 17 Pro's
// 1206×2622 becomes 768×1670). iOSWorld sends 706×1536.
//
// Landscape: the runner's /screenshot returns the portrait framebuffer even
// when an app is landscape, so a landscape screen arrives sideways and every
// coordinate the model picked would be wrong. When deviceInfo reports
// landscape and the image is portrait-shaped, it is rotated upright (270°,
// found by testing on a phone; the runner does not report which landscape).

import sharp from 'sharp';
import { formatElements, capElements, screenSignature } from './elements.mjs';

export const IMAGE_WIDTH = 768;
const LANDSCAPE_ROTATION = 270;

/**
 * @param {object} device   from device.mjs
 * @returns {Promise<{ image: Buffer, mime: string, width: number, height: number,
 *   elements: string[], signature: string, screen: { widthPoints: number, heightPoints: number } }>}
 */
export async function observe(device) {
  const screen = await device.info();
  const [raw, hierarchy] = await Promise.all([device.screenshot(), device.hierarchy().catch(() => '')]);
  let img = sharp(raw);
  const meta = await img.metadata();
  if (screen.widthPoints > screen.heightPoints && meta.height > meta.width) img = sharp(await img.rotate(LANDSCAPE_ROTATION).toBuffer());
  const image = await img.resize(IMAGE_WIDTH, null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const sized = await sharp(image).metadata();
  const elements = capElements(formatElements(hierarchy, screen.widthPoints, screen.heightPoints));
  return { image, mime: 'image/jpeg', width: sized.width, height: sized.height, elements, signature: screenSignature(elements), screen };
}

/** The text sent with a screenshot. */
export function describeScreen(elements, { keyboardUp = false } = {}) {
  if (!elements.length) return '';
  const occlusion = keyboardUp
    ? '\n⚠️ KEYBOARD LIKELY OPEN (you typed recently): listed elements below ~55% of the screen may be BEHIND the keyboard — tapping their coordinates presses a KEY instead and corrupts your text. Call hideKeyboard first, then tap.'
    : '';
  return `\n\nUI elements on screen:\n${elements.join('\n')}\nUse tap(x, y) with coordinates above for precise tapping.${occlusion}`;
}
