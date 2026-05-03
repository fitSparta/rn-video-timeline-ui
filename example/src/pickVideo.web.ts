/// <reference lib="dom" />

export type PickedVideo = {
  uri: string;
  name: string | null;
  type: string | null;
};

export function pickVideo(): Promise<PickedVideo | null> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('pickVideo (web) requires a DOM environment'));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';

    let settled = false;

    const cleanup = () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const finish = (value: PickedVideo | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    input.addEventListener(
      'change',
      () => {
        const file = input.files && input.files[0];
        if (!file) {
          finish(null);
          return;
        }
        finish({
          uri: URL.createObjectURL(file),
          name: file.name ?? null,
          type: file.type || null,
        });
      },
      { once: true }
    );

    // Modern browsers (Chrome 113+, Safari 16.4+, Firefox 91+) emit `cancel`
    // when the user dismisses the OS file dialog without choosing a file.
    input.addEventListener(
      'cancel',
      () => {
        finish(null);
      },
      { once: true }
    );

    document.body.appendChild(input);
    input.click();
  });
}

export function releasePickedVideo(uri: string): void {
  if (typeof URL !== 'undefined' && uri.startsWith('blob:')) {
    URL.revokeObjectURL(uri);
  }
}
