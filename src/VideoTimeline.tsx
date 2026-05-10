import type { ReactNode, RefObject } from 'react';
import React, { createContext, useContext, useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  runOnJS,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

const DEFAULT_CLIP_HEIGHT = 36;
const MIN_CLIP_DURATION_SEC = 0.01;

export interface TimelineItem {
  id: string;
  lane: number;
  start: number;
  end: number;
  height: number;
}

function normalizeLane(lane?: number): number {
  if (typeof lane !== 'number' || !Number.isFinite(lane)) return 1;
  return Math.max(1, Math.round(lane));
}



function laneIndexToYPosition(zeroBasedLane: number, clipHeight: number, laneHeight: number): number {
  const index = Math.max(0, zeroBasedLane);
  return index * laneHeight + laneHeight / 2 - clipHeight / 2;
}

function deriveClipLayout(
  item: Pick<TimelineItem, 'lane' | 'start' | 'end' | 'height'>,
  laneHeight: number,
  pixelsPerSecond: number
) {
  const lane = normalizeLane(item.lane);
  const laneIndex = lane - 1;
  const clipHeight = item.height ?? DEFAULT_CLIP_HEIGHT;
  const startSec = item.start;
  const endSecRaw = item.end;
  const durationSec = Math.max(MIN_CLIP_DURATION_SEC, endSecRaw - startSec);
  const widthPx = durationSec * pixelsPerSecond;
  const x = startSec * pixelsPerSecond;
  const endSec = startSec + widthPx / pixelsPerSecond;
  const y = laneIndexToYPosition(laneIndex, clipHeight, laneHeight);
  return {
    lane,
    laneIndex,
    startSec,
    endSec,
    width: widthPx,
    x,
    y,
    clipHeight,
  };
}

function clampZoomValue(value: number, minZoom?: number, maxZoom?: number): number {
  'worklet';
  let next = value;
  if (typeof minZoom === 'number') {
    next = Math.max(minZoom, next);
  }
  if (typeof maxZoom === 'number') {
    next = Math.min(maxZoom, next);
  }
  return next;
}

type ClipEntry = { id: string; lane: number; x: number; width: number };

interface TimelineContextValue {
  containerWidth: SharedValue<number>;
  contentWidth: SharedValue<number>;
  laneHeight: number;
  laneColor: string;
  maxLanes: number;
  displayLanes: SharedValue<number>;
  clipsRegistry: SharedValue<ClipEntry[]>;
  zoom: SharedValue<number>;
  pixelsPerSecond: number;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  onItemChangeRef: RefObject<(item: TimelineItem) => void>;
}

/**
 * Worklet: given a desired X for a clip of `itemWidth` on `lane`, return a
 * collision-free X (snapping to the nearest free slot). Returns null if the
 * lane has no free slot that fits the clip.
 */
function findValidX(
  desiredX: number,
  itemWidth: number,
  lane: number,
  registry: ClipEntry[],
  selfId: string,
  maxX: number
): number | null {
  'worklet';
  const others: { x: number; w: number }[] = [];
  for (let i = 0; i < registry.length; i++) {
    const c = registry[i]!;
    if (c.id === selfId) continue;
    if (c.lane !== lane) continue;
    others.push({ x: c.x, w: c.width });
  }
  others.sort((a, b) => a.x - b.x);

  let cursor = 0;
  const freeIntervals: [number, number][] = [];
  for (let i = 0; i < others.length; i++) {
    const c = others[i]!;
    const freeEnd = c.x - itemWidth;
    if (freeEnd >= cursor) freeIntervals.push([cursor, freeEnd]);
    if (c.x + c.w > cursor) cursor = c.x + c.w;
  }
  if (cursor <= maxX) freeIntervals.push([cursor, maxX]);

  if (freeIntervals.length === 0) return null;

  const clamped = Math.max(0, Math.min(desiredX, maxX));

  for (let i = 0; i < freeIntervals.length; i++) {
    const iv = freeIntervals[i]!;
    if (clamped >= iv[0] && clamped <= iv[1]) return clamped;
  }

  let bestX = freeIntervals[0]![0];
  let bestDist = Infinity;
  for (let i = 0; i < freeIntervals.length; i++) {
    const iv = freeIntervals[i]!;
    const dLo = Math.abs(clamped - iv[0]);
    const dHi = Math.abs(clamped - iv[1]);
    if (dLo < bestDist) { bestDist = dLo; bestX = iv[0]; }
    if (dHi < bestDist) { bestDist = dHi; bestX = iv[1]; }
  }
  return bestX;
}

/**
 * Worklet: largest right-edge of any clip on `lane` that ends at or before
 * `selfStartX` (i.e. the clip immediately to our left). This is the smallest
 * value our left edge can shrink to without overlapping a neighbor.
 */
function findMinLeftEdge(
  selfStartX: number,
  lane: number,
  registry: ClipEntry[],
  selfId: string
): number {
  'worklet';
  let minLeft = 0;
  for (let i = 0; i < registry.length; i++) {
    const c = registry[i]!;
    if (c.id === selfId || c.lane !== lane) continue;
    const cRight = c.x + c.width;
    if (cRight <= selfStartX && cRight > minLeft) {
      minLeft = cRight;
    }
  }
  return minLeft;
}

/**
 * Worklet: smallest left-edge of any clip on `lane` that starts at or after
 * `selfStartX + selfStartWidth` (the clip immediately to our right), or
 * `contentWidth` if no such clip exists. This is the largest value our right
 * edge can grow to without overlapping a neighbor or running off the content.
 */
function findMaxRightEdge(
  selfStartX: number,
  selfStartWidth: number,
  lane: number,
  registry: ClipEntry[],
  selfId: string,
  contentWidth: number
): number {
  'worklet';
  let maxRight = contentWidth;
  const selfStartRight = selfStartX + selfStartWidth;
  for (let i = 0; i < registry.length; i++) {
    const c = registry[i]!;
    if (c.id === selfId || c.lane !== lane) continue;
    if (c.x >= selfStartRight && c.x < maxRight) {
      maxRight = c.x;
    }
  }
  return maxRight;
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

function useTimeline() {
  const ctx = useContext(TimelineContext);
  if (!ctx) throw new Error('DraggableClip must be used inside VideoTimeline');
  return ctx;
}

function computeLabelInterval(
  pixelsPerSecond: number,
  framesPerSecond?: number,
  forceIntegerSeconds: boolean = false
): number {
  const targetPixels = 80;
  const safePps = Math.max(pixelsPerSecond, 1e-6);
  const targetSec = targetPixels / safePps;

  if (framesPerSecond && Number.isFinite(framesPerSecond) && framesPerSecond > 0) {
    const frameDuration = 1 / framesPerSecond;
    const targetFrames = targetSec / frameDuration;
    if (!isFinite(targetFrames) || targetFrames <= 0) return frameDuration;
    const candidateFrames = Math.max(1, Math.ceil(targetFrames));
    return candidateFrames * frameDuration;
  }

  if (!isFinite(targetSec) || targetSec <= 0) return 1;
  const exponent = Math.floor(Math.log10(targetSec));
  const base = Math.pow(10, exponent);
  const normalized = targetSec / base;
  const step = Math.max(1, Math.ceil(normalized));
  const candidate = step * base;
  if (forceIntegerSeconds) {
    return Math.max(1, Math.ceil(candidate));
  }
  return Math.max(candidate, 1);
}

function computeDecimalPlaces(interval: number): number {
  if (!isFinite(interval) || interval <= 0) {
    return 0;
  }
  const decimals = Math.max(0, Math.ceil(-Math.log10(interval)));
  return Math.min(decimals + 1, 6);
}

function formatTime(sec: number, decimals: number): string {
  const precision = Math.max(0, decimals);
  const factor = Math.pow(10, precision);
  const roundedUnits = Math.round(sec * factor);
  const totalSeconds = Math.floor(roundedUnits / factor);
  const fractionalUnits = Math.abs(roundedUnits - totalSeconds * factor);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const minutesStr = String(minutes).padStart(2, '0');
  const secondsStr = String(seconds).padStart(2, '0');
  let fractionalStr = '';
  if (precision > 0) {
    fractionalStr = String(fractionalUnits).padStart(precision, '0').replace(/0+$/, '');
  }
  const fractionalPart = fractionalStr.length > 0 ? `.${fractionalStr}` : '';

  if (hours > 0) {
    const hoursStr = String(hours).padStart(2, '0');
    return `${hoursStr}:${minutesStr}:${secondsStr}${fractionalPart}`;
  }

  return `${minutesStr}:${secondsStr}${fractionalPart}`;
}

function formatRulerLabel(sec: number, decimals: number, framesPerSecond?: number): string {
  if (framesPerSecond && Number.isFinite(framesPerSecond) && framesPerSecond > 0) {
    const frameDuration = 1 / framesPerSecond;
    const nearestSecond = Math.round(sec);
    if (Math.abs(sec - nearestSecond) <= frameDuration * 0.25) {
      return formatTime(nearestSecond, decimals);
    }

    const baseSecond = Math.floor(sec);
    let frameIndex = Math.round((sec - baseSecond) * framesPerSecond);
    if (frameIndex <= 0) frameIndex = 1;
    if (frameIndex >= framesPerSecond) {
      return formatTime(baseSecond + 1, decimals);
    }
    return `${frameIndex}f`;
  }
  return formatTime(sec, decimals);
}

export interface TimelineRulerProps {
  width: number;
  pixelsPerSecond: number;
  zoom: number;
  height?: number;
  /** Optional frame rate; render frame numbers when provided. */
  framesPerSecond?: number;
}

export const TimelineRuler = React.memo(function TimelineRuler({
  width,
  pixelsPerSecond,
  zoom,
  height = 28,
  framesPerSecond,
}: TimelineRulerProps) {
  const effectivePps = pixelsPerSecond * zoom;
  const safeEffectivePps = Math.max(effectivePps, 1e-6);

  // GPU-OPTIMIZED: We render all labels for the entire width.
  // This means React NEVER re-renders the ruler during scroll.
  // The CSS transform on the parent container handles the smooth movement.
  const visibleStartSec = 0;
  const visibleEndSec = width / safeEffectivePps;
  const minSpacingPx = 80;
  const fps = framesPerSecond && framesPerSecond > 0 ? framesPerSecond : null;
  const perSecondMode = safeEffectivePps >= minSpacingPx;
  const subLabelCap = fps ? fps - 1 : Number.POSITIVE_INFINITY;
  const maxSubLabels = perSecondMode
    ? Math.min(
        subLabelCap,
        Math.max(0, Math.floor(safeEffectivePps / minSpacingPx) - 1)
      )
    : 0;

  const fallbackInterval = computeLabelInterval(safeEffectivePps, undefined, true);
  const labelInterval = perSecondMode
    ? maxSubLabels > 0
      ? 1 / (maxSubLabels + 1)
      : 1
    : fallbackInterval;
  const decimals = computeDecimalPlaces(labelInterval);

  const rangeStartSec = visibleStartSec;
  const rangeEndSec = visibleEndSec;

  const labels = useMemo(() => {
    if (perSecondMode) {
      const placedTimes: number[] = [];
      const seen = new Set<number>();
      const push = (time: number) => {
        if (time < rangeStartSec - 1e-9 || time > rangeEndSec + 1e-9) return;
        const key = Math.round(time * 1e6) / 1e6;
        if (seen.has(key)) return;
        placedTimes.push(time);
        seen.add(key);
      };

      const secStart = Math.max(0, Math.floor(rangeStartSec));
      const secEnd = Math.ceil(rangeEndSec + 1e-9);
      for (let sec = secStart; sec <= secEnd; sec++) {
        push(sec);
        if (maxSubLabels <= 0) continue;

        if (fps) {
          const usedFrames = new Set<number>();
          for (let slot = 1; slot <= maxSubLabels; slot++) {
            const fraction = slot / (maxSubLabels + 1);
            let frameIndex = Math.round(fraction * fps);
            frameIndex = Math.min(fps - 1, Math.max(1, frameIndex));
            if (usedFrames.has(frameIndex)) continue;
            usedFrames.add(frameIndex);
            push(sec + frameIndex / fps);
          }
        } else {
          for (let slot = 1; slot <= maxSubLabels; slot++) {
            push(sec + slot / (maxSubLabels + 1));
          }
        }
      }

      return placedTimes.sort((a, b) => a - b);
    }

    const valueMap = new Map<number, number>();
    const push = (val: number) => {
      const key = Math.round(val * 1000) / 1000;
      if (!valueMap.has(key)) valueMap.set(key, val);
    };

    const firstLabel = Math.max(0, Math.floor(rangeStartSec / labelInterval) * labelInterval);
    let iterations = 0;
    for (let t = firstLabel; t <= rangeEndSec + 1e-9; t += labelInterval) {
      push(t);
      if (++iterations > 2500) break;
    }
    return Array.from(valueMap.values()).sort((a, b) => a - b);
  }, [perSecondMode, fps, maxSubLabels, rangeStartSec, rangeEndSec, labelInterval]);

  const dots = useMemo(() => {
    if (perSecondMode) {
      const list: number[] = [];
      for (let i = 0; i < labels.length - 1; i++) {
        list.push((labels[i]! + labels[i + 1]!) / 2);
      }
      return list;
    }

    const list: number[] = [];
    if (!(labelInterval > 0)) return list;
    const offset = labelInterval / 2;
    const firstDotBase = Math.floor((rangeStartSec - offset) / labelInterval) * labelInterval + offset;
    const firstDot = firstDotBase < rangeStartSec ? firstDotBase + labelInterval : firstDotBase;
    let iterations = 0;
    for (let t = firstDot; t <= rangeEndSec + 1e-9; t += labelInterval) {
      if (t >= rangeStartSec - 1e-9) list.push(t);
      if (++iterations > 2500) break;
    }
    return list;
  }, [perSecondMode, labels, rangeStartSec, rangeEndSec, labelInterval]);

  const dotSize = 3;
  const dotTop = height / 2 - dotSize / 2;
  const labelSlotWidth = 120;

  return (
    <View style={[styles.ruler, { height, width }]}>
      {labels.map((t) => (
        <View
          key={`label-${t}`}
          style={[
            styles.rulerLabelWrapper,
            { left: t * effectivePps - labelSlotWidth / 2, width: labelSlotWidth, pointerEvents: 'none' as any },
          ]}
        >
          <Text style={styles.rulerLabel}>
            {formatRulerLabel(t, decimals, fps ?? undefined)}
          </Text>
        </View>
      ))}
      {dots.map((t) => (
        <View
          key={`dot-${t}`}
          style={[
            styles.rulerDot,
            {
              left: t * effectivePps - dotSize / 2,
              top: dotTop,
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
            },
          ]}
        />
      ))}
    </View>
  );
});

export interface TimelineLaneProps {
  index: number;
}

export function TimelineLane({ index }: TimelineLaneProps) {
  const { laneHeight, laneColor } = useTimeline();
  return (
    <View
      style={[
        styles.lane,
        {
          height: laneHeight,
          backgroundColor: index % 2 === 0 ? laneColor : '#222',
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: '#444',
        },
      ]}
    />
  );
}

export interface DraggableClipProps {
  id: string;
  lane: number;
  start: number;
  end: number;
  height?: number;
  /** Whether to render left/right resize handles. Default true. */
  resizable?: boolean;
  /** Minimum logical width when resizing. Default 20. */
  minWidth?: number;
  /** Width of each resize handle in display pixels. Default 12. */
  handleWidth?: number;
  children?: ReactNode;
}

export function DraggableClip({
  id,
  lane,
  start,
  end,
  height: heightProp,
  resizable = true,
  minWidth = 20,
  handleWidth = 12,
  children,
}: DraggableClipProps) {
  const {
    containerWidth,
    contentWidth,
    laneHeight,
    maxLanes,
    displayLanes,
    clipsRegistry,
    zoom,
    pixelsPerSecond,
    selectedId,
    setSelectedId,
    onItemChangeRef,
  } = useTimeline();
  const isSelected = selectedId === id;

  const layout = useMemo(
    () =>
      deriveClipLayout(
        { lane, start, end, height: heightProp ?? DEFAULT_CLIP_HEIGHT },
        laneHeight,
        pixelsPerSecond
      ),
    [lane, start, end, heightProp, laneHeight, pixelsPerSecond]
  );
  const clipHeight = layout.clipHeight;
  const x = useSharedValue(layout.x);
  const y = useSharedValue(layout.y);
  const widthSV = useSharedValue(layout.width);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startWidthSV = useSharedValue(0);
  const currentLane = useSharedValue(layout.laneIndex);

  const extendContentWidth = (rightEdge: number) => {
    'worklet';
    const padding = laneHeight;
    if (rightEdge + padding > contentWidth.value) {
      contentWidth.value = rightEdge + padding;
    }
  };

  // Stable JS-thread callback: emits onItemsChange via the ref using the
  // current shared-value positions. Must NOT be an inline arrow inside a
  // worklet, otherwise reanimated serializes it as a worklet and calling
  // it via runOnJS fails the `isHostFunction` JSI assertion on native.
  const notifyItemChange = useCallback(() => {
    const startSec = x.value / Math.max(pixelsPerSecond, 1e-6);
    const endSec = (x.value + widthSV.value) / Math.max(pixelsPerSecond, 1e-6);
    const laneIndex = Math.max(0, currentLane.value);
    onItemChangeRef.current?.({
      id,
      lane: laneIndex + 1,
      start: startSec,
      end: endSec,
      height: clipHeight,
    });
  }, [id, pixelsPerSecond, clipHeight, x, widthSV, currentLane, onItemChangeRef]);

  // Sync with external prop changes
  useEffect(() => {
    x.value = layout.x;
  }, [layout.x]);

  useEffect(() => {
    y.value = layout.y;
    currentLane.value = layout.laneIndex;
  }, [layout.y, layout.laneIndex]);

  useEffect(() => {
    widthSV.value = layout.width;
  }, [layout.width]);

  // Register this clip in the shared registry so other clips can avoid it.
  useEffect(() => {
    const entry: ClipEntry = { id, lane: layout.laneIndex, x: layout.x, width: layout.width };
    clipsRegistry.value = [
      ...clipsRegistry.value.filter((c) => c.id !== id),
      entry,
    ];
    if (contentWidth.value < layout.x + layout.width) {
      contentWidth.value = layout.x + layout.width + laneHeight;
    }
    return () => {
      clipsRegistry.value = clipsRegistry.value.filter((c) => c.id !== id);
    };
  }, [id, layout.laneIndex, layout.x, layout.width, laneHeight, clipsRegistry, contentWidth]);

  // Re-clamp X when container width changes (resize on web)
  useAnimatedReaction(
    () => containerWidth.value,
    (currentWidth) => {
      if (currentWidth > 0) {
        x.value = Math.max(0, Math.min(x.value, contentWidth.value - widthSV.value));
      }
    }
  );

  const tapGesture = Gesture.Tap().onEnd((_event, success) => {
    if (success) runOnJS(setSelectedId)(id);
  });

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      startX.value = x.value;
      startY.value = y.value;
      startWidthSV.value = widthSV.value;
      currentLane.value = Math.round(startY.value / laneHeight);
    })
    .onStart(() => {
      runOnJS(setSelectedId)(id);
    })
    .onUpdate((event) => {
      const z = zoom.value || 1;
      // Translations are in display pixels; convert to logical pixels.
      const desiredX = startX.value + event.translationX / z;
      const cursorY = startY.value + event.translationY;
      const maxLane = Math.min(maxLanes, displayLanes.value) - 1;
      const desiredLane = Math.max(
        0,
        Math.min(Math.round(cursorY / laneHeight), maxLane)
      );
      const w = widthSV.value;
      // Logical content width is zoom-independent; clip may live anywhere in
      // [0, contentWidth - width] in logical pixels.
      const desiredRight = desiredX + w;
      extendContentWidth(desiredRight);
      const maxX = contentWidth.value - w;

      // Try placing in the desired lane without colliding with other clips.
      const validX = findValidX(
        desiredX,
        w,
        desiredLane,
        clipsRegistry.value,
        id,
        maxX
      );
      if (validX !== null) {
        currentLane.value = desiredLane;
        x.value = validX;
      } else {
        // Desired lane has no free space; keep current lane and clamp X there.
        const validXCurrent = findValidX(
          desiredX,
          w,
          currentLane.value,
          clipsRegistry.value,
          id,
          maxX
        );
        if (validXCurrent !== null) x.value = validXCurrent;
      }
      y.value = currentLane.value * laneHeight + laneHeight / 2 - clipHeight / 2;
    })
    .onEnd(() => {
      extendContentWidth(x.value + widthSV.value);
      x.value = Math.max(0, Math.min(x.value, contentWidth.value - widthSV.value));

      // Update the shared registry with the final position so other clips
      // immediately see the new bounds.
      const next: ClipEntry[] = [];
      const reg = clipsRegistry.value;
      for (let i = 0; i < reg.length; i++) {
        const entry = reg[i]!;
        if (entry.id === id) {
          next.push({ id, lane: currentLane.value, x: x.value, width: widthSV.value });
        } else {
          next.push(entry);
        }
      }
      clipsRegistry.value = next;

      runOnJS(notifyItemChange)();
    });

  const leftHandleGesture = Gesture.Pan()
    .onBegin(() => {
      startX.value = x.value;
      startWidthSV.value = widthSV.value;
      currentLane.value = Math.round(y.value / laneHeight);
    })
    .onUpdate((event) => {
      const z = zoom.value || 1;
      const dx = event.translationX / z;
      const originalRight = startX.value + startWidthSV.value;
      const minLeft = findMinLeftEdge(
        startX.value,
        currentLane.value,
        clipsRegistry.value,
        id
      );
      const desiredX = startX.value + dx;
      const newX = Math.max(minLeft, Math.min(desiredX, originalRight - minWidth));
      x.value = newX;
      widthSV.value = originalRight - newX;
    })
    .onEnd(() => {
      const next: ClipEntry[] = [];
      const reg = clipsRegistry.value;
      for (let i = 0; i < reg.length; i++) {
        const entry = reg[i]!;
        if (entry.id === id) {
          next.push({ id, lane: currentLane.value, x: x.value, width: widthSV.value });
        } else {
          next.push(entry);
        }
      }
      clipsRegistry.value = next;
      extendContentWidth(x.value + widthSV.value);

      runOnJS(notifyItemChange)();
    });

  const rightHandleGesture = Gesture.Pan()
    .onBegin(() => {
      startX.value = x.value;
      startWidthSV.value = widthSV.value;
      currentLane.value = Math.round(y.value / laneHeight);
    })
    .onUpdate((event) => {
      const z = zoom.value || 1;
      const dx = event.translationX / z;
      const maxRight = findMaxRightEdge(
        startX.value,
        startWidthSV.value,
        currentLane.value,
        clipsRegistry.value,
        id,
        contentWidth.value
      );
      const desiredWidth = startWidthSV.value + dx;
      const maxAllowedWidth = maxRight - x.value;
      widthSV.value = Math.max(minWidth, Math.min(desiredWidth, maxAllowedWidth));
      extendContentWidth(x.value + widthSV.value);
    })
    .onEnd(() => {
      const next: ClipEntry[] = [];
      const reg = clipsRegistry.value;
      for (let i = 0; i < reg.length; i++) {
        const entry = reg[i]!;
        if (entry.id === id) {
          next.push({ id, lane: currentLane.value, x: x.value, width: widthSV.value });
        } else {
          next.push(entry);
        }
      }
      clipsRegistry.value = next;
      extendContentWidth(x.value + widthSV.value);

      runOnJS(notifyItemChange)();
    });

  const animatedStyles = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value * zoom.value }, { translateY: y.value }],
    width: widthSV.value * zoom.value,
    height: clipHeight,
  }));

  const leftHandleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value * zoom.value }, { translateY: y.value }],
    width: handleWidth,
    height: clipHeight,
  }));

  const rightHandleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (x.value + widthSV.value) * zoom.value - handleWidth },
      { translateY: y.value },
    ],
    width: handleWidth,
    height: clipHeight,
  }));

  const clipComposedGesture = Gesture.Race(tapGesture, panGesture);

  return (
    <>
      <GestureDetector gesture={clipComposedGesture}>
        <Animated.View style={[styles.clip, animatedStyles]}>
          {children}
        </Animated.View>
      </GestureDetector>
      {resizable && isSelected ? (
        <>
          <GestureDetector gesture={leftHandleGesture}>
            <Animated.View style={[styles.handleBase, styles.handleLeft, leftHandleStyle]}>
              <View style={styles.handleBar} />
            </Animated.View>
          </GestureDetector>
          <GestureDetector gesture={rightHandleGesture}>
            <Animated.View style={[styles.handleBase, styles.handleRight, rightHandleStyle]}>
              <View style={styles.handleBar} />
            </Animated.View>
          </GestureDetector>
        </>
      ) : null}
    </>
  );
}

