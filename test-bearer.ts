import { prisma } from "./src/lib/prisma";
import { auth } from "./src/lib/auth";

async function test() {
  console.log("Testing auth.api.resetPasswordEmailOTP");
  try {
    const res = await (auth.api as any).resetPasswordEmailOTP({
      body: {
        email: "nonexistent@gmail.com",
        otp: "123456",
        password: "NewPassword123"
      }
    } as any);
    console.log("Success with resetPasswordEmailOTP", Object.keys(res || {}));
  } catch (e: any) {
    console.log("Error with resetPasswordEmailOTP:", e.message, e.body);
  }
}
test();
