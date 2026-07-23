import { PrismaClient } from '@prisma/client';

// Single Prisma client instance for the server process.
export const db = new PrismaClient();
