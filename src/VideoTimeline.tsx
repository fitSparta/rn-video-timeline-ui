import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

export interface DraggableBoxProps {
  size?: number;
  color?: string;
  children?: ReactNode;
}

export function DraggableBox({ size = 100, color = 'blue', children }: DraggableBoxProps) {
  const offset = useSharedValue(0);

  const animatedStyles = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      offset.value = event.translationX;
    })
    .onEnd(() => {
      offset.value = withSpring(0);
    });

  const backgroundColor = children ? 'transparent' : color;

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[
          styles.box,
          { width: size, height: size, backgroundColor },
          animatedStyles,
        ]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

export function VideoTimeline() {
  return (
    <DraggableBox />
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 10,
    overflow: 'hidden',
  },
});
