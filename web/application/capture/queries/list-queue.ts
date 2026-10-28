import type { QueuedBookView, QueueReadModel } from '../read-models'

/** Every book in the scanning queue, as `GET /api/captures` and `list_queue` read it. */
export class ListQueueHandler {
  constructor(private readonly queue: QueueReadModel) {}

  handle(): Promise<QueuedBookView[]> {
    return this.queue.list()
  }
}
