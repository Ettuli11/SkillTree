import { describe, it, expect } from "vitest";
import { isRelevantLearningContent } from "./relevance";

describe("isRelevantLearningContent", () => {
  it("titoli senza la parola della skill dentro una playlist pertinente restano", () => {
    const candidate = { title: "Corso Completo Blender 3D" };
    const video = {
      title: "Capitolo 1: Interfaccia e primi passi",
      description: "Primi passi con la modellazione 3D",
      channelName: "Docente3D",
    };
    // Valutazione con il contesto della playlist come in findUsablePlaylist
    const result = isRelevantLearningContent(
      {
        title: video.title + " " + candidate.title,
        description: video.description,
        channelName: video.channelName,
      },
      "Blender",
    );
    expect(result).toBe(true);
  });

  it("titoli completamente fuori tema (es. 'Minecraft survival #12' per skill 'Blender') vengono scartati", () => {
    const video = {
      title: "Minecraft survival #12",
      description: "Gameplay survival episodio 12",
      channelName: "GamerChannel",
    };
    const result = isRelevantLearningContent(video, "Blender");
    expect(result).toBe(false);
  });

  it("keeps a video with the skill word in the title", () => {
    const result = isRelevantLearningContent(
      {
        title: "Blender beginner tutorial",
        description: "Learn Blender from scratch",
        channelName: "BlenderGuru",
      },
      "Blender",
    );
    expect(result).toBe(true);
  });

  it("discards a video whose playlist title is also off-topic", () => {
    const result = isRelevantLearningContent(
      {
        title: "Redstone mechanics explained Minecraft",
        description: "Minecraft redstone",
        channelName: "MinecraftChannel",
      },
      "Blender",
    );
    expect(result).toBe(false);
  });
});
