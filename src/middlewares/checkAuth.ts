import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../shared/catchAsync';
import { prisma } from '../lib/prisma';
import AppError from '../errors/AppError';
import { jwtUtils } from '../utils/jwtUtils';
import { envVeriables } from '../config/envConfig';

declare global {
    namespace Express {
        interface Request {
            user?: any;
        }
    }
}

import { Role } from '@prisma/client';

export const checkAuth = (...roles: string[]) => {
    return catchAsync(async (req: Request, res: Response, next: NextFunction) => {

        // ─── OLD SESSION-BASED AUTH (commented out) ───────────────────────────
        const token =
            req.cookies['better-auth.session_token'] ||
            req.cookies['sessionToken'] ||
            req.cookies['accessToken'] ||
            req.headers.authorization?.split(' ')[1];

        if (!token) {
            throw new AppError(401, 'You are not authorized');
        }

        const session = await prisma.session.findFirst({
            where: { token },
            include: { user: true },
        });

        if (!session || !session.user) {
            throw new AppError(401, 'You are not authorized');
        }

        if (session.expiresAt < new Date()) {
            throw new AppError(401, 'Session expired');
        }

        if (roles.length > 0 && !roles.includes(session.user.role as Role)) {
            throw new AppError(403, 'Forbidden. You are not allowed to perform this action.');
        }

        req.user = session.user;
        next();
        // ──────────────────────────────────────────────────────────────────────

        // Extract token from cookie or Authorization header
        // const token =
        //     req.cookies['accessToken'] ||
        //     req.headers.authorization?.split(' ')[1];

        // if (!token) {
        //     throw new AppError(401, 'You are not authorized');
        // }

        // // 1. Verify and decode the access token
        // const result = jwtUtils.verifyToken(token, envVeriables.JWT_SECRET_KEY);

        // if (!result.seccess || !result.data) {
        //     throw new AppError(401, 'Invalid or expired token');
        // }

        // const decoded = result.data as { email: string; [key: string]: any };

        // // 2. Extract email from decoded payload
        // const email = decoded.email;

        // if (!email) {
        //     throw new AppError(401, 'Invalid token payload');
        // }

        // // 3. Find user in database using email
        // const user = await prisma.user.findUnique({
        //     where: { email },
        // });

        // if (!user) {
        //     throw new AppError(401, 'User not found');
        // }

        // // Attach user to request object
        // req.user = user;
        // next();
    });
};