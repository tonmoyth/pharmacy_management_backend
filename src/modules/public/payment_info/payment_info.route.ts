import express from "express";
import { PublicPaymentInfoController } from "./payment_info.controller";

const router = express.Router();

router.get("/", PublicPaymentInfoController.getPaymentInfo);

export const PublicPaymentInfoRoutes = router;
