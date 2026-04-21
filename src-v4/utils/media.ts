// src-v4/utils/media.ts

const SUPPORTED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
const SUPPORTED_DOCUMENT_MIME = ['application/pdf'] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;       // 5 MB
export const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;   // 30 MB

export type ImageMimeType = typeof SUPPORTED_IMAGE_MIME[number];
export type DocumentMimeType = typeof SUPPORTED_DOCUMENT_MIME[number];

export interface ImageContentBlock {
  type: 'image';
  source: { type: 'base64'; media_type: ImageMimeType; data: string };
}

export interface DocumentContentBlock {
  type: 'document';
  source: { type: 'base64'; media_type: DocumentMimeType; data: string };
}

export type MediaContentBlock = ImageContentBlock | DocumentContentBlock;

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = TextContentBlock | MediaContentBlock;

/** Input passed by a gateway to validation — base64 data plus source-reported MIME */
export interface MediaInput {
  /** Base64-encoded media data */
  data: string;
  /** MIME type as reported by the source (Telegram, WhatsApp, etc.) */
  mimetype: string;
  /** Optional filename for documents */
  filename?: string;
}

export type ValidationError =
  | { kind: 'unsupported_type'; mimetype: string }
  | { kind: 'too_large'; sizeBytes: number; limitBytes: number };

function isImageMime(m: string): m is ImageMimeType {
  return (SUPPORTED_IMAGE_MIME as readonly string[]).includes(m);
}

function isDocumentMime(m: string): m is DocumentMimeType {
  return (SUPPORTED_DOCUMENT_MIME as readonly string[]).includes(m);
}

/**
 * Validate a media input and build a ContentBlock ready to pass to Claude.
 */
export function validateAndBuildBlock(input: MediaInput):
  | { ok: true; block: MediaContentBlock }
  | { ok: false; error: ValidationError } {
  const { data, mimetype } = input;

  if (!isImageMime(mimetype) && !isDocumentMime(mimetype)) {
    return { ok: false, error: { kind: 'unsupported_type', mimetype } };
  }

  const sizeBytes = Buffer.from(data, 'base64').length;

  if (isImageMime(mimetype)) {
    if (sizeBytes > MAX_IMAGE_BYTES) {
      return { ok: false, error: { kind: 'too_large', sizeBytes, limitBytes: MAX_IMAGE_BYTES } };
    }
    return {
      ok: true,
      block: {
        type: 'image',
        source: { type: 'base64', media_type: mimetype, data },
      },
    };
  }

  // document
  if (sizeBytes > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: { kind: 'too_large', sizeBytes, limitBytes: MAX_DOCUMENT_BYTES } };
  }
  return {
    ok: true,
    block: {
      type: 'document',
      source: { type: 'base64', media_type: mimetype as DocumentMimeType, data },
    },
  };
}

/**
 * Format a validation error as a user-friendly message (default Indonesian).
 */
export function formatValidationError(error: ValidationError, lang: 'id' | 'en' = 'id'): string {
  if (error.kind === 'unsupported_type') {
    if (lang === 'en') {
      return `Unsupported file type: ${error.mimetype}. Supported: JPEG, PNG, GIF, WebP images and PDF documents.`;
    }
    return `Tipe file tidak didukung: ${error.mimetype}. Format yang didukung: JPEG, PNG, GIF, WebP (gambar) dan PDF (dokumen).`;
  }
  // too_large
  const sizeMB = (error.sizeBytes / (1024 * 1024)).toFixed(1);
  const limitMB = (error.limitBytes / (1024 * 1024)).toFixed(0);
  const isImage = error.limitBytes === MAX_IMAGE_BYTES;
  if (lang === 'en') {
    return `File too large (${sizeMB} MB). Maximum ${limitMB} MB for ${isImage ? 'images' : 'documents'}.`;
  }
  return `File terlalu besar (${sizeMB} MB). Maksimum ${limitMB} MB untuk ${isImage ? 'gambar' : 'dokumen'}.`;
}
