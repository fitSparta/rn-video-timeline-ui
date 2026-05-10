import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Image, ScrollView, Platform, TextInput } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Video from 'react-native-video';
import { VideoTimeline, DraggableClip } from 'rn-video-timeline-ui';
import { pickVideo, releasePickedVideo } from './pickVideo';
import { EditMode, WebVttTrack, EditorTimelineItem, SourcePayload } from './types';
import { renderJsxString } from './JsxRenderer';
import { generateFfmpegCommand } from './ffmpegUtils';
import { exportProjectZip } from './projectUtils';
import { serializeTrackToVTT } from './vttUtils';

// Компонент для отображения замороженного кадра видео (используем сам плеер)
function ThumbnailVideo({ uri, timeSec }: { uri: string; timeSec: number }) {
  const ref = useRef<Video>(null);
  const [loaded, setLoaded] = useState(false);

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Video
        ref={ref}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        paused={true}
        controls={false}
        muted={true}
        resizeMode="cover"
        onLoad={() => {
          if (!loaded) {
            setLoaded(true);
            if (Number.isFinite(timeSec) && ref.current) {
              ref.current.seek(timeSec)?.catch?.(() => {});
            }
          }
        }}
      />
      <View style={{...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)'}} />
    </View>
  );
}

const DEFAULT_VIDEO_URL =
  'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4';

const CLIP_HEIGHT = 40;
const LANE_HEIGHT = 60;
const PIXELS_PER_SECOND = 50;
const FRAMES_PER_SECOND = undefined;

