/**
 * The one place that knows which image formats exist. The server derives the
 * stored filename's extension from the WhatsApp mimetype via this map, and the
 * /media route derives the response Content-Type from the extension via its
 * inverse — keeping both directions in a single table so they cannot drift.
 */
export const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const IMAGE_MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(IMAGE_EXT_BY_MIME).map(([mime, ext]) => [ext, mime]),
);
