# WatchTogether

A private watch-party app: sign up, upload a movie you own (or paste a
direct video URL), create a room, and watch in sync with friends — with
live chat and reactions. Built to deploy cleanly on **Vercel**.

## Stack

- **Next.js 14** (App Router), plain serverless — no custom server
- **Postgres** for data (any provider — Vercel Postgres, Neon, Supabase...)
- **pCloud** for uploaded video files
- **Pusher Channels** (free tier) for real-time sync, chat, presence, and
  voice-chat signaling — this replaces a traditional WebSocket server,
  since serverless functions can't hold a persistent connection open
  themselves
- **WebRTC** (mesh, browser-to-browser) for live voice chat
- **JWT in an httpOnly cookie** for auth (bcrypt-hashed passwords)

## Why this specific stack

Vercel deploys Next.js as serverless functions: no long-lived process, and
no writable local disk between requests. That rules out a local SQLite
file, local file uploads, and a custom Socket.io server — all three are
swapped here for hosted equivalents that work within that model.

## 1. Set up the three services (all have free tiers)

**Database — Postgres**
- Easiest: in your Vercel project dashboard, go to **Storage → Create
  Database → Postgres** (powered by Neon). It sets `DATABASE_URL`
  automatically once connected to the project.
- Or use any Postgres you already have (Neon, Supabase, Railway...) and set
  `DATABASE_URL` yourself.

**File uploads — pCloud**
- See the full "Uploads (pCloud)" section below — it's a slightly longer
  setup (OAuth) than the other two services, so it has its own section
  rather than fitting in a couple of bullets here.
- Uploads work without this being set up too — you'll just get an error
  message if someone tries to upload a file. Pasting a video URL still
  works fine either way.

**Real-time — Pusher Channels**
- Create a free account/app at https://dashboard.pusher.com → **Channels →
  Create app**.
- Under **App Keys**, copy: `app_id`, `key`, `secret`, `cluster`.
- Set these in Vercel (Project → Settings → Environment Variables):
  - `PUSHER_APP_ID`
  - `PUSHER_KEY`
  - `PUSHER_SECRET`
  - `PUSHER_CLUSTER`
  - `NEXT_PUBLIC_PUSHER_KEY` — same value as `PUSHER_KEY`
  - `NEXT_PUBLIC_PUSHER_CLUSTER` — same value as `PUSHER_CLUSTER`

  (The `NEXT_PUBLIC_` versions are what the browser uses to connect; the
  plain ones are used server-side to send events.)

Also set `JWT_SECRET` to any long random string.

After setting env vars in Vercel, **redeploy** — env var changes don't
apply to already-built deployments.

## 2. Local development

```bash
npm install
cp .env.example .env   # fill in the values from step 1
npm run dev
```

Open http://localhost:3000.

## Fixed: duplicate "watching" entries + repeated join messages

Both were the same root cause: the room page's Pusher channel-subscription
effect used to depend on the whole `room` object, which gets a new
reference every time the video or capacity changes. That caused the
presence channel to fully unsubscribe and resubscribe on every single
video change — which looks exactly like a leave-then-rejoin to every other
client in the room, producing a duplicate entry in the participant list
and a repeated "X joined the room" system message each time the host
played something from the queue. The effect now only depends on values
that should actually trigger a resubscribe (`user`, `code`, `canJoin`),
not on `room` itself. Defensive id-based dedup was also added to the
"member added" handler as a second layer of protection.

The same stale dependency was also the real trigger behind an earlier
reported bug where a chat message could briefly show twice for the host —
the host's persisted-chat-history fetch was refetching (and re-seeding)
every time `room` changed reference too. That fetch is now decoupled from
`room` changes the same way, plus the seeding logic itself now dedupes
against messages already on screen as a second layer of protection.

## How sync works

1. Whoever plays, pauses, or seeks calls the app's `/api/rooms/[code]/broadcast`
   route, which relays the event to everyone else in the room over Pusher.
2. Every few seconds, the controller also sends a heartbeat with their
   current time, so someone who drifts catches up automatically.
3. If a client's local time is more than ~1.2s off from what it receives,
   it snaps to the correct time instead of just letting playback continue —
   but only if it isn't *already* mid-seek/buffering from the last
   correction. Piling a new seek on top of one still resolving is what
   caused the play/pause thrashing right after someone joined; this guard
   fixes that.
