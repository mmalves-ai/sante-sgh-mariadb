// Módulo do atendimento externo na API migrada (F2.2): recepção ambulatorial, consultório e pronto atendimento. A porta
// é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora
// disso, a indisponível (503, falha fechada). Os testes passam a porta pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import type { ContextoModulo } from '../registro.js';
import { AtendimentoController } from './atendimento.controller.js';
import { AVISOS_ATENDIMENTO, AvisosAtendimento } from './avisos.js';
import { PaController } from './pa.controller.js';
import { PORTA_ATENDIMENTO, type PortaAtendimento, portaAtendimentoIndisponivel } from './porta.js';
import { PortaAtendimentoMemoria } from './porta-memoria.js';
import { PortaAtendimentoPropria } from './porta-propria.js';

export interface OpcoesModuloAtendimento {
  /** Porta pronta (testes). */
  readonly porta?: PortaAtendimento;
}

/** A porta do atendimento pela regra do módulo (sem as opções de teste). */
export async function portaDoAtendimento(ctx: ContextoModulo): Promise<PortaAtendimento> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaAtendimentoPropria(ctx.nucleo, cliente);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaAtendimentoMemoria({ estado: () => 'verde' });
  return portaAtendimentoIndisponivel();
}

@Module({})
export class ModuloAtendimento {}

export async function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloAtendimento = {}): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDoAtendimento(ctx));
  return {
    module: ModuloAtendimento,
    controllers: [AtendimentoController, PaController],
    providers: [
      { provide: PORTA_ATENDIMENTO, useValue: porta },
      // Os avisos ao vivo do atendimento (sem o vigia do sistema de origem: os eventos vêm das gravações).
      { provide: AVISOS_ATENDIMENTO, useValue: new AvisosAtendimento(null) },
    ],
    exports: [PORTA_ATENDIMENTO, AVISOS_ATENDIMENTO],
  };
}
