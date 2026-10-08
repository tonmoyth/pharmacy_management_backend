import { Request, Response } from "express";

import httpStatus from "http-status";
import { PublicApplicationService } from "./application.public.service";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";


const createApplication = catchAsync(async (req: Request, res: Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };

  const screenshot = files?.screenshot?.[0];
  const nidOrLicense = files?.nidOrLicense?.[0];

  const result = await PublicApplicationService.createApplication(req.body, {
    screenshot,
    nidOrLicense,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Application submitted successfully",
    data: result,
  });
});

export const PublicApplicationController = {
  createApplication,
};
