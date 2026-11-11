/**
 * dataset-parser.ts
 *
 * Client-Side Dataset Validator and Previewer.
 * Universal ingestion supporting:
 * - .jsonl (Alpaca, OpenAI messages, ShareGPT conversations, DPO, prompt/completion)
 * - .json (Array of records or nested { data: [...] })
 * - .csv (Auto-detected instruction/response columns)
 * - .txt and .md (Sliding window paragraph chunking)
 *
 * Provides token estimation (~3.8 chars/token) and table preview for Training Studio.
 */

export interface TrainingSample {
  id: number;
  instruction: string;
  input?: string;
  response: string;
  system?: string;
  sourceFormat: string;
  estimatedTokens: number;
}

export interface DatasetParseResult {
  valid: boolean;
  totalRecords: number;
  estimatedTotalTokens: number;
  sampleRecords: TrainingSample[];
  records: TrainingSample[];
  formatDetected: string;
  fileSizeBytes: number;
  errors: string[];
  warnings: string[];
}

/**
 * Heuristic token counter (~3.8 chars per token for English & code).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 3.8));
}

/**
 * Parse and validate a dataset File object in the browser.
 */
export async function parseDatasetFile(file: File, maxPreviewSamples = 20): Promise<DatasetParseResult> {
  const text = await file.text();
  return parseDatasetContent(text, file.name, file.size, maxPreviewSamples);
}

/**
 * Parse raw text content with filename and size metadata.
 */
export function parseDatasetContent(
  rawContent: string,
  filename: string,
  fileSizeBytes: number = rawContent.length,
  maxPreviewSamples = 20
): DatasetParseResult {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const errors: string[] = [];
  const warnings: string[] = [];

  let records: TrainingSample[] = [];
  let formatDetected = "unknown";

  try {
    if (ext === "jsonl") {
      formatDetected = "JSON Lines (.jsonl)";
      records = parseJsonLines(rawContent, errors, warnings);
    } else if (ext === "json") {
      formatDetected = "Structured JSON (.json)";
      records = parseJsonDocument(rawContent, errors, warnings);
    } else if (ext === "csv" || ext === "tsv") {
      formatDetected = ext === "tsv" ? "Tab-Separated Values (.tsv)" : "Comma-Separated Values (.csv)";
      records = parseCsv(rawContent, ext === "tsv" ? "\t" : ",", errors, warnings);
    } else if (ext === "txt" || ext === "md" || ext === "markdown") {
      formatDetected = ext === "txt" ? "Raw Text (.txt)" : "Markdown (.md)";
      records = parseTextOrMarkdown(rawContent);
    } else {
      // Auto-detect by content sniffing
      const trimmed = rawContent.trim();
      if (trimmed.startsWith("{") && trimmed.includes("\n{")) {
        formatDetected = "Detected JSON Lines";
        records = parseJsonLines(rawContent, errors, warnings);
      } else if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        formatDetected = "Detected JSON Document";
        records = parseJsonDocument(rawContent, errors, warnings);
      } else if (trimmed.includes(",") && trimmed.split("\n")[0].includes(",")) {
        formatDetected = "Detected CSV";
        records = parseCsv(rawContent, ",", errors, warnings);
      } else {
        formatDetected = "Detected Freeform Text";
        records = parseTextOrMarkdown(rawContent);
      }
    }
  } catch (err: any) {
    errors.push(`Parsing failed: ${err.message || String(err)}`);
  }

  const valid = records.length > 0 && errors.length === 0;
  const totalRecords = records.length;
  const estimatedTotalTokens = records.reduce((acc, r) => acc + r.estimatedTokens, 0);
  const sampleRecords = records.slice(0, maxPreviewSamples);

  if (totalRecords === 0 && errors.length === 0) {
    errors.push("No valid training samples found in dataset file.");
  }

  return {
    valid,
    totalRecords,
    estimatedTotalTokens,
    sampleRecords,
    records,
    formatDetected,
    fileSizeBytes,
    errors,
    warnings,
  };
}

