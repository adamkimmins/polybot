// components/ui/MiniWave.tsx
import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

type Props = {
  color?: string;
  barWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  gap?: number;
  speedMs?: number;
};



export default function MiniWave({
  color = "#dcf9ff",
  barWidth = 4,
  minHeight = 4,
  maxHeight = 22,
  gap = 3,
  speedMs = 680,
}: Props) {
  const phase = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(phase, { toValue: 1, duration: speedMs, useNativeDriver: false }),
        Animated.timing(phase, { toValue: 0, duration: speedMs, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, speedMs]);

  //3 bar
//   const h2 = phase.interpolate({ inputRange: [0, 1], outputRange: [minHeight + 6, maxHeight] });
//   const h1 = phase.interpolate({ inputRange: [0, 1], outputRange: [minHeight, Math.max(minHeight + 6, maxHeight * 0.65)] });
//   const h3 = phase.interpolate({ inputRange: [0, 1], outputRange: [minHeight + 2, Math.max(minHeight + 8, maxHeight * 0.75)] });
const h2 = phase.interpolate({ inputRange: [0, 1], outputRange: [minHeight + 6, maxHeight] });
const h4 = phase.interpolate({ inputRange: [0, 1], outputRange: [minHeight+2, Math.max(minHeight + 6, maxHeight * 0.85)] });
const h3 = phase.interpolate({ inputRange: [0, 1], outputRange: [minHeight, Math.max(minHeight + 8, maxHeight * 0.75)] });
const h1 = phase.interpolate({ inputRange: [0, 1], outputRange: [minHeight+2, Math.max(minHeight + 6, maxHeight * 0.65)] });
const h5 = phase.interpolate({ inputRange: [0, 1], outputRange: [minHeight, Math.max(minHeight + 8, maxHeight * 0.55)] });

  const bar = (h: any) => ({
    width: barWidth,
    height: h,
    borderRadius: barWidth / 2,
    backgroundColor: color,
    marginHorizontal: gap / 2,
  });

  return (
    // ✅ fixed height + bottom pinned
    <View style={{ height: maxHeight, justifyContent: "flex-end", }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
        <Animated.View style={bar(h1)} />
        <Animated.View style={bar(h2)} />
        <Animated.View style={bar(h3)} />
        <Animated.View style={bar(h4)} />
        <Animated.View style={bar(h5)} />
      </View>
    </View>
  );
}
