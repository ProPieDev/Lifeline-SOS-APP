import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications() {
  try {
    if (!Device.isDevice) {
      await Notifications.requestPermissionsAsync();
      return;
    }

    const existing = await Notifications.getPermissionsAsync();
    const finalStatus =
      existing.status === "granted"
        ? existing.status
        : (await Notifications.requestPermissionsAsync()).status;

    if (finalStatus !== "granted") return;

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    return token;
  } catch (error) {
    console.log("Notification registration skipped", error);
  }
}

export async function sendLocalNotification(title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: null
    });
  } catch (error) {
    console.log("Local notification skipped", error);
  }
}
