// Uses Postgres instead of a local SQLite file, because serverless hosts
// like Vercel have a read-only filesystem (aside from /tmp, which is wiped
// between invocations) — a file-based DB simply won't persist there.
// Works with any Postgres: Vercel Postgres, Neon, Supabase, Railway, etc.
// Just set DATABASE_URL.
const { Pool } = require("pg");
const crypto = require("crypto");

if (!process.env.DATABASE_URL) {
  console.warn(
    "[db] DATABASE_URL is not set. Set it in your environment (see .env.example)."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

let schemaReady;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS movies (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        video_url TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        video_url TEXT NOT NULL,
        video_title TEXT,
        video_source TEXT NOT NULL,
        current_video_url TEXT,
        current_video_title TEXT,
        current_video_source TEXT,
        movie_id TEXT REFERENCES movies(id),
        max_participants INTEGER,
        host_id TEXT NOT NULL REFERENCES users(id),
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS room_queue (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        video_url TEXT NOT NULL,
        video_title TEXT,
        video_source TEXT NOT NULL,
        added_by TEXT,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS room_messages (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      -- Co-host status now persists here (instead of living only in
      -- ephemeral browser state) so the server can actually authorize
      -- co-host actions like playing a queued video, and so a co-host's
      -- permission survives a page refresh.
      CREATE TABLE IF NOT EXISTS room_cohosts (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (room_id, user_id)
      );

      -- Defensive migrations: if this table already existed from an earlier
      -- version of the schema (before these columns existed), add whatever
      -- is missing rather than requiring a manual migration step.
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS video_title TEXT;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS movie_id TEXT REFERENCES movies(id);
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS max_participants INTEGER;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS current_video_url TEXT;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS current_video_title TEXT;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS current_video_source TEXT;
      -- Rooms created before "now playing" existed as a separate concept:
      -- backfill it from the original video so they still play something.
      UPDATE rooms SET current_video_url = video_url WHERE current_video_url IS NULL;
      UPDATE rooms SET current_video_title = video_title WHERE current_video_title IS NULL;
      UPDATE rooms SET current_video_source = video_source WHERE current_video_source IS NULL;
    `);
  }
  return schemaReady;
}

function id() {
  return crypto.randomUUID();
}
function shortCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function createUser({ username, email, passwordHash }) {
  await ensureSchema();
  const userId = id();
  await pool.query(
    `INSERT INTO users (id, username, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, username, email, passwordHash, Date.now()]
  );
  return { id: userId, username, email };
}

async function getUserByEmail(email) {
  await ensureSchema();
  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0] || null;
}

async function getUserById(userId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, username, email FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function createRoom({
  name,
  videoUrl,
  videoTitle,
  videoSource,
  movieId,
  maxParticipants,
  hostId,
}) {
  await ensureSchema();
  const roomId = id();
  let code;
  do {
    code = shortCode(6);
  } while (await getRoomByCode(code));

  await pool.query(
    `INSERT INTO rooms (id, code, name, video_url, video_title, video_source, current_video_url, current_video_title, current_video_source, movie_id, max_participants, host_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $4, $5, $6, $7, $8, $9, $10)`,
    [
      roomId,
      code,
      name,
      videoUrl,
      videoTitle || null,
      videoSource,
      movieId || null,
      maxParticipants || null,
      hostId,
      Date.now(),
    ]
  );

  return getRoomByCode(code);
}

async function getRoomByCode(code) {
  await ensureSchema();
  const { rows } = await pool.query(`SELECT * FROM rooms WHERE code = $1`, [code]);
  return rows[0] || null;
}

async function listRoomsForUser(hostId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM rooms WHERE host_id = $1 ORDER BY created_at DESC`,
    [hostId]
  );
  return rows;
}

async function createMovie({ title, videoUrl, ownerId }) {
  await ensureSchema();
  const movieId = id();
  await pool.query(
    `INSERT INTO movies (id, owner_id, title, video_url, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [movieId, ownerId, title, videoUrl, Date.now()]
  );
  return getMovieById(movieId, ownerId);
}

async function listMoviesForUser(ownerId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM movies WHERE owner_id = $1 ORDER BY created_at DESC`,
    [ownerId]
  );
  return rows;
}

async function getMovieById(movieId, ownerId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM movies WHERE id = $1 AND owner_id = $2`,
    [movieId, ownerId]
  );
  return rows[0] || null;
}

async function deleteMovie(movieId, ownerId) {
  await ensureSchema();
  await pool.query(`DELETE FROM movies WHERE id = $1 AND owner_id = $2`, [movieId, ownerId]);
}

async function deleteRoom(code, hostId) {
  await ensureSchema();
  await pool.query(`DELETE FROM rooms WHERE code = $1 AND host_id = $2`, [code, hostId]);
}

async function updateRoomCapacity(code, hostId, maxParticipants) {
  await ensureSchema();
  const { rows } = await pool.query(
    `UPDATE rooms SET max_participants = $1 WHERE code = $2 AND host_id = $3 RETURNING *`,
    [maxParticipants, code, hostId]
  );
  return rows[0] || null;
}

// Updates only the "now playing" video — the room's original video_url/
// video_title/video_source (set at creation) never change, so the room
// keeps its original identity/thumbnail even as playback moves through
// a queue of other videos. Authorization (host or co-host) is checked by
// the caller — this only filters by code, not by who's asking, since a
// co-host's user id is never the row's host_id.
async function updateRoomCurrentVideo(code, { videoUrl, videoTitle, videoSource }) {
  await ensureSchema();
  const { rows } = await pool.query(
    `UPDATE rooms SET current_video_url = $1, current_video_title = $2, current_video_source = $3
     WHERE code = $4 RETURNING *`,
    [videoUrl, videoTitle || null, videoSource, code]
  );
  return rows[0] || null;
}

async function addToQueue({ roomId, videoUrl, videoTitle, videoSource, addedBy }) {
  await ensureSchema();
  const queueId = id();
  await pool.query(
    `INSERT INTO room_queue (id, room_id, video_url, video_title, video_source, added_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [queueId, roomId, videoUrl, videoTitle || null, videoSource, addedBy || null, Date.now()]
  );
  return listQueue(roomId);
}

async function listQueue(roomId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM room_queue WHERE room_id = $1 ORDER BY created_at ASC`,
    [roomId]
  );
  return rows;
}

// Fetches a specific queue item without removing it — playing it doesn't
// delete it from the queue (only the host's explicit "remove" does), so it
// stays there for reference/replay.
async function getQueueItem(queueId, roomId) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT * FROM room_queue WHERE id = $1 AND room_id = $2`,
    [queueId, roomId]
  );
  return rows[0] || null;
}

async function removeFromQueue(queueId, roomId) {
  await ensureSchema();
  await pool.query(`DELETE FROM room_queue WHERE id = $1 AND room_id = $2`, [queueId, roomId]);
}

async function saveMessage({ roomId, username, message }) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO room_messages (id, room_id, username, message, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [id(), roomId, username, message, Date.now()]
  );
}

async function getMessages(roomId, limit = 200) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT username, message, created_at FROM room_messages WHERE room_id = $1 ORDER BY created_at ASC LIMIT $2`,
    [roomId, limit]
  );
  return rows;
}

