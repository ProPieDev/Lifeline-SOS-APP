import { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, Switch
} from "react-native";

import { useRouter } from "expo-router";
import { auth } from "../firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "firebase/auth";
import {
  loadRememberedCredentials,
  saveRememberedCredentials
} from "../utils/rememberMe";

export default function LoginScreen() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loadingSaved, setLoadingSaved] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function restoreLogin() {
      const saved = await loadRememberedCredentials();
      if (!mounted) return;

      if (!saved) {
        setLoadingSaved(false);
        return;
      }

      setEmail(saved.email);
      setPassword(saved.password);

      try {
        await signInWithEmailAndPassword(auth, saved.email, saved.password);
        router.replace("/map");
      } catch {
        setLoadingSaved(false);
      }
    }

    restoreLogin();

    return () => {
      mounted = false;
    };
  }, [router]);

  const login = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      if (remember) {
        await saveRememberedCredentials(email, password);
      }
      router.replace("/map");
    } catch (e:any) {
      Alert.alert(e.message);
    }
  };

  const signup = async () => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      if (remember) {
        await saveRememberedCredentials(email, password);
      }
      router.replace("/settings");
    } catch (e:any) {
      Alert.alert(e.message);
    }
  };

  if (loadingSaved) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Lifeline SOS</Text>
        <Text style={styles.loadingText}>Checking saved login...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lifeline SOS 🚨</Text>

      <TextInput placeholder="Email" style={styles.input} onChangeText={setEmail}/>
      <TextInput placeholder="Password" secureTextEntry style={styles.input} onChangeText={setPassword}/>

      <View style={styles.row}>
        <Text style={{ color: "white" }}>Remember Me</Text>
        <Switch value={remember} onValueChange={setRemember} />
      </View>

      <TouchableOpacity style={styles.btn} onPress={login}>
        <Text style={styles.btnText}>Login</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.btnOutline} onPress={signup}>
        <Text style={styles.btnOutlineText}>Signup</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:{flex:1,justifyContent:"center",padding:20,backgroundColor:"#0f172a"},
  title:{color:"white",fontSize:26,textAlign:"center",marginBottom:20},
  input:{backgroundColor:"#1e293b",color:"white",padding:12,marginBottom:10,borderRadius:10},
  row:{flexDirection:"row",justifyContent:"space-between",marginVertical:10},
  btn:{backgroundColor:"#ef4444",padding:14,borderRadius:10},
  btnText:{color:"white",textAlign:"center"},
  btnOutline:{borderWidth:1,borderColor:"#ef4444",padding:14,borderRadius:10,marginTop:10},
  btnOutlineText:{color:"#ef4444",textAlign:"center"},
  loadingText:{color:"#cbd5e1",textAlign:"center"}
});
