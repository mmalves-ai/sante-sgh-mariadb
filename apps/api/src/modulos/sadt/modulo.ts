// Módulo do SADT (M26) na API migrada (F2.2): as telas do diagnóstico, a lista de trabalho DICOM (M47) e o portal de
// resultados sobre a porta própria (MariaDB pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as
// fontes sintéticas; fora disso, a porta indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// A liberação por chave e os parâmetros vêm da FONTE_CONFIGURACAO global do módulo de configuração (na memória, a
// funcionalidade vale ligada, como na sessão sintética). A vigia do valor crítico roda no banco (SADT_VIGIA_CRITICOS=nao
// a desliga) e na memória só com SADT_VIGIA_CRITICOS=sintetica, nos estabelecimentos ativos do cliente.
// Melhoria: o portal e a vigia operam pelo contexto do núcleo (cliente e estabelecimento por id); a lista de
// estabelecimentos da vigia vem do banco do cliente, não de uma lista fixa do ambiente.
import { randomBytes } from 'node:crypto';
import { type DynamicModule, Module } from '@nestjs/common';
import { chaveMestra } from '@sgh/dominio-acesso';
import { fontesSinteticas } from '../../sessao/montar.js';
import { AvisosAtendimento } from '../atendimento/public-api.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { type ContextoModulo, modulosPedidos } from '../registro.js';
import { ServicoComunicacao } from '../acesso/aplicacao/comunicacao.js';
import { AVISOS_INICIO } from '../acesso/comunicacao.controller.js';
import { PORTA_COMUNICACAO, type PortaComunicacao } from '../acesso/comunicacao-porta.js';
import { CENTRAL_AVISOS_SADT } from './aplicacao/central-critico.js';
import { ServicoPacs } from './aplicacao/pacs.js';
import { ServicoPortal } from './aplicacao/portal.js';
import { VigiaCriticos } from './aplicacao/vigia-criticos.js';
import { PacsController, SERVICO_PACS } from './pacs.controller.js';
import { PORTA_PACS, type PortaPacs } from './pacs-porta.js';
import { PortaPacsMemoria } from './pacs-porta-memoria.js';
import { portaPacsIndisponivel, PortaPacsPropria } from './pacs-porta-propria.js';
import { PORTA_SADT, type PortaSadt } from './porta.js';
import { PortaSadtMemoria } from './porta-memoria.js';
import { PortalController, SERVICO_PORTAL } from './portal.controller.js';
import { AVISOS_SADT, SadtController, VIGIA_CRITICOS } from './sadt.controller.js';

export interface OpcoesModuloSadt {
  /** Testes: as portas já montadas. */
  readonly porta?: PortaSadt;
  readonly pacs?: PortaPacs;
  /** Testes: os estabelecimentos da vigia (sem ler o banco). */
  readonly estabelecimentos?: readonly string[];
}

/** As portas do SADT e da lista de trabalho DICOM pela regra do módulo. */
export async function portasDoSadt(ctx: ContextoModulo): Promise<{ sadt: PortaSadt; pacs: PortaPacs }> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    const { PortaSadtPropria } = await import('./porta-propria.js');
    const sadt = new PortaSadtPropria(ctx.nucleo);
    return { sadt, pacs: new PortaPacsPropria(ctx.nucleo, sadt) };
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) {
    const sadt = new PortaSadtMemoria(null);
    return { sadt, pacs: new PortaPacsMemoria(sadt) };
  }
  const { portaSadtIndisponivel } = await import('./porta-propria.js');
  return { sadt: portaSadtIndisponivel(), pacs: portaPacsIndisponivel() };
}

/** Os códigos dos estabelecimentos ativos do cliente (a vigia percorre cada um). */
async function estabelecimentosAtivos(ctx: ContextoModulo): Promise<string[]> {
  const cliente = ctx.configuracao.clientePadrao;
  if (!ctx.nucleo || !cliente) return [];
  const linhas = await ctx.nucleo.lerSomente({ cliente, correlacao: 'sadt-estabelecimentos' }, (l) =>
    l.consultar<{ codigo: string }>(
      'SELECT codigo FROM estabelecimento WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY id',
      [],
    ),
  );
  return linhas.map((x) => x.codigo);
}

@Module({})
export class ModuloSadt {}

