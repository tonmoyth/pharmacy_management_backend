import app from './app';
import { envVeriables } from './config/envConfig';

async function main() {
  try {
    app.listen(envVeriables.PORT, () => {
      console.log(`Pharmacy Management Server is running on port ${envVeriables.PORT}`);
    });
  } catch (err) {
    console.log(err);
  }
}

main();
