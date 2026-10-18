# Expenses Module — API Specification (Phase 1)

## Overview

The Expenses module allows pharmacy owners to record, monitor, update, and summarize operational expenditures for their pharmacy tenant.

### Core Capabilities:
- Strict role restriction: Accessible **only** to the Pharmacy Owner (`OWN` / `Role.PHARMACY_OWNER`). Cashiers and Staff are strictly prohibited.
- Supported expense categories:
  - `RENT`
  - `ELECTRICITY`
  - `SALARY`
  - `INTERNET`
  - `TRANSPORT`
  - `MAINTENANCE`
  - `UTILITY`
  - `OTHER`
- Supports both JSON and `multipart/form-data` uploads for receipt/invoice attachments (JPEG, PNG, WEBP, PDF up to 5MB) with automated Cloudinary storage and cleanup.
- Soft-delete semantics (`deletedAt` timestamp): Records are never physically deleted from the database to preserve historical auditability, but are excluded from active listings, details, and reports.
- Comprehensive date-range (`from` / `to`) filtering and category-wise aggregation (`GET /expenses/summary`).

---

## Base Path & Route Mounts

- Global API Prefix: `/api/v1`
- Mounts:
  - `GET /api/v1/expenses` (or `/api/v1/pharmacy/expenses`)
  - `GET /api/v1/expenses/summary` (or `/api/v1/pharmacy/expenses/summary`)
  - `POST /api/v1/expenses` (or `/api/v1/pharmacy/expenses`)
  - `GET /api/v1/expenses/:id` (or `/api/v1/pharmacy/expenses/:id`)
  - `PATCH /api/v1/expenses/:id` (or `/api/v1/pharmacy/expenses/:id`)
  - `DELETE /api/v1/expenses/:id` (or `/api/v1/pharmacy/expenses/:id`)

---

## Role-Based Access Control

| Endpoint | Permitted Roles | Notes |
|---|---|---|
| All Expense Endpoints | `OWN` (`Role.PHARMACY_OWNER`) | Cashiers (`CSH`) and Staff (`STF`) receive HTTP 403 Forbidden. Scoped strictly to authenticated pharmacy tenant. |

---

## 1. GET /expenses — List Expenses

Retrieves a paginated list of non-deleted expenses for the authenticated pharmacy.

### Query Parameters
- `page` *(number, optional, default: 1)*
- `limit` *(number, optional, default: 10)*
- `sortBy` *(string, optional, default: "expenseDate")*
- `sortOrder` *(string: "asc" | "desc", optional, default: "desc")*
- `category` *(enum, optional)*: Filter by expense category.
- `from` *(string YYYY-MM-DD, optional)*: Start date.
- `to` *(string YYYY-MM-DD, optional)*: End date. Validates `from <= to`.
- `search` / `searchTerm` *(string, optional)*: Search in expense `note`.

### Response `200 OK`
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Expenses retrieved successfully",
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPage": 1
  },
  "data": [
    {
      "id": "clyexp123...",
      "pharmacyId": "pharma_123",
      "category": "RENT",
      "amount": 15000.00,
      "expenseDate": "2026-10-01T00:00:00.000Z",
      "note": "Shop monthly rent",
      "attachmentPath": "https://res.cloudinary.com/.../receipt.png",
      "createdById": "user_owner_1",
      "createdBy": {
        "id": "user_owner_1",
        "name": "Pharmacy Owner",
        "role": "PHARMACY_OWNER"
      },
      "createdAt": "2026-10-18T10:00:00.000Z",
      "updatedAt": "2026-10-18T10:00:00.000Z"
    }
  ]
}
```

---

## 2. GET /expenses/summary — Category-wise Summary

Calculates aggregated totals and counts grouped by expense category along with overall total for the period. Excludes soft-deleted records.

### Query Parameters
- `from` *(string YYYY-MM-DD, optional)*
- `to` *(string YYYY-MM-DD, optional)*

### Response `200 OK`
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Expenses summary retrieved successfully",
  "data": {
    "from": "2026-10-01",
    "to": "2026-10-31",
    "totalAmount": 19700.00,
    "totalCount": 3,
    "byCategory": [
      {
        "category": "RENT",
        "totalAmount": 15000.00,
        "count": 1
      },
      {
        "category": "ELECTRICITY",
        "totalAmount": 3500.00,
        "count": 1
      },
      {
        "category": "INTERNET",
        "totalAmount": 1200.00,
        "count": 1
      }
    ]
  }
}
```

