import React, { useEffect, useState } from "react";
import {
  ensureAnon,
  isAdmin,
  loadExerciseLibrary,
  saveExerciseLibrary,
  subscribeExerciseLibrary,
  subscribeToRoleChanges,
  type ExerciseLibraryItem,
} from "../lib/db";
import { ConfirmModal } from "../components/ConfirmModal";

type Exercise = ExerciseLibraryItem;

const DEFAULT_EXERCISES: Exercise[] = [
  { name: "Bench Press", url: "https://www.youtube.com/watch?v=AaxnxakLgRQ" },
  { name: "Squat", url: "https://www.youtube.com/watch?v=my0tLDaWyDU" },
  { name: "Deadlift", url: "https://www.youtube.com/watch?v=WP0IFHkkRZ0" },
  { name: "Goblet Squat", url: "https://www.youtube.com/shorts/yTDROg8zZsU" },
  { name: "Norwegian Curls", url: "https://www.youtube.com/shorts/Xyf3Aehy210" },
  { name: "Assisted Pull-ups", url: "https://www.youtube.com/shorts/65tcjz-ie8o" },
  { name: "Military Push-up", url: "https://www.youtube.com/shorts/zoN5EH50Dro" },
  { name: "Lat Pulldown", url: "https://www.youtube.com/shorts/bNmvKpJSWKM" },
  { name: "High Pulls", url: "https://www.youtube.com/shorts/e1E6TGWiUac" },
  { name: "Skull Crushers", url: "https://www.youtube.com/shorts/K3mFeNz4e3w" },
  { name: "Good Mornings", url: "https://www.youtube.com/watch?v=f23vXjoG2e8" },
  { name: "Bulgarian Split Squats", url: "https://www.youtube.com/shorts/lG3MsPmEQQk" },
  { name: "Spiderman Push-ups", url: "https://www.youtube.com/shorts/o7hoH-AsAqs" },
];

const toEmbedUrl = (source: string): string => {
  try {
    const url = new URL(source);
    const host = url.hostname.replace(/^www\./, "");
    let videoId = "";

    if (host === "youtu.be") {
      videoId = url.pathname.slice(1);
    } else if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v") ?? "";
      } else if (url.pathname.startsWith("/shorts/")) {
        const parts = url.pathname.split("/");
        videoId = parts[2] ?? "";
      } else if (url.pathname.startsWith("/embed/")) {
        videoId = url.pathname.split("/")[2] ?? "";
      }
    }

    if (!videoId) return source;

    return `https://www.youtube.com/embed/${videoId}`;
  } catch {
    return source;
  }
};

