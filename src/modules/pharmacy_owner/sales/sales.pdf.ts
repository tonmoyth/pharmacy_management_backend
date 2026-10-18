import PDFDocument from "pdfkit";
import { IInvoiceJSONResult } from "./sales.interface";

/**
 * Format date in Asia/Dhaka timezone (UTC+6).
 */
export const formatDhakaDateTime = (dateStr: string | Date): string => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return String(dateStr);
  }
};

/**
 * Generates an invoice PDF in either standard A4 or 80mm thermal receipt format.
 */
export const generateInvoicePDF = async (
  invoiceData: IInvoiceJSONResult,
  size: "a4" | "thermal80" = "a4"
): Promise<Buffer> => {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const buffers: Buffer[] = [];
      const { pharmacy, sale, customer, createdBy, items } = invoiceData;
      const formattedDate = formatDhakaDateTime(sale.soldAt);

      if (size === "thermal80") {
        // --- 80mm Thermal Receipt Layout ---
        // Width: 80mm = ~226.77 pt
        const doc = new PDFDocument({
          size: [226.77, 800],
          margins: { top: 15, bottom: 15, left: 10, right: 10 },
          autoFirstPage: true,
        });

        doc.on("data", (chunk) => buffers.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", reject);

        // Header
        doc
          .font("Helvetica-Bold")
          .fontSize(12)
          .text(pharmacy.name, { align: "center" });

        doc.font("Helvetica").fontSize(8);
        if (pharmacy.address) {
          doc.text(`${pharmacy.address}, ${pharmacy.area}, ${pharmacy.city}`, {
            align: "center",
          });
        }
        if (pharmacy.phone) {
          doc.text(`Phone: ${pharmacy.phone}`, { align: "center" });
        }
        if (pharmacy.invoiceHeader) {
          doc.text(pharmacy.invoiceHeader, { align: "center" });
        }

        doc.moveDown(0.5);
        doc.text("------------------------------------------------", {
          align: "center",
        });

        if (sale.status === "CANCELLED") {
          doc
            .font("Helvetica-Bold")
            .fontSize(10)
            .fillColor("red")
            .text("** CANCELLED INVOICE **", { align: "center" });
          doc.fillColor("black");
          doc.moveDown(0.2);
        }

        doc.font("Helvetica-Bold").fontSize(8);
        doc.text(`Invoice: ${sale.invoiceNo}`);
        doc.font("Helvetica").fontSize(8);
        doc.text(`Date: ${formattedDate}`);
        doc.text(`Served By: ${createdBy.name} (${createdBy.role})`);
        doc.text(`Customer: ${customer?.name || "Walk-in Customer"}`);
        if (customer?.phone) {
          doc.text(`Phone: ${customer.phone}`);
        }

        doc.moveDown(0.3);
        doc.text("------------------------------------------------", {
          align: "center",
        });

        // Items Header
        doc.font("Helvetica-Bold").fontSize(8);
        doc.text("Item / Description", { continued: false });
        doc.text("Qty x Price                Total");
        doc.font("Helvetica").fontSize(8);
        doc.text("------------------------------------------------", {
          align: "center",
        });

        for (const item of items) {
          const medText = `${item.medicineName} (${item.batchNo})`;
          doc.font("Helvetica-Bold").text(medText);
          doc.font("Helvetica");
          const calcText = `${item.quantityPieces} pcs @ ${item.unitPricePerPiece.toFixed(2)}`;
          const totalText = `${item.lineSubtotal.toFixed(2)} BDT`;
          doc.text(
            `${calcText.padEnd(26, " ")} ${totalText.padStart(10, " ")}`
          );
        }

        doc.text("------------------------------------------------", {
          align: "center",
        });

        // Financial Totals
        doc.text(`Subtotal: ${sale.subtotal.toFixed(2)} BDT`, {
          align: "right",
        });
        if (sale.discountAmount > 0) {
          doc.text(`Discount: -${sale.discountAmount.toFixed(2)} BDT`, {
            align: "right",
          });
        }
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .text(`Net Total: ${sale.totalAmount.toFixed(2)} BDT`, {
            align: "right",
          });
        doc.font("Helvetica").fontSize(8);
        doc.text(`Paid: ${sale.paidAmount.toFixed(2)} BDT`, {
          align: "right",
        });
        if (sale.dueAmount > 0) {
          doc.text(`Due: ${sale.dueAmount.toFixed(2)} BDT`, {
            align: "right",
          });
        }
        doc.text(`Payment: ${sale.paymentMethod}`, { align: "right" });

        if (sale.status === "CANCELLED" && sale.cancelReason) {
          doc.moveDown(0.5);
          doc.text(`Cancellation Reason: ${sale.cancelReason}`, {
            align: "left",
          });
          if (sale.cancelRefundAmount !== null && sale.cancelRefundAmount !== undefined) {
            doc.text(
              `Refund Payable: ${Number(sale.cancelRefundAmount).toFixed(2)} BDT`,
              { align: "left" }
            );
          }
        }

        doc.moveDown(0.5);
        doc.text("------------------------------------------------", {
          align: "center",
        });
        const footerMsg =
          pharmacy.invoiceFooter || "Thank you for your business!";
        doc.fontSize(8).text(footerMsg, { align: "center" });

        doc.end();
      } else {
        // --- Standard A4 Layout ---
        const doc = new PDFDocument({
          size: "A4",
          margins: { top: 36, bottom: 36, left: 36, right: 36 },
          autoFirstPage: true,
        });

        doc.on("data", (chunk) => buffers.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", reject);

        const pageWidth = 595.28 - 72; // ~523 pt usable width
        const leftX = 36;
        const rightColX = 320;

        // Header - Pharmacy Info
        doc
          .font("Helvetica-Bold")
          .fontSize(18)
          .fillColor("#1e293b")
          .text(pharmacy.name, leftX, 36);

        doc.font("Helvetica").fontSize(9).fillColor("#64748b");
        const fullAddress = [pharmacy.address, pharmacy.area, pharmacy.city]
          .filter(Boolean)
          .join(", ");
        if (fullAddress) doc.text(fullAddress, leftX, doc.y + 2);
        doc.text(`Phone: ${pharmacy.phone} | Email: ${pharmacy.email}`, leftX, doc.y + 2);
        if (pharmacy.invoiceHeader) {
          doc.text(pharmacy.invoiceHeader, leftX, doc.y + 2);
        }

        // Invoice Header Title
        doc
          .font("Helvetica-Bold")
          .fontSize(16)
          .fillColor("#0f172a")
          .text("INVOICE", rightColX, 36, { align: "right", width: 239 });

        doc.font("Helvetica").fontSize(9).fillColor("#475569");
        doc.text(`Invoice No: ${sale.invoiceNo}`, rightColX, doc.y + 2, {
          align: "right",
          width: 239,
        });
        doc.text(`Date: ${formattedDate}`, rightColX, doc.y + 2, {
          align: "right",
          width: 239,
        });
        doc.text(`Status: ${sale.status}`, rightColX, doc.y + 2, {
          align: "right",
          width: 239,
        });

        // Cancelled banner
        if (sale.status === "CANCELLED") {
          doc.moveDown(1);
          doc
            .rect(leftX, doc.y, pageWidth, 28)
            .fillAndStroke("#fee2e2", "#ef4444");
          doc
            .font("Helvetica-Bold")
            .fontSize(10)
            .fillColor("#b91c1c")
            .text(
              `CANCELLED INVOICE — Reason: ${sale.cancelReason || "N/A"}${
                sale.cancelRefundAmount
                  ? ` | Refund Amount: ${Number(sale.cancelRefundAmount).toFixed(2)} BDT`
                  : ""
              }`,
              leftX + 8,
              doc.y - 19,
              { width: pageWidth - 16 }
            );
          doc.moveDown(1);
        } else {
          doc.moveDown(1.5);
        }

        // Horizontal line separator
        doc
          .strokeColor("#cbd5e1")
          .lineWidth(1)
          .moveTo(leftX, doc.y)
          .lineTo(leftX + pageWidth, doc.y)
          .stroke();

        doc.moveDown(0.8);
        const metaY = doc.y;

        // Left Column: Bill To / Customer
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor("#0f172a")
          .text("Billed To:", leftX, metaY);
        doc.font("Helvetica").fontSize(9).fillColor("#334155");
        doc.text(`Name: ${customer?.name || "Walk-in Customer"}`, leftX, doc.y + 2);
        if (customer?.phone) {
          doc.text(`Phone: ${customer.phone}`, leftX, doc.y + 2);
        }
        if (customer?.address) {
          doc.text(`Address: ${customer.address}`, leftX, doc.y + 2);
        }

        // Right Column: Billed By
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .fillColor("#0f172a")
          .text("Staff / Cashier:", rightColX, metaY);
        doc.font("Helvetica").fontSize(9).fillColor("#334155");
        doc.text(`Name: ${createdBy.name}`, rightColX, doc.y + 2);
        doc.text(`Role: ${createdBy.role}`, rightColX, doc.y + 2);
        doc.text(`Payment: ${sale.paymentMethod}`, rightColX, doc.y + 2);

        doc.moveDown(2);

        // --- Table Headers ---
        const tableTop = Math.max(doc.y, metaY + 55);
        doc
          .rect(leftX, tableTop, pageWidth, 20)
          .fill("#f1f5f9");

        doc.font("Helvetica-Bold").fontSize(9).fillColor("#1e293b");
        const colSL = leftX + 6;
        const colMed = leftX + 30;
        const colBatch = leftX + 220;
        const colQty = leftX + 310;
        const colPrice = leftX + 380;
        const colTotal = leftX + 450;

        doc.text("#", colSL, tableTop + 5);
        doc.text("Medicine / Item", colMed, tableTop + 5);
        doc.text("Batch", colBatch, tableTop + 5);
        doc.text("Quantity", colQty, tableTop + 5);
        doc.text("Unit Price", colPrice, tableTop + 5);
        doc.text("Line Total", colTotal, tableTop + 5, { align: "right", width: 65 });

        // --- Table Rows ---
        let currentY = tableTop + 24;
        doc.font("Helvetica").fontSize(8).fillColor("#334155");

        items.forEach((item, index) => {
          const rowBg = index % 2 === 1 ? "#f8fafc" : "#ffffff";
          doc.rect(leftX, currentY - 3, pageWidth, 18).fill(rowBg);

          doc.fillColor("#334155");
          doc.text(String(index + 1), colSL, currentY);
          const medLabel = `${item.medicineName}${
            item.strength ? ` (${item.strength})` : ""
          }`;
          doc.text(medLabel, colMed, currentY, { width: 180, ellipsis: true });
          doc.text(item.batchNo, colBatch, currentY);
          doc.text(`${item.quantityPieces} pcs (${item.enteredQty} ${item.enteredUnit})`, colQty, currentY);
          doc.text(`${item.unitPricePerPiece.toFixed(2)}`, colPrice, currentY);
          doc.text(
            `${item.lineSubtotal.toFixed(2)} BDT`,
            colTotal,
            currentY,
            { align: "right", width: 65 }
          );

          currentY += 18;
        });

        // Bottom border of table
        doc
          .strokeColor("#e2e8f0")
          .lineWidth(1)
          .moveTo(leftX, currentY)
          .lineTo(leftX + pageWidth, currentY)
          .stroke();

        currentY += 10;

        // --- Totals Summary Block ---
        const totalsWidth = 200;
        const totalsX = leftX + pageWidth - totalsWidth;

        doc.font("Helvetica").fontSize(9).fillColor("#475569");
        doc.text("Subtotal:", totalsX, currentY);
        doc.text(`${sale.subtotal.toFixed(2)} BDT`, totalsX, currentY, {
          align: "right",
          width: totalsWidth,
        });

        currentY += 14;
        if (sale.discountAmount > 0) {
          doc.text(`Discount (${sale.discountType}):`, totalsX, currentY);
          doc.text(`-${sale.discountAmount.toFixed(2)} BDT`, totalsX, currentY, {
            align: "right",
            width: totalsWidth,
          });
          currentY += 14;
        }

        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#0f172a");
        doc.text("Total Payable:", totalsX, currentY);
        doc.text(`${sale.totalAmount.toFixed(2)} BDT`, totalsX, currentY, {
          align: "right",
          width: totalsWidth,
        });

        currentY += 16;
        doc.font("Helvetica").fontSize(9).fillColor("#475569");
        doc.text("Paid Amount:", totalsX, currentY);
        doc.text(`${sale.paidAmount.toFixed(2)} BDT`, totalsX, currentY, {
          align: "right",
          width: totalsWidth,
        });

        currentY += 14;
        doc.text("Due Amount:", totalsX, currentY);
        doc.text(`${sale.dueAmount.toFixed(2)} BDT`, totalsX, currentY, {
          align: "right",
          width: totalsWidth,
        });

        // Footer Note
        const footerText =
          pharmacy.invoiceFooter || "Thank you for choosing our pharmacy!";
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#94a3b8")
          .text(footerText, leftX, 780, { align: "center", width: pageWidth });

        doc.end();
      }
    } catch (error) {
      reject(error);
    }
  });
};
