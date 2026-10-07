import { Response } from 'express';

interface IResponse<T> {
    statusCode: number;
    success: boolean;
    message?: string | null;
    meta?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
    data?: T | null;
    token?: string;
    refreshToken?: string;
    sessionToken?: string;
}

const sendResponse = <T>(res: Response, data: IResponse<T>) => {
    res.status(data.statusCode).json({
        success: data.success,
        message: data.message || null,
        meta: data.meta || null,
        data: data.data || null,
        token: data.token,
        refreshToken: data.refreshToken,
        sessionToken: data.sessionToken,
    });
};

export default sendResponse;