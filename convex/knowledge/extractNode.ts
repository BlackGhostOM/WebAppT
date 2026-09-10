"use node";
/**
 * Node-only text extraction for PDF, Word and Excel files.
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server";

export const extract = internalAction({
  args: { storageId: v.id("_storage"), mimeType: v.string(), fileName: v.string() },
  returns: v.object({ text: v.string(), pages: v.optional(v.number()) }),
  handler: async (ctx, { storageId, mimeType, fileName }) => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error("FILE_NOT_FOUND");
    const buffer = Buffer.from(await blob.arrayBuffer());
    const isPdf = mimeType.includes("pdf") || fileName.endsWith(".pdf");
    const isDocx = mimeType.includes("wordprocessingml") || fileName.endsWith(".docx");
    const isXlsx = mimeType.includes("spreadsheetml") || mimeType.includes("ms-excel") || /\.xlsx?$/.test(fileName);
    if (isPdf) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      return { text: result.text ?? "", pages: result.total };
    }
    if (isDocx) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value ?? "" };
    }
    if (isXlsx) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const parts: string[] = [];
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        parts.push(`# ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`);
      }
      return { text: parts.join("\n\n") };
    }
    if (mimeType.includes("msword") || fileName.endsWith(".doc")) {
      throw new Error("ملفات .doc القديمة غير مدعومة؛ احفظ الملف بصيغة .docx");
    }
    throw new Error(`UNSUPPORTED_MIME:${mimeType}`);
  },
});