// ==============================================================================
// Format Parsers
// ==============================================================================

function normalizeSampleRecord(item: any, index: number): TrainingSample | null {
  if (!item || typeof item !== "object") return null;

  // 1. OpenAI Chat Format: { messages: [{role, content}, ...] }
  if (Array.isArray(item.messages)) {
    let system = "";
    let instruction = "";
    let response = "";

    for (const msg of item.messages) {
      if (msg.role === "system") {
        system = (msg.content || "").trim();
      } else if (msg.role === "user") {
        instruction += (instruction ? "\n" : "") + (msg.content || "").trim();
      } else if (msg.role === "assistant") {
        response += (response ? "\n" : "") + (msg.content || "").trim();
      }
    }

    if (instruction && response) {
      const combined = `${system} ${instruction} ${response}`;
      return {
        id: index + 1,
        instruction,
        response,
        system: system || undefined,
        sourceFormat: "chat_messages",
        estimatedTokens: estimateTokens(combined),
      };
    }
  }

  // 2. ShareGPT Format: { conversations: [{from, value}, ...] }
  if (Array.isArray(item.conversations)) {
    let system = "";
    let instruction = "";
    let response = "";

    for (const turn of item.conversations) {
      const role = (turn.from || turn.role || "").toLowerCase();
      const text = (turn.value || turn.content || "").trim();
      if (role === "system") system = text;
      else if (role === "human" || role === "user") instruction += (instruction ? "\n" : "") + text;
      else if (role === "gpt" || role === "chatgpt" || role === "assistant") response += (response ? "\n" : "") + text;
    }

    if (instruction && response) {
      const combined = `${system} ${instruction} ${response}`;
      return {
        id: index + 1,
        instruction,
        response,
        system: system || undefined,
        sourceFormat: "sharegpt",
        estimatedTokens: estimateTokens(combined),
      };
    }
  }

  // 3. Alpaca Format: { instruction, input, output }
  if ("instruction" in item && "output" in item) {
    const instruction = String(item.instruction || "").trim();
    const input = item.input ? String(item.input).trim() : undefined;
    const response = String(item.output || "").trim();

    if (instruction && response) {
      const combined = `${instruction} ${input || ""} ${response}`;
      return {
        id: index + 1,
        instruction,
        input,
        response,
        sourceFormat: "alpaca",
        estimatedTokens: estimateTokens(combined),
      };
    }
  }

  // 4. Prompt / Completion Format: { prompt, completion }
  if ("prompt" in item && "completion" in item) {
    const instruction = String(item.prompt || "").trim();
    const response = String(item.completion || "").trim();

    if (instruction && response) {
      const combined = `${instruction} ${response}`;
      return {
        id: index + 1,
        instruction,
        response,
        sourceFormat: "prompt_completion",
        estimatedTokens: estimateTokens(combined),
      };
    }
  }

  // 5. DPO Format: { prompt, chosen, rejected }
  if ("prompt" in item && "chosen" in item) {
    const instruction = String(item.prompt || "").trim();
    const response = String(item.chosen || "").trim();

    if (instruction && response) {
      const combined = `${instruction} ${response}`;
      return {
        id: index + 1,
        instruction,
        response,
        sourceFormat: "dpo_chosen",
        estimatedTokens: estimateTokens(combined),
      };
    }
  }

  // 6. Generic Text Field: { text }
  if (item.text && typeof item.text === "string") {
    const text = item.text.trim();
    if (text.length > 20) {
      return {
        id: index + 1,
        instruction: "Complete the text below:",
        input: text.slice(0, Math.floor(text.length / 2)),
        response: text.slice(Math.floor(text.length / 2)),
        sourceFormat: "causal_text",
        estimatedTokens: estimateTokens(text),
      };
    }
  }

  return null;
}

