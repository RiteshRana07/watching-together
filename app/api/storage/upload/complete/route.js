import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const { verifyToken } = require("../../../../../lib/auth");
const {
  getOrCreateUserFolder,
  findFileRecursive,
  moveFile,
  storageRef,
  filenameFromTitle,
  cleanupTemporaryUploadFolder,
} = require("../../../../../lib/pcloud");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCurrentUser() {
  try {
    const token = cookies().get("wt_session")?.value;
    const payload = token ? verifyToken(token) : null;
    return payload?.userId ? payload : null;
  } catch {
    return null;
  }
}

export async function POST(request) {
  const user = getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Not signed in." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const objectName = String(body?.objectName || "").trim();
    const originalFilename = String(body?.filename || "video.mp4").trim();
    const title = String(body?.title || "").trim();

    if (!objectName || !title) {
      return NextResponse.json(
        { error: "objectName and title are required." },
        { status: 400 }
      );
    }

    /*
     * File Request uploads may land in a temporary pCloud folder.
     * Find the uniquely named file anywhere under the account root,
     * then move it into the logged-in user's permanent folder.
     */
    let uploaded = null;

    // The pCloud File Request may currently place uploads into a
    // temporary folder such as "Files from rana on <date>".
    // Search from the pCloud account root, find the unique upload,
    // then move it into the logged-in user's permanent folder.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      uploaded = await findFileRecursive(0, objectName, 4);

      if (uploaded?.fileid) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!uploaded?.fileid) {
      return NextResponse.json(
        {
          error:
            "pCloud received the upload, but the file is not visible yet. Please wait a few seconds and try again.",
        },
        { status: 409 }
      );
    }

    const userFolder = await getOrCreateUserFolder(
      user.userId,
      user.username
    );

    // Use the title entered in the Library as the pCloud filename.
    // Preserve the original video's extension so playback remains reliable.
    const finalFilename = filenameFromTitle(
      title,
      originalFilename || uploaded.name
    );

    const moved = await moveFile(
      uploaded.fileid,
      userFolder.folderId,
      finalFilename
    );

    const finalFileId = moved?.fileid || uploaded.fileid;

    // Remove the empty pCloud File Request folder created by the
    // existing v4 upload-link flow. The folder is deleted only when
    // it matches pCloud's temporary naming pattern and is empty.
    await cleanupTemporaryUploadFolder(
      uploaded?.parentfolderid,
      uploaded?.parentfoldername
    );

    return NextResponse.json({
      ok: true,
      storageRef: storageRef(finalFileId),
      fileId: Number(finalFileId),
      folderId: userFolder.folderId,
      folderName: userFolder.folderName,
      size: Number(moved?.size || uploaded.size || 0),
      contentType:
        moved?.contenttype ||
        uploaded.contenttype ||
        "",
      name: moved?.name || finalFilename,
      title,
    });
  } catch (error) {
    console.error("[storage upload complete]", error);
    return NextResponse.json(
      { error: error?.message || "Could not finalize pCloud upload." },
      { status: 500 }
    );
  }
}
