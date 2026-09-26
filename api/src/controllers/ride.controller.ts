import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { getDistance } from '../repositories/zone.repo'
import { soloFare, pooledFare } from '../domain/fare'
import { NotFoundError } from '../errors'

export const quoteSchema = z.object({
  pickupZoneId:      z.number().int().positive(),
  destinationZoneId: z.number().int().positive(),
  seats:             z.number().int().min(1).max(3),
})

export async function quoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { pickupZoneId, destinationZoneId } = req.body as z.infer<typeof quoteSchema>

    if (pickupZoneId === destinationZoneId) {
      throw new NotFoundError('Pickup and destination must differ')
    }

    const distanceKm = await getDistance(pickupZoneId, destinationZoneId)
    if (distanceKm === null) throw new NotFoundError('No route between these zones')

    res.json({
      distanceKm,
      soloFarePaisa:   soloFare(distanceKm),
      pooledFarePaisa: pooledFare(distanceKm),
    })
  } catch (err) {
    next(err)
  }
}
