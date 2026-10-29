import type { CatalogueReadModel } from '../read-models'

/**
 * A book pulled off the shelves at random: its id, or null when nothing is
 * shelved. Chosen by the server so a phone is never sent the whole catalogue
 * to pick from, and with no memory of what it answered last, so asking twice
 * may answer the same book twice.
 */
export class RandomBookHandler {
  constructor(private readonly catalogue: CatalogueReadModel) {}

  async handle(): Promise<{ id: number } | null> {
    const id = await this.catalogue.randomShelvedId()
    return id === null ? null : { id }
  }
}
