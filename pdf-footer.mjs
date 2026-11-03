import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export async function addFooterLabel(pdfBytes, label) {
    const pdf = await PDFDocument.load(pdfBytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    let pageCount = 0;

    for (const page of pdf.getPages()) {
        const { width } = page.getSize();
        const fontSize = 8;
        const textWidth = font.widthOfTextAtSize(label, fontSize);

        page.drawText(label, {
            x: Math.max(12, (width - textWidth) / 2),
            y: 12,
            size: fontSize,
            font,
            color: rgb(0.35, 0.35, 0.35),
        });
        pageCount += 1;
    }

    return {
        bytes: await pdf.save(),
        pageCount,
    };
}
