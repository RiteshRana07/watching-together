// Pulls the 11-character video ID out of any common YouTube URL shape.
// Returns null if the URL isn't a recognizable YouTube link.
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
      if (u.pathname.startsWith("/live/")) return u.pathname.split("/")[2] || null;
    }

    return null;
  } catch {
    return null;
  }
}

// Given any URL (YouTube link or a direct video file link), resolves it to
// {videoUrl, videoTitle, videoSource} ready to store on a room or queue
// entry. Shared by the direct "switch video" route and the "add to queue"
// route so both treat YouTube links the same way.
async function resolveVideoInfo(url) {
  const youtubeId = extractYouTubeId(url);
  if (!youtubeId) {
    return { videoUrl: url, videoTitle: null, videoSource: "url" };
  }

  let videoTitle = null;
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${youtubeId}`
      )}&format=json`
    );
    if (oembedRes.ok) {
      const oembed = await oembedRes.json();
      videoTitle = oembed.title || null;
    }
  } catch {
    // Non-fatal — the entry still works without a fetched title.
  }

  return { videoUrl: youtubeId, videoTitle, videoSource: "youtube" };
}

// Recognizes a plain direct video file link (not YouTube) by extension —
// used by the chat UI to decide whether to show "Add to queue" for a link
// that isn't YouTube (e.g. a direct .mp4 link from a video download site).
const VIDEO_EXTENSIONS = /\.(mp4|webm|ogg|ogv|mov|mkv|m4v)(\?.*)?$/i;
function isDirectVideoUrl(url) {
  return VIDEO_EXTENSIONS.test(url);
}

module.exports = { extractYouTubeId, resolveVideoInfo, isDirectVideoUrl };
