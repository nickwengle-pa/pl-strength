import React from "react";

type Exercise = {
  name: string;
  url: string;
};

const EXERCISES: Exercise[] = [
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
  return (
    <div className="container py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Exercise Library</h1>
        <p className="mt-2 text-sm text-gray-600">
          Quick refreshers for key lifts. Watch the technique video before you coach or train the movement.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {EXERCISES.map((exercise) => {
          const embed = toEmbedUrl(exercise.url);
          return (
            <div key={exercise.name} className="card space-y-3">
              <div className="text-lg font-semibold">{exercise.name}</div>
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

