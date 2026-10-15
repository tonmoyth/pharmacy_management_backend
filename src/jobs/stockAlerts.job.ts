import { NotificationType } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Job 3: Stock & Due Alerts
 * Schedule: Daily 06:00 Asia/Dhaka
 *
 * Rules:
 * - Create/refresh LOW_STOCK, EXPIRING_SOON, EXPIRED_MEDICINE,
 *   CUSTOMER_DUE, SUPPLIER_DUE notifications per pharmacy.
 * - Use dedupeKey to avoid duplicate notifications.
 */
export const runStockAlertsJob = async (): Promise<{
  lowStockCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  customerDueCount: number;
  supplierDueCount: number;
}> => {
  const now = new Date();
  const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  let lowStockCount = 0;
  let expiringSoonCount = 0;
  let expiredCount = 0;
  let customerDueCount = 0;
  let supplierDueCount = 0;

  // 1. LOW_STOCK: Active medicines where total available batch stock <= minStockLevel
  const medicines = await prisma.medicine.findMany({
    where: {
      status: "ACTIVE",
      minStockLevel: { gt: 0 },
    },
    include: {
      batches: {
        select: { availableQty: true },
      },
    },
  });

  for (const med of medicines) {
    const totalAvailable = med.batches.reduce(
      (sum, b) => sum + b.availableQty,
      0
    );

    if (totalAvailable <= med.minStockLevel) {
      const dedupeKey = `low_stock_${med.id}`;
      await prisma.notification.upsert({
        where: {
          pharmacyId_dedupeKey: {
            pharmacyId: med.pharmacyId,
            dedupeKey,
          },
        },
        update: {
          title: `Low Stock: ${med.name}`,
          message: `Medicine '${med.name}' is running low with only ${totalAvailable} pcs remaining (minimum: ${med.minStockLevel} pcs).`,
          isRead: false,
        },
        create: {
          pharmacyId: med.pharmacyId,
          type: NotificationType.LOW_STOCK,
          title: `Low Stock: ${med.name}`,
          message: `Medicine '${med.name}' is running low with only ${totalAvailable} pcs remaining (minimum: ${med.minStockLevel} pcs).`,
          refType: "Medicine",
          refId: med.id,
          dedupeKey,
        },
      });
      lowStockCount++;
    }
  }

  // 2. EXPIRING_SOON: Batches with availableQty > 0 expiring within the next 60 days
  const expiringBatches = await prisma.medicineBatch.findMany({
    where: {
      availableQty: { gt: 0 },
      expiryDate: {
        gt: now,
        lte: sixtyDaysFromNow,
      },
    },
    include: {
      medicine: { select: { name: true } },
    },
  });

  for (const batch of expiringBatches) {
    const dedupeKey = `batch_expiring_${batch.id}`;
    const expiryFormatted = batch.expiryDate.toISOString().split("T")[0];

    await prisma.notification.upsert({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId: batch.pharmacyId,
          dedupeKey,
        },
      },
      update: {
        title: `Batch Expiring Soon: ${batch.medicine.name}`,
        message: `Batch '${batch.batchNo}' of '${batch.medicine.name}' (${batch.availableQty} pcs) will expire on ${expiryFormatted}.`,
        isRead: false,
      },
      create: {
        pharmacyId: batch.pharmacyId,
        type: NotificationType.EXPIRING_SOON,
        title: `Batch Expiring Soon: ${batch.medicine.name}`,
        message: `Batch '${batch.batchNo}' of '${batch.medicine.name}' (${batch.availableQty} pcs) will expire on ${expiryFormatted}.`,
        refType: "MedicineBatch",
        refId: batch.id,
        dedupeKey,
      },
    });
    expiringSoonCount++;
  }

  // 3. EXPIRED_MEDICINE: Batches with availableQty > 0 that have already expired
  const expiredBatches = await prisma.medicineBatch.findMany({
    where: {
      availableQty: { gt: 0 },
      expiryDate: {
        lte: now,
      },
    },
    include: {
      medicine: { select: { name: true } },
    },
  });

  for (const batch of expiredBatches) {
    const dedupeKey = `batch_expired_${batch.id}`;
    const expiryFormatted = batch.expiryDate.toISOString().split("T")[0];

    await prisma.notification.upsert({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId: batch.pharmacyId,
          dedupeKey,
        },
      },
      update: {
        title: `Medicine Expired: ${batch.medicine.name}`,
        message: `Batch '${batch.batchNo}' of '${batch.medicine.name}' (${batch.availableQty} pcs) expired on ${expiryFormatted}. Remove from inventory immediately.`,
        isRead: false,
      },
      create: {
        pharmacyId: batch.pharmacyId,
        type: NotificationType.EXPIRED_MEDICINE,
        title: `Medicine Expired: ${batch.medicine.name}`,
        message: `Batch '${batch.batchNo}' of '${batch.medicine.name}' (${batch.availableQty} pcs) expired on ${expiryFormatted}. Remove from inventory immediately.`,
        refType: "MedicineBatch",
        refId: batch.id,
        dedupeKey,
      },
    });
    expiredCount++;
  }

  // 4. CUSTOMER_DUE: Active customers with outstanding dueBalance > 0
  const customersWithDue = await prisma.customer.findMany({
    where: {
      isActive: true,
      dueBalance: { gt: 0 },
    },
  });

  for (const customer of customersWithDue) {
    const dedupeKey = `customer_due_${customer.id}`;
    const due = Number(customer.dueBalance);

    await prisma.notification.upsert({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId: customer.pharmacyId,
          dedupeKey,
        },
      },
      update: {
        title: `Customer Due: ${customer.name}`,
        message: `Customer '${customer.name}' has an outstanding due balance of ${due.toFixed(2)} BDT.`,
        isRead: false,
      },
      create: {
        pharmacyId: customer.pharmacyId,
        type: NotificationType.CUSTOMER_DUE,
        title: `Customer Due: ${customer.name}`,
        message: `Customer '${customer.name}' has an outstanding due balance of ${due.toFixed(2)} BDT.`,
        refType: "Customer",
        refId: customer.id,
        dedupeKey,
      },
    });
    customerDueCount++;
  }

  // 5. SUPPLIER_DUE: Active suppliers with outstanding dueBalance > 0
  const suppliersWithDue = await prisma.supplier.findMany({
    where: {
      isActive: true,
      dueBalance: { gt: 0 },
    },
  });

  for (const supplier of suppliersWithDue) {
    const dedupeKey = `supplier_due_${supplier.id}`;
    const due = Number(supplier.dueBalance);

    await prisma.notification.upsert({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId: supplier.pharmacyId,
          dedupeKey,
        },
      },
      update: {
        title: `Supplier Due: ${supplier.name}`,
        message: `Outstanding payable to supplier '${supplier.name}' is ${due.toFixed(2)} BDT.`,
        isRead: false,
      },
      create: {
        pharmacyId: supplier.pharmacyId,
        type: NotificationType.SUPPLIER_DUE,
        title: `Supplier Due: ${supplier.name}`,
        message: `Outstanding payable to supplier '${supplier.name}' is ${due.toFixed(2)} BDT.`,
        refType: "Supplier",
        refId: supplier.id,
        dedupeKey,
      },
    });
    supplierDueCount++;
  }

  return {
    lowStockCount,
    expiringSoonCount,
    expiredCount,
    customerDueCount,
    supplierDueCount,
  };
};
