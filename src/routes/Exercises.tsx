import React, { useEffect, useState } from "react";
import { ensureAnon, isAdmin, subscribeToRoleChanges } from "../lib/db";

type Exercise = {
  name: string;
  url: string;
};

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

const EXERCISES_STORAGE_KEY = "pl-strength.exercises";

function loadStoredExercises(): Exercise[] {
  if (typeof window === "undefined") {
    return [...DEFAULT_EXERCISES];
  }
  try {
    const raw = window.localStorage.getItem(EXERCISES_STORAGE_KEY);
    if (!raw) {
      return [...DEFAULT_EXERCISES];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_EXERCISES];
    }
    return parsed.map((item: any) => ({
      name: typeof item?.name === "string" ? item.name : "",
      url: typeof item?.url === "string" ? item.url : "",
    })).filter((ex: Exercise) => ex.name && ex.url);
  } catch (err) {
    console.warn("Failed to load exercises", err);
    return [...DEFAULT_EXERCISES];
  }
}

function saveExercises(exercises: Exercise[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXERCISES_STORAGE_KEY, JSON.stringify(exercises));
  } catch (err) {
    console.warn("Failed to save exercises", err);
  }
}

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
  const [exercises, setExercises] = useState<Exercise[]>(() => loadStoredExercises());
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await ensureAnon();
        const adminFlag = await isAdmin();
        if (!active) return;
        setAdmin(adminFlag);
      } catch (err) {
        if (!active) return;
        console.warn("Failed to load admin status", err);
        setAdmin(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRoleChanges((roles) => {
      setAdmin(roles.includes("admin"));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    saveExercises(exercises);
  }, [exercises]);

  const handleAddExercise = () => {
    const trimmedName = newName.trim();
    const trimmedUrl = newUrl.trim();
    
    if (!trimmedName) {
      alert("Please enter an exercise name");
      return;
    }
    
    if (!trimmedUrl) {
      alert("Please enter a YouTube URL");
      return;
    }
    
    // Check if URL is a valid YouTube URL
    if (!trimmedUrl.includes("youtube.com") && !trimmedUrl.includes("youtu.be")) {
      alert("Please enter a valid YouTube URL");
      return;
    }
    
    // Check for duplicate names
    if (exercises.some(ex => ex.name.toLowerCase() === trimmedName.toLowerCase())) {
      alert("An exercise with this name already exists");
      return;
    }
    
    setExercises(prev => [...prev, { name: trimmedName, url: trimmedUrl }]);
    setNewName("");
    setNewUrl("");
  };

  const handleDeleteExercise = (index: number) => {
    if (confirm(`Delete "${exercises[index].name}"?`)) {
      setExercises(prev => prev.filter((_, i) => i !== index));
    }
  };

  if (loading) {
    return (
      <div className="container py-6">
        <div className="card text-sm text-gray-600">Loading exercises...</div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Exercise Library</h1>
          <p className="mt-2 text-sm text-gray-600">
            Quick refreshers for key lifts. Watch the technique video before you coach or train the movement.
          </p>
        </div>

        {admin && (
          <button
            type="button"
            className={`btn btn-sm ${editMode ? "btn-secondary" : ""}`}
            onClick={() => setEditMode((prev) => !prev)}
          >
            {editMode ? "Done editing" : "Edit exercises"}
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
                Supports full URLs, shorts, and youtu.be links
              </p>
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
                  <button
                    type="button"
                    className="text-red-600 hover:text-red-700 text-xs font-medium"
                    onClick={() => handleDeleteExercise(index)}
                  >
                    Delete
                  </button>
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
                Open on YouTube
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

