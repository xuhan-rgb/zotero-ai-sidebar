export function answerNodeRange(previousCount, currentCount) {
  const previous = Math.max(0, Number(previousCount) || 0);
  const current = Math.max(0, Number(currentCount) || 0);
  if (current > previous) {
    return { start: previous, end: current, inPlace: false };
  }
  if (current > 0) {
    return { start: current - 1, end: current, inPlace: true };
  }
  return { start: 0, end: 0, inPlace: false };
}

export function inPlaceStillBaseline(inPlace, result, baseline) {
  if (!inPlace) return false;
  const answer = String(result?.answer || "").trim();
  const reasoning = String(result?.reasoning || "").trim();
  if (!answer && !reasoning) return true;
  return (
    answer === String(baseline?.answer || "").trim() &&
    reasoning === String(baseline?.reasoning || "").trim()
  );
}

export function nextAnswerWaitState(input) {
  const answer = String(input?.result?.answer || "").trim();
  const reasoning = String(input?.result?.reasoning || "").trim();
  const payload = { answer, reasoning };
  const signature = JSON.stringify(payload);
  const generating = !!input?.generating;
  const completionReady = !!input?.completionReady;
  const inPlace = !!input?.inPlace;
  const isDeepSeek = input?.host === "chat.deepseek.com";
  const emitProgress =
    !!(answer || reasoning) && signature !== input?.previousSignature;
  const nextStable =
    answer && signature === input?.previousSignature
      ? (Number(input?.stablePolls) || 0) + 1
      : 0;
  const shouldComplete = !!(
    answer &&
    ((completionReady && nextStable >= (generating ? 3 : 2)) ||
      (!generating &&
        ((!isDeepSeek && nextStable >= 3) ||
          (inPlace && nextStable >= 5) ||
          nextStable >= 12)))
  );
  return { emitProgress, shouldComplete, signature, nextStable, payload };
}

export function nextAnswerPollDelay(input) {
  if (input?.completionReady) return 100;
  return input?.generating ? 150 : 350;
}

export function isRecoverablePageReadError(value) {
  const message = String(value?.message || value || "").toLowerCase();
  return /execution context was destroyed|frame was detached|navigation (?:was )?interrupted/.test(
    message,
  );
}

export function visiblePageTextDelta(baseline, current, exclusions = []) {
  const baselineLines = new Set(textLines(baseline).map(normalizeLine));
  const exclusionLines = textLines(exclusions.join("\n")).map(normalizeLine);
  const seen = new Set();
  const result = [];
  let length = 0;
  for (const line of textLines(current)) {
    const normalized = normalizeLine(line);
    if (!normalized || baselineLines.has(normalized) || seen.has(normalized)) {
      continue;
    }
    if (
      exclusionLines.some(
        (excluded) =>
          excluded === normalized ||
          excluded.includes(normalized) ||
          normalized.includes(excluded),
      )
    ) {
      continue;
    }
    if (length + line.length > 6_000) break;
    seen.add(normalized);
    result.push(line);
    length += line.length + 1;
  }
  return result.join("\n");
}

export function nextPageNoticeWaitState(input) {
  const content = String(input?.content || "").trim();
  const signature = content;
  if (input?.normalAnswerObserved || !content) {
    return { shouldComplete: false, signature, nextStable: 0 };
  }
  // DeepSeek exposes upload/reading progress in the page body before an
  // assistant node exists. It must not be mirrored as a finished answer.
  if (isTransientPageNotice(content)) {
    return { shouldComplete: false, signature, nextStable: 0 };
  }
  const nextStable =
    input?.pageReady && signature === input?.previousSignature
      ? (Number(input?.stablePolls) || 0) + 1
      : 0;
  return {
    shouldComplete: nextStable >= 6,
    signature,
    nextStable,
  };
}

function isTransientPageNotice(content) {
  const text = String(content).toLowerCase();
  const failure =
    /失败|错误|出错|不支持|额度|频繁|error|failed|unsupported|quota|rate limit|too many requests|server unavailable|login required|sign in/.test(
      text,
    );
  return (
    !failure &&
    /上传中|解析中|处理中|正在阅读|生成中|思考中|uploading|processing|reading|generating|thinking/.test(
      text,
    )
  );
}

function textLines(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}
