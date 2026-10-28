import type { QueueCounts, QueueReadModel } from '../read-models'

/**
 * How many books in the scanning queue are being read, ready to shelve and
 * stuck: the numbers the first screen draws.
 */
export class CountQueueHandler {
  constructor(private readonly queue: QueueReadModel) {}

  handle(): Promise<QueueCounts> {
    return this.queue.counts()
  }
}
