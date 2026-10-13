import treeArtwork from "@/assets/skill-tree-mark.png";

interface SkillTreeMarkProps {
  className?: string;
}

export function SkillTreeMark({ className = "h-8 w-8" }: SkillTreeMarkProps) {
  return (
    <img
      src={treeArtwork}
      alt=""
      aria-hidden="true"
      className={className}
    />
  );
}