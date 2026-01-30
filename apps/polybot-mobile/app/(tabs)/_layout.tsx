import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const isApplePlatform =
  Platform.OS === 'ios' || Platform.OS === 'macos';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Talk',
          tabBarIcon: ({ color }) =>
            isApplePlatform ? (
              <IconSymbol
                size={28}
                name="bubble.left.and.bubble.right"
                color={color}
              />
            ) : (
              <MaterialIcons
                name="chat-bubble-outline"
                size={26}
                color={color}
              />
            ),
        }}
      />

      <Tabs.Screen
        name="learn"
        options={{
          title: 'Learn',
          tabBarIcon: ({ color }) =>
            isApplePlatform ? (
              <IconSymbol
                size={28}
                name="book.closed"
                color={color}
              />
            ) : (
              <MaterialIcons
                name="menu-book"
                size={26}
                color={color}
              />
            ),
        }}
      />
    </Tabs>
  );
}
