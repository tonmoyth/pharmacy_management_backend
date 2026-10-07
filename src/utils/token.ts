import { JwtPayload, SignOptions } from "jsonwebtoken";
import { Response } from "express";

import { envVeriables } from "../config/envConfig";
import { jwtUtils } from "./jwtUtils";
import { cookieUtil } from "./cookie";

const getToken = (
    payload: JwtPayload,
    expiresIn: SignOptions["expiresIn"] = envVeriables.JWT_EXPIRES_IN as SignOptions["expiresIn"],
) => {
    const accessToken = jwtUtils.createToken(
        payload,
        envVeriables.JWT_SECRET_KEY,
        {
            expiresIn,
        } as SignOptions,
    );
    return accessToken;
};

const getRefreshToken = (
    payload: JwtPayload,
    expiresIn: SignOptions["expiresIn"] = envVeriables.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"],
) => {
    const refreshToken = jwtUtils.createToken(
        payload,
        envVeriables.JWT_REFRESH_SECRET_KEY,
        { expiresIn } as SignOptions,
    );
    return refreshToken;
};

const setTokenCookie = (res: Response, token: string) => {
    cookieUtil.setCookie(res, "accessToken", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });
};

const setRefreshTokenCookie = (res: Response, token: string) => {
    cookieUtil.setCookie(res, "refreshToken", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });
};

const setBetterAuthSession = (res: Response, session: string) => {
    cookieUtil.setCookie(res, "better-auth.session_token", session, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });
};

const clearTokensCookies = (res: Response) => {
    res.clearCookie("accessToken", { path: "/" });
    res.clearCookie("refreshToken", { path: "/" });
    res.clearCookie("better-auth.session_token", { path: "/" });
    res.clearCookie("sessionToken", { path: "/" });
};

export const tokenUtils = {
    getToken,
    getRefreshToken,
    setTokenCookie,
    setRefreshTokenCookie,
    setBetterAuthSession,
    clearTokensCookies,
};