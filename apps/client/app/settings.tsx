import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSettings } from "@/components/settings";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";

export default function SettingsScreen() {
  const { settings, setSettings } = useSettings();
  const { learnLang, voiceId } = settings;
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
      <Pressable
          onPress={() => router.back()}
          style={styles.closeBtn}
          accessibilityLabel="Close settings"
        >
          <MaterialIcons name="west" size={30} color="#001d34" />
        </Pressable>

      <Text style={styles.title}>Settings</Text>
      </View>

      <Text style={styles.label}>Learning language</Text>
      <View style={styles.segment}>
        <Pressable
          onPress={() => setSettings({ ...settings, learnLang: "en" })}
          style={[styles.btn, styles.left, learnLang === "en" && styles.active]}
        >
          <Text style={[styles.text, learnLang === "en" && styles.textActive]}>English</Text>
        </Pressable>

        <Pressable
          onPress={() => setSettings({ ...settings, learnLang: "it" })}
          style={[styles.btn, styles.right, learnLang === "it" && styles.active]}
        >
          <Text style={[styles.text, learnLang === "it" && styles.textActive]}>Italiano</Text>
        </Pressable>
      </View>

      <Text style={[styles.label, { marginTop: 18 }]}>Voice</Text>
      <View style={styles.segment}>
        <Pressable
          onPress={() => setSettings({ ...settings, voiceId: "adam" })}
          style={[styles.btn, styles.left, voiceId === "adam" && styles.active]}
        >
          <Text style={[styles.text, voiceId === "adam" && styles.textActive]}>Adam</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 80, paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 0, marginLeft: 15 },
  label: { fontSize: 12, fontWeight: "700", marginBottom: 8 },
    topRow: {
    flexDirection: "row",
    textAlignVertical: "center",
    alignItems: "center",
    marginBottom: 16,

  },
  closeBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 0,
    // backgroundColor: "#dcf9ff",
    borderColor: "#001d34",
    alignItems: "center",
    justifyContent: "center"
  },

  segment: { flexDirection: "row", borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  btn: { flex: 1, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  left: { borderRightWidth: 1 },
  right: {},
  active: { backgroundColor: "#001d34" },
  text: { fontSize: 12, fontWeight: "700", color: "#001d34" },
  textActive: { color: "#dcf9ff" }
});
