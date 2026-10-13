import { createFileRoute } from "@tanstack/react-router";
import SkillTreeApp from "@/SkillTreeApp";

export const Route = createFileRoute("/$")({
  head: () => ({
    meta: [
      { title: "SkillTree — your learning tracks" },
      {
        name: "description",
        content:
          "Browse your skill tracks, playlists and favorites, and keep track of what you have watched.",
      },
      { property: "og:title", content: "SkillTree — your learning tracks" },
      {
        property: "og:description",
        content: "Browse your skill tracks, playlists and favorites in SkillTree.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SkillTreeApp,
});
