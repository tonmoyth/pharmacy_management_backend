/**
 * Date and timezone helper for Asia/Dhaka (UTC+6).
 * Handles both DateTime (timestamp with time zone) and Date (@db.Date) representations.
 */

export interface IDhakaBoundaries {
  year: number;
  month: number;
  day: number;
  // Exact UTC boundaries for TIMESTAMPTZ / DateTime fields (such as Sale.soldAt)
  startOfTodayUtc: Date;
  startOfTomorrowUtc: Date;
  startOfMonthUtc: Date;
  startOfNextMonthUtc: Date;
  // Exact calendar dates for @db.Date fields (such as Purchase.purchaseDate, Expense.expenseDate, MedicineBatch.expiryDate)
  todayDate: Date;
  startOfMonthDate: Date;
  endOfMonthDate: Date;
  expiringThresholdDate: Date;
  // Formatted date strings
  todayDateString: string;
  monthStartDateString: string;
  monthEndDateString: string;
}

const DHAKA_TIMEZONE = "Asia/Dhaka";
const DHAKA_UTC_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6 in milliseconds

/**
 * Extract calendar components in Asia/Dhaka for a given reference timestamp.
 */
export const getDhakaDateComponents = (refDate: Date = new Date()) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: DHAKA_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(refDate);
  const getPart = (type: string) => {
    const p = parts.find((part) => part.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };

  const year = getPart("year");
  const month = getPart("month"); // 1-12
  const day = getPart("day"); // 1-31
  const hour = getPart("hour") % 24;
  const minute = getPart("minute");
  const second = getPart("second");

  return { year, month, day, hour, minute, second };
};

/**
 * Calculates all today and current-month boundaries in Asia/Dhaka.
 */
export const getDhakaBoundaries = (
  refDate: Date = new Date(),
  thresholdDays: number = 30
): IDhakaBoundaries => {
  const { year, month, day } = getDhakaDateComponents(refDate);

  // Exact UTC timestamps corresponding to midnight in Asia/Dhaka
  // 00:00:00 Dhaka = Date.UTC(year, month - 1, day, 0, 0, 0) - 6 hours
  const startOfTodayUtc = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - DHAKA_UTC_OFFSET_MS
  );
  const startOfTomorrowUtc = new Date(
    Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0) - DHAKA_UTC_OFFSET_MS
  );

  const startOfMonthUtc = new Date(
    Date.UTC(year, month - 1, 1, 0, 0, 0, 0) - DHAKA_UTC_OFFSET_MS
  );
  const startOfNextMonthUtc = new Date(
    Date.UTC(year, month, 1, 0, 0, 0, 0) - DHAKA_UTC_OFFSET_MS
  );

  // Calendar dates for Prisma @db.Date mapping
  const todayDate = new Date(Date.UTC(year, month - 1, day));
  const startOfMonthDate = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonthDate = new Date(Date.UTC(year, month, 0)); // last day of current month
  const expiringThresholdDate = new Date(
    Date.UTC(year, month - 1, day + thresholdDays)
  );

  const pad = (n: number) => String(n).padStart(2, "0");
  const todayDateString = `${year}-${pad(month)}-${pad(day)}`;
  const monthStartDateString = `${year}-${pad(month)}-01`;
  const monthEndDateString = `${year}-${pad(month)}-${pad(endOfMonthDate.getUTCDate())}`;

  return {
    year,
    month,
    day,
    startOfTodayUtc,
    startOfTomorrowUtc,
    startOfMonthUtc,
    startOfNextMonthUtc,
    todayDate,
    startOfMonthDate,
    endOfMonthDate,
    expiringThresholdDate,
    todayDateString,
    monthStartDateString,
    monthEndDateString,
  };
};

/**
 * Utility to round monetary values to 2 decimal places safely.
 */
export const round2 = (val: number): number => {
  return Math.round((val + Number.EPSILON) * 100) / 100;
};
