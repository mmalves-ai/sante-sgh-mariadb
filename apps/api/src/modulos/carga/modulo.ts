// Módulo da linha de base de carga (k6) na API migrada: as rotas /api/carga só existem com o núcleo (o banco do cliente
// padrão) e só respondem em AMBIENTE=dev (404 nos demais). A busca de paciente usa a porta do cadastro, pela mesma regra
// do módulo do cadastro.
import { type DynamicModule, Module } from '@nestjs/common';
import { portaDoCadastro } from '../cadastro/modulo.js';
import { PORTA_CADASTRO } from '../cadastro/porta.js';
import type { ContextoModulo } from '../registro.js';
import { CargaController, FONTE_CARGA } from './carga.controller.js';
import { FonteCargaPropria } from './fonte-propria.js';

@Module({})
export class ModuloCarga {}

export async function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  const cliente = ctx.configuracao.clientePadrao;
  const fonte = ctx.nucleo && cliente ? new FonteCargaPropria(ctx.nucleo, cliente) : null;
  return {
    module: ModuloCarga,
    controllers: [CargaController],
    providers: [
      { provide: FONTE_CARGA, useValue: fonte },
      { provide: PORTA_CADASTRO, useValue: await portaDoCadastro(ctx) },
    ],
  };
}
