import app from './app';
import { envVeriables } from './config/envConfig';
import { initScheduledJobs } from './jobs';

async function main() {
  try {
    initScheduledJobs();

    app.listen(envVeriables.PORT, () => {
      console.log(`Pharmacy Management Server is running on port ${envVeriables.PORT}`);
    });
  } catch (err) {
    console.log(err);
  }
}

main();
