export default class AppError extends Error {
    public statusCode: number;
    public isOperational: boolean;
    public code?: string;

    constructor(statusCode: number, message: string, code?: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);

        this.statusCode = statusCode;
        this.isOperational = true;
        this.code = code;
        this.name = this.constructor.name;

        Error.captureStackTrace?.(this, this.constructor);
    }
}