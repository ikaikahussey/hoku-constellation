import { runWorker } from './import'

runWorker('property_hnl').then(() => process.exit(0)).catch(() => process.exit(1))
