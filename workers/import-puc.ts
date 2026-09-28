import { runWorker } from './import'

runWorker('puc').then(() => process.exit(0)).catch(() => process.exit(1))
