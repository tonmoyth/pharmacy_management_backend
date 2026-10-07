import { NextFunction, Request, Response } from "express";
import { ZodError, ZodSchema } from "zod";
import httpStatus from "http-status";

const validateRequest = (schema: ZodSchema) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await schema.parseAsync({
                body: req.body,
                query: req.query,
                params: req.params,
                cookies: req.cookies,
            });
            next();
        } catch (error: any) {
            if (error instanceof ZodError) {
                return res.status(httpStatus.BAD_REQUEST).json({
                    success: false,
                    message: "VALIDATION_ERROR",
                    errorSources: error.issues.map((issue) => ({
                        path: issue.path[issue.path.length - 1],
                        message: issue.message,
                    })),
                });
            }
            next(error);
        }
    };
};

export default validateRequest;
