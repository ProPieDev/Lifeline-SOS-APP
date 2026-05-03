import { Redirect } from "expo-router";
import { auth } from "../firebase";

export default function IndexRoute() {
  return <Redirect href={auth.currentUser ? "/map" : "/login"} />;
}
