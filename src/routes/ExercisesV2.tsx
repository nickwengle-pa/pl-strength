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
import { useToast } from "../context/ToastContext";

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
      if (url.pathname === "/watch") videoId = url.searchParams.get("v") ?? "";
      else if (url.pathname.startsWith("/shorts/")) videoId = url.pathname.split("/")[2] ?? "";
      else if (url.pathname.startsWith("/embed/")) videoId = url.pathname.split("/")[2] ?? "";
    }
    if (!videoId) return source;
    return `https://www.youtube.com/embed/${videoId}`;
  } catch {
    return source;
  }
};

export default function ExercisesV2() {
  const showToast = useToast();
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
          (items) => { if (!active) return; setExercises(items); },
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
      if (unsubscribeExercises) unsubscribeExercises();
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
    if (!trimmedName) { showToast("Please enter an exercise name.", "warning"); return; }
    if (!trimmedUrl) { showToast("Please enter a YouTube URL.", "warning"); return; }
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      trimmedUrl = "https://" + trimmedUrl;
    }
    if (!trimmedUrl.includes("youtube.com") && !trimmedUrl.includes("youtu.be")) {
      showToast("Please enter a valid YouTube URL.", "warning");
      return;
    }
    try { new URL(trimmedUrl); } catch { showToast("Please enter a valid URL.", "warning"); return; }
    if (exercises.some(ex => ex.name.toLowerCase() === trimmedName.toLowerCase())) {
      showToast("An exercise with this name already exists.", "warning");
      return;
    }
    const previous = exercises;
    const nextExercise = { name: trimmedName, url: trimmedUrl };
    const next = addPlacement === "top" ? [nextExercise, ...exercises] : [...exercises, nextExercise];
    setExercises(next);
    try {
      await saveExerciseLibrary(next, { requireRemote: true });
      setNewName(""); setNewUrl("");
    } catch (err) {
      console.warn("Failed to sync exercise library", err);
      setExercises(previous);
      showToast("Could not sync exercise changes right now. Please try again.", "error");
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
      showToast("Could not sync exercise order right now. Please try again.", "error");
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
      showToast("Could not sync exercise changes right now. Please try again.", "error");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-v2-surface-950">
        <span className="font-v2-heading text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] animate-pulse">
          Loading Exercises…
        </span>
      </div>
    );
  }

  const fieldCls =
    "bg-v2-surface-900 border border-v2-surface-700 text-v2-ink-50 font-v2-body rounded-v2-sm px-3 py-2 text-v2-base focus:border-v2-accent-500 focus:outline-none transition-colors duration-v2-quick placeholder:text-v2-ink-600 w-full";
  const labelCls =
    "block font-v2-body text-v2-xs font-semibold text-v2-ink-400 uppercase tracking-[0.18em] mb-1.5";

  return (
    <div className="min-h-screen bg-v2-surface-950 text-v2-ink-50 pb-12 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-64 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(122,15,24,0.15) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto px-gutter-mobile md:px-6 py-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-px w-7 bg-v2-accent-700" />
              <span className="font-v2-body text-v2-xs text-v2-accent-300 uppercase tracking-[0.24em] font-semibold">
                Library
              </span>
            </div>
            <h1 className="font-v2-heading text-v2-3xl font-bold text-v2-ink-50 uppercase tracking-tight leading-none mt-2">
              Exercise Library
            </h1>
            <p className="font-v2-body text-v2-sm text-v2-ink-400 mt-2 max-w-2xl">
              Quick refreshers for key lifts. Watch the technique video before you coach or train the movement.
            </p>
          </div>

          {admin && (
            <button
              type="button"
              className={`min-h-touch px-5 py-2 font-v2-heading text-v2-sm font-bold uppercase tracking-widest border rounded-v2-sm transition-colors duration-v2-quick ${
                editMode
                  ? "bg-v2-surface-800 border-v2-surface-600 text-v2-ink-100 hover:bg-v2-surface-700"
                  : "bg-v2-accent-700 border-v2-accent-600 text-v2-ink-50 hover:bg-v2-accent-800"
              }`}
              onClick={() => setEditMode((prev) => !prev)}
            >
              {editMode ? "Done Editing" : "Edit Exercises"}
            </button>
          )}
        </div>

        {/* Admin add-new form */}
        {admin && editMode && (
          <div className="bg-v2-surface-900 border border-v2-surface-800 border-l-[3px] border-l-v2-accent-600 rounded-v2-md shadow-v2-elev-1 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-px w-5 bg-v2-accent-600" />
              <span className="font-v2-body text-v2-xs font-semibold text-v2-accent-300 uppercase tracking-[0.22em]">
                Add New Exercise
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr,1fr,auto] md:items-end">
              <div>
                <label className={labelCls}>Exercise Name</label>
                <input
                  type="text"
                  className={fieldCls}
                  placeholder="e.g. Box Jumps"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>YouTube URL</label>
                <input
                  type="text"
                  className={fieldCls}
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Position</label>
                <select
                  className={fieldCls}
                  value={addPlacement}
                  onChange={(e) => setAddPlacement(e.target.value === "top" ? "top" : "bottom")}
                >
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </select>
              </div>
            </div>
            <p className="font-v2-body text-v2-xs text-v2-ink-500">
              Supports full URLs, Shorts, and youtu.be links.
            </p>
            <button
              type="button"
              className="min-h-touch px-5 py-2 bg-v2-accent-700 hover:bg-v2-accent-800 text-v2-ink-50 font-v2-heading text-v2-sm font-bold uppercase tracking-widest rounded-v2-sm transition-colors duration-v2-quick"
              onClick={handleAddExercise}
            >
              Add Exercise
            </button>
          </div>
        )}

        {/* Exercise grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {exercises.map((exercise, index) => {
            const embed = toEmbedUrl(exercise.url);
            return (
              <article
                key={`${exercise.name}-${index}`}
                className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md overflow-hidden shadow-v2-elev-1 flex flex-col"
              >
                <div className="px-4 py-3 border-b border-v2-surface-800 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-v2-mono text-v2-xs text-v2-ink-500 tabular-nums flex-shrink-0">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-v2-heading text-v2-lg font-bold text-v2-ink-50 uppercase tracking-tight leading-tight truncate">
                      {exercise.name}
                    </h3>
                  </div>
                  {admin && editMode && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        className="px-2 py-1 font-v2-body text-v2-xs font-bold uppercase tracking-wide border border-v2-surface-700 text-v2-ink-300 hover:border-v2-surface-500 hover:text-v2-ink-100 disabled:opacity-30 disabled:cursor-not-allowed rounded-v2-sm transition-colors duration-v2-quick"
                        disabled={index === 0}
                        onClick={() => void handleMoveExercise(index, -1)}
                        title="Move Up"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 font-v2-body text-v2-xs font-bold uppercase tracking-wide border border-v2-surface-700 text-v2-ink-300 hover:border-v2-surface-500 hover:text-v2-ink-100 disabled:opacity-30 disabled:cursor-not-allowed rounded-v2-sm transition-colors duration-v2-quick"
                        disabled={index === exercises.length - 1}
                        onClick={() => void handleMoveExercise(index, 1)}
                        title="Move Down"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 font-v2-body text-v2-xs font-bold uppercase tracking-wide text-v2-danger-400 hover:text-v2-danger-300 transition-colors duration-v2-quick"
                        onClick={() => setDeleteConfirm({ index, name: exercise.name })}
                      >
                        Del
                      </button>
                    </div>
                  )}
                </div>
                <div className="relative w-full bg-v2-surface-950 pt-[56.25%]">
                  <iframe
                    className="absolute inset-0 h-full w-full"
                    src={embed}
                    title={`${exercise.name} technique`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    loading="lazy"
                  />
                </div>
                <div className="px-4 py-3 border-t border-v2-surface-800">
                  <a
                    href={exercise.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-v2-body text-v2-xs font-semibold text-v2-accent-300 hover:text-v2-accent-200 uppercase tracking-[0.18em] underline underline-offset-4 decoration-v2-accent-700 hover:decoration-v2-accent-500 transition-colors duration-v2-quick"
                  >
                    Open on YouTube →
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteConfirm !== null}
        title="Delete Exercise"
        message={`Are you sure you want to delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleDeleteExercise}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
