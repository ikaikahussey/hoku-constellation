import { runWorker } from './import'
import { runSummarizeNews } from './summarize-news'

runWorker('news')
  .then(() => runSummarizeNews([]))
  .then(() => process.exit(0)).catch(() => process.exit(1))
