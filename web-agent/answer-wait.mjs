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

export function chatGLMResponseSnapshot(
  chunks,
  _generating,
  answerPhase = false,
  reasoningChunkCount,
) {
  const rawParts = (Array.isArray(chunks) ? chunks : []).map(
    collapseRepeatedChatGLMSnapshot,
  );
  if (Number.isInteger(reasoningChunkCount)) {
    const boundary = Math.max(
      0,
      Math.min(rawParts.length, reasoningChunkCount),
    );
    const reasoningParts = collapseChatGLMNodeCopies(
      rawParts.slice(0, boundary).filter(Boolean),
    );
    const answerParts = collapseChatGLMNodeCopies(
      rawParts.slice(boundary).filter(Boolean),
    );
    return {
      answer: answerParts.join("\n\n"),
      reasoning: reasoningParts.join("\n\n"),
    };
  }
  const parts = collapseChatGLMNodeCopies(rawParts.filter(Boolean));
  if (parts.length === 0) return { answer: "", reasoning: "" };
  if (!answerPhase) {
    return {
      answer: "",
      reasoning: parts.reduce((longest, part) =>
        part.length > longest.length ? part : longest,
      ),
    };
  }
  if (parts.length === 1) {
    return { answer: parts[0], reasoning: "" };
  }
  return {
    answer: parts[parts.length - 1],
    reasoning: parts.slice(0, -1).join("\n\n"),
  };
}

function collapseChatGLMNodeCopies(parts) {
  const collapsed = [];
  for (const part of parts) {
    const duplicateIndex = collapsed.findIndex(
      (candidate) =>
        Math.min(candidate.length, part.length) >= 80 &&
        (candidate.startsWith(part) || part.startsWith(candidate)),
    );
    if (duplicateIndex < 0) {
      collapsed.push(part);
    } else if (part.length > collapsed[duplicateIndex].length) {
      collapsed[duplicateIndex] = part;
    }
  }
  return collapsed;
}

function collapseRepeatedChatGLMSnapshot(value) {
  const text = String(value || "").trim();
  for (const separator of text.matchAll(/\n{2,}/g)) {
    const offset = separator.index;
    if (offset == null) continue;
    const left = text.slice(0, offset).trim();
    const right = text.slice(offset + separator[0].length).trim();
    if (Math.min(left.length, right.length) < 80) continue;
    if (left.startsWith(right)) return left;
    if (right.startsWith(left)) return right;
  }
  return text;
}

export function pageShowsGenerationProgress(host, content) {
  if (host !== "chatglm.cn") return false;
  return String(content || "")
    .split(/\r?\n/)
    .some((line) =>
      /^(?:搜索中(?:\.{3}|…)?|正在查询(?:\s+.+)?|思考中(?:\.{3}|…)?|正在思考(?:\.{3}|…)?|停止对话|searching(?:\.{3}|…)?|thinking(?:\.{3}|…)?)$/i.test(
        line.trim(),
      ),
    );
}

export function pageShowsChatGLMAnswerPhase(host, content, baseline = "") {
  if (host !== "chatglm.cn") return false;
  const text = String(content || "");
  const baselineText = String(baseline || "");
  if (
    text.split("思考结束").length <= baselineText.split("思考结束").length
  ) {
    return false;
  }
  const answerIndex = text.lastIndexOf("思考结束");
  const activeIndex = Math.max(
    text.lastIndexOf("思考中"),
    text.lastIndexOf("正在思考"),
    text.lastIndexOf("搜索中"),
    text.lastIndexOf("正在查询"),
    text.lastIndexOf("停止对话"),
  );
  return answerIndex >= 0 && answerIndex > activeIndex;
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
  const isChatGLM = input?.host === "chatglm.cn";
  const emitProgress =
    !!(answer || reasoning) && signature !== input?.previousSignature;
  const nextStable =
    answer && signature === input?.previousSignature
      ? (Number(input?.stablePolls) || 0) + 1
      : 0;
  // ChatGLM renders its copy/share actions before the answer stream ends and
  // its current stop control has no stable accessible label. Keep polling at
  // the existing 100/350 ms cadence, but require roughly 2.5 seconds without
  // visible answer growth before treating those early controls as completion.
  const chatGLMStablePolls = completionReady ? 25 : 8;
  const shouldComplete = !!(
    answer &&
    (isChatGLM
      ? !generating && nextStable >= chatGLMStablePolls
      : (completionReady && nextStable >= (generating ? 3 : 2)) ||
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
  if (input?.normalAnswerObserved || input?.pageGenerating || !content) {
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
    /上传中|解析中|处理中|正在阅读|生成中|思考中|搜索中|正在查询|停止对话|uploading|processing|reading|generating|thinking|searching/.test(
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
