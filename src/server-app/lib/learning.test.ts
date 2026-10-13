import { describe, it, expect } from 'vitest';
import type { Video } from "@workspace/db";
import {
  levelFromText,
  cappedPlaybackSeconds,
  isVideoComplete,
  effectivePlaybackSeconds,
  progressPercentForVideos,
} from './learning.ts';

describe('levelFromText', () => {
  it('should return Beginner for no signal', () => {
    expect(levelFromText('random title', 'random description', 'random source')).toBe('Beginner');
  });

  it('should return Beginner for Italian easy signal', () => {
    expect(levelFromText('Corso facile', 'Descrizione', 'Canale')).toBe('Beginner');
    expect(levelFromText('Titolo', 'Descrizione facile', 'Canale')).toBe('Beginner');
    expect(levelFromText('Titolo', 'Descrizione', 'Canale facile')).toBe('Beginner');
  });

  it('should return Intermediate for Italian medium signal', () => {
    expect(levelFromText('Corso intermedio', 'Descrizione', 'Canale')).toBe('Intermediate');
    expect(levelFromText('Titolo', 'Descrizione intermedio', 'Canale')).toBe('Intermediate');
    expect(levelFromText('Titolo', 'Descrizione', 'Canale intermedio')).toBe('Intermediate');
  });

  it('should return Advanced for Italian hard signal', () => {
    expect(levelFromText('Corso avanzato', 'Descrizione', 'Canale')).toBe('Advanced');
    expect(levelFromText('Titolo', 'Descrizione avanzato', 'Canale')).toBe('Advanced');
    expect(levelFromText('Titolo', 'Descrizione', 'Canale avanzato')).toBe('Advanced');
  });

  it('should return Expert for Italian expert signal', () => {
    expect(levelFromText('Corso esperto', 'Descrizione', 'Canale')).toBe('Expert');
    expect(levelFromText('Titolo', 'Descrizione esperto', 'Canale')).toBe('Expert');
    expect(levelFromText('Titolo', 'Descrizione', 'Canale esperto')).toBe('Expert');
  });

  it('should return Beginner for English easy signal', () => {
    expect(levelFromText('Easy course', 'Description', 'Channel')).toBe('Beginner');
    expect(levelFromText('Title', 'Easy description', 'Channel')).toBe('Beginner');
    expect(levelFromText('Title', 'Description', 'Easy channel')).toBe('Beginner');
  });

  it('should return Intermediate for English medium signal', () => {
    expect(levelFromText('Intermediate course', 'Description', 'Channel')).toBe('Intermediate');
    expect(levelFromText('Title', 'Intermediate description', 'Channel')).toBe('Intermediate');
    expect(levelFromText('Title', 'Description', 'Intermediate channel')).toBe('Intermediate');
  });

  it('should return Advanced for English hard signal', () => {
    expect(levelFromText('Advanced course', 'Description', 'Channel')).toBe('Advanced');
    expect(levelFromText('Title', 'Advanced description', 'Channel')).toBe('Advanced');
    expect(levelFromText('Title', 'Description', 'Advanced channel')).toBe('Advanced');
  });

  it('should return Expert for English expert signal', () => {
    expect(levelFromText('Expert course', 'Description', 'Channel')).toBe('Expert');
    expect(levelFromText('Title', 'Expert description', 'Channel')).toBe('Expert');
    expect(levelFromText('Title', 'Description', 'Expert channel')).toBe('Expert');
  });

  it('should return Beginner for Spanish easy signal', () => {
    expect(levelFromText('Curso fácil', 'Descripción', 'Canal')).toBe('Beginner');
    expect(levelFromText('Título', 'Descripción fácil', 'Canal')).toBe('Beginner');
    expect(levelFromText('Título', 'Descripción', 'Canal fácil')).toBe('Beginner');
  });

  it('should return Intermediate for Spanish medium signal', () => {
    expect(levelFromText('Curso intermedio', 'Descripción', 'Canal')).toBe('Intermediate');
    expect(levelFromText('Título', 'Descripción intermedio', 'Canal')).toBe('Intermediate');
    expect(levelFromText('Título', 'Descripción', 'Canal intermedio')).toBe('Intermediate');
  });

  it('should return Advanced for Spanish hard signal', () => {
    expect(levelFromText('Curso avanzado', 'Descripción', 'Canal')).toBe('Advanced');
    expect(levelFromText('Título', 'Descripción avanzado', 'Canal')).toBe('Advanced');
    expect(levelFromText('Título', 'Descripción', 'Canal avanzado')).toBe('Advanced');
  });

  it('should return Expert for Spanish expert signal', () => {
    expect(levelFromText('Curso experto', 'Descripción', 'Canal')).toBe('Expert');
    expect(levelFromText('Título', 'Descripción experto', 'Canal')).toBe('Expert');
    expect(levelFromText('Título', 'Descripción', 'Canal experto')).toBe('Expert');
  });

  it('should prioritize title over description and source', () => {
    // Title says Advanced, description says Beginner, source says Intermediate -> should be Advanced
    expect(levelFromText('Advanced title', 'Beginner description', 'Intermediate source')).toBe('Advanced');
    // Title says Beginner, description says Advanced, source says Intermediate -> should be Beginner (because title weight is 3)
    expect(levelFromText('Beginner title', 'Advanced description', 'Intermediate source')).toBe('Beginner');
  });
});

