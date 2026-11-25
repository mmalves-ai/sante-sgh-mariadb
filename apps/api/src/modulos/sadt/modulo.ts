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
import { MapaTrabalhoController, SERVICO_MAPA_TRABALHO } from './mapa-trabalho.controller.js';
import { LoteTrabalhoController, SERVICO_LOTE_TRABALHO } from './lote-trabalho.controller.js';
import { ResultadoBancoController, SERVICO_RESULTADO_SADT } from './resultado-banco.controller.js';
import { OrcamentoExamesController, SERVICO_ORCAMENTO_SADT } from './orcamento-exames.controller.js';
import { PedidoSadtController, SERVICO_PEDIDO_SADT } from './pedido.controller.js';
import { PedidoProntuarioSadtController } from './pedido-prontuario.controller.js';
import { AVISOS_SADT, SadtController, VIGIA_CRITICOS } from './sadt.controller.js';
import { CATALOGO_SADT, PortaCatalogoSadtPropria } from './catalogo-porta-propria.js';
import { CatalogoSadtController } from './catalogo.controller.js';
import { PortaRespostasSadtPropria, RESPOSTAS_SADT } from './catalogo-respostas-propria.js';
import { CatalogoRespostasSadtController } from './catalogo-respostas.controller.js';
import { LaudoGrandezasController } from './laudo-grandezas.controller.js';
import { ConsumoPadraoExameController } from './consumo-padrao.controller.js';
import { BuscaAtivaResultadoController } from './busca-ativa.controller.js';
import { BUSCA_ATIVA_RESULTADO, PortaBuscaAtivaPropria } from './busca-ativa-propria.js';
import { CONSUMO_PADRAO_EXAME, PortaConsumoPadraoExamePropria } from './consumo-padrao-propria.js';
import { HemodinamicaController } from './hemodinamica.controller.js';
import { PORTA_HEMODINAMICA, PortaHemodinamicaPropria } from './hemodinamica-propria.js';
import { LaudoMamaPatologiaController } from './laudo-mama-patologia.controller.js';
import {
  PORTA_LAUDO_MAMA_PATOLOGIA,
  PortaLaudoMamaPatologiaPropria,
} from './laudo-mama-patologia-propria.js';
import { GRANDEZAS_LAUDO, PortaGrandezasLaudoPropria } from './laudo-grandezas-propria.js';
import { LaudoRedacaoController, SERVICO_LAUDO_REDACAO } from './laudo-redacao.controller.js';
import { ApoioRemessaController, SERVICO_APOIO_REMESSA } from './apoio-remessa.controller.js';
import { EscalaExecucaoController, SERVICO_ESCALA_EXECUCAO } from './escala-execucao.controller.js';
import {
  InterfaceEquipamentoController,
  SERVICO_INTERFACE_EQUIPAMENTO,
} from './interface-equipamento.controller.js';
import { EntregaResultadoController, SERVICO_ENTREGA_RESULTADO } from './entrega-resultado.controller.js';
import { LimitesExameController, SERVICO_LIMITES_EXAME } from './limites-exame.controller.js';
import { AutoliberacaoController, SERVICO_AUTOLIBERACAO } from './autoliberacao.controller.js';
import { SERVICO_SOROTECA, SorotecaController } from './soroteca.controller.js';
import { MicrobiologiaController, SERVICO_MICROBIOLOGIA } from './microbiologia.controller.js';
import {
  MicrobiologiaCadastroController,
  SERVICO_CADASTRO_MICROBIOLOGIA,
} from './microbiologia-cadastro.controller.js';

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
  const pacs =
    opcoes.pacs ??
    portas?.pacs ??
    (sadt.destino === 'memoria' ? new PortaPacsMemoria(sadt) : portaPacsIndisponivel());
  const memoria = sadt.destino === 'memoria';
  const marca = ctx.env['SADT_VIGIA_CRITICOS'];
  const comVigia = memoria ? marca === 'sintetica' : marca !== 'nao' && !!ctx.nucleo;
  const estabelecimentos =
    opcoes.estabelecimentos ?? (comVigia || !memoria ? await estabelecimentosAtivos(ctx) : []);
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
  const configuracaoMemoria =
    memoria && !comConfiguracao
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
    controllers: [
      SadtController,
      PortalController,
      PacsController,
      CatalogoSadtController,
      CatalogoRespostasSadtController,
      PedidoSadtController,
      PedidoProntuarioSadtController,
      OrcamentoExamesController,
      MapaTrabalhoController,
      LoteTrabalhoController,
      ResultadoBancoController,
      LaudoRedacaoController,
      LaudoGrandezasController,
      ApoioRemessaController,
      LimitesExameController,
      AutoliberacaoController,
      SorotecaController,
      EntregaResultadoController,
      EscalaExecucaoController,
      InterfaceEquipamentoController,
      MicrobiologiaController,
      MicrobiologiaCadastroController,
      ConsumoPadraoExameController,
      BuscaAtivaResultadoController,
      HemodinamicaController,
      LaudoMamaPatologiaController,
    ],
    providers: [
      // F8 (04-CC linha 107): registro do exame de hemodinâmica (só no banco do cliente).
      {
        provide: PORTA_HEMODINAMICA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaHemodinamicaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F7 (05-SADT linha 18): laudos estruturados de mamografia e de anatomia patológica (só no banco do cliente).
      {
        provide: PORTA_LAUDO_MAMA_PATOLOGIA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaLaudoMamaPatologiaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F8 (05-SADT linha 22): consumo padrão do exame, baixa no estoque e lançamento na conta (só no banco do cliente).
      {
        provide: CONSUMO_PADRAO_EXAME,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaConsumoPadraoExamePropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F8 (05-SADT linha 24): busca ativa de resultados liberados depois da alta (só no banco do cliente).
      {
        provide: BUSCA_ATIVA_RESULTADO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaBuscaAtivaPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // Manutenção do catálogo de exames (F3.5): só com o banco do cliente; sem ele, 503.
      { provide: CATALOGO_SADT, useValue: ctx.nucleo ? new PortaCatalogoSadtPropria(ctx.nucleo) : null },
      { provide: RESPOSTAS_SADT, useValue: ctx.nucleo ? new PortaRespostasSadtPropria(ctx.nucleo) : null },
      {
        provide: GRANDEZAS_LAUDO,
        useValue: ctx.nucleo ? new PortaGrandezasLaudoPropria(ctx.nucleo) : null,
      },
      ...(configuracaoMemoria ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracaoMemoria }] : []),
      { provide: PORTA_SADT, useValue: sadt },
      { provide: PORTA_PACS, useValue: pacs },
      { provide: AVISOS_SADT, useValue: avisos },
      // Pedido, cancelamento do item, kit com versão, recoleta e sub-amostras: só no banco do cliente (sem ele, 503).
      // Retenção do exame na bancada (mapa de trabalho): só no banco do cliente (sem ele, 503).
      // Digitação, liberação e retificação do resultado pelo exame pedido (05-SADT linha 10): só no banco do cliente.
      {
        provide: SERVICO_RESULTADO_SADT,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoResultadoSadt } = await import('./aplicacao/resultado-propria.js');
          return new ServicoResultadoSadt(ctx.nucleo);
        },
      },
      // Lote de trabalho da bancada (abrir, fechar, imprimir): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_LOTE_TRABALHO,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoLoteTrabalho } = await import('./aplicacao/lote-trabalho-propria.js');
          return new ServicoLoteTrabalho(ctx.nucleo);
        },
      },
      {
        provide: SERVICO_MAPA_TRABALHO,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoMapaTrabalho } = await import('./aplicacao/mapa-trabalho-propria.js');
          return new ServicoMapaTrabalho(ctx.nucleo);
        },
      },
      {
        provide: SERVICO_PEDIDO_SADT,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoPedidoSadt } = await import('./aplicacao/pedido-propria.js');
          return new ServicoPedidoSadt(ctx.nucleo);
        },
      },
      // Orçamento de exames particulares e conversão (05-SADT linha 26): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_ORCAMENTO_SADT,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoOrcamentoSadt } = await import('./aplicacao/orcamento-propria.js');
          return new ServicoOrcamentoSadt(ctx.nucleo);
        },
      },
      // Laboratório de apoio: remessa, etiqueta e de-para (05-SADT linha 14): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_APOIO_REMESSA,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoApoioRemessa } = await import('./aplicacao/apoio-remessa-propria.js');
          return new ServicoApoioRemessa(ctx.nucleo);
        },
      },
      // Redação do laudo e laudo estruturado (05-SADT linhas 16 e 17): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_LAUDO_REDACAO,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoLaudoRedacao } = await import('./aplicacao/laudo-redacao.js');
          return new ServicoLaudoRedacao(ctx.nucleo);
        },
      },
      // Interface com os equipamentos do laboratório (05-SADT linha 13): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_INTERFACE_EQUIPAMENTO,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoInterfaceEquipamento } =
            await import('./aplicacao/interface-equipamento-propria.js');
          return new ServicoInterfaceEquipamento(ctx.nucleo);
        },
      },
      // Escala de execução (05-SADT linha 19): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_ESCALA_EXECUCAO,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoEscalaExecucao } = await import('./aplicacao/escala-execucao-propria.js');
          return new ServicoEscalaExecucao(ctx.nucleo);
        },
      },
      // Entrega de resultados: prazo, protocolo do balcão e publicação no portal (05-SADT linha 21): só no banco do
      // cliente (sem ele, 503 nas rotas, e o portal segue sem o filtro do perfil).
      {
        provide: SERVICO_ENTREGA_RESULTADO,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoEntregaResultado } = await import('./aplicacao/entrega-resultado-propria.js');
          return new ServicoEntregaResultado(ctx.nucleo);
        },
      },
      // Soroteca: guarda, retirada, devolução e expurgo da amostra (05-SADT linha 9): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_SOROTECA,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoSoroteca } = await import('./aplicacao/soroteca-propria.js');
          return new ServicoSoroteca(ctx.nucleo);
        },
      },
      // Autoliberação do resultado: fila de conferência e cadastro (05-SADT linha 11): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_AUTOLIBERACAO,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoAutoliberacao } = await import('./aplicacao/autoliberacao-propria.js');
          return new ServicoAutoliberacao(ctx.nucleo);
        },
      },
      // Limites do pedido de exame (05-SADT linha 6): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_LIMITES_EXAME,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoLimitesExame } = await import('./aplicacao/limites-exame-propria.js');
          return new ServicoLimitesExame(ctx.nucleo);
        },
      },
      // Microbiologia estruturada: cultura, isolados e antibiograma (05-SADT linha 12): só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_MICROBIOLOGIA,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoMicrobiologia } = await import('./aplicacao/microbiologia-propria.js');
          return new ServicoMicrobiologia(ctx.nucleo);
        },
      },
      // Cadastro do antibiograma: painéis e pontos de corte (05-SADT linha 12), só no banco do cliente (sem ele, 503).
      {
        provide: SERVICO_CADASTRO_MICROBIOLOGIA,
        useFactory: async () => {
          if (!ctx.nucleo || !ctx.configuracao.clientePadrao || sadt.destino !== 'banco') return null;
          const { ServicoCadastroMicrobiologia } =
            await import('./aplicacao/microbiologia-cadastro-propria.js');
          return new ServicoCadastroMicrobiologia(ctx.nucleo);
        },
      },
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
