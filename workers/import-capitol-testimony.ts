import { runWorker } from './import'

runWorker('capitol_testimony').then(() => process.exit(0)).catch(() => process.exit(1))
