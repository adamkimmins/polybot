import { Image } from 'expo-image';
import { Platform, StyleSheet } from 'react-native';

import { Collapsible } from '@/components/ui/collapsible';
import { ExternalLink } from '@/components/external-link';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Fonts } from '@/constants/theme';

export default function TabTwoScreen() {
  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="chevron.left.forwardslash.chevron.right"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText
          type="title"
          style={{
            fontFamily: Fonts.rounded,
          }}>

{/* Completely useless for now, We will just store concept art here until Phase 2. */}

        <Image
          source={require('@/assets/images/MediumPolybotLogo.png')}
          style={{ width: 500, height: 500, alignSelf: 'center' }}
        />
        <Image
          source={require('@/assets/images/LargePolybotLogo.png')}
          style={{ width: 500, height: 500, alignSelf: 'center' }}
        />
        <Image
          source={require('@/assets/images/SmallPolybotLogoLIGHT.png')}
          style={{ width: 500, height: 500, alignSelf: 'center' }}
        />
        <Image
          source={require('@/assets/images/LargePolybotLogo2.png')}
          style={{ width: 500, height: 500, alignSelf: 'center' }}
        />
        <Image
          source={require('@/assets/images/IconPolybotLogo.png')}
          style={{ width: 500, height: 500, alignSelf: 'center' }}
        />
        </ThemedText>
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
});
