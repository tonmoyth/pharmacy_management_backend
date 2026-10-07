import { Request, Response } from "express";
import { catchAsync } from "../../shared/catchAsync";
import sendResponse from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AuthService } from "./auth.service";
import { tokenUtils } from "../../utils/token";
import AppError from "../../errors/AppError";

const login = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.loginUser(req.body);
  const { user, token } = result;

  const jwtPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
  };

  // const accessToken = tokenUtils.getToken(jwtPayload as any);
  const refreshToken = tokenUtils.getRefreshToken(jwtPayload as any);

  // Set tokens in cookies
  // tokenUtils.setTokenCookie(res, accessToken);
  tokenUtils.setRefreshTokenCookie(res, refreshToken);
  tokenUtils.setBetterAuthSession(res, token);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User logged in successfully",
    data: Object.assign({}, user, {
      // token: accessToken,
      refreshToken,
      sessionToken: token,
    })
  });
});

const getNewRefreshToken = catchAsync(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken;
  const sessionToken = req.cookies?.["better-auth.session_token"] || req.cookies?.sessionToken;

  if (!refreshToken || !sessionToken) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token and session token are required.");
  }

  const result = await AuthService.getNewRefreshToken(
    refreshToken,
    sessionToken,
  );

  // tokenUtils.setTokenCookie(res, result.accessToken);
  tokenUtils.setRefreshTokenCookie(res, result.refreshToken);
  tokenUtils.setBetterAuthSession(res, sessionToken);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Token refreshed successfully",
    data: {
      // accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      session: result.session,
    },
  });
});

const logout = catchAsync(async (req: Request, res: Response) => {
  const sessionToken = req.cookies?.["better-auth.session_token"] || req.cookies?.sessionToken;

  if (sessionToken) {
    await AuthService.logoutUser(sessionToken);
  }

  // Clear all tokens from cookies
  tokenUtils.clearTokensCookies(res);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User logged out successfully",
    data: null,
  });
});


const getMe = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id; // attached by checkAuth middleware

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const result = await AuthService.getMe(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User profile retrieved successfully",
    data: result,
  });
});

const updateMe = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const result = await AuthService.updateMe(userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User profile updated successfully",
    data: result,
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const sessionToken = req.cookies?.["better-auth.session_token"] || req.cookies?.sessionToken;


  if (!sessionToken) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Session token is required to change password.");
  }

  const result = await AuthService.changePassword(payload, sessionToken);

  const { refreshToken } = result;

  // tokenUtils.setTokenCookie(res, accessToken);
  tokenUtils.setRefreshTokenCookie(res, refreshToken);
  tokenUtils.setBetterAuthSession(res, sessionToken);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed successfully.",
    data: {
      refreshToken,
      sessionToken
    },
  });
});

const changeEmail = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const sessionToken = req.cookies?.["better-auth.session_token"] || req.cookies?.sessionToken;

  if (!sessionToken) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Session token is required to change email.");
  }

  const result = await AuthService.changeEmail(
    payload,
    sessionToken,
    req.ip,
    req.headers["user-agent"]
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Email changed successfully.",
    data: result,
  });
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  await AuthService.forgotPassword(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset instructions sent successfully.",
    data: null,
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await AuthService.resetPassword(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password has been reset successfully.",
    data: null,
  });
});

export const AuthController = {
  login,
  getNewRefreshToken,
  logout,
  getMe,
  updateMe,
  changePassword,
  changeEmail,
  forgotPassword,
  resetPassword,
};