4. On joining, a new viewer immediately asks whoever's in control for a
   snapshot (`player:request-sync`) instead of waiting up to 4s for the next
   scheduled heartbeat — this shortens how long they sit at a stale/zero
   position before the first correction.

This is a "best effort" sync model, not frame-accurate broadcast-grade sync
— good enough for a shared movie night.

## Multi-video rooms (queue)

A room's original video (set at creation) is permanent — it's the room's
identity, and what shows on the invite page. What's actually playing is
tracked separately (`current_video_*` in the `rooms` table) and can move
through a **queue**:

- Anyone in the room can paste a YouTube link in chat; a
  "➕ Add to queue" button appears under that message and adds it to
  `room_queue` (visible to everyone, live).
- Only the host can play a queued video ("▶️ Play" next to it in the queue
  panel), which updates `current_video_*` and broadcasts
  `room:video-changed` to everyone.
- **Playing a queue item does not remove it** — it stays there so it can be
  replayed or referenced later. Only the host's explicit "✕ remove"
  deletes an entry.
- The original video always has a **"▶️ Play main video"** button in the
  queue panel to jump straight back to it. The original `video_url`/
  `video_title` are never touched by any of this — the queue and
  "now playing" are both layered on top of it, not a replacement for it.

## Persistent chat (host-only)

Chat behaves differently for the host vs. everyone else:
- **Host**: every message sent in the room (by anyone, including while the
  host was away) is saved to `room_messages` and loaded back in whenever
  the host opens the room — so they never miss anything that was said.
- **Everyone else**: chat is session-only, same as before — they only see
  messages sent live during their current visit, not history from before
  they joined or after they leave.
- All messages are deleted when the room is deleted (`room_messages` has
  `ON DELETE CASCADE` on `room_id`).

This is intentional, not a bug: the host is the one persistent owner of a
room across sessions, so they're the one who needs continuity; guests are
transient by design.

## Production checklist

- Use a strong random `JWT_SECRET`
- Consider rate limiting `/api/auth/*` and `/api/upload`
- Only allow uploading/sharing video content you own or have rights to
- pCloud's free tier and Pusher's free tier both have usage caps — check
  current limits if you expect real traffic

## Room capacity enforcement

There are two layers:
1. The Pusher presence-channel auth route (`/api/pusher/auth`) rejects a
   join once the room's member count reaches its cap.
2. The room page itself calls `/api/rooms/[code]/can-join` **before**
   rendering the video or chat at all. This closes a gap where a full room
   would still play the video (since fetching room info doesn't check
   capacity) even though live chat/sync silently failed — which looked
   like the cap wasn't enforced.

The cap can be changed any time from inside the room (host-only, with
+/− buttons and quick presets), and updates live for everyone via
`room:capacity-changed`. There's no "unlimited" option — every room has a
real numeric cap (1–500).

Note: capacity enforcement checks Pusher's REST API for the current member
count at join time, which is not perfectly atomic — two people joining in
the same instant could both slip in when there's exactly one slot left.
For a small watch-party app this edge case is rare enough to accept rather
than adding a distributed-locking layer.

## Host & co-host controls

The room creator is the host (shown with a "Host" badge). By default, only
the host can play/pause/seek. The host can open the participant list in
the chat panel and make (or remove) specific viewers as **co-hosts**.

Co-host status is now **persisted** (a `room_cohosts` table), not just
broadcast live — so it survives a page refresh, and so the server can
actually authorize co-host actions rather than trusting the browser.
Co-hosts can do everything playback-related the host can:
- Play/pause/seek the current video
- Play any video from the queue
- Jump back to the room's main/original video

Co-hosts can **not** do host-only administrative things: remove items from
the queue, change the room's participant cap, delete the room, or make/
remove other co-hosts (only the original host can do those).

Playback controls (including fullscreen) stay visible and clickable for
everyone — there's no browser-native or YouTube-API way to show only the
fullscreen button while hiding play/pause. Instead, a non-controller's
play/pause/seek simply isn't broadcast to the room, so it only affects
their own view; the host's next heartbeat (every ~4s) pulls them back into
sync automatically.

## Voice chat

