import argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { withTransaction } from '../db/pool'
import { findUserByEmail, findUserById, createUser, UserRow } from '../repositories/user.repo'
import { ConflictError, NotFoundError, UnauthenticatedError } from '../errors'
import { z } from 'zod'

export const registerSchema = z.object({
  name:     z.string().min(1),
  email:    z.string().email(),
  password: z.string().min(8),
  role:     z.enum(['PASSENGER', 'DRIVER']),
  gender:   z.enum(['MALE', 'FEMALE', 'OTHER']),
})

export const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

export type UserDTO = {
  id: string
  name: string
  email: string
  role: string
  gender: string
}

function toDTO(u: UserRow): UserDTO {
  return { id: u.id, name: u.name, email: u.email, role: u.role, gender: u.gender }
}

function signToken(user: UserRow): string {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '24h' })
}

export async function register(data: z.infer<typeof registerSchema>) {
  const existing = await findUserByEmail(data.email)
  if (existing) throw new ConflictError('EMAIL_TAKEN', 'Email already registered')

  const passwordHash = await argon2.hash(data.password)

  const user = await withTransaction(tx =>
    createUser(tx, { name: data.name, email: data.email, passwordHash, role: data.role, gender: data.gender }),
  )

  return { token: signToken(user), user: toDTO(user) }
}

export async function login(data: z.infer<typeof loginSchema>) {
  const user = await findUserByEmail(data.email)
  if (!user) throw new UnauthenticatedError('Invalid email or password')

  const valid = await argon2.verify(user.password_hash, data.password)
  if (!valid) throw new UnauthenticatedError('Invalid email or password')

  return { token: signToken(user), user: toDTO(user) }
}

export async function getMe(userId: string): Promise<UserDTO> {
  const user = await findUserById(userId)
  if (!user) throw new NotFoundError('User not found')
  return toDTO(user)
}