// Keep old DraggableBox for backward compatibility
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

export interface VideoTimelineProps {
  laneHeight?: number;
  laneColor?: string;
  maxLanes?: number;
  /** Array of clips (lane + start/end). */
  items?: TimelineItem[];
  onItemsChange?: (items: TimelineItem[]) => void;
  /** Pixels representing one second at zoom = 1. Default 50. */
  pixelsPerSecond?: number;
  /** Whether to render the time ruler on top. Default true. */
  showRuler?: boolean;
  /** Ruler height in pixels. Default 28. */
  rulerHeight?: number;
  /** Initial zoom. Default 1. */
  initialZoom?: number;
  /** Optional minimum zoom factor; omit for no lower bound. */
  minZoom?: number;
  /** Optional maximum zoom factor; omit for no upper bound. */
  maxZoom?: number;
  /** Whether to render the built-in zoom buttons. Default true. */
  showZoomControls?: boolean;
  /**
   * Sensitivity of zoom-by-drag on the ruler. The zoom factor on each frame
   * is `exp(translationX * sensitivity)`, so larger values mean the same
   * drag distance produces a larger zoom change.
   *
   * Reference (with default `0.005`):
   * - 100 px drag => zoom ×1.65
   * - 200 px drag => zoom ×2.72
   *
   * Default 0.005.
   */
  rulerZoomSensitivity?: number;
  /** Whether to render a vertical playhead line in the visible center. Default true. */
  showPlayhead?: boolean;
  /** Playhead color. Default white. */
  playheadColor?: string;
  /** Playhead width (pixels). Default 1. */
  playheadWidth?: number;
  /** Optional frame rate passed to the ruler for frame numbering. */
  framesPerSecond?: number;
  /** Currently selected clip id (controlled mode). */
  selectedItemId?: string | null;
  /** Initial selection for uncontrolled mode. */
  defaultSelectedItemId?: string | null;
  /** Called whenever the selection changes (clip id or null). */
  onSelectedItemIdChange?: (id: string | null) => void;
  /** Current time for two-way sync. */
  currentTime?: number;
  /** Called when the timeline scrolls. */
  onTimeChange?: (time: number) => void;
  /** Whether the video is currently playing. Used for frame-perfect sync. */
  isPaused?: boolean;
  /** Ref to the video component to access currentTime directly. */
  videoRef?: RefObject<any>;
  /** Offset to map video currentTime to timeline time. TimelineTime = VideoCurrentTime + videoTimeOffset. */
  videoTimeOffset?: number;
  children?: ReactNode;
}