Anyone in the room can click **"🎙️ Join voice"** in the chat panel to join
a live voice call with everyone else who's joined it — mute/unmute
yourself any time. The host and any co-host can **mute** another
participant remotely (takes effect immediately), or **ask** a muted
participant to unmute — nobody can remotely turn someone else's
microphone *on* without that person acting themselves; that's a
deliberate privacy choice, matching how Meet/Teams behave.

Two real limitations worth knowing:
- **No TURN server.** This uses only public STUN servers for NAT
  traversal. That's enough for the large majority of home/mobile
  networks, but some restrictive corporate networks (or unusual/symmetric
  NAT setups) may fail to connect directly. Adding a TURN server (e.g.
  Twilio, Xirsys, metered.ca) would fix that, but needs its own paid
  account/credentials this app doesn't have configured.
- **Mesh topology.** Every participant connects directly to every other
  participant in the call — simple and needs no media server, but
  bandwidth/CPU cost grows with the square of the participant count.
  Fine for a handful of simultaneous speakers, not built for dozens.

Signaling (WebRTC offer/answer/ICE exchange) is relayed through the same
Pusher channel already used for playback sync — no separate signaling
server needed.

## Changing the room after it's created

- **Room size**: the host can edit the participant cap any time from the
  room page itself (not just at creation) — this updates live for everyone
  currently in the room.
- **Deleting a room**: from the Watch Rooms list, the host can delete any
  room they created.
- **Switching the video**: superseded by the queue system — see
  "Multi-video rooms (queue)" above.

## Uploads (pCloud)

Video files are stored in **pCloud** instead of Vercel Blob.

### One-time setup

