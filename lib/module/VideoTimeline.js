"use strict";

import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { jsx as _jsx } from "react/jsx-runtime";
const _worklet_2846763510714_init_data = {
  code: "function VideoTimelineTsx1(){const{offset}=this.__closure;return{transform:[{translateX:offset.value}]};}",
  location: "C:\\tmp\\vtui\\src\\VideoTimeline.tsx",
  sourceMap: "{\"version\":3,\"names\":[\"VideoTimelineTsx1\",\"offset\",\"__closure\",\"transform\",\"translateX\",\"value\"],\"sources\":[\"C:/tmp/vtui/src/VideoTimeline.tsx\"],\"mappings\":\"AAc0C,SAAAA,kBAAA,QAAAC,MAAA,OAAAC,SAAA,OAAO,CAC7CC,SAAS,CAAE,CAAC,CAAEC,UAAU,CAAEH,MAAM,CAACI,KAAM,CAAC,CAC1C,CAAC\",\"ignoreList\":[]}"
};
const _worklet_4175568407495_init_data = {
  code: "function VideoTimelineTsx2(){const{offset,withSpring}=this.__closure;offset.value=withSpring(0);}",
  location: "C:\\tmp\\vtui\\src\\VideoTimeline.tsx",
  sourceMap: "{\"version\":3,\"names\":[\"VideoTimelineTsx2\",\"offset\",\"withSpring\",\"__closure\",\"value\"],\"sources\":[\"C:/tmp/vtui/src/VideoTimeline.tsx\"],\"mappings\":\"AAsBW,SAAAA,iBAAMA,CAAA,QAAAC,MAAA,CAAAC,UAAA,OAAAC,SAAA,CACXF,MAAM,CAACG,KAAK,CAAGF,UAAU,CAAC,CAAC,CAAC,CAC9B\",\"ignoreList\":[]}"
};
const _worklet_13270733731974_init_data = {
  code: "function VideoTimelineTsx3(event){const{offset}=this.__closure;offset.value=event.translationX;}",
  location: "C:\\tmp\\vtui\\src\\VideoTimeline.tsx",
  sourceMap: "{\"version\":3,\"names\":[\"VideoTimelineTsx3\",\"event\",\"offset\",\"__closure\",\"value\",\"translationX\"],\"sources\":[\"C:/tmp/vtui/src/VideoTimeline.tsx\"],\"mappings\":\"AAmBe,SAAAA,iBAAUA,CAAAC,KAAA,QAAAC,MAAA,OAAAC,SAAA,CACnBD,MAAM,CAACE,KAAK,CAAGH,KAAK,CAACI,YAAY,CACnC\",\"ignoreList\":[]}"
};
export function DraggableBox({
  size = 100,
  color = 'blue',
  children
}) {
  const offset = useSharedValue(0);
  const animatedStyles = useAnimatedStyle(function VideoTimelineTsx1Factory({
    _worklet_2846763510714_init_data,
    offset
  }) {
    const _e = [new global.Error(), -2, -27];
    const VideoTimelineTsx1 = () => ({
      transform: [{
        translateX: offset.value
      }]
    });
    VideoTimelineTsx1.__closure = {
      offset
    };
    VideoTimelineTsx1.__workletHash = 2846763510714;
    VideoTimelineTsx1.__pluginVersion = "0.8.2";
    VideoTimelineTsx1.__initData = _worklet_2846763510714_init_data;
    VideoTimelineTsx1.__stackDetails = _e;
    return VideoTimelineTsx1;
  }({
    _worklet_2846763510714_init_data,
    offset
  }));
  const panGesture = Gesture.Pan().onUpdate(function VideoTimelineTsx3Factory({
    _worklet_13270733731974_init_data,
    offset
  }) {
    const _e = [new global.Error(), -2, -27];
    const VideoTimelineTsx3 = function (event) {
      offset.value = event.translationX;
    };
    VideoTimelineTsx3.__closure = {
      offset
    };
    VideoTimelineTsx3.__workletHash = 13270733731974;
    VideoTimelineTsx3.__pluginVersion = "0.8.2";
    VideoTimelineTsx3.__initData = _worklet_13270733731974_init_data;
    VideoTimelineTsx3.__stackDetails = _e;
    return VideoTimelineTsx3;
  }({
    _worklet_13270733731974_init_data,
    offset
  })).onEnd(function VideoTimelineTsx2Factory({
    _worklet_4175568407495_init_data,
    offset,
    withSpring
  }) {
    const _e = [new global.Error(), -3, -27];
    const VideoTimelineTsx2 = function () {
      offset.value = withSpring(0);
    };
    VideoTimelineTsx2.__closure = {
      offset,
      withSpring
    };
    VideoTimelineTsx2.__workletHash = 4175568407495;
    VideoTimelineTsx2.__pluginVersion = "0.8.2";
    VideoTimelineTsx2.__initData = _worklet_4175568407495_init_data;
    VideoTimelineTsx2.__stackDetails = _e;
    return VideoTimelineTsx2;
  }({
    _worklet_4175568407495_init_data,
    offset,
    withSpring
  }));
  const backgroundColor = children ? 'transparent' : color;
  return /*#__PURE__*/_jsx(GestureDetector, {
    gesture: panGesture,
    children: /*#__PURE__*/_jsx(Animated.View, {
      style: [styles.box, {
        width: size,
        height: size,
        backgroundColor
      }, animatedStyles],
      children: children
    })
  });
}
export function VideoTimeline() {
  return /*#__PURE__*/_jsx(DraggableBox, {});
}
const styles = StyleSheet.create({
  box: {
    borderRadius: 10,
    overflow: 'hidden'
  }
});
//# sourceMappingURL=VideoTimeline.js.map