import { runWorker } from './import'

runWorker('csc').then(() => process.exit(0)).catch(() => process.exit(1))
