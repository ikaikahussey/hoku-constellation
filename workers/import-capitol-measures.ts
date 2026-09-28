import { runWorker } from './import'

runWorker('capitol_measures').then(() => process.exit(0)).catch(() => process.exit(1))
