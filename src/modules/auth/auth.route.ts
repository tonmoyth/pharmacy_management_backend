import express from "express";
import { Role } from "@prisma/client";
import { AuthController } from "./auth.controller";

import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { AuthValidation } from "./auth.validation";

const router = express.Router();

router.post("/login", AuthController.login);

router.post("/refresh", AuthController.getNewRefreshToken);

router.post("/logout", AuthController.logout);

router.get("/me", checkAuth(), AuthController.getMe);

router.patch("/me", checkAuth(), validateRequest(AuthValidation.updateMeZodSchema), AuthController.updateMe);

router.post("/change-password", checkAuth(), validateRequest(AuthValidation.changePasswordZodSchema), AuthController.changePassword);

router.post("/change-email", checkAuth(Role.SUPER_ADMIN, Role.PHARMACY_OWNER), validateRequest(AuthValidation.changeEmailZodSchema), AuthController.changeEmail);


router.post("/forgot-password", checkAuth(Role.SUPER_ADMIN, Role.PHARMACY_OWNER), validateRequest(AuthValidation.forgotPasswordZodSchema), AuthController.forgotPassword);

router.post("/reset-password", checkAuth(Role.SUPER_ADMIN, Role.PHARMACY_OWNER), validateRequest(AuthValidation.resetPasswordZodSchema), AuthController.resetPassword);

export const AuthRoutes = router;
