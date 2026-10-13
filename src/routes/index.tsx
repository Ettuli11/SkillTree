import { createFileRoute } from "@tanstack/react-router";
import SkillTreeApp from "@/SkillTreeApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SkillTree — YouTube learning tracker" },
      {
        name: "description",
        content:
          "Turn YouTube videos, playlists and channels into structured skill tracks, track your watch progress and get AI learning coaching.",
      },
      { property: "og:title", content: "SkillTree — YouTube learning tracker" },
      {
        property: "og:description",
        content:
          "Build structured skill tracks from YouTube content and track your learning progress.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SkillTreeApp,
});
