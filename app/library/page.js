"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Nav from "../../components/Nav";

import {
  useCurrentUser,
} from "../../lib/use-current-user";

/* =========================================================
   HELPERS
========================================================= */

function mb(bytes) {
  return (
    Number(bytes || 0) /
    (1024 * 1024)
  );
}

function formatMB(bytes) {
  const value =
    mb(bytes);

  return value >= 10
    ? value.toFixed(0)
    : value.toFixed(1);
}

/* =========================================================
   UPLOAD
========================================================= */

async function uploadToPCloud(
  file,
  title,
  onProgress
) {
  /*
   * STEP 1:
   * Ask our server for a direct pCloud Upload Link URL.
   * No video bytes are sent to Railway.
   */
  const prepareResponse = await fetch(
    "/api/storage/upload",
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        filename: file.name,
        contentType: file.type,
        size: file.size,
      }),
    }
  );

  const prepareText = await prepareResponse.text();
  let prepare = {};

  try {
    prepare = JSON.parse(prepareText || "{}");
  } catch {
    throw new Error(
      `Upload preparation returned invalid JSON (HTTP ${prepareResponse.status}).`
    );
  }

  if (!prepareResponse.ok || !prepare.ok) {
    throw new Error(
      prepare.error ||
        `Could not prepare pCloud upload (HTTP ${prepareResponse.status}).`
    );
  }

  /*
   * STEP 2:
   * Upload the video directly from the browser to pCloud.
   *
   * This is the important Railway/Vercel fix:
   * Railway never receives the multi-GB video body.
   */
  const uploadResult = await new Promise(
    (resolve, reject) => {
      const formData = new FormData();

      formData.append(
        "file",
        file,
        prepare.filename || file.name
      );

      const xhr = new XMLHttpRequest();

      xhr.open(
        "POST",
        prepare.uploadUrl,
        true
      );

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress?.(event.loaded);

          console.log(
            "[library] direct pCloud upload progress:",
            {
              uploaded: event.loaded,
              total: event.total,
              percentage: Math.round(
                (event.loaded / event.total) * 100
              ),
            }
          );
        }
      };

      xhr.onload = () => {
        let data = {};

        try {
          data = JSON.parse(
            xhr.responseText || "{}"
          );
        } catch {
          reject(
            new Error(
              `pCloud returned invalid JSON (HTTP ${xhr.status}).`
            )
          );
          return;
        }

        if (
          xhr.status < 200 ||
          xhr.status >= 300 ||
          Number(data.result) !== 0
        ) {
          reject(
            new Error(
              data.error ||
                `pCloud upload failed (HTTP ${xhr.status}, result ${data.result ?? "unknown"}).`
            )
          );
          return;
        }

        resolve(data);
      };

      xhr.onerror = () => {
        reject(
          new Error(
            "Network error while uploading directly to pCloud."
          )
        );
      };

      xhr.onabort = () => {
        reject(
          new Error(
            "Video upload was cancelled."
          )
        );
      };

      xhr.send(formData);
    }
  );

  console.log(
    "[library] pCloud direct upload completed:",
    uploadResult
  );

  onProgress?.(file.size);

  /*
   * STEP 3:
   * Ask our server to find the uploaded file in /WatchTogether,
   * move it into the user's folder, and return its permanent
   * pCloud file reference.
   */
  const finalizeResponse = await fetch(
    "/api/storage/upload/complete",
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        objectName: prepare.objectName,
        filename: file.name,
        title,
      }),
    }
  );

  const finalizeText =
    await finalizeResponse.text();

  let finalized = {};

  try {
    finalized = JSON.parse(
      finalizeText || "{}"
    );
  } catch {
    throw new Error(
      `Upload finalization returned invalid JSON (HTTP ${finalizeResponse.status}).`
    );
  }

  if (
    !finalizeResponse.ok ||
    !finalized.ok
  ) {
    throw new Error(
      finalized.error ||
        `Could not finalize pCloud upload (HTTP ${finalizeResponse.status}).`
    );
  }

  return finalized;
}

