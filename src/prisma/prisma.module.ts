import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { BlindIndex } from '../crypto/blind-index.js';
import { FieldCipher } from '../crypto/field-cipher.js';
import { createPrismaClient, PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      inject: [ConfigService, FieldCipher, BlindIndex],
      useFactory: (
        config: ConfigService<Env, true>,
        cipher: FieldCipher,
        blindIndex: BlindIndex,
      ) =>
        createPrismaClient(
          config.get('DATABASE_URL', { infer: true }),
          cipher,
          blindIndex,
        ),
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule implements OnModuleDestroy {
  constructor(private readonly prisma: PrismaService) {}

  // Factory-provided clients don't get lifecycle hooks, so close it here.
  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
