// Módulo das integrações (M34) e da fachada da API de integração da Hal-AI (M58-F4) na API migrada (F2.2, lote
// 04-01): as portas próprias sobre o banco do cliente quando o núcleo existe; sem núcleo, as de memória só em dev/ci
// (fontes sintéticas); fora disso, as indisponíveis (503, falha fechada). Os testes passam as portas prontas.
// - O conteúdo das mensagens vai ao armazém de objetos (S3 do ambiente); na sessão sintética, à memória.
// - A configuração (FONTE_CONFIGURACAO e CACHE_CONFIG) vem do módulo config (global) quando registrado; na memória sem
//   ele, a fonte sintética local.
// - A entrada do parceiro aceita os estabelecimentos do cliente (o código desconhecido não acha a credencial: 401).
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { ClienteS3 } from '../documento/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { criarServicoFachada, FachadaController, SERVICO_FACHADA } from './fachada/fachada.controller.js';
import type { PortaFachada } from './fachada/porta.js';
import { PORTA_FACHADA } from './fachada/porta.js';
import { PortaFachadaMemoria } from './fachada/porta-memoria.js';
import { portaFachadaIndisponivel, PortaFachadaPropria } from './fachada/porta-propria.js';
import { type ArmazemConteudo, ArmazemConteudoMemoria, ArmazemConteudoS3 } from './infra/armazem-conteudo.js';
import { ARMAZEM_CONTEUDO, ESTABELECIMENTOS_ENTRADA, IntegracaoController } from './integracao.controller.js';
import { PORTA_INTEGRACAO, type PortaIntegracao } from './porta.js';
import { PortaIntegracaoMemoria } from './porta-memoria.js';
import { portaIntegracaoIndisponivel, PortaIntegracaoPropria } from './porta-propria.js';

export interface OpcoesModuloIntegracao {
  /** Testes: as portas e o armazém já montados. */
  readonly porta?: PortaIntegracao;
  readonly fachada?: PortaFachada;
  readonly armazem?: ArmazemConteudo;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: FonteConfiguracao;
  /** Estabelecimentos aceitos na entrada do parceiro (vazio: todos os do cliente). */
  readonly estabelecimentosEntrada?: readonly string[];
}

export function moduloIntegracao(ctx: ContextoModulo, o: OpcoesModuloIntegracao = {}): DynamicModule {
  const sintetica = fontesSinteticas(ctx.env);
  const cliente = ctx.configuracao.clientePadrao;
  const nucleo = ctx.nucleo && cliente ? ctx.nucleo : null;
  const armazem: ArmazemConteudo =
    o.armazem ??
    (!nucleo && sintetica
      ? new ArmazemConteudoMemoria()
      : new ArmazemConteudoS3(
          new ClienteS3({
            endpoint: ctx.env['S3_ENDPOINT']?.trim() || 'http://127.0.0.1:9318',
            regiao: ctx.env['S3_REGIAO']?.trim() || 'us-east-1',
            acesso: ctx.env['S3_SEGREDO']?.trim() ? ctx.env['S3_ACESSO']?.trim() : undefined,
            segredo: ctx.env['S3_SEGREDO']?.trim() || undefined,
          }),
        ));
  const porta: PortaIntegracao =
    o.porta ??
    (nucleo && cliente
      ? new PortaIntegracaoPropria(nucleo, cliente)
      : sintetica && armazem instanceof ArmazemConteudoMemoria
        ? new PortaIntegracaoMemoria(armazem, ctx.trilha)
        : portaIntegracaoIndisponivel());
  const fachada: PortaFachada =
    o.fachada ??
    (nucleo && cliente
      ? new PortaFachadaPropria(nucleo, cliente)
      : sintetica
        ? new PortaFachadaMemoria()
        : portaFachadaIndisponivel());
  const local =
    o.configuracao ??
    (porta.destino === 'memoria'
      ? fonteConfiguracaoMemoria(ctx.trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: parametrosIniciaisSinteticos,
        })
      : null);
  return {
    module: class ModuloIntegracao {},
    controllers: [IntegracaoController, FachadaController],
    providers: [
      { provide: PORTA_INTEGRACAO, useValue: porta },
      { provide: PORTA_FACHADA, useValue: fachada },
      { provide: ARMAZEM_CONTEUDO, useValue: armazem },
      { provide: ESTABELECIMENTOS_ENTRADA, useValue: o.estabelecimentosEntrada ?? [] },
      ...(local ? [{ provide: FONTE_CONFIGURACAO, useValue: local }] : []),
      {
        provide: SERVICO_FACHADA,
        useFactory: (fonte: FonteConfiguracao | null) => criarServicoFachada(fachada, fonte ?? local, ctx.env),
        inject: [{ token: FONTE_CONFIGURACAO, optional: true }],
      },
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloIntegracao(ctx);
}
