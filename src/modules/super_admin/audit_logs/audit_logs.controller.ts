import { Request, Response } from "express";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import httpStatus from "http-status";
import { AdminAuditLogsService } from "./audit_logs.service";

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminAuditLogsService.getAuditLogs(req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Audit logs retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

export const AdminAuditLogsController = {
  getAuditLogs,
};
