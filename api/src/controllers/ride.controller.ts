import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { getDistance } from '../repositories/zone.repo'
import { soloFare, pooledFare } from '../domain/fare'
import { NotFoundError } from '../errors'
import { requestRide, getMyRides, getRideById, createRideSchema } from '../services/ride.service'
import { AuthedRequest } from './auth.controller'

export { createRideSchema }

export const quoteSchema = z.object({
  pickupZoneId:      z.number().int().positive(),
  destinationZoneId: z.number().int().positive(),
  seats:             z.number().int().min(1).max(3),
})

export async function createRideHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const authed = req as AuthedRequest
    const key = (req.headers['idempotency-key'] as string) ?? null
    const dto = await requestRide(authed.user.id, req.body as z.infer<typeof createRideSchema>, key)
    res.status(201).json({ ride: dto })
  } catch (err) {
    next(err)
  }
}

export async function getMyRidesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rides = await getMyRides((req as AuthedRequest).user.id)
    res.json({ rides })
  } catch (err) {
    next(err)
  }
}

export async function getRideByIdHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ride = await getRideById(req.params.id, (req as AuthedRequest).user.id)
    res.json({ ride })
  } catch (err) {
    next(err)
  }
}

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
