// Módulo do cadastro na API migrada (F2.2): pacientes, profissionais, solicitantes, pessoas e especialidades. A porta é
// a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora disso,
// a indisponível (503, falha fechada). Os testes passam a porta pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { ligarMapaEstabelecimentos } from './contexto-nucleo.js';
import { FichaComplementarController } from './ficha-complementar.controller.js';
import { FICHA_COMPLEMENTAR, FichaComplementarPropria } from './ficha-complementar-proprio.js';
import { CadastroVinculosProprio } from './paciente-vinculos-proprio.js';
import { PacienteVinculosController, VINCULOS_CADASTRO } from './paciente-vinculos.controller.js';
import { PacientesController } from './pacientes.controller.js';
import { PORTA_CADASTRO, type PortaCadastro, portaCadastroIndisponivel } from './porta.js';
import { PortaCadastroMemoria } from './porta-memoria.js';
import { PortaCadastroPropria } from './porta-propria.js';
import { ProfissionaisController } from './profissionais.controller.js';
import { ProfissionalComplementoController } from './profissional-complemento.controller.js';
import {
  COMPLEMENTO_PROFISSIONAL,
  ProfissionalComplementoProprio,
} from './profissional-complemento-proprio.js';

export interface OpcoesModuloCadastro {
  /** Porta pronta (testes). */
  readonly porta?: PortaCadastro;
}

/** A porta do cadastro pela regra do módulo (sem as opções de teste). */
export async function portaDoCadastro(ctx: ContextoModulo): Promise<PortaCadastro> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaCadastroPropria(ctx.nucleo, cliente);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaCadastroMemoria();
  return portaCadastroIndisponivel();
}

@Module({})
export class ModuloCadastro {}

export async function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloCadastro = {}): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDoCadastro(ctx));
  // Coberturas, pré-cadastro e captação (F3.1): só sobre o banco do cliente; sem ele, 503 nas rotas.
  const cliente = ctx.configuracao.clientePadrao;
  const vinculos = ctx.nucleo && cliente ? new CadastroVinculosProprio(ctx.nucleo, cliente) : null;
  // F3.1: ficha complementar (regras de campo, contatos e responsáveis), também só no banco do cliente.
  const ficha = ctx.nucleo && cliente ? new FichaComplementarPropria(ctx.nucleo, cliente) : null;
  // F3.1 (02-CAD linha 16): complemento do profissional (fiscal, conta, RQE e assinatura), só no banco do cliente.
  const complemento = ctx.nucleo && cliente ? new ProfissionalComplementoProprio(ctx.nucleo, cliente) : null;
  return {
    module: ModuloCadastro,
    controllers: [
      PacientesController,
      ProfissionaisController,
      PacienteVinculosController,
      FichaComplementarController,
      ProfissionalComplementoController,
    ],
    providers: [
      { provide: PORTA_CADASTRO, useValue: porta },
      { provide: VINCULOS_CADASTRO, useValue: vinculos },
      { provide: FICHA_COMPLEMENTAR, useValue: ficha },
      { provide: COMPLEMENTO_PROFISSIONAL, useValue: complemento },
    ],
    exports: [PORTA_CADASTRO],
  };
}