export function VideoTimeline({
  laneHeight = 60,
  laneColor = '#1a1a1a',
  maxLanes = 5,
  items = [],
  onItemsChange,
  pixelsPerSecond = 50,
  showRuler = true,
  rulerHeight = 28,
  isPaused = true,
  videoRef,
  initialZoom = 1,
  minZoom,
  maxZoom,
  showZoomControls = true,
  rulerZoomSensitivity = 0.005,
  showPlayhead = true,
  playheadColor = '#fff',
  playheadWidth = 1,
  framesPerSecond,
  selectedItemId,
  defaultSelectedItemId = null,
  onSelectedItemIdChange,
  currentTime,
  onTimeChange,
  videoTimeOffset = 0,
  children,
}: VideoTimelineProps) {
  const { width: windowWidth } = useWindowDimensions();
  const containerWidth = useSharedValue(0);
  const [containerWidthState, setContainerWidthState] = useState(0);
  const contentWidth = useSharedValue(0);
  const [contentWidthState, setContentWidthState] = useState(0);
  const updateContentWidthState = useCallback((next: number) => {
    setContentWidthState((prev) => (prev === next ? prev : next));
  }, []);
  const clipsRegistry = useSharedValue<ClipEntry[]>([]);

  // Horizontal scroll offset in *display* pixels. 0 = leftmost.
  const scrollX = useSharedValue(0);
  const startScrollX = useSharedValue(0);

  // Selection state (controlled + uncontrolled)
  const isSelectionControlled = selectedItemId !== undefined;
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    defaultSelectedItemId
  );
  const selectedId = isSelectionControlled
    ? selectedItemId ?? null
    : internalSelectedId;
  const setSelectedId = useCallback(
    (id: string | null) => {
      if (!isSelectionControlled) setInternalSelectedId(id);
      onSelectedItemIdChange?.(id);
    },
    [isSelectionControlled, onSelectedItemIdChange]
  );

  const [zoom, setZoom] = useState(initialZoom);
  const zoomSV = useSharedValue(initialZoom);
  const startZoomSV = useSharedValue(initialZoom);
  const lastZoomSyncSV = useSharedValue(0);
  // Sync external (button) zoom changes -> shared value
  useEffect(() => {
    zoomSV.value = zoom;
  }, [zoom, zoomSV]);

  const clampZoomJS = useCallback(
    (value: number) => clampZoomValue(value, minZoom, maxZoom),
    [minZoom, maxZoom]
  );

  const handleZoomIn = useCallback(() => {
    setZoom((z) => clampZoomJS(+(z * 1.5).toFixed(4)));
  }, [clampZoomJS]);
  const handleZoomOut = useCallback(() => {
    setZoom((z) => clampZoomJS(+(z / 1.5).toFixed(4)));
  }, [clampZoomJS]);

  // Pan on the ruler to zoom (TradingView-style): drag right -> zoom in,
  // drag left -> zoom out. Multiplicative for natural feel.
  const rulerPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-5, 5])
        .onBegin(() => {
          startZoomSV.value = zoomSV.value;
          lastZoomSyncSV.value = 0;
        })
        .onUpdate((event) => {
          const factor = Math.exp(event.translationX * rulerZoomSensitivity);
          const next = clampZoomValue(startZoomSV.value * factor, minZoom, maxZoom);
          zoomSV.value = next;
          // Throttle React state updates to ~30 fps to keep ruler labels in sync
          // without flooding the JS thread.
          const nowMs = Date.now();
          if (nowMs - lastZoomSyncSV.value > 33) {
            lastZoomSyncSV.value = nowMs;
            runOnJS(setZoom)(next);
          }
        })
        .onEnd(() => {
          runOnJS(setZoom)(zoomSV.value);
        }),
    [minZoom, maxZoom, rulerZoomSensitivity, zoomSV, startZoomSV, lastZoomSyncSV]
  );

  // Keep scrollX within valid bounds when zoom changes.
  useAnimatedReaction(
    () => ({ z: zoomSV.value, viewport: containerWidth.value, content: contentWidth.value }),
    (cur) => {
      const maxScroll = Math.max(0, cur.content * cur.z - cur.viewport);
      if (scrollX.value > maxScroll) scrollX.value = maxScroll;
      else if (scrollX.value < 0) scrollX.value = 0;
    }
  );

  // Track whether the user is currently dragging the timeline.
  // When true we skip programmatic scrollX updates from currentTime.
  const isDraggingTimeline = useSharedValue(false);
  const lastTimeRef = useRef(currentTime);

  // ─── FRAME-PERFECT SYNC via requestAnimationFrame ───
  // useFrameCallback runs on the Reanimated UI thread and CANNOT access React
  // refs.  Instead we use a plain rAF loop that reads `<video>.currentTime`
  // directly from the DOM every frame and writes to the shared value.
  const rafIdRef = useRef<number>(0);

  useEffect(() => {
    function getVideoElement(): any {
      const r = videoRef?.current;
      
      // 1. Try to find the element starting from the ref
      if (r) {
        if (r._videoElement) return r._videoElement;
        if (r._root && r._root.querySelector) {
          const found = r._root.querySelector('video');
          if (found) return found;
        }
        // react-native-video internal property
        if (r._video && r._video.nodeName === 'VIDEO') return r._video;
      }
      
      // 2. Global search fallback (extremely effective on Web)
      const g = globalThis as any;
      if (typeof g !== 'undefined' && g.document) {
        const found = g.document.querySelector('video');
        if (found) return found;
      }
      
      return null;
    }

    function tick() {
      if (isDraggingTimeline.value) {
        rafIdRef.current = requestAnimationFrame(tick);
        return;
      }
      
      const vid = getVideoElement();
      if (vid && typeof vid.currentTime === 'number') {
        // Use the actual DOM state (vid.paused) as the source of truth if possible
        const isVidPaused = vid.paused;
        if (!isVidPaused) {
          const timelineTime = vid.currentTime + videoTimeOffset;
          const target = timelineTime * pixelsPerSecond * zoomSV.value;
          const max = contentWidth.value * zoomSV.value;
          scrollX.value = Math.max(0, Math.min(target, max));
        }
      }
      rafIdRef.current = requestAnimationFrame(tick);
    }
    
    // Always start the loop if we have a video ref, 
    // we'll check vid.paused inside tick for 60fps sync
    if (videoRef?.current) {
      rafIdRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [isPaused, videoRef, pixelsPerSecond, zoomSV, contentWidth, scrollX, isDraggingTimeline, videoTimeOffset]);

  // Fallback: sync from the React `currentTime` prop (fires on onProgress).
  // This handles seek jumps and the case when videoRef is unavailable.
  useEffect(() => {
    if (isDraggingTimeline.value) return;
    if (currentTime !== undefined && containerWidthState > 0) {
      const targetScroll = currentTime * pixelsPerSecond * zoomSV.value;
      const maxScroll = contentWidth.value * zoomSV.value;
      const nextScroll = Math.max(0, Math.min(targetScroll, maxScroll));

      const diff = Math.abs(currentTime - (lastTimeRef.current || 0));
      lastTimeRef.current = currentTime;

      if (diff > 0.5) {
        // Seek jump – instant snap
        scrollX.value = nextScroll;
      } else if (isPaused) {
        // When paused (no rAF loop), still update smoothly
        scrollX.value = withTiming(nextScroll, {
          duration: 200,
          easing: Easing.linear,
        });
      }
      // During playback the rAF loop handles it – skip here.
    }
  }, [currentTime, pixelsPerSecond, containerWidthState, isPaused]);


  // Helper: compute time from current scrollX position (playhead is always at center)
  // With paddingLeft: width/2, scrollX=0 means the start is at center.
  const computeTimeFromScroll = useCallback((scrollXVal: number) => {
    'worklet';
    return scrollXVal / (pixelsPerSecond * zoomSV.value);
  }, [pixelsPerSecond, zoomSV]);

  // Pan gesture on empty lane area to scroll the timeline horizontally.
  const backgroundScrollGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-5, 5])
        .onBegin(() => {
          startScrollX.value = scrollX.value;
          isDraggingTimeline.value = true;
        })
        .onUpdate((event) => {
          'worklet';
          let next = startScrollX.value - event.translationX;
          const extendThresholdPx = 40;
          
          const currentMaxScroll = contentWidth.value * zoomSV.value;
          
          if (next > currentMaxScroll - extendThresholdPx) {
            const logicalPad = Math.max(containerWidth.value / Math.max(zoomSV.value, 0.001), laneHeight);
            contentWidth.value = contentWidth.value + logicalPad;
          }
          
          const maxScroll = contentWidth.value * zoomSV.value;
          if (next > maxScroll) next = maxScroll;
          if (next < 0) next = 0;
          scrollX.value = next;

          if (onTimeChange) {
            const time = computeTimeFromScroll(next);
            runOnJS(onTimeChange)(time);
          }
        })
        .onEnd(() => {
          'worklet';
          isDraggingTimeline.value = false;
          if (onTimeChange) {
            const time = computeTimeFromScroll(scrollX.value);
            runOnJS(onTimeChange)(time);
          }
        })
        .onFinalize(() => {
          'worklet';
          isDraggingTimeline.value = false;
        }),
    [scrollX, startScrollX, containerWidth, zoomSV, contentWidth, laneHeight, isDraggingTimeline, onTimeChange, computeTimeFromScroll]
  );

  // Tap on empty area to deselect any clip.
  const backgroundTapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd((_event, success) => {
        if (success) runOnJS(setSelectedId)(null);
      }),
    [setSelectedId]
  );

  const backgroundComposedGesture = useMemo(
    () => Gesture.Race(backgroundTapGesture, backgroundScrollGesture),
    [backgroundTapGesture, backgroundScrollGesture]
  );

  const itemLayouts = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        ...deriveClipLayout(item, laneHeight, pixelsPerSecond),
      })),
    [items, laneHeight, pixelsPerSecond]
  );
  const occupiedLanes = new Set(itemLayouts.map((layout) => layout.laneIndex));
  const neededLanes = Math.max(occupiedLanes.size, 1);
  const displayLanes = Math.min(neededLanes + 1, maxLanes);
  const displayLanesSV = useSharedValue(displayLanes);
  useEffect(() => {
    displayLanesSV.value = displayLanes;
  }, [displayLanes, displayLanesSV]);

  const handleLayout = useCallback(
    (event: any) => {
      const w = event.nativeEvent.layout.width;
      containerWidth.value = w;
      setContainerWidthState(w);
      if (contentWidth.value < w) {
        contentWidth.value = w;
      }
    },
    [containerWidth, contentWidth]
  );

  // Also re-measure on web window resize
  const outerRef = useRef<any>(null);
  useEffect(() => {
    if (outerRef.current) {
      // @ts-ignore — measure is available on native and web
      outerRef.current.measure?.((x: number, y: number, w: number, h: number) => {
        if (w > 0) {
          containerWidth.value = w;
          setContainerWidthState(w);
          if (contentWidth.value < w) {
            contentWidth.value = w;
          }
        }
      });
    }
  }, [windowWidth, containerWidth, contentWidth]);

  const contentAnimatedStyle = useAnimatedStyle(() => {
    const cw = containerWidth.value;
    return {
      width: contentWidth.value * zoomSV.value + cw, // content + left+right padding
      transform: [{ translateX: -scrollX.value }],
      paddingLeft: cw / 2,
      paddingRight: cw / 2,
    };
  });

  // We no longer sync scrollX to React state high-frequency to keep GPU performance

  useAnimatedReaction(
    () => contentWidth.value,
    (value) => {
      // Round to whole pixels to avoid thrashing re-renders
      runOnJS(updateContentWidthState)(Math.round(value));
    }
  );

  useEffect(() => {
    let maxRight = 0;
    for (let i = 0; i < itemLayouts.length; i++) {
      const layout = itemLayouts[i]!;
      const right = layout.x + layout.width;
      if (right > maxRight) maxRight = right;
    }
    const padded = Math.max(containerWidthState, maxRight + laneHeight);
    if (padded > contentWidth.value) {
      contentWidth.value = padded;
    }
  }, [itemLayouts, laneHeight, contentWidth, containerWidthState]);

  const onItemChangeRef = useRef(onItemsChange ? (item: TimelineItem) => {
    const newItems = items.map((i) => (i.id === item.id ? item : i));
    onItemsChange(newItems);
  } : () => {});

  useEffect(() => {
    onItemChangeRef.current = onItemsChange ? (item: TimelineItem) => {
      const newItems = items.map((i) => (i.id === item.id ? item : i));
      onItemsChange(newItems);
    } : () => {};
  }, [items, onItemsChange]);

  const contextValue: TimelineContextValue = {
    containerWidth,
    contentWidth,
    laneHeight,
    laneColor,
    maxLanes,
    displayLanes: displayLanesSV,
    clipsRegistry,
    zoom: zoomSV,
    pixelsPerSecond,
    selectedId,
    setSelectedId,
    onItemChangeRef,
  };

  const totalHeight = displayLanes * laneHeight;

  return (
    <TimelineContext.Provider value={contextValue}>
      <View
        ref={outerRef}
        style={styles.outer}
        onLayout={handleLayout}
        collapsable={false}
      >
        {showZoomControls ? (
          <View style={styles.toolbar}>
            <Pressable
              onPress={handleZoomOut}
              style={styles.zoomButton}
              accessibilityRole="button"
            >
              <Text style={styles.zoomButtonText}>{'\u2212'}</Text>
            </Pressable>
            <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
            <Pressable
              onPress={handleZoomIn}
              style={styles.zoomButton}
              accessibilityRole="button"
            >
              <Text style={styles.zoomButtonText}>{'+'}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.scrollWrap}>
          <Animated.View style={[styles.scrollContent, contentAnimatedStyle]}>
            {showRuler ? (
              <GestureDetector gesture={rulerPanGesture}>
                <View collapsable={false}>
                  {contentWidthState > 0 ? (
                    <TimelineRuler
                      width={contentWidthState * zoom}
                      pixelsPerSecond={pixelsPerSecond}
                      zoom={zoom}
                      height={rulerHeight}
                      framesPerSecond={framesPerSecond}
                    />

                  ) : (
                    <View style={[styles.ruler, { height: rulerHeight }]} />
                  )}
                </View>
              </GestureDetector>
            ) : null}
            <View
              style={[styles.container, { height: totalHeight }]}
              collapsable={false}
            >
              {Array.from({ length: displayLanes }).map((_, i) => (
                <TimelineLane key={i} index={i} />
              ))}
              {/*
                Scroll hit-area: an absolute-fill sibling rendered BEFORE the
                clips so that clips (zIndex: 10) sit on top of it. Touches on
                empty lane areas hit this view and trigger scroll; touches on
                clips are captured by the clip's own GestureDetector.
              */}
              <GestureDetector gesture={backgroundComposedGesture}>
                <View style={styles.scrollHitArea} collapsable={false} />
              </GestureDetector>
              {children}
            </View>
          </Animated.View>
          {showPlayhead && containerWidthState > 0 ? (
            <View
              style={[
                styles.playhead,
                {
                  left: containerWidthState / 2 - playheadWidth / 2,
                  width: playheadWidth,
                  backgroundColor: playheadColor,
                  pointerEvents: 'none' as any,
                },
              ]}
            />
          ) : null}
        </View>
      </View>
    </TimelineContext.Provider>
  );
}