1. Register an OAuth app at pCloud (https://docs.pcloud.com/my_apps/) to get
   a client ID and client secret.
2. Set `PCLOUD_CLIENT_ID`, `PCLOUD_CLIENT_SECRET`, and `PCLOUD_REDIRECT_URI`
   (your deployed URL + `/api/pcloud/callback`) as env vars, and deploy.
3. Visit `/api/pcloud/authorize` in your browser, signed into the pCloud
   account you want to use, and approve access.
4. You'll land on a page showing `PCLOUD_ACCESS_TOKEN` and
   `PCLOUD_API_HOST` — copy both into your env vars and redeploy. This
   token doesn't expire on its own (only if you revoke it in pCloud), so
   this is a true one-time step.

### How it works, and two things you should verify after deploying

pCloud doesn't offer short-lived, upload-scoped client tokens the way
Vercel Blob or S3 do. The closest equivalent is an **upload link**
(`createuploadlink`), which lets the browser POST a file straight to
pCloud using just a link code — never exposing the real access token to
the browser. That's the primary upload path here, and if it works, upload
size is effectively unlimited (same as Vercel Blob was).

**Verify this after deploying**: whether pCloud allows that direct browser
POST is a CORS question that can't be confirmed without live credentials.
If it fails, the app **automatically falls back** to routing the upload
through this server instead — but that reintroduces Vercel's ~4.5MB
serverless request body limit (the same constraint Vercel Blob's
client-token flow was originally built to avoid). Try uploading a file
over ~4MB after setup; if it fails with a size error, the direct path
isn't working and you'd need to either sort out CORS on pCloud's side, or
accept the ~4MB fallback cap for now.

**The other thing worth knowing**: pCloud's direct-download links
*expire* (a few hours) — there's no permanent public URL like Vercel Blob
gives you. To handle this without ever breaking playback, a movie's
`video_url` is stored as `/api/stream/<pcloud-fileid>` (a URL on this
app's own domain), and that route resolves a **fresh** pCloud link on
every single request before redirecting the video player to it. This
means playback keeps working indefinitely, but every video load makes one
extra server-side call to pCloud to resolve the current link.

The upload form shows live progress as **MB uploaded / total MB**, and
warns if progress hasn't moved in 15+ seconds.

## Joining a room

Joining requires an account — there's no anonymous/guest access. Sharing
a room sends people to `/invite/[code]`, a preview page (title, viewer
count, live/waiting status) with a **Sign in to join** / **Create an
account** prompt if they aren't signed in yet; after signing in they're
sent straight back to the room. This is enforced both in the UI and
server-side (the Pusher presence-channel auth route rejects unauthenticated
requests), so a bookmarked room link can't be used to skip sign-in.

## Room size limits

Every room has a required numeric cap (1–500) — picked at creation (quick
presets 1/2/3/5/10, or type any number), and editable any time afterward
from inside the room. See "Room capacity enforcement" above for how it's
enforced. The host is always exempt from their own cap.

## External video links

Pasting a link in chat shows "➕ Add to queue" for either a YouTube link
or a plain direct video file link (`.mp4`, `.webm`, `.mov`, etc. — the
kind of link a video-download site gives you alongside a "watch" button).
Room creation and the queue both resolve any non-YouTube URL as a direct
video source automatically (`lib/youtube.js`'s `resolveVideoInfo`).

## Project structure

```
lib/
  db.js                 # Postgres schema + queries (users, movies, rooms, queue, chat, co-hosts)
  auth.js                # password hashing, JWT, cookies
  pusher.js               # server-side Pusher client
  pusher-client.js         # browser-side Pusher client
  pcloud.js                 # pCloud API helper (upload links, fresh download links)
  use-current-user.js        # client hook: fetch /api/auth/me, redirect if signed out
  youtube.js                  # YouTube URL parsing + direct-video-link detection
app/
  page.js                # landing page
  login/, signup/         # auth pages (support ?redirect=/room/CODE)
  dashboard/              # home: welcome + stats + quick actions
  library/                 # movie library: upload + list + delete
  rooms/                    # active rooms + join by code
  rooms/create/              # create a room: library movie, YouTube, or URL; room size
  room/[code]/                # the live watch room (video + chat), auth-gated
  invite/[code]/               # public preview/gate page for shared invite links
  api/
    auth/{signup,login,logout,me}/
    movies/  movies/[id]/
    rooms/  rooms/[code]/
      /broadcast, /presence, /can-join, /cohosts, /play-original
      /queue, /queue/[itemId], /queue/[itemId]/play
      /messages
    upload/                      # issues pCloud upload links + server-proxy fallback
    stream/[fileid]/              # resolves a fresh pCloud link on every playback request
    pcloud/authorize/, pcloud/callback/  # one-time OAuth setup
    pusher/auth/                  # presence-channel auth + room-size enforcement
components/
  Nav.js                  # shared top nav for signed-in pages
  VideoPlayer.js            # synced <video> element, host/co-host-gated controls
  YouTubePlayer.js            # synced YouTube IFrame player, host/co-host-gated controls
  Chat.js                       # live chat (deduped/persisted for host) + reactions + participants
  VoiceChat.js                   # WebRTC mesh voice call, signaled over Pusher
  Queue.js                        # up-next queue + jump back to the room's original video
```

## How the movie library works

Uploading is a separate step from creating a room, matching the reference
flow: upload once to your library (stored via pCloud + a `movies` row),
then create as many rooms from that movie as you like. Rooms can also be
created from a YouTube link or a direct video URL instead.

## YouTube support

YouTube rooms use the YouTube IFrame Player API (not a plain `<video>`
element, since YouTube videos can't be played that way). Sync works the
same as direct video: whoever plays/pauses/seeks broadcasts it, and a
heartbeat every few seconds keeps everyone within ~1.5s of each other
(a bit looser than direct video's ~0.75s, since YouTube's reported playback
time is less precise). Supported link formats: `youtube.com/watch?v=...`,
`youtu.be/...`, `youtube.com/shorts/...`, `youtube.com/embed/...`.

## If chat or the viewer count still isn't working

The presence/chat system depends entirely on Pusher being configured
correctly. Open the browser console in the room — the app now logs Pusher
connection and subscription errors there. Things to double check:
- `NEXT_PUBLIC_PUSHER_KEY` / `NEXT_PUBLIC_PUSHER_CLUSTER` were set **before**
  the last deploy that's currently live (Next.js bakes `NEXT_PUBLIC_*` vars
  into the browser bundle at build time — adding them after a build doesn't
  retroactively apply, you need a fresh deploy)
- The plain `PUSHER_KEY`/`PUSHER_CLUSTER` match the `NEXT_PUBLIC_` versions
  exactly (same Pusher app)
- The Pusher app's cluster (e.g. `ap2`, `us2`) is correct — this is easy to
  copy wrong