export default function App() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const releasableUriRef = useRef<string | null>(null);

  // Editor State
  const [editMode, setEditMode] = useState<EditMode>('global');
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const currentTimeRef = useRef<number>(0); // high-frequency, no re-renders
  const lastStateUpdateRef = useRef<number>(0); // throttle React updates
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(true);
  const videoRef = useRef<Video>(null);

  // WebVtt Tracks Data
  const [webvttTracks, setWebvttTracks] = useState<WebVttTrack[]>([
    {
      id: 'source-track',
      name: 'Main Video',
      kind: 'source',
      cues: [
        { id: 'src-1', startTime: 0, endTime: 60, payload: { src: DEFAULT_VIDEO_URL, mediaStart: 0, playbackRate: 1.0 } }
      ]
    },
    {
      id: 'sub-track-1',
      name: 'English Subtitles',
      kind: 'subtitles',
      cues: [
        { id: 'sub-1', startTime: 2, endTime: 5, payload: 'Hello World!' },
        { id: 'sub-2', startTime: 6, endTime: 10, payload: 'This is the second subtitle.' }
      ]
    },
    {
      id: 'meta-track-1',
      name: 'Interactive Overlays',
      kind: 'metadata',
      cues: [
        { id: 'meta-1', startTime: 1, endTime: 15, payload: '<TouchableOpacity onPress="https://google.com" style="position:absolute;top:10%;left:5%;"><Text>Click Me!</Text></TouchableOpacity>' }
      ]
    }
  ]);

  useEffect(() => {
    return () => {
      if (releasableUriRef.current) {
        releasePickedVideo(releasableUriRef.current);
        releasableUriRef.current = null;
      }
    };
  }, []);

  // Global Playback Ticker: Advances time even in gaps between clips
  useEffect(() => {
    let rafId: number;
    let lastTime = Date.now();

    const tick = () => {
      const now = Date.now();
      if (!isPaused) {
        const delta = (now - lastTime) / 1000;
        currentTimeRef.current += delta;
        const timelineTime = currentTimeRef.current;
        
        if (now - lastStateUpdateRef.current > 250) {
          lastStateUpdateRef.current = now;
          setCurrentTime(timelineTime);
        }
      }
      lastTime = now;
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPaused, isVideoEmpty]);

  // When the video loads, update the active source clip's originalDuration and endTime (if new)
  const handleVideoLoad = useCallback((data: { duration: number }) => {
    const duration = data.duration;
    const ct = currentTimeRef.current;
    
    setWebvttTracks(prev => {
      const sourceTrack = prev.find(t => t.kind === 'source');
      if (!sourceTrack) return prev;

      // Find exactly which clip is currently active to update it
      const activeClip = sourceTrack.cues.find(cue => ct >= cue.startTime && ct <= cue.endTime);
      if (!activeClip || typeof activeClip.payload === 'string') return prev;

      const p = activeClip.payload as SourcePayload;
      // If we already know the duration for THIS specific clip, do nothing
      if (p.originalDuration === duration) return prev;

      return prev.map(t => {
        if (t.id !== sourceTrack.id) return t;
        
        return {
          ...t,
          cues: t.cues.map(cue => {
            if (cue.id !== activeClip.id) return cue;

            const playbackRate = p.playbackRate || 1.0;
            const currentDur = cue.endTime - cue.startTime;
            const isInitial = Math.abs(currentDur - 0.1) < 0.001 || Math.abs(currentDur - 10) < 0.001 || Math.abs(currentDur - 130.8) < 0.1 || Math.abs(currentDur - 60) < 0.001;
            
            return {
              ...cue,
              endTime: isInitial ? cue.startTime + (duration / playbackRate) : cue.endTime,
              payload: { ...p, originalDuration: duration }
            };
          })
        };
      });
    });
  }, []); // Stable callback! Prevents Video component from re-mounting or re-binding onLoad unnecessarily.

  const handleVideoProgress = useCallback((e: { currentTime: number }) => {
    const timelineTime = e.currentTime + videoTimeOffset;
    currentTimeRef.current = timelineTime;
    // Throttle React state updates to ~4fps for subtitle/overlay rendering.
    // The timeline scroll is driven by rAF directly from the DOM, not this.
    const now = Date.now();
    if (now - lastStateUpdateRef.current > 250) {
      lastStateUpdateRef.current = now;
      setCurrentTime(timelineTime);
    }
  }, [videoTimeOffset]);


  const handlePickVideo = useCallback(async () => {
    console.log('[Editor] handlePickVideo started');
    try {
      setErrorMessage(null);
      const picked = await pickVideo();
      if (!picked) {
        console.log('[Editor] pickVideo returned null (cancelled)');
        return;
      }
      console.log('[Editor] Video picked:', picked.name, 'URI:', picked.uri);

      // Get duration immediately using a temporary video element
      let detectedDuration = 10; // default fallback
      try {
        const tempVideo = document.createElement('video');
        tempVideo.src = picked.uri;
        detectedDuration = await new Promise<number>((resolve) => {
          tempVideo.onloadedmetadata = () => resolve(tempVideo.duration);
          tempVideo.onerror = () => resolve(10);
          // Safety timeout
          setTimeout(() => resolve(10), 3000);
        });
        console.log('[Editor] Detected duration for new video:', detectedDuration);
      } catch (e) {
        console.warn('[Editor] Failed to detect duration, using default 10s');
      }
      
      setWebvttTracks(prev => prev.map(t => {
        if (t.kind === 'source') {
          const lastCue = t.cues.length > 0 ? t.cues[t.cues.length - 1] : null;
          const newStartTime = lastCue ? lastCue.endTime : 0;
          
          console.log(`[Editor] Adding new clip to "${t.name}" at timeline position: ${newStartTime}s with duration: ${detectedDuration}s`);
          
          return {
            ...t,
            cues: [...t.cues, { 
              id: `src-${Date.now()}`, 
              startTime: newStartTime, 
              endTime: newStartTime + detectedDuration,
              payload: { 
                src: picked.uri, 
                mediaStart: 0, 
                playbackRate: 1.0,
                originalDuration: detectedDuration
              } 
            }]
          };
        }
        return t;
      }));

    } catch (err) {
      console.error('[Editor] Error in handlePickVideo:', err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Compute Timeline Items based on editMode
  const getTimelineItems = (): EditorTimelineItem[] => {
    let items: EditorTimelineItem[] = [];
    
    const sourceTrack = webvttTracks.find(t => t.kind === 'source');
    if (sourceTrack) {
      items.push(...sourceTrack.cues.map(cue => ({
        id: cue.id,
        lane: 1, // Video is ALWAYS lane 1
        start: cue.startTime,
        end: cue.endTime,
        height: CLIP_HEIGHT,
        trackId: sourceTrack.id,
        kind: sourceTrack.kind,
        payload: cue.payload,
      })));
    }

    if (editMode === 'global') {
      // Show other tracks collapsed
      webvttTracks.filter(t => t.kind !== 'source').forEach((track, index) => {
        const lane = index + 2;
        track.cues.forEach(cue => {
          items.push({
            id: cue.id,
            lane: lane,
            start: cue.startTime,
            end: cue.endTime,
            height: CLIP_HEIGHT,
            trackId: track.id,
            kind: track.kind,
            payload: cue.payload,
          });
        });
      });
    } else if (editMode === 'track_edit' && activeTrackId) {
      // Show only active track in lane 2
      const activeTrack = webvttTracks.find(t => t.id === activeTrackId);
      if (activeTrack) {
        activeTrack.cues.forEach(cue => {
          items.push({
            id: cue.id,
            lane: 2,
            start: cue.startTime,
            end: cue.endTime,
            height: CLIP_HEIGHT,
            trackId: activeTrack.id,
            kind: activeTrack.kind,
            payload: cue.payload,
          });
        });
      }
    }
    return items;
  };

  const handleTimelineItemsChange = useCallback((updated: any[]) => {
    setWebvttTracks(prev => prev.map(track => {
      const newCues = track.cues.map(cue => {
        const item = updated.find(i => i.id === cue.id);
        if (!item) return cue;

        const newStart = Number(item.start);
        const newEnd = Number(item.end);
        
        if (track.kind === 'source' && typeof cue.payload !== 'string') {
          const payload = cue.payload as SourcePayload;
          const playbackRate = payload.playbackRate || 1.0;
          const originalDuration = payload.originalDuration; // Might be undefined if not loaded yet
          
          const oldStart = cue.startTime;
          const oldEnd = cue.endTime;
          const oldDuration = oldEnd - oldStart;
          const newDuration = newEnd - newStart;
          
          const isResize = Math.abs(newDuration - oldDuration) > 0.01;
          const startChanged = Math.abs(newStart - oldStart) > 0.01;
          
          let nextMediaStart = payload.mediaStart;
          let finalStart = newStart;
          let finalEnd = newEnd;

          if (isResize && originalDuration !== undefined) {
            if (startChanged) {
              // Left handle resize (trim start)
              const deltaTimeline = newStart - oldStart;
              const deltaMedia = deltaTimeline * playbackRate;
              
              // New mediaStart must be >= 0 and <= originalDuration
              let potentialMediaStart = payload.mediaStart + deltaMedia;
              if (potentialMediaStart < 0) potentialMediaStart = 0;
              if (potentialMediaStart > originalDuration) potentialMediaStart = originalDuration;
              
              const actualDeltaMedia = potentialMediaStart - payload.mediaStart;
              const actualDeltaTimeline = actualDeltaMedia / playbackRate;
              
              finalStart = oldStart + actualDeltaTimeline;
              nextMediaStart = potentialMediaStart;
              
              // Also ensure we don't exceed the right boundary
              const maxRemaining = (originalDuration - nextMediaStart) / playbackRate;
              if (finalEnd - finalStart > maxRemaining) {
                finalEnd = finalStart + maxRemaining;
              }
            } else {
              // Right handle resize (trim end)
              const maxAllowedDuration = (originalDuration - nextMediaStart) / playbackRate;
              if (newDuration > maxAllowedDuration) {
                finalEnd = finalStart + maxAllowedDuration;
              }
            }
          }
          
          return {
            ...cue,
            startTime: finalStart,
            endTime: finalEnd,
            payload: { ...payload, mediaStart: nextMediaStart }
          };
        }
        
        return {
          ...cue,
          startTime: newStart,
          endTime: newEnd,
        };
      });
      return { ...track, cues: newCues };
    }));
  }, []);

  // Called when the user drags the timeline → seek the video.
  // Do NOT setCurrentTime here; the video's onProgress will update it,
  // preventing a feedback loop.
  const handleTimeChange = useCallback((timelineTime: number) => {
    // ВАЖНО: Вычисляем offset на лету для timelineTime, а не из замыкания,
    // так как стейт videoTimeOffset может быть устаревшим (например 0).
    const sourceTrack = webvttTracks.find(t => t.kind === 'source');
    const activeClip = sourceTrack?.cues.find(cue => timelineTime >= cue.startTime && timelineTime <= cue.endTime);
    const offset = activeClip ? (activeClip.startTime - ((activeClip.payload as any)?.mediaStart || 0)) : 0;
    
    const videoTime = timelineTime - offset;
    
    // Сразу обновляем стейты, чтобы React-компоненты (и offset) обновились корректно
    currentTimeRef.current = timelineTime;
    setCurrentTime(timelineTime);
    lastStateUpdateRef.current = Date.now();
    
    if (Number.isFinite(videoTime) && videoRef.current && activeClip) {
      videoRef.current.seek(videoTime)?.catch?.(() => {});
    }
  }, [webvttTracks]);

  const handleSplit = useCallback(() => {
    if (!selectedItemId || !activeTrackId) return;
    setWebvttTracks(prev => prev.map(track => {
      if (track.id !== activeTrackId) return track;
      const cueIndex = track.cues.findIndex(c => c.id === selectedItemId);
      if (cueIndex === -1) return track;
      const cue = track.cues[cueIndex];
      const ct = currentTimeRef.current;
      if (ct <= cue.startTime || ct >= cue.endTime) return track;
      const newCue1 = { ...cue, endTime: ct };
      const newCue2 = { ...cue, id: cue.id + '-split', startTime: ct };
      // If the cue is a source clip, adjust the mediaStart for the second part
      if (typeof cue.payload === 'object' && cue.payload !== null && 'mediaStart' in cue.payload) {
        const originalPayload = cue.payload as any;
        // Duration of the first segment
        const duration1 = ct - cue.startTime;
        newCue2.payload = {
          ...originalPayload,
          mediaStart: originalPayload.mediaStart + duration1,
        };
      }
      const newCues = [...track.cues];
      newCues.splice(cueIndex, 1, newCue1, newCue2);
      return { ...track, cues: newCues };
    }));
  }, [selectedItemId, activeTrackId]);

  const handleDelete = useCallback(() => {
    if (!selectedItemId || !activeTrackId) return;
    setWebvttTracks(prev => prev.map(track => {
      if (track.id !== activeTrackId) return track;
      return { ...track, cues: track.cues.filter(c => c.id !== selectedItemId) };
    }));
    setSelectedItemId(null);
  }, [selectedItemId, activeTrackId]);

  const handleAddCue = useCallback(() => {
    if (!activeTrackId) return;
    setWebvttTracks(prev => prev.map(track => {
      if (track.id !== activeTrackId) return track;
      return {
        ...track,
        cues: [...track.cues, {
          id: `cue-${Date.now()}`,
          startTime: currentTimeRef.current,
          endTime: track.kind === 'source' ? currentTimeRef.current + 0.1 : currentTimeRef.current + 5,
          payload: track.kind === 'source' ? { src: '', mediaStart: 0, playbackRate: 1.0 } : 'New cue'
        }]
      };
    }));
  }, [activeTrackId]);


  const activeOverlays = webvttTracks
    .filter(t => t.kind === 'metadata')
    .flatMap(t => t.cues)
    .filter(cue => currentTime >= cue.startTime && currentTime <= cue.endTime);

  const activeSubtitles = webvttTracks
    .filter(t => t.kind === 'subtitles')
    .flatMap(t => t.cues)
    .filter(cue => currentTime >= cue.startTime && currentTime <= cue.endTime);

  const handleExportFfmpeg = useCallback(() => {
    const cmd = generateFfmpegCommand(webvttTracks);
    console.log('FFmpeg Command:\n', cmd);
    // In a real app we'd copy to clipboard or show a modal
  }, [webvttTracks]);

  const handleSaveProject = useCallback(async () => {
    try {
      const buffer = exportProjectZip(webvttTracks);
      const blob = new Blob([buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setErrorMessage('Failed to save project: ' + String(e));
    }
  }, [webvttTracks]);

  const handleExportVtt = useCallback((track: WebVttTrack) => {
    try {
      const vtt = serializeTrackToVTT(track);
      const blob = new Blob([vtt], { type: 'text/vtt' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${track.name.replace(/\s+/g, '_')}.vtt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setErrorMessage('Failed to export VTT: ' + String(e));
    }
  }, []);

  const handleSpeedChange = useCallback((text: string) => {
    const newRate = parseFloat(text.replace(',', '.'));
    if (!newRate || isNaN(newRate) || newRate <= 0) return;
    
    setWebvttTracks(prev => prev.map(t => {
      const cue = t.cues.find(c => c.id === selectedItemId);
      if (cue && typeof cue.payload !== 'string') {
         const oldRate = cue.payload.playbackRate || 1.0;
         const currentDuration = cue.endTime - cue.startTime;
         const newDuration = currentDuration * oldRate / newRate;
         
         return {
           ...t,
           cues: t.cues.map(c => c.id === cue.id ? {
              ...c,
              endTime: c.startTime + newDuration,
              payload: { ...c.payload, playbackRate: newRate }
           } : c)
         };
      }
      return t;
    }));
  }, [selectedItemId]);

  const selectedCueInfo = useMemo(() => {
    for (const track of webvttTracks) {
      const cue = track.cues.find(c => c.id === selectedItemId);
      if (cue) return { track, cue };
    }
    return null;
  }, [webvttTracks, selectedItemId]);

  const sourceTrack = webvttTracks.find(t => t.kind === 'source');
  const activeSourceClip = sourceTrack?.cues.find(cue => currentTime >= cue.startTime && currentTime <= cue.endTime);
  const videoTimeOffset = activeSourceClip ? (activeSourceClip.startTime - ((activeSourceClip.payload as any)?.mediaStart || 0)) : 0;
  
  const currentVideoUri = activeSourceClip ? (activeSourceClip.payload as any).src : undefined;
  const videoSource = useMemo(() => ({ uri: currentVideoUri || null }), [currentVideoUri]);
  
  const currentPlaybackRate = activeSourceClip ? ((activeSourceClip.payload as any).playbackRate || 1.0) : 1.0;
  const isVideoEmpty = !activeSourceClip;

  // When the video clip moves, the playhead stays put, so we must seek 
  // the video to the new relative time to maintain synchronization.
  useEffect(() => {
    const videoTime = currentTimeRef.current - videoTimeOffset;
    // Same fix: avoid seeking if the video has no source (duration=NaN -> crash)
    if (Number.isFinite(videoTime) && videoRef.current && !isVideoEmpty) {
      videoRef.current.seek(videoTime)?.catch?.(() => {});
    }
  }, [videoTimeOffset, isVideoEmpty]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>W3C Video Editor</Text>
      </View>

      {/* Main Player Area */}
      <View style={styles.playerContainer}>
        <Video
          ref={videoRef}
          source={videoSource}
          style={styles.video}
          controls={true}
          paused={isVideoEmpty || isPaused}
          muted={false}
          rate={currentPlaybackRate}
          onLoad={handleVideoLoad}
          onProgress={handleVideoProgress}
          onPlay={() => setIsPaused(false)}
          onPause={() => setIsPaused(true)}
          onPlaybackRateChange={(data: { playbackRate: number }) => {
            setIsPaused(data.playbackRate === 0);
          }}
          resizeMode="contain"
          progressUpdateInterval={250}
        />
        
        {/* Subtitles Overlay */}
        <View style={styles.subtitlesOverlay}>
          {activeSubtitles.map(cue => (
            <Text key={cue.id} style={styles.subtitleText}>{String(cue.payload)}</Text>
          ))}
        </View>

        {/* Metadata/JSX Overlay */}
        <View style={styles.metadataOverlay}>
          {activeOverlays.map(cue => (
            <React.Fragment key={cue.id}>
              {renderJsxString(String(cue.payload))}
            </React.Fragment>
          ))}
        </View>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity style={[styles.btn, { backgroundColor: isPaused ? '#16a34a' : '#dc2626' }]} onPress={() => setIsPaused(!isPaused)}>
          <Text style={styles.btnText}>{isPaused ? '▶ Play' : '⏸ Pause'}</Text>
        </TouchableOpacity>

        {editMode === 'track_edit' ? (
          <>
            <TouchableOpacity style={styles.btn} onPress={() => setEditMode('global')}>
              <Text style={styles.btnText}>← Back</Text>
            </TouchableOpacity>
            {selectedCueInfo?.track.kind === 'source' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 10 }}>
                <Text style={{ color: '#fff', marginRight: 5 }}>Speed:</Text>
                <TextInput
                  style={[styles.btn, { backgroundColor: '#4b5563', paddingVertical: 4, paddingHorizontal: 8, width: 60, color: '#fff', textAlign: 'center' }]}
                  defaultValue={String((selectedCueInfo.cue.payload as any).playbackRate || 1.0)}
                  onEndEditing={(e) => handleSpeedChange(e.nativeEvent.text)}
                  keyboardType="numeric"
                />
              </View>
            )}
            <TouchableOpacity style={styles.btn} onPress={handleSplit} disabled={!selectedItemId}>
              <Text style={styles.btnText}>Split</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={handleDelete} disabled={!selectedItemId}>
              <Text style={styles.btnText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={handleAddCue}>
              <Text style={styles.btnText}>Add Cue</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.btn} onPress={handlePickVideo}>
            <Text style={styles.btnText}>Add Source</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.btn} onPress={handleExportFfmpeg}>
          <Text style={styles.btnText}>FFmpeg</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={handleSaveProject}>
          <Text style={styles.btnText}>Save Zip</Text>
        </TouchableOpacity>
      </View>

      {/* Track Selector in Global Mode */}
      {editMode === 'global' && (
        <ScrollView horizontal style={styles.trackSelector}>
          {webvttTracks.map(track => (
            <View key={track.id} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 15 }}>
              <TouchableOpacity 
                style={styles.trackBtn}
                onPress={() => {
                  if (track.kind === 'source') return;
                  setActiveTrackId(track.id);
                  setEditMode('track_edit');
                }}
              >
                <Text style={styles.trackBtnText}>{track.kind === 'source' ? track.name : `Edit ${track.name}`}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.trackBtn, { backgroundColor: '#1e293b', marginLeft: 4 }]}
                onPress={() => handleExportVtt(track)}
              >
                <Text style={[styles.trackBtnText, { fontSize: 10 }]}>VTT</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Timeline Area */}
      <View style={styles.timelineWrapper}>
        <VideoTimeline
          laneHeight={LANE_HEIGHT}
          maxLanes={editMode === 'global' ? 5 : 2}
          pixelsPerSecond={PIXELS_PER_SECOND}
          framesPerSecond={FRAMES_PER_SECOND}
          items={getTimelineItems()}
          onItemsChange={handleTimelineItemsChange}
          currentTime={currentTime}
          isPaused={isPaused}
          videoRef={videoRef}
          videoTimeOffset={videoTimeOffset}
          onTimeChange={handleTimeChange}
          selectedItemId={selectedItemId}
          onSelectedItemIdChange={setSelectedItemId}
        >
          {getTimelineItems().map((clip) => (
            <DraggableClip
              key={clip.id}
              id={clip.id}
              lane={clip.lane}
              start={clip.start}
              end={clip.end}
              height={clip.height ?? CLIP_HEIGHT}
            >
              <View style={[styles.clipContent, { backgroundColor: clip.kind === 'source' ? '#2563eb' : (clip.kind === 'subtitles' ? '#16a34a' : '#d97706') }]}>
                {clip.kind === 'source' ? (
                  <View style={styles.sourceClip}>
                     <ThumbnailVideo uri={(clip.payload as SourcePayload).src} timeSec={(clip.payload as SourcePayload).mediaStart} />
                     <Text style={styles.clipText}>[Video] {(clip.payload as SourcePayload).src.split('/').pop()}</Text>
                  </View>
                ) : (
                  <Text style={styles.clipText} numberOfLines={1}>{String(clip.payload)}</Text>
                )}
              </View>
            </DraggableClip>
          ))}
        </VideoTimeline>
      </View>

      {errorMessage ? (
        <Text style={styles.error}>{errorMessage}</Text>
      ) : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  topBar: { padding: 16, backgroundColor: '#1e293b' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#f8fafc' },
  playerContainer: { width: '100%', height: 250, backgroundColor: '#000', position: 'relative' },
  video: { width: '100%', height: '100%' },
  subtitlesOverlay: { position: 'absolute', bottom: 20, width: '100%', alignItems: 'center' },
  subtitleText: { color: 'white', backgroundColor: 'rgba(0,0,0,0.6)', padding: 4, fontSize: 18 },
  metadataOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'box-none' as any },
  toolbar: { flexDirection: 'row', padding: 10, gap: 10, backgroundColor: '#1e293b' },
  btn: { backgroundColor: '#3b82f6', padding: 10, borderRadius: 6 },
  btnText: { color: 'white', fontWeight: '600' },
  trackSelector: { padding: 10, maxHeight: 60 },
  trackBtn: { backgroundColor: '#475569', padding: 10, borderRadius: 6, marginRight: 10 },
  trackBtnText: { color: '#f8fafc' },
  timelineWrapper: { flex: 1, padding: 10 },
  clipContent: { flex: 1, borderRadius: 4, padding: 4, justifyContent: 'center' },
  sourceClip: { flex: 1 },
  clipText: { color: '#fff', fontSize: 12 },
  error: { color: '#ef4444', padding: 16 },
});
