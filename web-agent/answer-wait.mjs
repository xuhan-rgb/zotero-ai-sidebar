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
    answer && signature === input?.previousSignature && !generating
      ? (Number(input?.stablePolls) || 0) + 1
      : 0;
  const shouldComplete = !!(
    answer &&
    !generating &&
    ((!isDeepSeek && nextStable >= 3) ||
      (completionReady && nextStable >= 5) ||
      (inPlace && nextStable >= 5) ||
      nextStable >= 12)
  );
  return { emitProgress, shouldComplete, signature, nextStable, payload };
}
