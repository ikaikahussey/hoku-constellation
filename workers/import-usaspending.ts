import { runWorker } from './import'

runWorker('usaspending').then(() => process.exit(0)).catch(() => process.exit(1))
