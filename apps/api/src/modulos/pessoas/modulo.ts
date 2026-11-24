// Módulo da gestão de pessoas (M52/M53, W0-06, F6) na API migrada (F2.2, onda 3): colaboradores, escala e realizado,
// ponto, SESMT, cargos e salários, avaliação, treinamentos, rubricas, folha (cálculo, férias, rescisão, fechamento,
// integração), autoatendimento, indicadores e eSocial. Cada porta segue a regra do F2-L: a própria sobre o MariaDB
// (pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com as fontes sintéticas; fora disso,
// indisponível (503, falha fechada).
// A cifra do CPF vem da chave do ambiente (PESSOAS_CHAVE_CPF ou a chave mestra); em dev/ci sem chave, uma chave
// aleatória do processo. Sem chave fora de dev/ci, as portas próprias sobem e o que lê ou grava o CPF recusa com 503
// `chave-cpf-ausente`, dizendo o que falta (chave-cpf-ausente.ts); o que não toca o CPF segue funcionando.
// A liberação e os parâmetros vêm da FONTE_CONFIGURACAO do módulo de configuração (global); na memória sem ele, a
// fonte sintética local. Os PDFs (holerite, espelho do ponto, ASO, F6) saem pelo conversor HTML → PDF/A do documento.
// Melhoria: as opções de teste são tipadas (OpcoesModuloPessoas), e a conferência dos specs prova que chegaram.
import { randomBytes } from 'node:crypto';
import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { criarArmazemLocal, lerRaizArquivos } from '@sgh/nucleo';
import { fontesSinteticas } from '../../sessao/montar.js';
import {
  chavesIniciaisSinteticas,
  FONTE_CONFIGURACAO,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { converterHtmlEmPdfA } from '../documento/infra/gotenberg.js';
import { configuracaoPedida } from '../especialidades/modulo.js';
import { portaIndisponivel } from '../exames/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { MeuEspacoController } from './autoatendimento/meu-espaco.controller.js';
import { MeuHoleriteController } from './autoatendimento/meu-holerite.controller.js';
import { MinhasFeriasController } from './autoatendimento/minhas-ferias.controller.js';
import {
  METODOS_PORTA_AUTOATENDIMENTO,
  PORTA_AUTOATENDIMENTO,
  type PortaAutoatendimento,
} from './autoatendimento/porta-autoatendimento.js';
import { efeitosAutoatendimentoProprios, fonteCalculoDe } from './autoatendimento/efeitos-proprios.js';
import { PortaAutoatendimentoMemoria } from './autoatendimento/porta-autoatendimento-memoria.js';
import { PortaAutoatendimentoPropria } from './autoatendimento/porta-propria.js';
import {
  FilaSolicitacoesController,
  MinhasSolicitacoesController,
} from './autoatendimento/solicitacoes.controller.js';
import { AvaliacaoController } from './avaliacao/avaliacao.controller.js';
import {
  METODOS_PORTA_AVALIACAO,
  PORTA_AVALIACAO,
  type PortaAvaliacao,
} from './avaliacao/porta-avaliacao.js';
import { PortaAvaliacaoMemoria } from './avaliacao/porta-avaliacao-memoria.js';
import { PortaAvaliacaoPropria } from './avaliacao/porta-propria.js';
import { CargosController } from './cargos/cargos.controller.js';
import { PORTA_CARGOS, type PortaCargos, portaCargosIndisponivel } from './cargos/porta-cargos.js';
import { PortaCargosMemoria } from './cargos/porta-cargos-memoria.js';
import { PortaCargosPropria } from './cargos/porta-propria.js';
import { cifraDasPortas, diagnosticoChaveCpf } from './chave-cpf-ausente.js';
import { CifraCpf } from './cifra-cpf.js';
import { EscalaController } from './escala/escala.controller.js';
import { PlantaoController } from './escala/plantao.controller.js';
import { METODOS_PORTA_ESCALA, PORTA_ESCALA, type PortaEscala } from './escala/porta-escala.js';
import { PortaEscalaMemoria } from './escala/porta-escala-memoria.js';
import { PortaEscalaPropria } from './escala/porta-escala-propria.js';
import { METODOS_PORTA_REALIZADO, PORTA_REALIZADO, type PortaRealizado } from './escala/porta-realizado.js';
import { PortaRealizadoMemoria } from './escala/porta-realizado-memoria.js';
import { PortaRealizadoPropria } from './escala/porta-realizado-propria.js';
import { RealizadoController } from './escala/realizado.controller.js';
import { EsocialController } from './esocial/esocial.controller.js';
import { PORTA_ESOCIAL, type PortaEsocial } from './esocial/porta-esocial.js';
import { portaEsocialDoAmbiente } from './esocial/porta-esocial-propria.js';
import {
  type DisponibilidadeTransmissor,
  TRANSMISSOR_ESOCIAL,
  transmissorEsocialDoAmbiente,
} from './esocial/transmissor/transmissor-esocial.js';
import { CalculoFolhaController } from './folha/calculo.controller.js';
import { GERADOR_PDF_FOLHA } from './folha/documentos-calculo.js';
import { FechamentoFolhaController } from './folha/fechamento.controller.js';
import { FeriasFolhaController } from './folha/ferias.controller.js';
import { FolhaController } from './folha/folha.controller.js';
import { IntegracaoFolhaController } from './folha/integracao.controller.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from './folha/porta-calculo.js';
import { PortaCalculoFolhaMemoria } from './folha/porta-calculo-memoria.js';
import { portaCalculoFolhaIndisponivel, PortaCalculoFolhaPropria } from './folha/porta-calculo-propria.js';
import { PORTA_FOLHA, type PortaFolha } from './folha/porta-folha.js';
import { PortaFolhaMemoria } from './folha/porta-folha-memoria.js';
import { portaFolhaIndisponivel, PortaFolhaPropria } from './folha/porta-folha-propria.js';
import { PORTA_INTEGRACAO_FOLHA, type PortaIntegracaoFolha } from './folha/porta-integracao.js';
import { portaIntegracaoFolhaIndisponivel } from './folha/porta-integracao-indisponivel.js';
import { PortaIntegracaoFolhaMemoria } from './folha/porta-integracao-memoria.js';
import { PortaIntegracaoFolhaPropria } from './folha/porta-integracao-propria.js';
import { RescisaoFolhaController } from './folha/rescisao.controller.js';
import { IndicadoresPessoasController } from './indicadores/indicadores.controller.js';
import {
  PORTA_INDICADORES_PESSOAS,
  type PortaIndicadoresPessoas,
  portaIndicadoresPessoasIndisponivel,
} from './indicadores/porta-indicadores.js';
import { PortaIndicadoresPessoasMemoria } from './indicadores/porta-indicadores-memoria.js';
import { PortaIndicadoresPessoasPropria } from './indicadores/porta-indicadores-propria.js';
import { SEMENTE_INDICADORES_PESSOAS } from './indicadores/semente-indicadores.js';
import { ObrigacoesController } from './obrigacoes/obrigacoes.controller.js';
import { CIFRA_CPF_PESSOAS, PessoasController } from './pessoas.controller.js';
import { PORTA_PESSOAS, type PortaPessoas } from './porta.js';
import { PortaPessoasMemoria } from './porta-memoria.js';
import { portaPessoasIndisponivel, PortaPessoasPropria } from './porta-propria.js';
import { GERADOR_PDF_PONTO, PontoController } from './ponto/ponto.controller.js';
import { PORTA_PONTO, type PortaPonto } from './ponto/porta-ponto.js';
import { PortaPontoMemoria } from './ponto/porta-ponto-memoria.js';
import { portaPontoIndisponivel, PortaPontoPropria } from './ponto/porta-ponto-propria.js';
import { PORTA_RUBRICAS, type PortaRubricas } from './rubricas/porta-rubricas.js';
import { PortaRubricasMemoria } from './rubricas/porta-rubricas-memoria.js';
import { portaRubricasIndisponivel, PortaRubricasPropria } from './rubricas/porta-rubricas-propria.js';
import { RubricasController } from './rubricas/rubricas.controller.js';
import { PORTA_SESMT, type PortaSesmt } from './sesmt/porta-sesmt.js';
import { PortaSesmtMemoria } from './sesmt/porta-sesmt-memoria.js';
import { portaSesmtIndisponivel, PortaSesmtPropria } from './sesmt/porta-sesmt-propria.js';
import { GERADOR_PDF_SESMT, SesmtController } from './sesmt/sesmt.controller.js';
import { PORTA_TREINAMENTO, type PortaTreinamento } from './treinamento/porta-treinamento.js';
import { PortaTreinamentoMemoria } from './treinamento/porta-treinamento-memoria.js';
import {
  portaTreinamentoIndisponivel,
  PortaTreinamentoPropria,
} from './treinamento/porta-treinamento-propria.js';
import { GERADOR_PDF_F6, TreinamentoController } from './treinamento/treinamento.controller.js';

/** Opções de teste (specs HTTP): as portas já montadas, a cifra do CPF, a configuração e o transmissor do eSocial. */
export interface OpcoesModuloPessoas {
  readonly pessoas?: PortaPessoas;
  readonly escala?: PortaEscala;
  readonly realizado?: PortaRealizado;
  readonly ponto?: PortaPonto;
  readonly sesmt?: PortaSesmt;
  readonly cargos?: PortaCargos;
  readonly avaliacao?: PortaAvaliacao;
  readonly treinamento?: PortaTreinamento;
  readonly rubricas?: PortaRubricas;
  readonly folha?: PortaFolha;
  readonly calculoFolha?: PortaCalculoFolha;
  readonly integracaoFolha?: PortaIntegracaoFolha;
  readonly autoatendimento?: PortaAutoatendimento;
  readonly indicadoresPessoas?: PortaIndicadoresPessoas;
  readonly esocial?: PortaEsocial;
  readonly transmissorEsocial?: DisponibilidadeTransmissor;
  /** null: sem cifra (as telas que mostram o CPF recusam). */
  readonly cifraCpf?: CifraCpf | null;
  /** A fonte da liberação e dos parâmetros (ausente: a do módulo de configuração ou a sintética local). */
  readonly configuracao?: unknown;
}

/** As portas do módulo pela regra do F2-L (as opções de teste têm precedência). */
export function portasDePessoas(
  ctx: ContextoModulo,
  o: OpcoesModuloPessoas = {},
  cifra: CifraCpf | null = null,
) {
  const n = ctx.nucleo;
  const memoria = !n && fontesSinteticas(ctx.env);
  // Sem chave do CPF, as portas próprias sobem com a cifra que recusa (503 chave-cpf-ausente, com o que falta).
  const cifraPortas = n ? cifraDasPortas(cifra, ctx.env) : null;

  const pessoas: PortaPessoas =
    o.pessoas ??
    (n && cifraPortas
      ? new PortaPessoasPropria(n, cifraPortas)
      : memoria
        ? new PortaPessoasMemoria()
        : portaPessoasIndisponivel());
  const pessoasMem = pessoas instanceof PortaPessoasMemoria ? pessoas : null;
  const escala: PortaEscala =
    o.escala ??
    (n
      ? new PortaEscalaPropria(n)
      : memoria
        ? new PortaEscalaMemoria(pessoasMem)
        : portaIndisponivel<PortaEscala>(METODOS_PORTA_ESCALA));
  const realizado: PortaRealizado =
    o.realizado ??
    (n
      ? new PortaRealizadoPropria(n)
      : memoria
        ? new PortaRealizadoMemoria(escala, pessoas)
        : portaIndisponivel<PortaRealizado>(METODOS_PORTA_REALIZADO));
  const ponto: PortaPonto =
    o.ponto ??
    (n && cifraPortas
      ? new PortaPontoPropria(n, cifraPortas)
      : memoria
        ? new PortaPontoMemoria(pessoasMem)
        : portaPontoIndisponivel());
  const sesmt: PortaSesmt =
    o.sesmt ??
    (n ? new PortaSesmtPropria(n) : memoria ? new PortaSesmtMemoria(pessoas) : portaSesmtIndisponivel());
  const cargos: PortaCargos =
    o.cargos ??
    (n ? new PortaCargosPropria(n) : memoria ? new PortaCargosMemoria() : portaCargosIndisponivel());
  // Em memória, a ficha do colaborador lê o cargo do quadro na memória dos cargos (chave: o código do estabelecimento).
  if (pessoasMem && cargos instanceof PortaCargosMemoria)
    pessoasMem.quadroDeCargos = (hospital, id) =>
      cargos.cargo(
        { cliente: '', estabelecimento: null, usuario: null, correlacao: 'quadro', hospital } as never,
        id,
      );
  const treinamento: PortaTreinamento =
    o.treinamento ??
    (n
      ? new PortaTreinamentoPropria(n)
      : memoria
        ? new PortaTreinamentoMemoria(pessoas)
        : portaTreinamentoIndisponivel());
  const avaliacao: PortaAvaliacao =
    o.avaliacao ??
    (n
      ? new PortaAvaliacaoPropria(n)
      : memoria
        ? new PortaAvaliacaoMemoria(pessoas)
        : portaIndisponivel<PortaAvaliacao>(METODOS_PORTA_AVALIACAO));
  // Em memória, o PDI da avaliação lê os cursos e as conclusões dos treinamentos em memória.
  if (avaliacao instanceof PortaAvaliacaoMemoria && treinamento instanceof PortaTreinamentoMemoria)
    avaliacao.treinamento = treinamento;
  const rubricas: PortaRubricas =
    o.rubricas ??
    (n ? new PortaRubricasPropria(n) : memoria ? new PortaRubricasMemoria() : portaRubricasIndisponivel());
  const folha: PortaFolha =
    o.folha ??
    (n && cifraPortas
      ? new PortaFolhaPropria(n, cifraPortas)
      : memoria
        ? new PortaFolhaMemoria(pessoas)
        : portaFolhaIndisponivel());
  const calculoFolha: PortaCalculoFolha =
    o.calculoFolha ??
    (n
      ? // O arquivo da obrigação no disco da instalação (ADR 0004); sem ARQUIVOS_RAIZ, gravar e baixar recusam (503).
        new PortaCalculoFolhaPropria(
          n,
          lerRaizArquivos(ctx.env) ? criarArmazemLocal(n, { env: ctx.env }) : null,
        )
      : memoria
        ? new PortaCalculoFolhaMemoria(pessoas)
        : portaCalculoFolhaIndisponivel());
  const integracaoFolha: PortaIntegracaoFolha =
    o.integracaoFolha ??
    (n
      ? new PortaIntegracaoFolhaPropria(n)
      : memoria
        ? new PortaIntegracaoFolhaMemoria(folha instanceof PortaFolhaMemoria ? folha : null)
        : portaIntegracaoFolhaIndisponivel());
  const autoatendimento: PortaAutoatendimento =
    o.autoatendimento ??
    (n
      ? new PortaAutoatendimentoPropria(
          n,
          // Os efeitos da aprovação (ajuste do ponto, correção do cadastro, férias) gravam pelas portas próprias.
          pessoas instanceof PortaPessoasPropria && ponto instanceof PortaPontoPropria
            ? efeitosAutoatendimentoProprios({ pessoas, ponto, calculo: fonteCalculoDe(calculoFolha) })
            : null,
        )
      : memoria &&
          ponto instanceof PortaPontoMemoria &&
          calculoFolha instanceof PortaCalculoFolhaMemoria &&
          pessoasMem
        ? new PortaAutoatendimentoMemoria(ponto, calculoFolha, pessoasMem)
        : portaIndisponivel<PortaAutoatendimento>(METODOS_PORTA_AUTOATENDIMENTO));
  const indicadoresPessoas: PortaIndicadoresPessoas =
    o.indicadoresPessoas ??
    (n
      ? new PortaIndicadoresPessoasPropria(n)
      : memoria
        ? new PortaIndicadoresPessoasMemoria(SEMENTE_INDICADORES_PESSOAS)
        : portaIndicadoresPessoasIndisponivel());
  const esocial: PortaEsocial = o.esocial ?? portaEsocialDoAmbiente(n, ctx.configuracao.ambiente);
  return {
    pessoas,
    escala,
    realizado,
    ponto,
    sesmt,
    cargos,
    treinamento,
    avaliacao,
    rubricas,
    folha,
    calculoFolha,
    integracaoFolha,
    autoatendimento,
    indicadoresPessoas,
    esocial,
  };
}

@Module({})
export class ModuloPessoas {}

export function moduloPessoas(ctx: ContextoModulo, o: OpcoesModuloPessoas = {}): DynamicModule {
  const chave = diagnosticoChaveCpf(ctx.env).chave ?? (fontesSinteticas(ctx.env) ? randomBytes(32) : null);
  const cifra = o.cifraCpf !== undefined ? o.cifraCpf : chave ? new CifraCpf(chave) : null;
  const p = portasDePessoas(ctx, o, cifra);
  const configuracao =
    o.configuracao !== undefined
      ? o.configuracao
      : !ctx.nucleo && !configuracaoPedida(ctx)
        ? fonteConfiguracaoMemoria(ctx.trilha, {
            chavesIniciais: chavesIniciaisSinteticas,
            prerequisitosIniciais: prerequisitosIniciaisSinteticos,
            parametrosIniciais: parametrosIniciaisSinteticos,
          })
        : null;
  const gotenberg = ctx.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
  const geradorPdf = async (html: string, titulo: string) =>
    (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
  const providers: Provider[] = [
    { provide: PORTA_PESSOAS, useValue: p.pessoas },
    { provide: PORTA_ESCALA, useValue: p.escala },
    { provide: PORTA_REALIZADO, useValue: p.realizado },
    { provide: PORTA_PONTO, useValue: p.ponto },
    { provide: PORTA_SESMT, useValue: p.sesmt },
    { provide: PORTA_CARGOS, useValue: p.cargos },
    { provide: PORTA_TREINAMENTO, useValue: p.treinamento },
    { provide: PORTA_AVALIACAO, useValue: p.avaliacao },
    { provide: PORTA_RUBRICAS, useValue: p.rubricas },
    { provide: PORTA_FOLHA, useValue: p.folha },
    { provide: PORTA_CALCULO_FOLHA, useValue: p.calculoFolha },
    { provide: PORTA_INTEGRACAO_FOLHA, useValue: p.integracaoFolha },
    { provide: PORTA_AUTOATENDIMENTO, useValue: p.autoatendimento },
    { provide: PORTA_INDICADORES_PESSOAS, useValue: p.indicadoresPessoas },
    { provide: PORTA_ESOCIAL, useValue: p.esocial },
    { provide: TRANSMISSOR_ESOCIAL, useValue: o.transmissorEsocial ?? transmissorEsocialDoAmbiente(ctx.env) },
    { provide: CIFRA_CPF_PESSOAS, useValue: cifra },
    { provide: GERADOR_PDF_SESMT, useValue: geradorPdf },
    { provide: GERADOR_PDF_PONTO, useValue: geradorPdf },
    { provide: GERADOR_PDF_FOLHA, useValue: geradorPdf },
    { provide: GERADOR_PDF_F6, useValue: geradorPdf },
    ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
  ];
  return {
    module: ModuloPessoas,
    controllers: [
      PessoasController,
      EscalaController,
      PlantaoController,
      RealizadoController,
      PontoController,
      SesmtController,
      CargosController,
      AvaliacaoController,
      TreinamentoController,
      RubricasController,
      FolhaController,
      CalculoFolhaController,
      FeriasFolhaController,
      RescisaoFolhaController,
      FechamentoFolhaController,
      IntegracaoFolhaController,
      ObrigacoesController,
      EsocialController,
      IndicadoresPessoasController,
      MeuEspacoController,
      MeuHoleriteController,
      MinhasFeriasController,
      MinhasSolicitacoesController,
      FilaSolicitacoesController,
    ],
    providers,
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloPessoas(ctx);
}