---

## 3. POST /expenses — Create Expense

Supports `application/json` or `multipart/form-data` with an optional `attachment` file.

### Request Fields
- `category` *(enum, required)*: `RENT`, `ELECTRICITY`, `SALARY`, `INTERNET`, `TRANSPORT`, `MAINTENANCE`, `UTILITY`, `OTHER`.
- `amount` *(number, positive, finite, required)*: Decimal amount > 0.
- `expenseDate` *(string YYYY-MM-DD, required)*: Date of expense.
- `note` *(string, optional, nullable)*: Max 500 characters.
- `attachment` *(file, optional)*: File upload (JPEG, PNG, WEBP, PDF, max 5MB).

### Response `201 Created`
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Expense created successfully",
  "data": {
    "id": "clyexp123...",
    "pharmacyId": "pharma_123",
    "category": "RENT",
    "amount": 15000.00,
    "expenseDate": "2026-10-01T00:00:00.000Z",
    "note": "Shop monthly rent",
    "attachmentPath": "https://res.cloudinary.com/.../receipt.png",
    "createdById": "user_owner_1",
    "createdAt": "2026-10-18T10:00:00.000Z",
    "updatedAt": "2026-10-18T10:00:00.000Z"
  }
}
```

---

## 4. GET /expenses/:id — Expense Details

Returns single expense details. If soft-deleted or belonging to another pharmacy, returns 404 Not Found.

### Response `200 OK`
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Expense retrieved successfully",
  "data": {
    "id": "clyexp123...",
    "pharmacyId": "pharma_123",
    "category": "RENT",
    "amount": 15000.00,
    "expenseDate": "2026-10-01T00:00:00.000Z",
    "note": "Shop monthly rent",
    "attachmentPath": null,
    "createdById": "user_owner_1",
    "createdAt": "2026-10-18T10:00:00.000Z",
    "updatedAt": "2026-10-18T10:00:00.000Z"
  }
}
```

---

## 5. PATCH /expenses/:id — Update Expense

Allows partial updates to `category`, `amount`, `expenseDate`, `note`, and optionally replacing `attachment`. When a new attachment is provided, the previous attachment is automatically cleaned up from Cloudinary storage.

### Response `200 OK`
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Expense updated successfully",
  "data": {
    "id": "clyexp123...",
    "amount": 16000.00,
    "note": "Updated rent amount"
  }
}
```

---

## 6. DELETE /expenses/:id — Soft Delete Expense

Soft deletes an expense by setting `deletedAt = new Date()`. The record physically remains in the database for auditability and historical tracking, but is excluded from all subsequent active queries.

### Response `200 OK`
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Expense deleted successfully",
  "data": {
    "id": "clyexp123..."
  }
}
```

---

## Error Codes

| Error Code | HTTP Status | Description |
|---|---|---|
| `EXPENSE_NOT_FOUND` | 404 | Expense does not exist, is soft-deleted, or belongs to another pharmacy tenant. |
| `INVALID_CATEGORY` | 400 | The supplied category is not among the 8 supported categories. |
| `INVALID_AMOUNT` | 400 | Expense amount is non-positive, zero, or malformed. |
| `INVALID_DATE_RANGE` | 400 | `from` date is later than `to` date, or date format is invalid. |
| `INVALID_FILE_TYPE` | 400 | Attachment is not an allowed MIME type (JPEG, PNG, WEBP, PDF). |
| `FILE_TOO_LARGE` | 400 | Attachment file size exceeds 5MB limit. |
| `ATTACHMENT_UPLOAD_FAILED` | 500 | Storage upload operation encountered an error. |