function parseJsonLines(content: string, errors: string[], warnings: string[]): TrainingSample[] {
  const lines = content.split(/\r?\n/);
  const records: TrainingSample[] = [];
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line);
      const normalized = normalizeSampleRecord(parsed, records.length);
      if (normalized) {
        records.push(normalized);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
      if (errors.length < 5) {
        errors.push(`Line ${i + 1}: Malformed JSON string`);
      }
    }
  }

  if (skipped > 0 && records.length > 0) {
    warnings.push(`Skipped ${skipped} lines that did not match recognized training schemas.`);
  }

  return records;
}

function parseJsonDocument(content: string, errors: string[], warnings: string[]): TrainingSample[] {
  const parsed = JSON.parse(content);
  let array: any[] = [];

  if (Array.isArray(parsed)) {
    array = parsed;
  } else if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.data)) array = parsed.data;
    else if (Array.isArray(parsed.records)) array = parsed.records;
    else if (Array.isArray(parsed.rows)) array = parsed.rows;
    else if (Array.isArray(parsed.samples)) array = parsed.samples;
    else {
      errors.push("JSON root object does not contain an array of training records (e.g. 'data', 'records').");
      return [];
    }
  }

  const records: TrainingSample[] = [];
  let skipped = 0;

  for (let i = 0; i < array.length; i++) {
    const normalized = normalizeSampleRecord(array[i], records.length);
    if (normalized) {
      records.push(normalized);
    } else {
      skipped++;
    }
  }

  if (skipped > 0 && records.length > 0) {
    warnings.push(`Skipped ${skipped} records that did not match recognized schemas.`);
  }

  return records;
}

function parseCsv(content: string, delimiter: string, errors: string[], warnings: string[]): TrainingSample[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    errors.push("CSV file must have a header line and at least one data row.");
    return [];
  }

  const headers = splitCsvLine(lines[0], delimiter).map((h) => h.toLowerCase().trim().replace(/['"]/g, ""));

  // Detect column mapping
  let instIdx = headers.findIndex((h) => ["instruction", "prompt", "question", "input_text", "query"].includes(h));
  let respIdx = headers.findIndex((h) => ["response", "output", "completion", "answer", "target", "target_text"].includes(h));
  let inputIdx = headers.findIndex((h) => ["input", "context", "document"].includes(h));

  // Fallbacks if header names don't match exactly
  if (instIdx === -1 && headers.length >= 2) instIdx = 0;
  if (respIdx === -1 && headers.length >= 2) respIdx = 1;

  if (instIdx === -1 || respIdx === -1) {
    errors.push(`Could not detect instruction/response columns in CSV headers: [${headers.join(", ")}]`);
    return [];
  }

  const records: TrainingSample[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    if (cells.length <= Math.max(instIdx, respIdx)) {
      skipped++;
      continue;
    }

    const instruction = cells[instIdx]?.trim();
    const response = cells[respIdx]?.trim();
    const input = inputIdx !== -1 && cells[inputIdx] ? cells[inputIdx].trim() : undefined;

    if (instruction && response) {
      const combined = `${instruction} ${input || ""} ${response}`;
      records.push({
        id: records.length + 1,
        instruction,
        input: input || undefined,
        response,
        sourceFormat: "csv_tabular",
        estimatedTokens: estimateTokens(combined),
      });
    } else {
      skipped++;
    }
  }

  if (skipped > 0 && records.length > 0) {
    warnings.push(`Skipped ${skipped} CSV rows with missing columns.`);
  }

  return records;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      insideQuotes = !insideQuotes;
    } else if (char === delimiter && !insideQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseTextOrMarkdown(content: string): TrainingSample[] {
  // Sliding window chunking by double newline / paragraphs
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 40);

  const records: TrainingSample[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const half = Math.floor(p.length / 2);
    records.push({
      id: i + 1,
      instruction: "Predict and continue the document context:",
      input: p.slice(0, half).trim(),
      response: p.slice(half).trim(),
      sourceFormat: "chunked_text",
      estimatedTokens: estimateTokens(p),
    });
  }

  return records;
}
