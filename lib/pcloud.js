// Thin wrapper around pCloud's REST API. All calls that need real account
// access use PCLOUD_ACCESS_TOKEN (obtained once via the OAuth flow in
// app/api/pcloud/authorize + callback, then set as an env var — pCloud
// access tokens don't expire on their own, only if revoked).
//
// Important: pCloud does NOT provide short-lived, upload-scoped client
// tokens the way Vercel Blob or S3 presigned URLs do. The closest
// equivalent is an "upload link" (createuploadlink), which lets a browser
// POST a file straight to pCloud using just a link code — no access token
// exposed to the client. That's what the direct-upload path below uses.
// Whether pCloud allows that POST cross-origin from a browser (CORS) isn't
// something that can be verified without live credentials — the library
// page has an automatic fallback to a server-proxied upload if the direct
// attempt fails, at the cost of Vercel's ~4.5MB serverless body limit
// applying to that fallback path.
//
// Also important: pCloud's direct-download links (getfilelink /
// getpublinkdownload) EXPIRE (the API response includes an `expires`
// timestamp) — they are not permanent URLs like a Vercel Blob URL. Movies
// are stored with `/api/stream/<fileid>` as their video_url (a URL on our
// own domain), and that route resolves a fresh pCloud link on every
// request, so expiry is handled transparently instead of ever breaking.

function apiHost() {
  const raw = process.env.PCLOUD_API_HOST || "api.pcloud.com";
  // Defensive: strip a scheme and/or trailing slash if someone pastes the
  // full URL into the env var instead of just the hostname (an easy
  // mistake — https://api.pcloud.com would otherwise build a malformed
  // https://https://api.pcloud.com/... URL, and fetch() fails on that with
  // an unhelpfully generic "fetch failed" error).
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

async function pcloudGet(method, params = {}) {
  const token = process.env.PCLOUD_ACCESS_TOKEN;
  if (!token) {
    throw new Error("pCloud isn't connected yet — PCLOUD_ACCESS_TOKEN isn't set.");
  }
  const qs = new URLSearchParams({ ...params, access_token: token });
  const url = `https://${apiHost()}/${method}?${qs.toString()}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    // Surface the real underlying reason (DNS failure, TLS error, etc.)
    // instead of just the generic "fetch failed" wrapper message, which
    // by itself gives no clue what actually went wrong.
    const cause = err.cause?.message || err.cause?.code || err.message;
    throw new Error(`Couldn't reach pCloud at ${apiHost()} (${cause}). Check PCLOUD_API_HOST.`);
  }
  const data = await res.json();
  if (data.result !== 0) {
    throw new Error(data.error || `pCloud API error (code ${data.result}) calling ${method}`);
  }
  return data;
}

// Creates a single-use upload link scoped to one folder — the browser can
// POST a file to it directly without ever seeing the real access token.
async function createUploadLink({ folderId, comment } = {}) {
  const data = await pcloudGet("createuploadlink", {
    folderid: folderId ?? process.env.PCLOUD_FOLDER_ID ?? "0",
    comment: comment || "WatchTogether upload",
    maxspace: 2 * 1024 * 1024 * 1024, // 2GB cap per link
  });
  // pCloud returns either `code` directly or nested under `uploadlinkid`/
  // link data depending on API version — handle both shapes defensively.
  const code = data.code || data.uploadlinkid || data.linkid;
  return { code: String(code), uploadUrl: `https://${apiHost()}/uploadtolink` };
}

// Fallback path: proxies the file through OUR server using the real
// access token. Subject to Vercel's serverless request body size limit —
// only used automatically when the direct browser upload fails.
async function uploadFileProxy(file, filename) {
  const token = process.env.PCLOUD_ACCESS_TOKEN;
  if (!token) {
    throw new Error("pCloud isn't connected yet — PCLOUD_ACCESS_TOKEN isn't set.");
  }
  const form = new FormData();
  form.append("file", file, filename);
  const folderId = process.env.PCLOUD_FOLDER_ID ?? "0";
  let res;
  try {
    res = await fetch(`https://${apiHost()}/uploadfile?access_token=${token}&folderid=${folderId}`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    const cause = err.cause?.message || err.cause?.code || err.message;
    throw new Error(`Couldn't reach pCloud at ${apiHost()} (${cause}). Check PCLOUD_API_HOST.`);
  }
  const data = await res.json();
  if (data.result !== 0) {
    throw new Error(data.error || `pCloud upload failed (code ${data.result})`);
  }
  const fileid = data.fileids?.[0] ?? data.metadata?.[0]?.fileid;
  if (!fileid) throw new Error("pCloud upload succeeded but returned no file id");
  return fileid;
}

// Resolves a fileid to a fresh, currently-valid direct-download URL.
// Called on every playback request (see app/api/stream/[fileid]/route.js)
// since these links expire — there's no way to get a permanent one.
async function getFreshFileUrl(fileid) {
  const data = await pcloudGet("getfilelink", { fileid });
  const host = data.hosts?.[0];
  if (!host || !data.path) throw new Error("pCloud didn't return a downloadable link");
  return `https://${host}${data.path}`;
}

module.exports = { apiHost, pcloudGet, createUploadLink, uploadFileProxy, getFreshFileUrl };
