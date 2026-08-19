import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObjectStorageService } from './object-storage.service';

/**
 * Global porque lo van a necesitar sitios que no se conocen entre sí —los XML
 * del SRI y los PDF sueltos, hoy; mañana lo que haga falta guardar— y ninguno
 * tiene por qué importar al otro solo para llegar aquí.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [ObjectStorageService],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule {}
