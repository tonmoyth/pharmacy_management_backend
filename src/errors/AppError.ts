export default class AppError extends Error {
    public statusCode: number;
    public isOperational: boolean;

    constructor(statusCode: number, message: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);

        this.statusCode = statusCode;
        this.isOperational = true;
        this.name = this.constructor.name;

        Error.captureStackTrace?.(this, this.constructor);
    }
}