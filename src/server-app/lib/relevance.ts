// Pure relevance logic for SkillTree learning content. No DB imports.

export function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["the", "and", "for", "with", "from", "learn", "learning"].includes(word));
}

export function isRelevantLearningContent(
  candidate: { title: string; description: string; channelName: string },
  skill: string,
  goal?: string,
) {
  const skillWords = tokenize(skill);
  if (!skillWords.length) return true;

  const text = `${candidate.title} ${candidate.description} ${candidate.channelName}`.toLowerCase();
  const textWords = new Set(tokenize(text));
  const normalizedText = [...textWords].join(" ");
  const normalizedSkill = skillWords.join(" ");
  const genericTerms = new Set([
    "studio",
    "software",
    "computer",
    "computers",
    "technology",
    "tech",
    "tutorial",
    "course",
    "courses",
    "training",
    "complete",
    "full",
    "practical",
    "project",
    "projects",
    "learn",
    "learning",
    "create",
    "creating",
    "make",
    "making",
    "build",
    "building",
    "game",
    "games",
    "tutorials",
  ]);
  const anchorWords = skillWords.filter((word) => !genericTerms.has(word));
  const phraseMatches = skillWords.every((word) => textWords.has(word));
  const matchedAnchors = anchorWords.filter((word) => textWords.has(word));
  if (!phraseMatches && anchorWords.length > 0 && matchedAnchors.length < Math.min(2, anchorWords.length)) {
    return false;
  }
  if (!phraseMatches && anchorWords.length === 0 && !skillWords.some((word) => normalizedText.includes(word))) {
    return false;
  }

  const goalWords = tokenize(goal ?? "");
  if (!goalWords.length) return true;
  const goalAnchors = goalWords.filter((word) => !genericTerms.has(word));
  if (!goalAnchors.length) return true;
  const matchedGoalWords = goalAnchors.filter((word) => textWords.has(word));
  return matchedGoalWords.length > 0;
}
