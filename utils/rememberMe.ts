import * as FileSystem from "expo-file-system/legacy";

type SavedCredentials = {
  email: string;
  password: string;
};

const FILE_URI = `${FileSystem.documentDirectory}lifeline-remember.json`;

export async function saveRememberedCredentials(
  email: string,
  password: string
) {
  await FileSystem.writeAsStringAsync(
    FILE_URI,
    JSON.stringify({ email, password }),
    { encoding: FileSystem.EncodingType.UTF8 }
  );
}

export async function loadRememberedCredentials(): Promise<SavedCredentials | null> {
  try {
    const info = await FileSystem.getInfoAsync(FILE_URI);
    if (!info.exists) return null;

    const content = await FileSystem.readAsStringAsync(FILE_URI, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    const parsed = JSON.parse(content);
    if (!parsed?.email || !parsed?.password) return null;

    return {
      email: String(parsed.email),
      password: String(parsed.password),
    };
  } catch {
    return null;
  }
}

export async function clearRememberedCredentials() {
  const info = await FileSystem.getInfoAsync(FILE_URI);
  if (info.exists) {
    await FileSystem.deleteAsync(FILE_URI, { idempotent: true });
  }
}
