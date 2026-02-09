import React from "react";
import { Animated, Pressable, StyleSheet, ViewStyle, Platform } from "react-native";

type Props = {
  enabled: boolean;
  opacity: any; // Animated interpolation
  scale: any;   // Animated interpolation
  expanded: boolean;
  onPress: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
};

export default function CenterMic({
  enabled,
  opacity,
  scale,
  expanded,
  onPress,
  children,
  style,
}: Props) {
  return (
    <Animated.View
      pointerEvents={enabled ? "auto" : "none"}
      style={[
        styles.wrap,
        { opacity, transform: [{ scale }] },
        style,
      ]}
    >
      <Pressable
        style={[styles.button, expanded && styles.buttonWide]}
        onPress={onPress}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: Platform.OS === "web" ? "70%" : "87%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 56,
    marginHorizontal: Platform.OS ==="web" ? "30%" : undefined,
  },
  button: {
    width: Platform.OS === "web" ? 100 : 80,
    height: Platform.OS === "web" ? 100 : 80,
    borderRadius: Platform.OS === "web" ? 70 : 60,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonWide: {
    width: 170,
    borderRadius: 40,
    paddingHorizontal: 14,
  },
});
