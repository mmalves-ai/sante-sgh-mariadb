// Módulo do M16 na API migrada (F2.2): painel de leitos ao vivo, censo, painéis gerenciais, indicadores, BI e o vigia
// de mudanças. A fonte é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só
// em dev/ci (a "gravação por fora" do E2E pelo arquivo LEITOS_SINTETICOS_POR_FORA); fora disso, a indisponível (503,
// falha fechada). O vigia é um por processo, com a marca d'água no armazém da sessão. Os testes passam a fonte e o vigia
// pelas opções.
// Melhoria: o vigia lê o canal pela trilha de auditoria do banco do cliente (sem gatilho nem consulta por tela), no
// contexto do núcleo da sessão (cliente e estabelecimento por id).
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import type { ContextoModulo } from '../registro.js';
import { ConfiguracaoM16 } from './configuracao.js';
import { FONTE_INTERNACAO, type FonteInternacao, fonteInternacaoIndisponivel } from './fonte.js';
import { FonteInternacaoMemoria, variantesSinteticasRede } from './fonte-memoria.js';
import { FonteInternacaoPropria } from './fonte-propria.js';
import { LeitosController } from './leitos.controller.js';
import { RelatorioController } from './relatorio.controller.js';
import { ServicoInternacao } from './servico.js';
import {
  BATIDA_EVENTOS_MS,
  BATIDA_EVENTOS_PADRAO_MS,
  CONFIGURACAO_M16,
  SERVICO_INTERNACAO,
} from './simbolos.js';
import { intervaloDoAmbiente, MOTOR_VIGIA, MotorVigia } from './vigia.js';

export interface OpcoesModuloInternacao {
  /** Fonte pronta (testes). */
  readonly fonte?: FonteInternacao;
  /** Vigia pronto (testes); null desliga o vigia. */
  readonly vigia?: MotorVigia | null;
  /** Batida do canal de eventos (testes). */
  readonly batidaEventosMs?: number;
}

/** A fonte do M16 pela regra do módulo (sem as opções de teste). */
export async function fonteDaInternacao(ctx: ContextoModulo): Promise<FonteInternacao> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new FonteInternacaoPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return new FonteInternacaoMemoria({
      arquivoPorFora: ctx.env['LEITOS_SINTETICOS_POR_FORA']?.trim() || null,
      variantes: variantesSinteticasRede(ctx.env['REDE_SINTETICA_SEGUNDO']),
    });
  return fonteInternacaoIndisponivel();
}

@Module({})
export class ModuloInternacao {}

export async function modulo(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloInternacao = {},
): Promise<DynamicModule> {
  const fonte = opcoes.fonte ?? (await fonteDaInternacao(ctx));
  const armazemCompartilhado = !(ctx.armazem instanceof ArmazemMemoria);
  const vigia =
    opcoes.vigia !== undefined
      ? opcoes.vigia
      : new MotorVigia({
          lerCanal: (alvo, canal, marca) => fonte.canal(alvo, canal, marca),
          armazem: ctx.armazem,
          tipoArmazem: armazemCompartilhado ? 'valkey' : 'memoria',
          intervaloMs: intervaloDoAmbiente(ctx.env),
        });
  return {
    module: ModuloInternacao,
    controllers: [LeitosController, RelatorioController],
    providers: [
      { provide: FONTE_INTERNACAO, useValue: fonte },
      { provide: MOTOR_VIGIA, useValue: vigia },
      { provide: BATIDA_EVENTOS_MS, useValue: opcoes.batidaEventosMs ?? BATIDA_EVENTOS_PADRAO_MS },
      {
        provide: SERVICO_INTERNACAO,
        // Painéis da cópia diária no armazém compartilhado (Valkey) só com a fonte do banco; a memória é deste processo.
        useValue: new ServicoInternacao(
          fonte,
          vigia,
          undefined,
          fonte instanceof FonteInternacaoPropria && armazemCompartilhado ? ctx.armazem : null,
        ),
      },
      {
        provide: CONFIGURACAO_M16,
        useFactory: (cfg: FonteConfiguracao | null, cache: CacheConfig | null) =>
          new ConfiguracaoM16(cfg, cache),
        inject: [
          { token: FONTE_CONFIGURACAO, optional: true },
          { token: CACHE_CONFIG, optional: true },
        ],
      },
    ],
    exports: [FONTE_INTERNACAO, MOTOR_VIGIA, SERVICO_INTERNACAO, CONFIGURACAO_M16],
  };
}
