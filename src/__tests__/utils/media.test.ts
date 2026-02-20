import { describe, expect, it, vi } from 'vitest';
import { downloadAndValidateMedia, buildMediaContentBlock } from '../../utils/media.js';
import type { DownloadedMedia } from '../../utils/media.js';

function createMockMessage(overrides: {
  hasMedia?: boolean;
  mimetype?: string;
  data?: string;
  filename?: string;
  downloadFails?: boolean;
  downloadReturnsNull?: boolean;
} = {}) {
  const {
    hasMedia = true,
    mimetype = 'image/jpeg',
    data = Buffer.from('fake-image-data').toString('base64'),
    filename = 'photo.jpg',
    downloadFails = false,
    downloadReturnsNull = false,
  } = overrides;

  return {
    hasMedia,
    downloadMedia: downloadFails
      ? vi.fn().mockRejectedValue(new Error('download error'))
      : vi.fn().mockResolvedValue(
          downloadReturnsNull ? null : { mimetype, data, filename }
        ),
  } as any;
}

describe('downloadAndValidateMedia', () => {
  it('returns error when message has no media', async () => {
    const msg = createMockMessage({ hasMedia: false });
    const result = await downloadAndValidateMedia(msg);
    expect(result).toEqual({ error: 'Message has no media' });
  });

  it('returns downloaded media for supported image type', async () => {
    const msg = createMockMessage({ mimetype: 'image/png', data: 'aGVsbG8=', filename: 'img.png' });
    const result = await downloadAndValidateMedia(msg);
    expect(result).toEqual({ data: 'aGVsbG8=', mimetype: 'image/png', filename: 'img.png' });
  });

  it('returns downloaded media for PDF', async () => {
    const msg = createMockMessage({ mimetype: 'application/pdf', data: 'cGRm', filename: 'doc.pdf' });
    const result = await downloadAndValidateMedia(msg);
    expect(result).toEqual({ data: 'cGRm', mimetype: 'application/pdf', filename: 'doc.pdf' });
  });

  it('returns error for unsupported mimetype', async () => {
    const msg = createMockMessage({ mimetype: 'video/mp4' });
    const result = await downloadAndValidateMedia(msg);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('Unsupported file format');
  });

  it('returns error when file exceeds size limit', async () => {
    // Create data larger than 20MB
    const largeData = Buffer.alloc(21 * 1024 * 1024).toString('base64');
    const msg = createMockMessage({ data: largeData });
    const result = await downloadAndValidateMedia(msg);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('too large');
  });

  it('returns error when download fails', async () => {
    const msg = createMockMessage({ downloadFails: true });
    const result = await downloadAndValidateMedia(msg);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('Failed to download');
  });

  it('returns error when download returns null', async () => {
    const msg = createMockMessage({ downloadReturnsNull: true });
    const result = await downloadAndValidateMedia(msg);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('Failed to download');
  });

  it('sets filename to null when not provided', async () => {
    const msg = {
      hasMedia: true,
      downloadMedia: vi.fn().mockResolvedValue({
        mimetype: 'image/jpeg',
        data: 'aGVsbG8=',
        filename: undefined,
      }),
    } as any;
    const result = await downloadAndValidateMedia(msg);
    expect(result).toEqual({ data: 'aGVsbG8=', mimetype: 'image/jpeg', filename: null });
  });
});

describe('buildMediaContentBlock', () => {
  it('returns image block for image mimetype', () => {
    const media: DownloadedMedia = { data: 'abc', mimetype: 'image/png', filename: 'img.png' };
    const block = buildMediaContentBlock(media);
    expect(block).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc' },
    });
  });

  it('returns document block for PDF mimetype', () => {
    const media: DownloadedMedia = { data: 'xyz', mimetype: 'application/pdf', filename: 'doc.pdf' };
    const block = buildMediaContentBlock(media);
    expect(block).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'xyz' },
    });
  });

  it('handles all supported image types', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      const media: DownloadedMedia = { data: 'test', mimetype: mime, filename: null };
      const block = buildMediaContentBlock(media);
      expect(block.type).toBe('image');
    }
  });
});
