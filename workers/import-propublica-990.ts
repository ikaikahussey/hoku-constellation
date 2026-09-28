import { runWorker } from './import'

runWorker('propublica_990').then(() => process.exit(0)).catch(() => process.exit(1))
