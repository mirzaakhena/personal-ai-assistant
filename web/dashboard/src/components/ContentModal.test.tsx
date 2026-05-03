import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ContentModal } from './ContentModal.js';

describe('ContentModal', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('does not render when open=false', () => {
    const { queryByRole } = render(
      <ContentModal open={false} onClose={() => {}} variant="text" content="hi" />
    );
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders text content when open', () => {
    const { getByText } = render(
      <ContentModal open onClose={() => {}} variant="text" content="hello world" />
    );
    expect(getByText('hello world')).toBeTruthy();
  });

  it('renders pretty-printed JSON when variant=json', () => {
    const { getByText } = render(
      <ContentModal open onClose={() => {}} variant="json" content={{ a: 1 }} />
    );
    expect(getByText(/"a": 1/)).toBeTruthy();
  });

  it('calls onClose when backdrop clicked', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <ContentModal open onClose={onClose} variant="text" content="x" />
    );
    fireEvent.click(getByTestId('content-modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape pressed', () => {
    const onClose = vi.fn();
    render(<ContentModal open onClose={onClose} variant="text" content="x" />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside the modal body', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <ContentModal open onClose={onClose} variant="text" content="inside" />
    );
    fireEvent.click(getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('copies content to clipboard when Copy is clicked', () => {
    const { getByText } = render(
      <ContentModal open onClose={() => {}} variant="text" content="copyme" />
    );
    fireEvent.click(getByText('Copy'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copyme');
  });
});
