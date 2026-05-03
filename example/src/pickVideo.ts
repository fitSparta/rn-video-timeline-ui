import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';

export type PickedVideo = {
  uri: string;
  name: string | null;
  type: string | null;
};

export async function pickVideo(): Promise<PickedVideo | null> {
  try {
    const [result] = await pick({
      type: [types.video],
      allowMultiSelection: false,
    });

    if (!result) {
      return null;
    }

    return {
      uri: result.uri,
      name: result.name,
      type: result.type,
    };
  } catch (err) {
    if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
      return null;
    }
    throw err;
  }
}

// No-op on native; the web counterpart revokes the underlying object URL.
export function releasePickedVideo(_uri: string): void {
  // Nothing to release on native platforms.
}
