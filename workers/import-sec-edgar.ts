import { runWorker } from './import'

runWorker('sec_edgar').then(() => process.exit(0)).catch(() => process.exit(1))
