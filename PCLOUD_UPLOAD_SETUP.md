# WatchTogether + pCloud upload setup

This deployment uses a **pCloud Upload Link / File Request** so large video files are uploaded directly from the browser to pCloud.

That is important for both Vercel and Railway: the Next.js server never receives the multi-GB video body.

## 1. Create the pCloud destination folder

Create or use:

`/WatchTogether`

The application server can create this folder automatically for normal authenticated pCloud operations, but the Upload Link must point to this folder.

## 2. Create a pCloud Upload Link / File Request

In pCloud web:

1. Open `/WatchTogether`.
2. Open the folder menu.
3. Choose **Request files** / **File Request** (the exact label can vary).
4. Create the request.
5. Keep it active.
6. Make sure its storage/file limits are sufficient for your intended uploads.

pCloud's API documents upload links and the unauthenticated `uploadtolink` endpoint. The upload-link code is the value used by the application.

## 3. Configure environment variables

Set these on Railway:

```env
JWT_SECRET=use-a-long-random-secret

DATABASE_URL=<Railway PostgreSQL connection string>

PCLOUD_API_HOST=https://api.pcloud.com
PCLOUD_ACCESS_TOKEN=<your server-side pCloud OAuth/access token>
PCLOUD_FOLDER=/WatchTogether
PCLOUD_UPLOAD_LINK_CODE=<pCloud upload-link code or full upload-link URL>

PUSHER_APP_ID=<your Pusher app id>
PUSHER_KEY=<your Pusher key>
PUSHER_SECRET=<your Pusher secret>
PUSHER_CLUSTER=<your Pusher cluster>
NEXT_PUBLIC_PUSHER_KEY=<your Pusher key>
NEXT_PUBLIC_PUSHER_CLUSTER=<your Pusher cluster>
```

Use `https://eapi.pcloud.com` instead if your pCloud account belongs to pCloud's European data center. pCloud documents separate US and European API hosts.

**Never put `PCLOUD_ACCESS_TOKEN` in a `NEXT_PUBLIC_*` variable.**

## 4. Upload flow in the Railway version

```text
Browser
   |
   | 1. POST metadata only
   v
Railway / Next.js
   |
   | returns pCloud upload URL + unique filename
   v
Browser
   |
   | 2. DIRECT multipart upload
   v
pCloud Upload Link
   |
   | file stored temporarily in /WatchTogether
   v
Browser
   |
   | 3. POST completion metadata
   v
Railway / Next.js
   |
   | find unique file + move it
   v
/WatchTogether/<username>/<original filename>
   |
   v
PostgreSQL stores pcloud:<fileid>
```

The server does not buffer the video and does not use Railway's local filesystem for video storage.

pCloud's `uploadtolink` endpoint accepts the upload-link code and multipart file upload, while `renamefile` can move a file into another folder.

## 5. Maximum file size

The application keeps the existing **3 GB application limit**.

The actual usable limit is also constrained by your pCloud storage/quota and the limits configured on the Upload Link.

## 6. Playback

The database stores only a stable pCloud file reference:

`pcloud:<fileid>`

When a video is played, the server uses pCloud's server-side `getfilelink` API and returns a temporary content URL to the browser.

pCloud explicitly documents `getfilelink` as a server-side method and says it cannot be called directly from a web application, which is why the WatchTogether server performs this operation.

## 7. Important

If the pCloud Upload Link/File Request is deleted, expired, or reaches its configured file/space limit, new uploads will fail. pCloud documents these upload-link failure conditions.

The `PCLOUD_UPLOAD_LINK_CODE` value can be either the raw code or the full pCloud upload-link URL; WatchTogether extracts the code automatically.
