const crypto = require("crypto");

const API_HOST = (
  process.env.PCLOUD_API_HOST ||
  "https://api.pcloud.com"
).replace(/\/$/, "");

const ACCESS_TOKEN =
  process.env.PCLOUD_ACCESS_TOKEN ||
  process.env.PCLOUD_AUTH ||
  "";

const ROOT_FOLDER =
  process.env.PCLOUD_FOLDER ||
  "/WatchTogether";

const UPLOAD_LINK_CODE =
  process.env.PCLOUD_UPLOAD_LINK_CODE || "";

const MAX_VIDEO_BYTES =
  3 * 1024 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/x-matroska",
]);

/* =========================================================
   CONFIG
========================================================= */

function isConfigured() {
  return Boolean(ACCESS_TOKEN);
}

function requireConfigured() {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "pCloud is not configured. Set PCLOUD_ACCESS_TOKEN."
    );
  }
}

function getUploadLinkCode() {
  const raw = String(UPLOAD_LINK_CODE || "").trim();
  if (!raw) {
    throw new Error(
      "pCloud upload is not configured. Set PCLOUD_UPLOAD_LINK_CODE."
    );
  }

  // Accept either the raw pCloud upload-link code or the full
  // https://my.pcloud.com/#page=puplink&code=... URL.
  try {
    const hash = raw.includes("#") ? raw.split("#")[1] : "";
    const params = new URLSearchParams(hash);
    const code = params.get("code");
    if (code) return code;
  } catch {}

  const match = raw.match(/[?&#]code=([^&#]+)/i);
  if (match) {
    return decodeURIComponent(match[1]);
  }

  return raw;
}

function safeUploadLinkName(value) {
  return (
    String(value || "WatchTogether")
      .normalize("NFKC")
      .replace(/[\\/\0]+/g, "-")
      .replace(/[^a-zA-Z0-9._ -]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) ||
    "WatchTogether"
  );
}

function getUploadLinkUrl(uploaderName = "WatchTogether") {
  const code = getUploadLinkCode();

  /*
   * pCloud upload links have historically required the `names`
   * parameter for direct multipart uploads, even though it is not
   * listed as required in the current uploadtolink documentation.
   * Omitting it can produce result 2001 (Invalid file/folder name).
   * Keep it simple and URL-encode it.
   */
  const name = safeUploadLinkName(uploaderName);

  return (
    `${API_HOST}/uploadtolink?code=${encodeURIComponent(code)}` +
    `&names=${encodeURIComponent(name)}&nopartial=1`
  );
}

/* =========================================================
   pCloud API
========================================================= */

async function api(
  method,
  params = {},
  options = {}
) {
  requireConfigured();

  const url = new URL(
    `${API_HOST}/${method}`
  );

  Object.entries(params).forEach(
    ([key, value]) => {
      if (
        value !== undefined &&
        value !== null
      ) {
        url.searchParams.set(
          key,
          String(value)
        );
      }
    }
  );

  url.searchParams.set(
    "access_token",
    ACCESS_TOKEN
  );

  const response = await fetch(
    url,
    {
      method:
        options.method || "GET",

      cache: "no-store",

      signal:
        options.signal,

      headers: {
        ...(options.headers || {}),
        Authorization:
          `Bearer ${ACCESS_TOKEN}`,
      },

      body:
        options.body,
    }
  );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    throw new Error(
      `pCloud returned invalid JSON (HTTP ${response.status})`
    );
  }

  if (
    !response.ok ||
    Number(data.result) !== 0
  ) {
    const error =
      new Error(
        data.error ||
          `pCloud API error ${
            data.result ||
            response.status
          }`
      );

    error.code =
      data.result;

    error.status =
      response.status;

    throw error;
  }

  return data;
}

/* =========================================================
   Filename
========================================================= */

function safeFilename(name) {
  const base =
    String(
      name ||
        "video.mp4"
    )
      .normalize("NFKC")
      .replace(
        /[\\/\0]+/g,
        "-"
      )
      .replace(
        /[^a-zA-Z0-9._ -]+/g,
        "-"
      )
      .replace(
        /\s+/g,
        " "
      )
      .replace(
        /-+/g,
        "-"
      )
      .trim()
      .replace(
        /^[. -]+|[. -]+$/g,
        ""
      )
      .slice(
        0,
        180
      );

  return (
    base ||
    "video.mp4"
  );
}

/*
 * Unique filename.
 *
 * This prevents one user's upload from overwriting
 * another file with the same original filename.
 */
function filenameFromTitle(title, originalFilename) {
  const original = safeFilename(originalFilename || "video.mp4");
  const lastDot = original.lastIndexOf(".");
  const extension =
    lastDot > 0 && lastDot < original.length - 1
      ? original.slice(lastDot)
      : ".mp4";

  let cleanTitle = safeFilename(title || "video");
  cleanTitle = cleanTitle.replace(/\.[^.]+$/, "");

  return safeFilename(`${cleanTitle || "video"}${extension}`);
}

function isPCloudFileMissingError(error) {
  return Number(error?.code) === 2009;
}

function makeObjectName(
  userId,
  filename
) {
  return `${safeFilename(
    userId
  )}-${Date.now()}-${crypto.randomUUID()}-${safeFilename(
    filename
  )}`;
}

/* =========================================================
   User folder name
========================================================= */

function safeFolderName(
  username,
  userId
) {
  const source =
    String(
      username ||
        userId ||
        "user"
    )
      .normalize("NFKC")
      .replace(
        /[\\/\0]+/g,
        "-"
      )
      .replace(
        /[^a-zA-Z0-9._ -]+/g,
        "-"
      )
      .replace(
        /\s+/g,
        " "
      )
      .replace(
        /-+/g,
        "-"
      )
      .trim()
      .replace(
        /^[. -]+|[. -]+$/g,
        ""
      )
      .slice(
        0,
        80
      );

  return (
    source ||
    `user-${userId}`
  );
}

/* =========================================================
   Storage reference
========================================================= */

function storageRef(
  fileId
) {
  return `pcloud:${String(
    fileId
  )}`;
}

function isPCloudRef(
  value
) {
  return (
    typeof value ===
      "string" &&
    value.startsWith(
      "pcloud:"
    )
  );
}

function fileIdFromRef(
  value
) {
  if (
    !isPCloudRef(value)
  ) {
    return null;
  }

  const id =
    value.slice(
      "pcloud:".length
    );

  return /^\d+$/.test(
    id
  )
    ? id
    : null;
}

/* =========================================================
   Video validation
========================================================= */

function validateVideo({
  filename,
  contentType,
  size,
}) {
  if (
    !ALLOWED_TYPES.has(
      contentType
    )
  ) {
    throw new Error(
      "Unsupported video type. Use MP4, WebM, OGG, MOV or MKV."
    );
  }

  const bytes =
    Number(size);

  if (
    !Number.isFinite(
      bytes
    ) ||
    bytes <= 0
  ) {
    throw new Error(
      "Invalid video size."
    );
  }

  if (
    bytes >
    MAX_VIDEO_BYTES
  ) {
    throw new Error(
      "Video is too large. Maximum size is 3 GB."
    );
  }

  if (
    !String(
      filename || ""
    ).trim()
  ) {
    throw new Error(
      "Filename is required."
    );
  }

  return bytes;
}

/* =========================================================
   ROOT FOLDER
========================================================= */

/*
 * Creates /WatchTogether only once.
 *
 * If it already exists, pCloud returns its
 * existing metadata instead of creating another folder.
 */
async function ensureFolder() {
  const data =
    await api(
      "createfolderifnotexists",
      {
        path:
          ROOT_FOLDER,
      }
    );

  const folderId =
    data.metadata?.folderid ??
    data.metadata?.id;

  if (!folderId) {
    throw new Error(
      "pCloud did not return the WatchTogether folder ID."
    );
  }

  return Number(
    folderId
  );
}

/* =========================================================
   LIST FOLDER
========================================================= */

async function listFolder(
  folderId
) {
  const data =
    await api(
      "listfolder",
      {
        folderid:
          folderId,
      }
    );

  return (
    data.metadata ||
    {}
  );
}

/* =========================================================
   USER FOLDER
========================================================= */

/*
 * IMPORTANT:
 *
 * WatchTogether
 *      |
 *      +-- rana
 *      |
 *      +-- rahul
 *      |
 *      +-- amit
 *
 * Same username:
 *     existing folder is reused.
 *
 * New username:
 *     folder is created once.
 */
async function getOrCreateUserFolder(
  userId,
  username
) {
  if (!userId) {
    throw new Error(
      "User ID is required to create the pCloud user folder."
    );
  }

  // User folders live directly in the pCloud account root:
  // pCloud/
  //   rana/
  //   rahul/
  //   ...
  // This matches the logged-in username instead of nesting
  // everything under /WatchTogether.
  const rootFolderId = 0;

  const folderName =
    safeFolderName(
      username,
      userId
    );

  console.log(
    "[pCloud] root folder:",
    rootFolderId
  );

  console.log(
    "[pCloud] user folder:",
    folderName
  );

  /*
   * First check whether the folder already exists.
   */
  const metadata =
    await listFolder(
      rootFolderId
    );

  const contents =
    Array.isArray(
      metadata.contents
    )
      ? metadata.contents
      : [];

  const existingFolder =
    contents.find(
      (item) =>
        item.isfolder &&
        String(
          item.name
        ).toLowerCase() ===
          folderName.toLowerCase()
    );

  if (
    existingFolder?.folderid ||
    existingFolder?.id
  ) {
    const existingId =
      existingFolder.folderid ??
      existingFolder.id;

    console.log(
      "[pCloud] existing user folder:",
      existingId
    );

    return {
      folderId:
        Number(existingId),

      folderName,
    };
  }

  /*
   * Folder doesn't exist.
   *
   * Create it directly in the user's pCloud root.
   */
  try {
    const created =
      await api(
        "createfolderifnotexists",
        {
          folderid:
            rootFolderId,

          name:
            folderName,
        }
      );

    const newFolderId =
      created.metadata?.folderid ??
      created.metadata?.id;

    if (!newFolderId) {
      throw new Error(
        "pCloud did not return the new user folder ID."
      );
    }

    console.log(
      "[pCloud] created user folder:",
      {
        folderId:
          newFolderId,

        folderName,
      }
    );

    return {
      folderId:
        Number(newFolderId),

      folderName,
    };
  } catch (error) {
    /*
     * Another request may have created the folder
     * at exactly the same time.
     *
     * Error 2004 = folder already exists.
     */
    if (
      Number(
        error?.code
      ) === 2004
    ) {
      const retry =
        await listFolder(
          rootFolderId
        );

      const retryContents =
        Array.isArray(
          retry.contents
        )
          ? retry.contents
          : [];

      const folder =
        retryContents.find(
          (item) =>
            item.isfolder &&
            String(
              item.name
            ).toLowerCase() ===
              folderName.toLowerCase()
        );

      if (
        folder?.folderid ||
        folder?.id
      ) {
        return {
          folderId:
            Number(
              folder.folderid ??
                folder.id
            ),

          folderName,
        };
      }
    }

    throw error;
  }
}

/* =========================================================
   UPLOAD FILE
========================================================= */

/*
 * Server receives the browser file and sends it to
 * pCloud's uploadfile endpoint.
 *
 * folderId decides exactly where the file is stored.
 */
async function uploadFileToFolder({
  folderId,
  file,
  filename,
  contentType,
}) {
  requireConfigured();

  if (!folderId) {
    throw new Error(
      "pCloud folder ID is required."
    );
  }

  if (!file) {
    throw new Error(
      "Video file is required."
    );
  }

  const finalFilename =
    safeFilename(
      filename ||
        file.name ||
        "video.mp4"
    );

  const blob =
    file instanceof Blob
      ? file
      : new Blob(
          [file],
          {
            type:
              contentType ||
              "application/octet-stream",
          }
        );

  const form =
    new FormData();

  /*
   * pCloud requires filename to be supplied
   * as the multipart filename.
   */
  form.append(
    "file",
    blob,
    finalFilename
  );

  const url =
    new URL(
      `${API_HOST}/uploadfile`
    );

  url.searchParams.set(
    "access_token",
    ACCESS_TOKEN
  );

  url.searchParams.set(
    "folderid",
    String(folderId)
  );

  url.searchParams.set(
    "filename",
    finalFilename
  );

  url.searchParams.set(
    "nopartial",
    "1"
  );

  url.searchParams.set(
    "renameifexists",
    "1"
  );

  console.log(
    "[pCloud] uploading:",
    {
      folderId,
      filename:
        finalFilename,
      size:
        file.size,
    }
  );

  const response =
    await fetch(
      url,
      {
        method:
          "POST",

        cache:
          "no-store",

        headers: {
          Authorization:
            `Bearer ${ACCESS_TOKEN}`,
        },

        body:
          form,
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(
        text
      );
  } catch {
    throw new Error(
      `pCloud upload returned invalid JSON (HTTP ${response.status})`
    );
  }

  if (
    !response.ok ||
    Number(data.result) !== 0
  ) {
    const error =
      new Error(
        data.error ||
          `pCloud upload failed (${
            data.result ||
            response.status
          })`
      );

    error.code =
      data.result;

    error.status =
      response.status;

    throw error;
  }

  const uploadedFile =
    Array.isArray(
      data.metadata
    )
      ? data.metadata[0]
      : null;

  const fileId =
    data.fileids?.[0] ??
    uploadedFile?.fileid;

  if (!fileId) {
    throw new Error(
      "pCloud upload succeeded but no file ID was returned."
    );
  }

  console.log(
    "[pCloud] upload successful:",
    {
      fileId,
      folderId,
      filename:
        uploadedFile?.name ||
        finalFilename,
    }
  );

  return {
    fileId:
      Number(fileId),

    storageRef:
      storageRef(
        fileId
      ),

    metadata:
      uploadedFile,
  };
}

/* =========================================================
   FIND FILE
========================================================= */

async function findFile(
  folderId,
  objectName
) {
  const metadata =
    await listFolder(
      folderId
    );

  const files =
    Array.isArray(
      metadata.contents
    )
      ? metadata.contents
      : [];

  return (
    files.find(
      (item) =>
        !item.isfolder &&
        item.name ===
          objectName
    ) ||
    null
  );
}

/* =========================================================
   FIND FILE RECURSIVELY
========================================================= */

async function findFileRecursive(
  folderId,
  objectName,
  maxDepth = 4,
  visited = new Set()
) {
  const id = Number(folderId);

  if (!Number.isFinite(id) || visited.has(id) || maxDepth < 0) {
    return null;
  }

  visited.add(id);

  const metadata = await listFolder(id);
  const contents = Array.isArray(metadata.contents) ? metadata.contents : [];

  const direct = contents.find(
    (item) => !item.isfolder && item.name === objectName
  );

  if (direct) {
    return {
      ...direct,
      parentfolderid: direct.parentfolderid ?? id,
      parentfoldername: direct.parentfoldername ?? metadata.name ?? "",
    };
  }

  if (maxDepth === 0) return null;

  for (const item of contents) {
    const childId = item.folderid ?? item.id;
    if (!item.isfolder || !childId) continue;

    const found = await findFileRecursive(
      childId,
      objectName,
      maxDepth - 1,
      visited
    );

    if (found) return found;
  }

  return null;
}

/* =========================================================
   FILE METADATA
========================================================= */

async function getFileMetadata(
  fileId
) {
  const data =
    await api(
      "stat",
      {
        fileid:
          fileId,
      }
    );

  return data.metadata;
}

/* =========================================================
   PLAYBACK
========================================================= */

function buildContentUrl(
  result
) {
  if (
    !result?.hosts?.length ||
    !result.path
  ) {
    throw new Error(
      "pCloud did not return a playable content URL."
    );
  }

  return `https://${result.hosts[0]}${result.path}`;
}

async function getFileLink(
  fileId
) {
  const data =
    await api(
      "getfilelink",
      {
        fileid:
          fileId,

        skipfilename:
          1,
      }
    );

  return buildContentUrl(
    data
  );
}

async function signDownload(
  storedValue
) {
  if (
    !isPCloudRef(
      storedValue
    )
  ) {
    return storedValue;
  }

  const fileId =
    fileIdFromRef(
      storedValue
    );

  if (!fileId) {
    throw new Error(
      "Invalid pCloud storage reference."
    );
  }

  return getFileLink(
    fileId
  );
}

/* =========================================================
   METADATA FROM STORAGE REF
========================================================= */

async function getMetadataFromRef(
  storedValue
) {
  const fileId =
    fileIdFromRef(
      storedValue
    );

  if (!fileId) {
    return null;
  }

  return getFileMetadata(
    fileId
  );
}

/* =========================================================
   MOVE FILE
========================================================= */

async function moveFile(fileId, folderId, filename) {
  if (!fileId || !folderId) {
    throw new Error("pCloud file ID and destination folder are required.");
  }

  const data = await api("renamefile", {
    fileid: fileId,
    tofolderid: folderId,
    toname: safeFilename(filename),
  });

  return data.metadata;
}

/* =========================================================
   DELETE
========================================================= */

async function deleteFile(
  fileId
) {
  await api(
    "deletefile",
    {
      fileid:
        fileId,
    }
  );
}

/*
 * v4 intentionally keeps the existing pCloud File Request upload link
 * because it is already working with the user's current pCloud setup.
 * pCloud can create a temporary folder such as:
 *   Files from rana on Aug 16, 2026
 *
 * After we move the uploaded file into the permanent /username folder,
 * remove that temporary folder only when it is empty and its name matches
 * pCloud's File Request naming pattern. Never delete normal user folders.
 */
async function cleanupTemporaryUploadFolder(folderId, folderName) {
  const id = Number(folderId);
  const name = String(folderName || "").trim();

  if (!Number.isFinite(id) || id <= 0) {
    return false;
  }

  if (!/^Files from .+ on .+$/i.test(name)) {
    return false;
  }

  try {
    const metadata = await listFolder(id);
    const contents = Array.isArray(metadata.contents)
      ? metadata.contents
      : [];

    // Never delete a folder that still contains files/folders.
    if (contents.length !== 0) {
      return false;
    }

    await api("deletefolder", { folderid: id });

    console.log(
      "[pCloud] removed empty temporary File Request folder:",
      { folderId: id, folderName: name }
    );

    return true;
  } catch (error) {
    // Cleanup is best-effort; the upload itself remains successful.
    console.error(
      "[pCloud] temporary folder cleanup failed:",
      error?.message || error
    );
    return false;
  }
}

async function deleteStoredObject(
  storedValue
) {
  if (
    !isPCloudRef(
      storedValue
    )
  ) {
    return;
  }

  const fileId =
    fileIdFromRef(
      storedValue
    );

  if (fileId) {
    await deleteFile(
      fileId
    );
  }
}

/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
  API_HOST,

  ROOT_FOLDER,

  MAX_VIDEO_BYTES,

  ALLOWED_TYPES,

  isConfigured,

  requireConfigured,

  safeFilename,

  filenameFromTitle,

  isPCloudFileMissingError,

  safeFolderName,

  makeObjectName,

  storageRef,

  isPCloudRef,

  fileIdFromRef,

  validateVideo,

  ensureFolder,

  listFolder,

  getOrCreateUserFolder,

  getUploadLinkCode,

  getUploadLinkUrl,

  moveFile,

  uploadFileToFolder,

  findFile,

  findFileRecursive,

  getFileMetadata,

  signDownload,

  getMetadataFromRef,

  cleanupTemporaryUploadFolder,

  deleteStoredObject,
};