const styles = StyleSheet.create({
  outer: {
    width: '100%',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#0a0a0a',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  zoomButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 20,
  },
  zoomLabel: {
    color: '#ccc',
    fontSize: 12,
    minWidth: 40,
    textAlign: 'center',
  },
  scrollWrap: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  scrollContent: {
    position: 'relative',
    ...({ willChange: 'transform' } as any),
  },
  ruler: {
    width: '100%',
    backgroundColor: '#0a0a0a',
    position: 'relative',
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
    ...({ cursor: 'ew-resize', userSelect: 'none' } as object),
  },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    zIndex: 20,
  },
  scrollHitArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  rulerDot: {
    position: 'absolute',
    backgroundColor: '#777',
  },
  rulerLabelWrapper: {
    position: 'absolute',
    top: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rulerLabel: {
    color: '#aaa',
    fontSize: 10,
    textAlign: 'center',
  },
  container: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  lane: {
    width: '100%',
  },
  clip: {
    position: 'absolute',
    borderRadius: 4,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    zIndex: 10,
  },
  handleBase: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11,
    ...({ cursor: 'ew-resize', userSelect: 'none' } as object),
  },
  handleLeft: {
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
  },
  handleRight: {
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  handleBar: {
    width: 2,
    height: 16,
    borderRadius: 1,
    backgroundColor: '#555',
  },
  box: {
    borderRadius: 10,
    overflow: 'hidden',
  },
});
