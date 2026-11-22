// Módulo da digitalização certificada (M50, etapa 6; F2.2, lote 03-02): o controlador sobre a porta própria (MariaDB
// pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas (os pacientes do cadastro
// sintético); fora disso, a porta indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// A assinatura de quem conferiu usa o serviço ICP-Brasil do módulo de assinatura, achado na partida da app (o módulo de
// assinatura carregado em API_MODULOS); sem ele, o pedido de assinatura responde 503 e a conclusão não é ligada.
// A liberação (chave `digitalizacao`) vem da FONTE_CONFIGURACAO do módulo de configuração; na memória, a sintética.
import type { DynamicModule, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { fontesSinteticas } from '../../sessao/montar.js';
import { SERVICO_ASSINATURA_ICP } from '../assinatura/simbolos.js';
import type { ServicoAssinaturaIcp } from '../assinatura/aplicacao/servico.js';
import { PORTA_ASSINATURA_ICP, type PortaAssinaturaIcp } from '../assinatura/porta.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { ARMAZEM_DIGITALIZACAO, type ArmazemDigitalizacao, criarArmazemDigitalizacao } from './armazem.js';
import { ServicoAssinaturaDigitalizacao } from './assinatura.js';
import { DigitalizacaoController, SERVICO_ASSINATURA_DIGITALIZACAO } from './digitalizacao.controller.js';
import { PORTA_DIGITALIZACAO, type PortaDigitalizacao } from './porta.js';
import { PortaDigitalizacaoMemoria } from './porta-memoria.js';
import { portaDigitalizacaoIndisponivel, PortaDigitalizacaoPropria } from './porta-propria.js';

export interface OpcoesModuloDigitalizacao {
  /** Testes: a porta já montada. */
  readonly porta?: PortaDigitalizacao;
  /** Testes: o armazém dos arquivos. */
  readonly armazem?: ArmazemDigitalizacao;
  /** Testes: a fonte da liberação. */
  readonly configuracao?: unknown;
}

/**
 * A ligação com o serviço ICP-Brasil: na partida da app (todos os módulos montados), acha o serviço e a porta do módulo
 * de assinatura e cria o serviço da digitalização (que se registra no serviço ICP para concluir os pedidos de
 * finalidade "digitalizacao"). Sem o módulo de assinatura, `servico` fica null (o pedido responde 503).
 */
export class LigacaoAssinaturaDigitalizacao implements OnApplicationBootstrap {
  servico: ServicoAssinaturaDigitalizacao | null = null;

  constructor(
    private readonly ref: Pick<ModuleRef, 'get'>,
    private readonly porta: PortaDigitalizacao,
    private readonly armazem: ArmazemDigitalizacao,
  ) {}

  onApplicationBootstrap(): void {
    if (this.servico) return;
    let icp: ServicoAssinaturaIcp;
    let portaIcp: PortaAssinaturaIcp;
    try {
      icp = this.ref.get<ServicoAssinaturaIcp>(SERVICO_ASSINATURA_ICP, { strict: false });
      portaIcp = this.ref.get<PortaAssinaturaIcp>(PORTA_ASSINATURA_ICP, { strict: false });
    } catch {
      return;
    }
    this.servico = new ServicoAssinaturaDigitalizacao(icp, portaIcp, this.porta, this.armazem);
  }
}

/** A porta da digitalização pela regra do módulo (sem as opções de teste). */
export async function portaDaDigitalizacao(ctx: ContextoModulo): Promise<PortaDigitalizacao> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    // O código do estabelecimento da sessão vira o id do banco (o mesmo mapa dos outros módulos).
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaDigitalizacaoPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) {
    const cadastro = new PortaCadastroMemoria();
    return new PortaDigitalizacaoMemoria(async (c, pront) => {
      const r = await cadastro.buscarDireto(
        c as ContextoPorta,
        { tipo: 'prontuario', prontuario: pront },
        false,
      );
      const p = r.pacientes[0];
      return p ? { id: p.id, prontuario: p.prontuario, nome: p.nome, nomeSocial: p.nomeSocial } : null;
    });
  }
  return portaDigitalizacaoIndisponivel();
}

export async function moduloDigitalizacao(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloDigitalizacao = {},
): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDaDigitalizacao(ctx));
  // Com o núcleo, o disco local (ADR 0004); sem ele, a memória (a sessão sintética).
  const armazem =
    opcoes.armazem ??
    criarArmazemDigitalizacao(ctx.nucleo, ctx.configuracao.clientePadrao, ctx.env as NodeJS.ProcessEnv);
  const configuracao =
    opcoes.configuracao ??
    (porta.destino === 'memoria'
      ? fonteConfiguracaoMemoria(ctx.trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : null);
  return {
    module: class ModuloDigitalizacao {},
    controllers: [DigitalizacaoController],
    providers: [
      { provide: PORTA_DIGITALIZACAO, useValue: porta },
      { provide: ARMAZEM_DIGITALIZACAO, useValue: armazem },
      {
        provide: SERVICO_ASSINATURA_DIGITALIZACAO,
        useFactory: (ref: ModuleRef) => new LigacaoAssinaturaDigitalizacao(ref, porta, armazem),
        inject: [ModuleRef],
      },
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
    exports: [PORTA_DIGITALIZACAO, ARMAZEM_DIGITALIZACAO],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloDigitalizacao(ctx);
}
