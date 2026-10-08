import express from "express";

import { PublicApplicationValidation } from "./application.public.validation";
import { PublicApplicationController } from "./application.public.controller";
import { upload } from "../../../middlewares/upload";
import validateRequest from "../../../middlewares/validateRequest";

const router = express.Router();

router.post(
  "/",
  upload.fields([
    { name: "screenshot", maxCount: 1 },
    { name: "nidOrLicense", maxCount: 1 },
  ]),
  (req, res, next) => {
    if (req.body.data) {
      try {
        req.body = JSON.parse(req.body.data);
      } catch (error) {
        // Continue if parsing fails, Zod will catch invalid structures
      }
    }
    next();
  },
  validateRequest(PublicApplicationValidation.createApplicationZodSchema),
  PublicApplicationController.createApplication
);

export const PublicApplicationRoutes = router;