export async function moduloSadt(ctx: ContextoModulo, opcoes: OpcoesModuloSadt = {}): Promise<DynamicModule> {
  const portas = opcoes.porta ? null : await portasDoSadt(ctx);
  const sadt = opcoes.porta ?? portas!.sadt;
  const pacs = opcoes.pacs ?? portas?.pacs ?? (sadt.destino === 'memoria' ? new PortaPacsMemoria(sadt) : portaPacsIndisponivel());
  const memoria = sadt.destino === 'memoria';
  const marca = ctx.env['SADT_VIGIA_CRITICOS'];
  const comVigia = memoria ? marca === 'sintetica' : marca !== 'nao' && !!ctx.nucleo;
  const estabelecimentos = opcoes.estabelecimentos ?? (comVigia || !memoria ? await estabelecimentosAtivos(ctx) : []);
  const rede = ctx.configuracao.rede ?? '';
  const chavePortal =
    chaveMestra(ctx.env['PORTAL_CHAVE_MESTRA'] ?? ctx.env['PLATAFORMA_CHAVE_MESTRA']) ??
    (fontesSinteticas(ctx.env) ? randomBytes(32) : null);
  const avisos = new AvisosAtendimento(null);
  // Na memória, a fonte sintética da configuração (as chaves iniciais ligadas, como a sessão sintética); no banco, a
  // global do módulo de configuração.
  // Com o módulo de configuração pedido (API_MODULOS), a fonte é a global dele: a liberação feita na tela vale aqui.
  const comConfiguracao = (() => {
    try {
      return modulosPedidos(ctx.env).includes('config');
    } catch {
      return false;
    }
  })();
  const configuracaoMemoria = memoria && !comConfiguracao
    ? fonteConfiguracaoMemoria(ctx.trilha, {
        chavesIniciais: chavesIniciaisSinteticas,
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : null;
  const configuracaoDe = (f: FonteConfiguracao | null | undefined) => configuracaoMemoria ?? f ?? null;
  return {
    module: ModuloSadt,
    // Global: o portal-medico injeta as portas deste módulo (montagem da onda 4).
    global: true,
    controllers: [SadtController, PortalController, PacsController],
    providers: [
      ...(configuracaoMemoria ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracaoMemoria }] : []),
      { provide: PORTA_SADT, useValue: sadt },
      { provide: PORTA_PACS, useValue: pacs },
      { provide: AVISOS_SADT, useValue: avisos },
      // A central de avisos (o sino) é a comunicação do módulo acesso: sem ele, o aviso do crítico fica no painel do SADT.
      {
        provide: CENTRAL_AVISOS_SADT,
        inject: [
          { token: PORTA_COMUNICACAO, optional: true },
          { token: AVISOS_INICIO, optional: true },
        ],
        useFactory: (porta?: PortaComunicacao | null, inicio?: AvisosAtendimento | null) =>
          porta ? new ServicoComunicacao(porta, inicio ?? null) : null,
      },
      {
        provide: VIGIA_CRITICOS,
        useFactory: (f?: FonteConfiguracao | null) =>
          comVigia ? new VigiaCriticos(sadt, rede, estabelecimentos, configuracaoDe(f), avisos) : null,
        inject: [{ token: FONTE_CONFIGURACAO, optional: true }],
      },
      {
        provide: SERVICO_PACS,
        useFactory: (f?: FonteConfiguracao | null, cache?: CacheConfig | null) =>
          new ServicoPacs(pacs, ctx.trilha, configuracaoDe(f), cache ?? null, ctx.env),
        inject: [
          { token: FONTE_CONFIGURACAO, optional: true },
          { token: CACHE_CONFIG, optional: true },
        ],
      },
      {
        provide: SERVICO_PORTAL,
        useFactory: (servicoPacs: ServicoPacs, f?: FonteConfiguracao | null) => {
          const portal = new ServicoPortal(
            sadt,
            rede,
            configuracaoDe(f),
            chavePortal,
            ctx.configuracao.produtoNome,
            estabelecimentos[0] ?? null,
          );
          portal.imagens = (c, exame) => servicoPacs.imagemDoLaudo(c, exame);
          return portal;
        },
        inject: [SERVICO_PACS, { token: FONTE_CONFIGURACAO, optional: true }],
      },
    ],
    exports: [PORTA_SADT, PORTA_PACS, SERVICO_PORTAL, SERVICO_PACS, AVISOS_SADT],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloSadt(ctx);
}
