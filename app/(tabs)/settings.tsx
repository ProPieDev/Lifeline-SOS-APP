import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import * as ImagePicker from "expo-image-picker";
import { signOut } from "firebase/auth";
import { onValue, ref, update } from "firebase/database";
import { auth, db } from "../../firebase";

const defaultUser = require("../../assets/default-user.png");

export default function SettingsScreen() {
  const user = auth.currentUser;

  const [username, setUsername] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [condition, setCondition] = useState("");
  const [phone, setPhone] = useState("");
  const [photo, setPhoto] = useState("");
  const [localImage, setLocalImage] = useState("");
  const [ratingAvg, setRatingAvg] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;

    const userRef = ref(db, `users/${user.uid}`);
    const unsubscribe = onValue(userRef, (snap) => {
      const data = snap.val();
      if (!data) return;

      setUsername(data.username || "");
      setAge(data.age || "");
      setGender(data.gender || "");
      setCondition(data.condition || "");
      setPhone(data.phone || "");
      setPhoto(data.photo || "");
      setRatingAvg(Number(data.ratingAvg || 0));
      setRatingCount(Number(data.ratingCount || 0));
    });

    return () => unsubscribe();
  }, [user]);

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission required", "Please allow photo access.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.75,
    });

    if (!result.canceled) {
      setLocalImage(result.assets[0].uri);
    }
  }

  async function uploadImage() {
    if (!localImage) return photo;

    const data = new FormData();
    data.append("file", {
      uri: localImage,
      type: "image/jpeg",
      name: "profile.jpg",
    } as any);
    data.append("upload_preset", "profile_images");

    const res = await fetch(
      "https://api.cloudinary.com/v1_1/dtb7eengh/image/upload",
      { method: "POST", body: data }
    );

    if (!res.ok) throw new Error("Profile image upload failed");

    const result = await res.json();
    return result.secure_url;
  }

  async function save() {
    if (!user) return;
    if (!username.trim()) {
      Alert.alert("Name required", "Please add a username.");
      return;
    }

    setSaving(true);

    try {
      const imageUrl = await uploadImage();

      await update(ref(db, `users/${user.uid}`), {
        username: username.trim(),
        age: age.trim(),
        gender,
        condition,
        phone: phone.trim(),
        photo: imageUrl,
      });

      setPhoto(imageUrl);
      setLocalImage("");
      Alert.alert("Profile saved");
    } catch (e: any) {
      Alert.alert("Unable to save profile", e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Profile</Text>

      <TouchableOpacity onPress={pickImage} style={styles.avatarWrap}>
        <Image
          source={localImage ? { uri: localImage } : photo ? { uri: photo } : defaultUser}
          style={styles.avatar}
        />
        <Text style={styles.changePhoto}>Change photo</Text>
      </TouchableOpacity>

      <Text style={styles.rating}>
        Helper rating: {ratingCount ? `${ratingAvg.toFixed(1)} (${ratingCount})` : "New"}
      </Text>

      <TextInput
        placeholder="Username"
        placeholderTextColor="#94a3b8"
        style={styles.input}
        value={username}
        onChangeText={setUsername}
      />

      <TextInput
        placeholder="Age"
        placeholderTextColor="#94a3b8"
        keyboardType="number-pad"
        style={styles.input}
        value={age}
        onChangeText={setAge}
      />

      <TextInput
        placeholder="Phone number for emergency calls"
        placeholderTextColor="#94a3b8"
        keyboardType="phone-pad"
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
      />

      <View style={styles.pickerWrap}>
        <Picker selectedValue={gender} onValueChange={setGender} style={styles.picker}>
          <Picker.Item label="Select gender" value="" />
          <Picker.Item label="Male" value="Male" />
          <Picker.Item label="Female" value="Female" />
          <Picker.Item label="Other" value="Other" />
        </Picker>
      </View>

      <View style={styles.pickerWrap}>
        <Picker
          selectedValue={condition}
          onValueChange={setCondition}
          style={styles.picker}
        >
          <Picker.Item label="Medical condition" value="" />
          <Picker.Item label="Asthma" value="Asthma" />
          <Picker.Item label="Blood pressure" value="Blood pressure" />
          <Picker.Item label="Diabetes" value="Diabetes" />
          <Picker.Item label="Epilepsy" value="Epilepsy" />
          <Picker.Item label="Food allergy" value="Food allergy" />
          <Picker.Item label="Heart condition" value="Heart condition" />
          <Picker.Item label="Mobility impairment" value="Mobility impairment" />
          <Picker.Item label="Pregnancy" value="Pregnancy" />
          <Picker.Item label="Seizure risk" value="Seizure risk" />
          <Picker.Item label="Vision impairment" value="Vision impairment" />
          <Picker.Item label="Other" value="Other" />
          <Picker.Item label="None" value="None" />
        </Picker>
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={save} disabled={saving}>
        <Text style={styles.primaryText}>{saving ? "Saving..." : "Save profile"}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => signOut(auth)}>
        <Text style={styles.secondaryText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: "#f8fafc",
  },
  title: {
    marginTop: 32,
    marginBottom: 22,
    color: "#0f172a",
    fontSize: 26,
    fontWeight: "900",
  },
  avatarWrap: {
    alignItems: "center",
    marginBottom: 12,
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 4,
    borderColor: "#22c55e",
    backgroundColor: "#e2e8f0",
  },
  changePhoto: {
    marginTop: 8,
    color: "#2563eb",
    fontWeight: "800",
  },
  rating: {
    marginBottom: 18,
    textAlign: "center",
    color: "#475569",
    fontWeight: "700",
  },
  input: {
    height: 50,
    marginBottom: 12,
    borderRadius: 8,
    paddingHorizontal: 14,
    color: "#0f172a",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  pickerWrap: {
    height: 50,
    marginBottom: 12,
    borderRadius: 8,
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
  },
  picker: {
    color: "#0f172a",
  },
  primaryButton: {
    height: 52,
    marginTop: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ef4444",
  },
  primaryText: {
    color: "#ffffff",
    fontWeight: "900",
  },
  secondaryButton: {
    height: 50,
    marginTop: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  secondaryText: {
    color: "#0f172a",
    fontWeight: "800",
  },
});
