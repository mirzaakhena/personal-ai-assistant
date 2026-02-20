import type { Message } from 'whatsapp-web.js';
import {
  MAX_MEDIA_SIZE_BYTES,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_DOCUMENT_TYPES,
} from '../core/constants.js';
import { log } from './logger.js';

export type MediaContentBlock =
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        data: string;
      };
    }
  | {
      type: 'document';
      source: {
        type: 'base64';
        media_type: 'application/pdf';
        data: string;
      };
    };

export interface DownloadedMedia {
  data: string;
  mimetype: string;
  filename: string | null;
}

export async function downloadAndValidateMedia(
  message: Message
): Promise<DownloadedMedia | { error: string }> {
  if (!message.hasMedia) {
    return { error: 'Message has no media' };
  }

  try {
    const media = await message.downloadMedia();

    if (!media) {
      return { error: 'Failed to download media.' };
    }

    const { mimetype, data, filename } = media;

    if (
      !SUPPORTED_IMAGE_TYPES.has(mimetype) &&
      !SUPPORTED_DOCUMENT_TYPES.has(mimetype)
    ) {
      return {
        error: `Unsupported file format: ${mimetype}. Supported formats: JPEG, PNG, GIF, WebP images and PDF documents.`,
      };
    }

    const sizeBytes = Buffer.from(data, 'base64').length;
    if (sizeBytes > MAX_MEDIA_SIZE_BYTES) {
      const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
      const limitMB = (MAX_MEDIA_SIZE_BYTES / (1024 * 1024)).toFixed(0);
      return {
        error: `File too large (${sizeMB}MB). Maximum allowed size is ${limitMB}MB.`,
      };
    }

    return { data, mimetype, filename: filename ?? null };
  } catch (err) {
    log.error(`Media download failed: ${err}`);
    return { error: 'Failed to download media. Please try again.' };
  }
}

export function buildMediaContentBlock(
  media: DownloadedMedia
): MediaContentBlock {
  if (SUPPORTED_IMAGE_TYPES.has(media.mimetype)) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: media.mimetype as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: media.data,
      },
    };
  }

  return {
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: media.data,
    },
  };
}
