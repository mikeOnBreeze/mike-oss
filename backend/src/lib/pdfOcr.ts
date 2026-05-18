import { spawn } from "child_process";
import { once } from "events";
import fs from "fs/promises";
import os from "os";
import path from "path";

type PdfGetDocument = {
  promise: Promise<{
    numPages: number;
    getPage: (pageNumber: number) => Promise<{
      getTextContent: () => Promise<{
        items: unknown[];
      }>;
    }>;
  }>;
};

async function extractableTextCharCount(
  buf: ArrayBuffer,
  minChars: number,
): Promise<number> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  const pdf = await (
    pdfjsLib as unknown as {
      getDocument: (opts: unknown) => PdfGetDocument;
    }
  ).getDocument({ data: new Uint8Array(buf) }).promise;

  let total = 0;
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const text = await page.getTextContent();
    for (const item of text.items) {
      const str =
        typeof item === "object" &&
        item !== null &&
        "str" in item &&
        typeof (item as { str?: unknown }).str === "string"
          ? (item as { str: string }).str
          : "";
      total += str.replace(/\s+/g, "").length;
      if (total >= minChars) return total;
    }
  }
  return total;
}

export async function isPdfSearchable(
  pdfBuffer: Buffer,
  minChars = 25,
): Promise<boolean> {
  try {
    const rawBuf = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength,
    ) as ArrayBuffer;
    const count = await extractableTextCharCount(rawBuf, minChars);
    return count >= minChars;
  } catch {
    return false;
  }
}

async function runOcrmypdf(input: string, output: string): Promise<void> {
  const child = spawn(
    "ocrmypdf",
    [
      "--skip-text",
      "--force-ocr",
      "--output-type",
      "pdf",
      "--quiet",
      input,
      output,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const chunks: Buffer[] = [];
  child.stdout.on("data", (d: Buffer) => chunks.push(d));
  child.stderr.on("data", (d: Buffer) => chunks.push(d));

  const [code, signal] = (await once(child, "close")) as [
    number | null,
    NodeJS.Signals | null,
  ];
  if (code === 0) return;

  const detail = Buffer.concat(chunks).toString("utf8").trim();
  throw new Error(
    `ocrmypdf exited with code ${code ?? "unknown"}${
      signal ? ` (signal ${signal})` : ""
    }${detail ? `: ${detail}` : ""}`,
  );
}

export async function maybeOcrPdf(
  pdfBuffer: Buffer,
): Promise<{ buffer: Buffer; ocrApplied: boolean }> {
  const searchable = await isPdfSearchable(pdfBuffer);
  if (searchable) {
    return { buffer: pdfBuffer, ocrApplied: false };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mike-ocr-"));
  const inputPath = path.join(tempDir, "input.pdf");
  const outputPath = path.join(tempDir, "output.pdf");

  try {
    await fs.writeFile(inputPath, pdfBuffer);
    await runOcrmypdf(inputPath, outputPath);
    const ocrBytes = await fs.readFile(outputPath);
    if (!ocrBytes.byteLength) return { buffer: pdfBuffer, ocrApplied: false };
    return { buffer: ocrBytes, ocrApplied: true };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
