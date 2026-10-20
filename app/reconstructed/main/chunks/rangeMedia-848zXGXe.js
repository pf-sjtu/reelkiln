import { extname } from "node:path";
const MIME = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};
const VCMEDIA_SCHEME = {
  scheme: "vcmedia",
  privileges: {
    standard: true,
    secure: true,
    stream: true,
    supportFetchAPI: true,
    corsEnabled: true,
    bypassCSP: true,
  },
};
function mimeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
function planMediaResponse(filePath, size, rangeHeader) {
  const type = mimeFor(filePath);
  const m = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null;
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || end < start) {
      return {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
        range: null,
      };
    }
    return {
      status: 206,
      headers: {
        "Content-Type": type,
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
      range: { start, end },
    };
  }
  return {
    status: 200,
    headers: {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Content-Length": String(size),
    },
    range: null,
  };
}
export { VCMEDIA_SCHEME as V, mimeFor as m, planMediaResponse as p };
