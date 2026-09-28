import { runWorker } from './import'

runWorker('fec').then(() => process.exit(0)).catch(() => process.exit(1))
