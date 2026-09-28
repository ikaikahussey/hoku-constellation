import { runWorker } from './import'

runWorker('spo_hands').then(() => process.exit(0)).catch(() => process.exit(1))