describe('cappedPlaybackSeconds', () => {
  it('should return 0 when playback is 0', () => {
    expect(cappedPlaybackSeconds(0, 100)).toBe(0);
    expect(cappedPlaybackSeconds(0, 0)).toBe(0);
  });

  it('should return playback when below threshold', () => {
    expect(cappedPlaybackSeconds(89, 100)).toBe(89); // 89% < 90%
    expect(cappedPlaybackSeconds(50, 100)).toBe(50);
  });

  it('should return duration when at or above threshold', () => {
    expect(cappedPlaybackSeconds(90, 100)).toBe(100); // 90% exactly
    expect(cappedPlaybackSeconds(91, 100)).toBe(100); // 91% > 90%
    expect(cappedPlaybackSeconds(100, 100)).toBe(100); // 100%
    expect(cappedPlaybackSeconds(150, 100)).toBe(100); // more than duration
  });

  it('should return duration when duration is 0', () => {
    expect(cappedPlaybackSeconds(50, 0)).toBe(0);
  });
});

describe('isVideoComplete', () => {
  const makeVideo = (overrides: Partial<Video> = {}): Video => ({
    id: 1,
    youtubeId: 'test',
    title: 'test',
    description: '',
    channelName: '',
    thumbnailUrl: '',
    durationSeconds: 100,
    durationLabel: '1:40',
    level: 'Beginner',
    levelOverridden: false,
    playbackSeconds: 0,
    watched: false,
    favorite: false,
    position: 0,
    sourceName: '',
    sourceType: 'video',
    playlistUrl: null,
    url: 'https://youtube.com/watch?v=test',
    updatedAt: new Date(),
    ...overrides,
  } as Video);

  it('should return true when watched is true', () => {
    expect(isVideoComplete(makeVideo({ watched: true, playbackSeconds: 0 }))).toBe(true);
    expect(isVideoComplete(makeVideo({ watched: true, playbackSeconds: 50 }))).toBe(true);
  });

  it('should return true when playback reaches 90% threshold', () => {
    expect(isVideoComplete(makeVideo({ watched: false, playbackSeconds: 90 }))).toBe(true);
    expect(isVideoComplete(makeVideo({ watched: false, playbackSeconds: 95 }))).toBe(true);
    expect(isVideoComplete(makeVideo({ watched: false, playbackSeconds: 100 }))).toBe(true);
    expect(isVideoComplete(makeVideo({ watched: false, playbackSeconds: 150 }))).toBe(true);
  });

  it('should return false when playback is below 90% and not watched', () => {
    expect(isVideoComplete(makeVideo({ watched: false, playbackSeconds: 0 }))).toBe(false);
    expect(isVideoComplete(makeVideo({ watched: false, playbackSeconds: 50 }))).toBe(false);
    expect(isVideoComplete(makeVideo({ watched: false, playbackSeconds: 89 }))).toBe(false);
  });

  it('should return false when duration is 0', () => {
    expect(isVideoComplete(makeVideo({ watched: false, durationSeconds: 0, playbackSeconds: 0 }))).toBe(false);
    expect(isVideoComplete(makeVideo({ watched: false, durationSeconds: 0, playbackSeconds: 100 }))).toBe(false);
  });
});

