import { CookieOptions, Request, Response } from "express";

const setCookie = (
    res: Response,
    key: string,
    value: string,
    option: CookieOptions,
) => {
    res.cookie(key, value, option);
};

const getCookie = (req: Request, key: string) => {
    return req.cookies[key];
};

const clearCookie = (res: Response, key: string, option: CookieOptions) => {
    res.clearCookie(key, option);
};

export const cookieUtil = {
    setCookie,
    getCookie,
    clearCookie,
};