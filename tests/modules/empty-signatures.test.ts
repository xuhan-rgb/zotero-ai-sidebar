import { describe, expect, it, vi } from 'vitest';
import { renderEmptySignatures } from '../../src/modules/empty-signatures';

describe('empty conversation signatures', () => {
  it('renders non-empty signatures in configured order as plain text', () => {
    const node = renderEmptySignatures(
      document,
      [
        'Why am I reading this paper?',
        '<strong>Think for yourself.</strong>',
      ],
      () => {},
    );

    expect(node).not.toBeNull();
    expect(
      [...node!.querySelectorAll('.empty-signature-line')].map(
        (line) => line.textContent,
      ),
    ).toEqual([
      'Why am I reading this paper?',
      '<strong>Think for yourself.</strong>',
    ]);
    expect(node!.querySelector('strong')).toBeNull();
  });

  it('does not create an empty signature block', () => {
    expect(renderEmptySignatures(document, [], () => {})).toBeNull();
  });

  it('closes through the accessible dismiss button', () => {
    const onClose = vi.fn();
    const node = renderEmptySignatures(document, ['Keep the question.'], onClose)!;
    const close = node.querySelector<HTMLButtonElement>(
      '.empty-signature-close',
    )!;

    expect(close.getAttribute('aria-label')).toBe('关闭个性签名');
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
