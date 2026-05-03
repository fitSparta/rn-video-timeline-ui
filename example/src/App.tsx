import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Video from 'react-native-video';
import { DraggableBox } from 'rn-video-timeline-ui';
import { pickVideo, releasePickedVideo } from './pickVideo';

const DEFAULT_VIDEO_URL =
  'https://download.blender.org/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4';

const BOX_SIZE = 240;

export default function App() {
  const [videoUri, setVideoUri] = useState<string>(DEFAULT_VIDEO_URL);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const releasableUriRef = useRef<string | null>(null);

  // Release the previously picked resource when this component unmounts.
  useEffect(() => {
    return () => {
      if (releasableUriRef.current) {
        releasePickedVideo(releasableUriRef.current);
        releasableUriRef.current = null;
      }
    };
  }, []);

  const handlePickVideo = useCallback(async () => {
    try {
      setErrorMessage(null);
      const picked = await pickVideo();
      if (!picked) {
        return;
      }

      if (releasableUriRef.current) {
        releasePickedVideo(releasableUriRef.current);
      }
      releasableUriRef.current = picked.uri;

      setVideoUri(picked.uri);
    } catch (err) {
      console.warn('Failed to pick video', err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <Text style={styles.title}>Video Timeline UI</Text>
      <Text style={styles.hint}>Swipe the box to drag the video.</Text>

      <DraggableBox size={BOX_SIZE}>
        <View style={styles.videoWrapper}>
          <Video
            key={videoUri}
            source={{ uri: videoUri }}
            style={styles.video}
            controls
            muted
            paused={false}
            repeat
            resizeMode="cover"
          />
        </View>
      </DraggableBox>

      <TouchableOpacity
        accessibilityRole="button"
        style={styles.button}
        onPress={handlePickVideo}
      >
        <Text style={styles.buttonText}>Select video</Text>
      </TouchableOpacity>

      {errorMessage ? (
        <Text style={styles.error}>{errorMessage}</Text>
      ) : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#111',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  hint: {
    color: '#aaa',
    marginBottom: 24,
  },
  videoWrapper: {
    flex: 1,
    backgroundColor: '#000',
  },
  video: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  button: {
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    marginTop: 16,
    color: '#f87171',
    textAlign: 'center',
  },
});