async function addCoHost(roomId, userId) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO room_cohosts (room_id, user_id, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (room_id, user_id) DO NOTHING`,
    [roomId, userId, Date.now()]
  );
}

async function removeCoHost(roomId, userId) {
  await ensureSchema();
  await pool.query(`DELETE FROM room_cohosts WHERE room_id = $1 AND user_id = $2`, [
    roomId,
    userId,
  ]);
}

async function listCoHosts(roomId) {
  await ensureSchema();
  const { rows } = await pool.query(`SELECT user_id FROM room_cohosts WHERE room_id = $1`, [
    roomId,
  ]);
  return rows.map((r) => r.user_id);
}

// The one check used everywhere a co-host should be allowed to do
// something a host can do (playback actions), but a plain viewer can't.
async function isHostOrCoHost(room, userId) {
  if (room.host_id === userId) return true;
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT 1 FROM room_cohosts WHERE room_id = $1 AND user_id = $2`,
    [room.id, userId]
  );
  return rows.length > 0;
}

module.exports = {
  pool,
  createUser,
  getUserByEmail,
  getUserById,
  createRoom,
  getRoomByCode,
  listRoomsForUser,
  deleteRoom,
  updateRoomCapacity,
  updateRoomCurrentVideo,
  addToQueue,
  listQueue,
  getQueueItem,
  removeFromQueue,
  saveMessage,
  getMessages,
  addCoHost,
  removeCoHost,
  listCoHosts,
  isHostOrCoHost,
  createMovie,
  listMoviesForUser,
  getMovieById,
  deleteMovie,
};
