import { runWorker } from './import'

runWorker('boards').then(() => process.exit(0)).catch(() => process.exit(1))
