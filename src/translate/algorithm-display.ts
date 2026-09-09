// Algorithm fragments share their open scopes across paragraph boundaries.
// Callers protect math before parsing, so math braces and commands stay intact.
export interface AlgorithmDisplayState {
  depth: number;
}

export function hasAlgorithmSyntax(text: string): boolean {
  return /\\(?:begin\{algorithm\*?\}|KwIn\b|KwOut\b|For\b|ForEach\b|While\b|If\b|Else\b|tcc\b|tcp\b|对于|如果|否则)/.test(
    text,
  );
}

export function normalizeAlgorithmDisplay(
  text: string,
  state: AlgorithmDisplayState = { depth: 0 },
  language: "source" | "translation" = "translation",
): string {
  if (!state.depth && !hasAlgorithmSyntax(text)) return text;
  text = text
    .replace(/\\对于(?=\s*\{)/g, "\\For")
    .replace(/\\如果(?=\s*\{)/g, "\\If")
    .replace(/\\否则(?=\s*\{)/g, "\\Else")
    .replace(/\\(?:begin|end)\{algorithm\*?\}(?:\[[^\]\n]*\])?/g, "\n")
    .replace(
      /\\(?:SetAlgoLined|DontPrintSemicolon|SetNoFillComment|footnotesize|BlankLine)\b/g,
      "",
    )
    .replace(/\\[;；]/g, "\n");
  const labels: Record<string, [string, string]> = {
    KwIn: ["Input", "输入"],
    KwOut: ["Output", "输出"],
    KwData: ["Data", "数据"],
    KwResult: ["Result", "结果"],
    For: ["For", "遍历"],
    ForEach: ["For each", "遍历"],
    While: ["While", "当"],
    If: ["If", "如果"],
    ElseIf: ["Else if", "否则如果"],
    Else: ["Else", "否则"],
    tcc: ["Comment", "注释"],
    tcp: ["Comment", "注释"],
    Return: ["Return", "返回"],
    caption: ["Algorithm", "算法"],
    algorithmfootnote: ["Note", "说明"],
  };
  const lines: string[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer.trim()) lines.push("  ".repeat(state.depth) + buffer.trim());
    buffer = "";
  };
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\n") {
      flush();
      i++;
      continue;
    }
    if (text[i] === "}" && state.depth) {
      flush();
      state.depth--;
      i++;
      continue;
    }
    const command = text
      .slice(i)
      .match(/^\\([A-Za-z]+)\b\*?\s*(?:\[[^\]\n]*\])?\s*/);
    if (!command) {
      buffer += text[i++];
      continue;
    }
    const name = command[1];
    const start = i + command[0].length;
    const first = bracedBody(text, start);
    const label = labels[name]?.[language === "source" ? 0 : 1];
    if (name === "Else" && text[start] === "{") {
      flush();
      buffer = `**${label}：**`;
      flush();
      state.depth++;
      i = start + 1;
      continue;
    }
    if (!label || !first) {
      // Preserve unsupported commands rather than destroying their arguments.
      const end = first?.end ?? start;
      buffer += text.slice(i, end);
      i = end;
      continue;
    }
    if (["For", "ForEach", "While", "If", "ElseIf"].includes(name)) {
      let bodyStart = first.end;
      while (/\s/.test(text[bodyStart] ?? "")) bodyStart++;
      if (text[bodyStart] !== "{") {
        buffer += text.slice(i, first.end);
        i = first.end;
        continue;
      }
      flush();
      buffer = `**${label}：** ${first.body.trim()}`;
      flush();
      state.depth++;
      i = bodyStart + 1;
    } else {
      flush();
      buffer =
        name === "tcc"
          ? `/* ${first.body.trim()} */`
          : name === "tcp"
            ? `// ${first.body.trim()}`
            : `**${label}：** ${first.body.trim()}`;
      flush();
      i = first.end;
    }
  }
  flush();
  return lines.join("\n");
}

function bracedBody(
  text: string,
  start: number,
): { body: string; end: number } | null {
  while (/\s/.test(text[start] ?? "")) start++;
  if (text[start] !== "{") return null;
  let depth = 1;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0)
      return { body: text.slice(start + 1, i), end: i + 1 };
  }
  return null;
}
