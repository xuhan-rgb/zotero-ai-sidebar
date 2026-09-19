// A page click while picking, on a paper whose material comes from the LaTeX
// source, can never hit anything: that material has no position in the PDF.
// Saying so beats the click doing nothing — the user is otherwise left guessing
// whether they missed the box or the paper has no boxes at all. The bubble
// lives in the reader document, where the click happened, so it carries its own
// inline styling: the plugin's stylesheet does not reach that frame.

const HINT_ID = "zai-material-pick-hint";
const HINT_TEXT = "素材来自 LaTeX 源，PDF 上没有位置；请在列表里选";
const HINT_MS = 1800;

export function flashMaterialPickHint(
  doc: Document,
  clientX: number,
  clientY: number,
): void {
  doc.getElementById(HINT_ID)?.remove();
  const body = doc.body || doc.documentElement;
  if (!body) return;
  const hint = doc.createElement("div");
  hint.id = HINT_ID;
  hint.textContent = HINT_TEXT;
  hint.setAttribute("role", "status");
  hint.style.position = "fixed";
  hint.style.left = `${Math.round(clientX)}px`;
  hint.style.top = `${Math.round(clientY)}px`;
  hint.style.transform = "translate(-50%, calc(-100% - 12px))";
  hint.style.padding = "6px 10px";
  hint.style.borderRadius = "8px";
  hint.style.background = "rgba(45, 41, 37, 0.94)";
  hint.style.color = "#fff";
  hint.style.font = "12px/1.5 system-ui, 'Noto Sans SC', sans-serif";
  hint.style.whiteSpace = "nowrap";
  hint.style.pointerEvents = "none";
  hint.style.zIndex = "2147483647";
  hint.style.boxShadow = "0 6px 18px rgba(0, 0, 0, 0.28)";
  body.append(hint);
  const remove = () => hint.remove();
  const win = doc.defaultView;
  if (win) win.setTimeout(remove, HINT_MS);
  else setTimeout(remove, HINT_MS);
}
