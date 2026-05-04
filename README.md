# rn-video-timeline-ui

React Native video timeline UI components with gesture-driven interactions.
Works on iOS, Android and Web (via `react-native-web`).

## Demo

[Live web example](https://html-preview.github.io/?url=https://github.com/fitSparta/rn-video-timeline-ui/blob/initial/example/dist/index.html)

## Installation

```sh
npm install https://github.com/fitSparta/rn-video-timeline-ui/tarball/release/latest/
```

### Peer dependencies

This library relies on Reanimated and Gesture Handler. Install them in your app:

```sh
npm install react-native-reanimated react-native-gesture-handler react-native-worklets
```

For web support also install:

```sh
npm install react-native-web
```

Follow the official setup guides:

- [react-native-reanimated](https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started)
- [react-native-gesture-handler](https://docs.swmansion.com/react-native-gesture-handler/docs/installation)

## Usage

Wrap your app with `GestureHandlerRootView` and use the provided components:

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DraggableBox, VideoTimeline } from 'rn-video-timeline-ui';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DraggableBox size={120} color="tomato" />
      <VideoTimeline />
    </GestureHandlerRootView>
  );
}
```

## API

### `DraggableBox`

Draggable square powered by Reanimated shared values and a pan gesture.

| Prop       | Type        | Default  | Description                          |
| ---------- | ----------- | -------- | ------------------------------------ |
| `size`     | `number`    | `100`    | Box width and height in pixels       |
| `color`    | `string`    | `'blue'` | Background color (ignored if `children` provided) |
| `children` | `ReactNode` | —        | Optional content rendered inside     |

### `VideoTimeline`

Container component that currently renders a default `DraggableBox`.
Intended as the entry point for a full timeline UI.

### `multiply(a, b)`

Utility helper that returns `a * b`. Useful for verifying the native link.

## Running the example

```sh
git clone https://github.com/fitSparta/rn-video-timeline-ui.git
cd rn-video-timeline-ui
npm install
npm run prepare

# iOS / Android
npm --prefix example install
npm --prefix example run android
npm --prefix example run ios

# Web
npm --prefix example run web          # dev server on http://localhost:8080
npm --prefix example run build:web    # production build into example/dist
```

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
