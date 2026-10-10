const FILES = {
  correct: "/sounds/correct.mp3",
  incorrect: "/sounds/incorrect.trimmed.mp3",
  buzz: "/sounds/buzz-in.mp3",
  intro: "/sounds/introduction.mp3",
} as const;

export type Sound = keyof typeof FILES;

const MUTE_KEY = "ff-muted";

const readMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};

let muted = readMuted();
let basePath = "";
const playing = new Set<HTMLAudioElement>();

export const setSoundBasePath = (path: string) => {
  basePath = path;
};

export const isMuted = () => muted;

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Storage can be unavailable inside an embedded frame; the toggle still works for this session.
  }
  if (value) for (const audio of playing) audio.pause();
}

export function playSound(sound: Sound, volume = 0.6) {
  if (muted) return;
  const audio = new Audio(basePath + FILES[sound]);
  audio.volume = volume;
  playing.add(audio);
  audio.addEventListener("ended", () => playing.delete(audio));
  // Browsers block audio until the player has interacted with the page.
  audio.play().catch(() => playing.delete(audio));
}
