export function renderEmptySignatures(
  doc: Document,
  signatures: string[],
  onClose: () => void,
): HTMLElement | null {
  if (signatures.length === 0) return null;

  const root = doc.createElement('div');
  root.className = 'empty-signatures';

  const copy = doc.createElement('div');
  copy.className = 'empty-signature-copy';
  for (const signature of signatures) {
    const line = doc.createElement('p');
    line.className = 'empty-signature-line';
    line.textContent = signature;
    copy.append(line);
  }

  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'empty-signature-close';
  close.textContent = '×';
  close.title = '关闭个性签名';
  close.setAttribute('aria-label', '关闭个性签名');
  close.addEventListener('click', onClose);

  root.append(copy, close);
  return root;
}