export default function Exercises() {
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>(() => [...DEFAULT_EXERCISES]);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [addPlacement, setAddPlacement] = useState<"top" | "bottom">("bottom");
  const [deleteConfirm, setDeleteConfirm] = useState<{ index: number; name: string } | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribeExercises: (() => void) | null = null;
    (async () => {
      try {
        await ensureAnon();
        const [adminFlag, loadedExercises] = await Promise.all([
          isAdmin(),
          loadExerciseLibrary(DEFAULT_EXERCISES),
        ]);
        if (!active) return;
        setAdmin(adminFlag);
        setExercises(loadedExercises);

        unsubscribeExercises = subscribeExerciseLibrary(
          (items) => {
            if (!active) return;
            setExercises(items);
          },
          DEFAULT_EXERCISES
        );
      } catch (err) {
        if (!active) return;
        console.warn("Failed to initialize exercises", err);
        setExercises([...DEFAULT_EXERCISES]);
        setAdmin(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      if (unsubscribeExercises) {
        unsubscribeExercises();
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRoleChanges((roles) => {
      setAdmin(roles.includes("admin"));
    });
    return unsubscribe;
  }, []);

  const handleAddExercise = async () => {
    const trimmedName = newName.trim();
    let trimmedUrl = newUrl.trim();
    
    if (!trimmedName) {
      alert("Please Enter An Exercise Name");
      return;
    }
    
    if (!trimmedUrl) {
      alert("Please Enter A YouTube URL");
      return;
    }
    
    // Add https:// if missing
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      trimmedUrl = "https://" + trimmedUrl;
    }
    
    // Check if URL is a valid YouTube URL
    if (!trimmedUrl.includes("youtube.com") && !trimmedUrl.includes("youtu.be")) {
      alert("Please Enter A Valid YouTube URL");
      return;
    }
    
    // Validate URL format
    try {
      new URL(trimmedUrl);
    } catch {
      alert("Please Enter A Valid URL");
      return;
    }
    
    // Check for duplicate names
    if (exercises.some(ex => ex.name.toLowerCase() === trimmedName.toLowerCase())) {
      alert("An Exercise With This Name Already Exists");
      return;
    }
    
    const previous = exercises;
    const nextExercise = { name: trimmedName, url: trimmedUrl };
    const next =
      addPlacement === "top"
        ? [nextExercise, ...exercises]
        : [...exercises, nextExercise];
    setExercises(next);
    try {
      await saveExerciseLibrary(next, { requireRemote: true });
      setNewName("");
      setNewUrl("");
    } catch (err) {
      console.warn("Failed to sync exercise library", err);
      setExercises(previous);
      alert("Could not sync exercise changes right now. Please try again.");
    }
  };

  const handleMoveExercise = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= exercises.length) return;
    const previous = exercises;
    const next = [...exercises];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    setExercises(next);
    try {
      await saveExerciseLibrary(next, { requireRemote: true });
    } catch (err) {
      console.warn("Failed to sync exercise order", err);
      setExercises(previous);
      alert("Could not sync exercise order right now. Please try again.");
    }
  };

  const handleDeleteExercise = async () => {
    if (deleteConfirm === null) return;
    const previous = exercises;
    const next = exercises.filter((_, i) => i !== deleteConfirm.index);
    setExercises(next);
    try {
      await saveExerciseLibrary(next, { requireRemote: true });
      setDeleteConfirm(null);
    } catch (err) {
      console.warn("Failed to sync exercise library", err);
      setExercises(previous);
      alert("Could not sync exercise changes right now. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="container py-6">
        <div className="card text-sm text-gray-600">Loading Exercises...</div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Exercise Library</h1>
          <p className="mt-2 text-sm text-gray-600">
            Quick Refreshers For Key Lifts. Watch The Technique Video Before You Coach Or Train The Movement.
          </p>
        </div>

        {admin && (
          <button
            type="button"
            className={`btn btn-sm ${editMode ? "btn-secondary" : ""}`}
            onClick={() => setEditMode((prev) => !prev)}
          >
            {editMode ? "Done Editing" : "Edit Exercises"}
          </button>
        )}
      </div>

      {admin && editMode && (
        <div className="card space-y-4 border-2 border-brand-200 bg-brand-50">
          <div className="text-sm font-semibold text-brand-900">Add New Exercise</div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Exercise Name
              </label>
              <input
                type="text"
                className="field w-full"
                placeholder="e.g. Box Jumps"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                YouTube URL
              </label>
              <input
                type="text"
                className="field w-full"
                placeholder="https://www.youtube.com/watch?v=..."
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                Supports Full URLs, Shorts, And youtu.be Links
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Insert Position
              </label>
              <select
                className="field w-full"
                value={addPlacement}
                onChange={(e) =>
                  setAddPlacement(e.target.value === "top" ? "top" : "bottom")
                }
              >
                <option value="bottom">Bottom Of List</option>
                <option value="top">Top Of List</option>
              </select>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleAddExercise}
            >
              Add Exercise
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {exercises.map((exercise, index) => {
          const embed = toEmbedUrl(exercise.url);
          return (
            <div key={`${exercise.name}-${index}`} className="card space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="text-lg font-semibold">{exercise.name}</div>
                {admin && editMode && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={index === 0}
                      onClick={() => void handleMoveExercise(index, -1)}
                      title="Move Up"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={index === exercises.length - 1}
                      onClick={() => void handleMoveExercise(index, 1)}
                      title="Move Down"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="text-red-600 hover:text-red-700 text-xs font-medium"
                      onClick={() => setDeleteConfirm({ index, name: exercise.name })}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              <div className="relative w-full overflow-hidden rounded-xl border border-gray-200 bg-black pt-[56.25%]">
                <iframe
                  className="absolute inset-0 h-full w-full"
                  src={embed}
                  title={`${exercise.name} technique`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
              <a
                href={exercise.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-brand-600 hover:text-brand-700"
              >
                Open On YouTube
              </a>
            </div>
          );
        })}
      </div>

      <ConfirmModal
        isOpen={deleteConfirm !== null}
        title="Delete Exercise"
        message={`Are You Sure You Want To Delete "${deleteConfirm?.name}"? This Cannot Be Undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDeleteExercise}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