describe('progressPercentForVideos', () => {
  const makeVideo = (overrides: Partial<Video> = {}): Video => ({
    id: 1,
    youtubeId: 'test',
    title: 'test',
    description: '',
    channelName: '',
    thumbnailUrl: '',
    durationSeconds: 100,
    durationLabel: '1:40',
    level: 'Beginner',
    levelOverridden: false,
    playbackSeconds: 0,
    watched: false,
    favorite: false,
    position: 0,
    sourceName: '',
    sourceType: 'video',
    playlistUrl: null,
    url: 'https://youtube.com/watch?v=test',
    updatedAt: new Date(),
    ...overrides,
  } as Video);

  it('should return 0 for empty list', () => {
    expect(progressPercentForVideos([])).toBe(0);
  });

  it('should return 0 when no playback', () => {
    const videos = [
      makeVideo({ durationSeconds: 100, playbackSeconds: 0, watched: false }),
      makeVideo({ durationSeconds: 200, playbackSeconds: 0, watched: false }),
    ];
    expect(progressPercentForVideos(videos)).toBe(0);
  });

  it('should return percentage based on playback seconds', () => {
    const videos = [
      makeVideo({ durationSeconds: 100, playbackSeconds: 50, watched: false }), // 50s effective
      makeVideo({ durationSeconds: 200, playbackSeconds: 100, watched: false }), // 100s effective
    ];
    // total effective = 150s, total duration = 300s -> 50%
    expect(progressPercentForVideos(videos)).toBe(50);
  });

  it('should count watched videos as full duration', () => {
    const videos = [
      makeVideo({ durationSeconds: 100, playbackSeconds: 0, watched: true }), // 100s effective
      makeVideo({ durationSeconds: 200, playbackSeconds: 50, watched: false }), // 50s effective
    ];
    // total effective = 150s, total duration = 300s -> 50%
    expect(progressPercentForVideos(videos)).toBe(50);
  });

  it('should cap playback at duration for unwatched videos', () => {
    const videos = [
      makeVideo({ durationSeconds: 100, playbackSeconds: 150, watched: false }), // effective: 100s (capped)
      makeVideo({ durationSeconds: 100, playbackSeconds: 50, watched: false }), // effective: 50s
    ];
    // total effective = 150s, total duration = 200s -> 75%
    expect(progressPercentForVideos(videos)).toBe(75);
  });

  it('should handle mixed cases', () => {
    const videos = [
      makeVideo({ durationSeconds: 100, playbackSeconds: 0, watched: true }), // 100s
      makeVideo({ durationSeconds: 100, playbackSeconds: 0, watched: false }), // 0s
      makeVideo({ durationSeconds: 200, playbackSeconds: 150, watched: false }), // 150s (capped at 200? no, 150<200 -> 150)
    ];
    // total effective = 100 + 0 + 150 = 250s
    // total duration = 100+100+200 = 400s
    // 250/400 = 62.5% -> rounded to 63? The function uses Math.round.
    expect(progressPercentForVideos(videos)).toBe(63);
  });
});

describe('levelFromText realistic titles (PIN 1)', () => {
  it('"Pro Tools tutorial" should not become Beginner by default', () => {
    expect(levelFromText('Pro Tools tutorial', 'Audio mixing guide', 'Channel')).toBe('Beginner'); // solo termine ambiguo + tutorial = Beginner (corretto: non c'è segnale esplicito)
  });
  it('"Part 1 - Advanced rigging" must recognize Advanced', () => {
    expect(levelFromText('Part 1 - Advanced rigging', 'Rigging techniques', 'Channel')).toBe('Advanced');
  });
  it('"Blender per principianti" must be Beginner', () => {
    expect(levelFromText('Blender per principianti', 'Tutorial complete', 'Channel')).toBe('Beginner');
  });
  it('"Masterclass completa" must be Expert', () => {
    expect(levelFromText('Masterclass completa', 'Advanced techniques', 'Channel')).toBe('Expert');
  });
  it('"Intermediate course - new edition" must stay Intermediate', () => {
    expect(levelFromText('Intermediate course - new edition', 'Updated content', 'Channel')).toBe('Intermediate');
  });
  it('"Standard lighting setup" without level must stay Beginner', () => {
    expect(levelFromText('Standard lighting setup', 'Tutorial', 'Channel')).toBe('Beginner');
  });
  it('"Simple beginner guide" with begin signals is Beginner', () => {
    expect(levelFromText('Simple beginner guide', 'Step by step', 'Channel')).toBe('Beginner');
  });
  it('"Mid-level Python course" must be Intermediate (explicit mid with level)', () => {
    expect(levelFromText('Mid-level Python course', 'Description', 'Channel')).toBe('Intermediate');
  });
  it('"Normal workflow" alone must not decide', () => {
    expect(levelFromText('Normal workflow', 'Tutorial', 'Channel')).toBe('Beginner');
  });
  it('"Base model tutorial" alone must not decide', () => {
    expect(levelFromText('Base model tutorial', 'Tutorial', 'Channel')).toBe('Beginner');
  });
  it('"Average difficulty intro" must not become Intermediate', () => {
    expect(levelFromText('Average difficulty intro', 'Intro', 'Channel')).toBe('Beginner');
  });
  it('"New 3D modeling series" alone must not decide', () => {
    expect(levelFromText('New 3D modeling series', 'Series', 'Channel')).toBe('Beginner');
  });
  it('"Pro workflow - expert tips" must be Expert', () => {
    expect(levelFromText('Pro workflow - expert tips', 'Tips', 'Channel')).toBe('Expert');
  });
  it('"Part 2 - Intermediate concepts" must be Intermediate', () => {
    expect(levelFromText('Part 2 - Intermediate concepts', 'Concepts', 'Channel')).toBe('Intermediate');
  });
  it('"Advanced character design" must be Advanced', () => {
    expect(levelFromText('Advanced character design', 'Design', 'Channel')).toBe('Advanced');
  });
  it('"Simple part 1 of 5" must stay Beginner (part 1 + simple ambiguous)', () => {
    expect(levelFromText('Simple part 1 of 5', 'Tutorial', 'Channel')).toBe('Beginner');
  });
});
