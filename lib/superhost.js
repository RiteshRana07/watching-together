// A single account (identified by email) can act as a full host/co-host
// in EVERY room on the site — theirs or anyone else's — without ever
// being recorded as that room's actual host_id. The room's real creator
// keeps their own "Host" badge and ownership; this account just always
// has the same powers layered on top. Configured via SUPER_HOST_EMAIL so
// it's not hardcoded in source.
function isSuperHostEmail(email) {
  const configured = (process.env.SUPER_HOST_EMAIL || "").trim().toLowerCase();
  if (!configured || !email) return false;
  return email.trim().toLowerCase() === configured;
}

module.exports = { isSuperHostEmail };
