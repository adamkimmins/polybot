import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

type Props = {
  color?: string;
  size?: number;      // dot size in px
  bounce?: number;    // how high to bounce
  speedMs?: number;   // animation speed
};

export default function BouncingDots({
  color = "#dcf9ff",
  size = 6,
  bounce = 4,
  speedMs = 220,
}: Props) {
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: speedMs, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: speedMs, useNativeDriver: true }),
          Animated.delay(speedMs),
        ])
      );

    const l1 = make(a1, 0);
    const l2 = make(a2, Math.floor(speedMs * 0.4));
    const l3 = make(a3, Math.floor(speedMs * 0.8));

    l1.start(); l2.start(); l3.start();
    return () => { l1.stop(); l2.stop(); l3.stop(); };
  }, [a1, a2, a3, speedMs]);

  const dotStyle = (v: Animated.Value) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
    marginHorizontal: Math.max(2, Math.floor(size * 0.35)),
    transform: [
      {
        translateY: v.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -bounce],
        }),
      },
    ],
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
  });

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Animated.View style={dotStyle(a1)} />
      <Animated.View style={dotStyle(a2)} />
      <Animated.View style={dotStyle(a3)} />
    </View>
  );
}
