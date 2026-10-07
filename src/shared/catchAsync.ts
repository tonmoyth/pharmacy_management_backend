import e, { NextFunction, Request, RequestHandler, Response } from "express";
import AppError from "../errors/AppError";


export const catchAsync = (fn: RequestHandler) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await fn(req, res, next);
        } catch (error: any) {
            console.error("Error in catchAsync:", error.message);

            if (error instanceof AppError) {
                return res.status(error.statusCode).json({
                    success: false,
                    message: error.message,
                });
            }

            res.status(500).json({
                success: false,
                message: error?.message || "Internal Server Error",
                error: error,
            });
        }
    };
};