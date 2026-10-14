export const MEDICINE_TEMPLATE_HEADERS = [
  "Name",
  "Generic Name",
  "Company",
  "Category",
  "Strength",
  "Dosage Form",
  "Barcode",
  "Min Stock Level",
  "Prescription Required",
  "Strip Factor",
  "Box Factor",
] as const;

export const OPENING_STOCK_TEMPLATE_HEADERS = [
  "Name",
  "Strength",
  "Dosage Form",
  "Barcode",
  "Batch No",
  "Expiry Date",
  "Unit",
  "Quantity",
  "Purchase Price",
  "Selling Price",
  "MRP",
] as const;

export const MEDICINE_SAMPLE_ROWS = [
  {
    "Name": "Napa",
    "Generic Name": "Paracetamol",
    "Company": "Beximco Pharmaceuticals",
    "Category": "Analgesic",
    "Strength": "500mg",
    "Dosage Form": "Tablet",
    "Barcode": "8901234567890",
    "Min Stock Level": 50,
    "Prescription Required": "No",
    "Strip Factor": 10,
    "Box Factor": 100,
  },
  {
    "Name": "Seclo",
    "Generic Name": "Omeprazole",
    "Company": "Square Pharmaceuticals",
    "Category": "Antiulcerant",
    "Strength": "20mg",
    "Dosage Form": "Capsule",
    "Barcode": "8901234567891",
    "Min Stock Level": 30,
    "Prescription Required": "No",
    "Strip Factor": 14,
    "Box Factor": 140,
  },
];

export const OPENING_STOCK_SAMPLE_ROWS = [
  {
    "Name": "Napa",
    "Strength": "500mg",
    "Dosage Form": "Tablet",
    "Barcode": "8901234567890",
    "Batch No": "NP2026A",
    "Expiry Date": "12/2027",
    "Unit": "STRIP",
    "Quantity": 10,
    "Purchase Price": 1.20,
    "Selling Price": 1.50,
    "MRP": 1.50,
  },
  {
    "Name": "Napa",
    "Strength": "500mg",
    "Dosage Form": "Tablet",
    "Barcode": "8901234567890",
    "Batch No": "NP2026B",
    "Expiry Date": "06/2028",
    "Unit": "BOX",
    "Quantity": 2,
    "Purchase Price": 1.15,
    "Selling Price": 1.50,
    "MRP": 1.50,
  },
  {
    "Name": "Seclo",
    "Strength": "20mg",
    "Dosage Form": "Capsule",
    "Barcode": "8901234567891",
    "Batch No": "SC991",
    "Expiry Date": "08/2027",
    "Unit": "BOX",
    "Quantity": 5,
    "Purchase Price": 4.50,
    "Selling Price": 6.00,
    "MRP": 6.00,
  },
];

export const MAX_IMPORT_ROWS = 5000;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const ALLOWED_FILE_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;

export const importFilterableFields = ["type", "status", "duplicateMode"];
export const importSearchableFields = ["fileName"];
