import express from "express";
import { PublicPlanController } from "./plan.public.controller";

const router = express.Router();

router.get("/", PublicPlanController.getActivePlans);

export const PublicPlanRoutes = router;