/* =========================================================
   LIBRARY PAGE
========================================================= */

export default function LibraryPage() {
  const user =
    useCurrentUser();

  const [
    movies,
    setMovies,
  ] = useState(
    undefined
  );

  const [
    showForm,
    setShowForm,
  ] = useState(
    false
  );

  const [
    title,
    setTitle,
  ] = useState("");

  const [
    file,
    setFile,
  ] = useState(
    null
  );

  const [
    busy,
    setBusy,
  ] = useState(
    false
  );

  const [
    progressBytes,
    setProgressBytes,
  ] = useState(
    0
  );

  const [
    error,
    setError,
  ] = useState("");

  const [
    success,
    setSuccess,
  ] = useState("");

  /* =======================================================
     PROGRESS
  ======================================================= */

  const progressPercent =
    useMemo(() => {
      if (
        !file?.size
      ) {
        return 0;
      }

      return Math.min(
        100,
        (
          progressBytes /
          file.size
        ) * 100
      );
    }, [
      file,
      progressBytes,
    ]);

  /* =======================================================
     LOAD MOVIES
  ======================================================= */

  async function loadMovies() {
    try {
      const response =
        await fetch(
          "/api/movies",
          {
            cache:
              "no-store",

            credentials:
              "include",
          }
        );

      const data =
        await response.json();

      if (
        response.ok
      ) {
        setMovies(
          data.movies ||
          []
        );
      } else {
        console.error(
          "Failed to load movies:",
          data.error
        );
      }
    } catch (error) {
      console.error(
        "Failed to load movies:",
        error
      );
    }
  }

  /* =======================================================
     SAVE MOVIE IN DATABASE
  ======================================================= */

  async function saveMovie(
    titleValue,
    storageRefValue
  ) {
    const response =
      await fetch(
        "/api/movies",
        {
          method:
            "POST",

          credentials:
            "include",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              title:
                titleValue,

              videoUrl:
                storageRefValue,
            }),
        }
      );

    const text =
      await response.text();

    let data = {};

    try {
      data =
        JSON.parse(
          text || "{}"
        );
    } catch {
      throw new Error(
        `Movie API returned invalid JSON (HTTP ${response.status})`
      );
    }

    if (
      !response.ok
    ) {
      throw new Error(
        data.error ||
        "Couldn't save the video to your library."
      );
    }

    return data.movie;
  }

  /* =======================================================
     INITIAL LOAD
  ======================================================= */

  useEffect(() => {
    if (!user) {
      return;
    }

    loadMovies();

    // Check pCloud periodically so files deleted directly in pCloud
    // disappear from the WatchTogether library automatically.
    const syncTimer = setInterval(() => {
      loadMovies();
    }, 15000);

    /*
     * Recover a movie if the browser was interrupted
     * after pCloud upload but before DB save.
     */
    try {
      const pending =
        JSON.parse(
          localStorage.getItem(
            "wt_pending_movie"
          ) || "null"
        );

      if (
        pending?.title &&
        pending?.storageRef
      ) {
        saveMovie(
          pending.title,
          pending.storageRef
        )
          .then(() => {
            localStorage.removeItem(
              "wt_pending_movie"
            );
          })
          .then(
            loadMovies
          )
          .catch(
            console.error
          );
      }
    } catch (error) {
      console.error(
        "Pending movie recovery failed:",
        error
      );
    }

    return () => clearInterval(syncTimer);
  }, [user]);

  /* =======================================================
     RESET
  ======================================================= */

  function resetUpload() {
    setTitle("");

    setFile(null);

    setProgressBytes(
      0
    );

    setError("");

    setSuccess("");

    setShowForm(
      false
    );
  }

  /* =======================================================
     UPLOAD
  ======================================================= */

  async function handleUpload(
    event
  ) {
    event.preventDefault();

    setError("");

    setSuccess("");

    if (
      !title.trim()
    ) {
      setError(
        "Give the movie a title."
      );

      return;
    }

    if (!file) {
      setError(
        "Choose a video file."
      );

      return;
    }

    setBusy(true);

    setProgressBytes(
      0
    );

    try {
      console.log(
        "[library] starting upload:",
        {
          userId:
            user?.userId,

          username:
            user?.username,

          filename:
            file.name,

          size:
            file.size,

          type:
            file.type,
        }
      );

      /*
       * Upload to the logged-in user's pCloud folder.
       */
      const result =
        await uploadToPCloud(
          file,
          title.trim(),
          (uploaded) => {
            setProgressBytes(
              uploaded
            );
          }
        );

      console.log(
        "[library] upload result:",
        result
      );

      const storageRef =
        result.storageRef;

      if (
        !storageRef
      ) {
        throw new Error(
          "pCloud upload completed but no storage reference was returned."
        );
      }

      /*
       * Save recovery information.
       */
      localStorage.setItem(
        "wt_pending_movie",
        JSON.stringify({
          title:
            title.trim(),

          storageRef,
        })
      );

      /*
       * Save movie in application database.
       */
      await saveMovie(
        title.trim(),
        storageRef
      );

      /*
       * Database succeeded.
       */
      localStorage.removeItem(
        "wt_pending_movie"
      );

      setProgressBytes(
        file.size
      );

      setSuccess(
        `Movie uploaded successfully to ${result.folderName} folder and added to your library.`
      );

      await loadMovies();

      /*
       * Clear form but keep success message.
       */
      setTitle("");

      setFile(null);

      setProgressBytes(
        0
      );

      setShowForm(
        false
      );
    } catch (error) {
      console.error(
        "[library] upload error:",
        error
      );

      setError(
        error?.message ||
        "Something went wrong while uploading."
      );
    } finally {
      setBusy(false);
    }
  }

  /* =======================================================
     DELETE MOVIE
  ======================================================= */

  async function handleDelete(
    id
  ) {
    if (
      !confirm(
        "Remove this movie from your library?"
      )
    ) {
      return;
    }

    try {
      const response =
        await fetch(
          `/api/movies/${id}`,
          {
            method:
              "DELETE",

            credentials:
              "include",
          }
        );

      if (
        !response.ok
      ) {
        const data =
          await response
            .json()
            .catch(
              () => ({})
            );

        alert(
          data.error ||
          "Couldn't remove the movie."
        );

        return;
      }

      await loadMovies();
    } catch (error) {
      alert(
        error?.message ||
        "Couldn't remove the movie."
      );
    }
  }

  /* =======================================================
     NOT LOGGED IN
  ======================================================= */

  if (!user) {
    return null;
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <main>
      <Nav
        username={
          user.username
        }
      />

      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* HEADER */}

        <div className="flex items-start justify-between mb-8">

          <div>
            <p className="text-xs uppercase tracking-wide text-accent mb-1">
              Your collection
            </p>

            <h1 className="text-2xl font-bold mb-1">
              Movie library
            </h1>

            <p className="text-sm text-neutral-500">
              Everything you've uploaded —
              ready for a private watch room.
            </p>
          </div>

          <button
            onClick={() =>
              setShowForm(
                (value) =>
                  !value
              )
            }
            disabled={busy}
            className="px-5 py-2.5 bg-accent rounded-lg font-medium hover:opacity-90 whitespace-nowrap disabled:opacity-50"
          >
            + Upload movie
          </button>
        </div>

        {/* SUCCESS */}

        {success && (
          <div className="mb-6 rounded-xl border border-green-800 bg-green-950/30 px-5 py-4 text-sm text-green-400">
            {success}
          </div>
        )}

        {/* UPLOAD FORM */}

        {showForm && (
          <form
            onSubmit={
              handleUpload
            }
            className="mb-8 p-6 rounded-xl bg-neutral-900 border border-neutral-800 space-y-4"
          >

            <div>
              <label className="block text-sm font-medium mb-2">
                Movie title
              </label>

              <input
                className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-3"
                placeholder="Enter movie title"
                value={title}
                disabled={busy}
                onChange={(event) =>
                  setTitle(
                    event.target
                      .value
                  )
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Video file
              </label>

              <input
                type="file"
                accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-matroska"
                disabled={busy}
                onChange={(event) =>
                  setFile(
                    event.target
                      .files?.[0] ||
                    null
                  )
                }
                className="w-full text-sm text-neutral-400"
              />
            </div>

            {file && (
              <p className="text-xs text-neutral-500">
                Selected:{" "}
                {file.name}
                {" · "}
                {formatMB(
                  file.size
                )}
                {" MB"}
              </p>
            )}

            {error && (
              <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {busy &&
              file && (
                <div className="space-y-2">

                  <div className="flex justify-between text-xs text-neutral-400">

                    <span>
                      Uploading video to pCloud
                    </span>

                    <span>
                      {formatMB(
                        progressBytes
                      )}
                      {" MB / "}
                      {formatMB(
                        file.size
                      )}
                      {" MB ("}
                      {Math.round(
                        progressPercent
                      )}
                      {"%)"}
                    </span>

                  </div>

                  <div className="h-2 rounded-full bg-neutral-800 overflow-hidden">

                    <div
                      className="h-full bg-accent transition-all"
                      style={{
                        width:
                          `${progressPercent}%`,
                      }}
                    />

                  </div>

                </div>
              )}

            <button
              type="submit"
              disabled={
                busy ||
                !file ||
                !title.trim()
              }
              className="bg-accent px-5 py-2.5 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? `Uploading ${formatMB(
                  progressBytes
                )} MB / ${formatMB(
                  file?.size ||
                  0
                )} MB`
                : "Add to library"}
            </button>

          </form>
        )}

        {/* EMPTY */}

        {movies &&
          movies.length ===
          0 && (
            <div className="text-center py-20 border border-dashed border-neutral-800 rounded-xl">

              <p className="text-lg font-semibold mb-2">
                Your library is empty
              </p>

              <p className="text-sm text-neutral-500 mb-6">
                Upload a legally owned movie
                file to start your first
                private watch party.
              </p>

              <button
                onClick={() =>
                  setShowForm(
                    true
                  )
                }
                className="px-5 py-2.5 bg-accent rounded-lg font-medium hover:opacity-90"
              >
                + Upload movie
              </button>

            </div>
          )}

        {/* MOVIES */}

        {movies &&
          movies.length >
          0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">

              {movies.map(
                (movie) => (
                  <div
                    key={
                      movie.id
                    }
                    className="p-5 rounded-xl bg-neutral-900 border border-neutral-800 flex flex-col gap-3"
                  >

                    <div className="aspect-video rounded-lg bg-neutral-950 overflow-hidden border border-neutral-800">
                      {movie.video_url ? (
                        <video
                          className="w-full h-full object-contain bg-black"
                          controls
                          preload="metadata"
                          playsInline
                          src={movie.video_url}
                        >
                          Your browser does not support video playback.
                        </video>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-700 text-3xl">
                          🎬
                        </div>
                      )}
                    </div>

                    <p className="font-medium truncate" title={movie.title}>
                      {
                        movie.title
                      }
                    </p>

                    <a
                      href={`/rooms/create?movieId=${encodeURIComponent(
                        movie.id
                      )}`}
                      className="text-xs text-accent hover:underline"
                    >
                      Use in room
                    </a>

                    <button
                      onClick={() =>
                        handleDelete(
                          movie.id
                        )
                      }
                      className="text-xs text-neutral-500 hover:text-red-400 text-left"
                    >
                      Remove
                    </button>

                  </div>
                )
              )}

            </div>
          )}

      </div>
    </main>
  );
}