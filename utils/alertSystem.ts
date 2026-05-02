import { Audio } from "expo-av";

let sound: Audio.Sound | null = null;

export const playSOSAlert = async () => {
  try {
    if (sound) return;

    const { sound: s } = await Audio.Sound.createAsync(
      require("../assets/sos.mp3"),
      { shouldPlay: true, isLooping: true }
    );

    sound = s;
  } catch (e) {
    console.log("Sound error", e);
  }
};

export const stopSOSAlert = async () => {
  try {
    if (!sound) return;

    await sound.stopAsync();
    await sound.unloadAsync();
    sound = null;
  } catch (e) {
    console.log("Stop sound error", e);
  }
};