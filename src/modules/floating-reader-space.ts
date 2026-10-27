export interface ReaderRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GAP = 8;

function edges(rect: ReaderRect): Edges {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
}

function validRect(rect: ReaderRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function overlaps(a: Edges, b: Edges): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

function largestFree(
  bounds: Edges,
  obstacles: Edges[],
  minWidth: number,
  minHeight: number,
  preferredSide: "left" | "right",
  answer: Edges | null,
  requireMinimums: boolean,
): ReaderRect | null {
  const xs = new Set([bounds.left, bounds.right]);
  const ys = new Set([bounds.top, bounds.bottom]);
  for (const obstacle of obstacles) {
    xs.add(Math.max(bounds.left, Math.min(bounds.right, obstacle.left)));
    xs.add(Math.max(bounds.left, Math.min(bounds.right, obstacle.right)));
    ys.add(Math.max(bounds.top, Math.min(bounds.bottom, obstacle.top)));
    ys.add(Math.max(bounds.top, Math.min(bounds.bottom, obstacle.bottom)));
  }
  const xList = [...xs].sort((a, b) => a - b);
  const yList = [...ys].sort((a, b) => a - b);
  let best: ReaderRect | null = null;
  let bestArea = 0;
  let bestPreferred = false;

  for (let leftIndex = 0; leftIndex < xList.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < xList.length;
      rightIndex++
    ) {
      const left = xList[leftIndex]!;
      const right = xList[rightIndex]!;
      const width = right - left;
      if (width <= 0 || (requireMinimums && width < minWidth)) continue;
      for (let topIndex = 0; topIndex < yList.length; topIndex++) {
        for (
          let bottomIndex = topIndex + 1;
          bottomIndex < yList.length;
          bottomIndex++
        ) {
          const top = yList[topIndex]!;
          const bottom = yList[bottomIndex]!;
          const height = bottom - top;
          if (height <= 0 || (requireMinimums && height < minHeight)) continue;
          const candidateEdges = { left, top, right, bottom };
          if (obstacles.some((obstacle) => overlaps(candidateEdges, obstacle)))
            continue;
          const area = width * height;
          const candidatePreferred = answer
            ? preferredSide === "left"
              ? right <= answer.left
              : left >= answer.right
            : preferredSide === "left"
              ? left <= (bounds.left + bounds.right) / 2
              : right >= (bounds.left + bounds.right) / 2;
          const betterTie =
            area === bestArea &&
            (candidatePreferred !== bestPreferred
              ? candidatePreferred
              : top < (best?.top ?? Infinity) ||
                (top === best?.top &&
                  (preferredSide === "left"
                    ? left < (best?.left ?? Infinity)
                    : right > (best ? best.left + best.width : -Infinity))));
          if (area > bestArea || betterTie) {
            best = { left, top, width, height };
            bestArea = area;
            bestPreferred = candidatePreferred;
          }
        }
      }
    }
  }
  return best;
}

export function findFloatingReaderSpace(
  viewport: ReaderRect,
  answer: ReaderRect | null,
  composer: ReaderRect | null,
  preferredSide: "left" | "right",
): ReaderRect | null {
  if (!validRect(viewport)) return null;
  const viewportEdges = edges(viewport);
  const minWidth = Math.min(240, viewport.width);
  const minHeight = Math.min(160, viewport.height);
  const obstacles = [answer, composer]
    .filter((rect): rect is ReaderRect => !!rect && validRect(rect))
    .map((rect) => {
      const raw = edges(rect);
      return {
        left: Math.max(viewportEdges.left, raw.left - GAP),
        top: Math.max(viewportEdges.top, raw.top - GAP),
        right: Math.min(viewportEdges.right, raw.right + GAP),
        bottom: Math.min(viewportEdges.bottom, raw.bottom + GAP),
      };
    })
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);

  let answerEdges: Edges | null = null;
  if (answer && validRect(answer)) {
    const raw = edges(answer);
    const expanded = {
      left: Math.max(viewportEdges.left, raw.left - GAP),
      top: Math.max(viewportEdges.top, raw.top - GAP),
      right: Math.min(viewportEdges.right, raw.right + GAP),
      bottom: Math.min(viewportEdges.bottom, raw.bottom + GAP),
    };
    if (expanded.right > expanded.left && expanded.bottom > expanded.top)
      answerEdges = expanded;
  }

  if (answerEdges) {
    const side =
      preferredSide === "left"
        ? { ...viewportEdges, right: answerEdges.left }
        : { ...viewportEdges, left: answerEdges.right };
    if (
      side.right - side.left >= minWidth &&
      side.bottom - side.top >= minHeight
    ) {
      const sideObstacles = obstacles.filter((obstacle) =>
        overlaps(side, obstacle),
      );
      const preferred = largestFree(
        side,
        sideObstacles,
        minWidth,
        minHeight,
        preferredSide,
        answerEdges,
        true,
      );
      if (preferred) return preferred;
    }
  }

  const viewportMinimum = largestFree(
    viewportEdges,
    obstacles,
    minWidth,
    minHeight,
    preferredSide,
    answerEdges,
    true,
  );
  return (
    viewportMinimum ??
    largestFree(
      viewportEdges,
      obstacles,
      minWidth,
      minHeight,
      preferredSide,
      answerEdges,
      false,
    )
  );
}
