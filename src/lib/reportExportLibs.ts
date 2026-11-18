/** Lazy-load heavy export dependencies (keeps initial route chunks small). */

export async function loadXlsx() {
  return await import("xlsx");
}

export async function loadDocx(): Promise<typeof import("docx")> {
  return await import("docx");
}

export async function loadJsPdf(): Promise<import("jspdf").default> {
  const { default: JsPDF } = await import("jspdf");
  return JsPDF;
}

export async function loadJsPdfWithAutotable(): Promise<import("jspdf").default> {
  await import("jspdf-autotable");
  const { default: JsPDF } = await import("jspdf");
  return JsPDF;
}

export async function loadHtml2canvas() {
  const mod = await import("html2canvas");
  return mod.default;
}
