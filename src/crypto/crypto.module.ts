import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { BlindIndex } from './blind-index.js';
import { FieldCipher } from './field-cipher.js';
import { decodeKey, parseKeyring } from './keys.js';

// Keys are already validated at startup (config validation), so parsing here
// can't fail on a misconfigured environment.
@Global()
@Module({
  providers: [
    {
      provide: FieldCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new FieldCipher(
          parseKeyring(config.get('ENCRYPTION_KEYS', { infer: true })),
          config.get('ENCRYPTION_ACTIVE_KEY_ID', { infer: true }),
        ),
    },
    {
      provide: BlindIndex,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new BlindIndex(
          decodeKey(config.get('BLIND_INDEX_KEY', { infer: true })),
        ),
    },
  ],
  exports: [FieldCipher, BlindIndex],
})
export class CryptoModule {}
