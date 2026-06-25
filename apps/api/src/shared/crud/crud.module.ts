import { Global, Module } from '@nestjs/common';
import { CrudEngineService } from './crud-engine.service';
import { AggregateEngineService } from './aggregate-engine.service';
import { DatabaseProvider } from '../database/database.provider';

/** Engines CRUD/agregado disponíveis globalmente p/ os controllers gerados pelas fábricas. */
@Global()
@Module({
  providers: [CrudEngineService, AggregateEngineService, DatabaseProvider],
  exports: [CrudEngineService, AggregateEngineService],
})
export class CrudModule {}
