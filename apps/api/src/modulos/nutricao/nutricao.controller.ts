// Nutrição clínica, serviço de nutrição e dietética e serviço social (M45, etapa 5; ficha, seções 4, 5, 7 e 8):
//   GET  /api/nutricao/gravacao                       a funcionalidade e cada ação valem agora? (motivo; a categoria)
//   GET  /api/nutricao/mapa/gravacao                  o mesmo, para a copa (quem lê o mapa)
//   GET  /api/nutricao/fila                           pacientes a triar (vencida em vermelho; auditado)
//   POST /api/nutricao/triagens                       pep.triarNutricao (nutricionista com o conselho ativo)
//   GET  /api/nutricao/internacoes/:reg/triagens      as triagens da internação
//   GET  /api/nutricao/terapias/:reg                  a terapia nutricional (EMTN; auditado)
//   POST /api/nutricao/terapias/metas                 pep.acompanharTerapiaNutricional (a meta; EMTN)
//   POST /api/nutricao/terapias/acompanhamentos       pep.acompanharTerapiaNutricional (o dia; EMTN)
//   GET  /api/nutricao/mapa/opcoes                    as unidades e as refeições com o corte
//   GET  /api/nutricao/mapa                           o mapa da unidade, refeição e dia (auditado)
//   POST /api/nutricao/mapa/fechar                    internacao.fecharMapaDietas (o retrato no corte)
//   POST /api/nutricao/mapa/etiquetas                 as etiquetas de bandeja em ZPL (fila de impressão)
//   GET  /api/nutricao/acompanhantes/:reg             a refeição do acompanhante da internação
//   POST /api/nutricao/acompanhantes                  internacao.registrarDietaAcompanhante (direito legal)
//   POST /api/nutricao/acompanhantes/:id/encerrar     internacao.registrarDietaAcompanhante (o encerramento)
//   GET  /api/servico-social/gravacao                 a funcionalidade e a ação valem agora?
//   GET  /api/servico-social/fila                     os internados com o risco e as barreiras sociais (auditado)
//   GET  /api/servico-social/internacoes/:reg         os registros (parecer só da categoria; vínculo; auditado)
//   POST /api/servico-social/registros                pep.registrarAvaliacaoSocial (com a barreira social no NIR)
// O total da triagem e os percentuais são SEMPRE calculados aqui pelo domínio; as categorias são conferidas na hora
// pelo vínculo do login (CBO com o conselho ativo). Gravações só SGH_ com a trilha na mesma transação.
import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CategoriaAssistencial,
  CHAVE_LIBERACAO_NUTRICAO,
  CHAVE_LIBERACAO_SERVICO_SOCIAL,
  type EtiquetasGeradas,
  esquemaEncerrarDietaAcompanhante,
  esquemaEtiquetasBandeja,
  esquemaFecharMapa,
  esquemaRegistrarAcompanhamentoTerapia,
  esquemaRegistrarAvaliacaoSocial,
  esquemaRegistrarDietaAcompanhante,
  esquemaRegistrarMetaTerapia,
  esquemaRegistrarTriagem,
  esquemaAdendoSocial,
  esquemaAlterarDietaAcompanhante,
  esquemaAlterarMetaTerapia,
  esquemaAvaliarNpt,
  esquemaRetificarAcompanhamento,
  esquemaRetificarTriagem,
  esquemaSoMotivo,
  type ResultadoCorrecao,
  EVENTOS_AUDITAVEIS as E,
  type GravacaoNutricao,
  PARAMETRO_ALERTA_META_DIAS,
  PARAMETRO_CADASTROS_POR_LOGIN_MAX,
  PARAMETRO_NPT_ORIGEM,
  PARAMETRO_CORTE_ANTECEDENCIA_MIN,
  PARAMETRO_CORTES_REFEICAO,
  PARAMETRO_EXAMES_COM_JEJUM,
  PARAMETRO_FECHAMENTO_TOLERANCIA_HORAS,
  PARAMETRO_JEJUM_CIRURGIA_HORAS,
  PARAMETRO_JEJUM_EXAME_HORAS,
  PARAMETRO_META_ADEQUADA_PCT,
  PARAMETRO_TRIAGEM_PRAZO_HORAS,
  PARAMETRO_TRIAGEM_PREFERENCIAL_HORAS,
  PARAMETRO_TRIAGEM_REAVALIACAO_DIAS,
  PERMISSOES_NUTRICAO_CODIGOS as P,
  type ResultadoMapa,
  type ResultadoSocial,
  type ResultadoTerapia,
  type ResultadoTriagem,
  type ServicoSocialPaciente,
  TIPOS_INTENSIVA_PADRAO,
} from '@sgh/contratos';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { enfileirarZpl, ErroZpl, zplEtiquetaBandeja } from '@sgh/dominio-documento';
import {
  calcularAcompanhamento,
  calcularMeta,
  calcularTriagem,
  categoriaDoCbo,
  comSigiloSocial,
  conferirDireitoLegal,
  conferirRiscoSocial,
  ErroMapa,
  ErroSocial,
  ErroTerapia,
  ErroTriagem,
  exigirMotivo,
  horasDesdeAdmissao,
  idadeNoDia,
  imc,
  reavaliarEm,
  respostasCompactas,
  somarDias,
  volumeDoDiaPorVia,
  volumesPorDia,
  conferirAvaliacaoNpt,
  conferirRetificacaoVolume,
  ErroCorrecao,
  exigirAtivo,
  exigirProprioAutor,
} from '@sgh/dominio-pep';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { idDaRota, type SessaoCadastro, sessaoDe as sessaoCadastroDe } from '../cadastro/comum.js';
import { comPedido } from './pedido.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { CONFIGURACAO_M16, type ConfiguracaoM16 } from '../internacao/public-api.js';
import { acompanhantesComRefeicao, PORTA_PORTARIA, type PortaPortaria } from '../portaria/public-api.js';
import { AcessoPacientePep } from '../pep/acesso-paciente.js';
import { ESTADO_PRONTUARIO } from '../pep/prontuario.controller.js';
import type { EstadoProntuario } from '../pep/sessao-prontuario.js';
import { type GravadorNutricao, PORTA_NUTRICAO, type PortaNutricao } from './porta.js';
import {
  comCorrecao,
  type ParametrosNutricao,
  type PrazosDaUnidade,
  ServicoNutricao,
  triagemLida,
} from './servico.js';

/** As ações das telas e a permissão de agir de cada uma (vale também no servidor). */
const ACOES_NUTRICAO: Readonly<Record<string, string>> = {
  triar: P.nutricaoTriar,
  avaliarNpt: P.terapiaAvaliarNpt,
  terapia: P.terapiaAcompanhar,
  fecharMapa: P.mapaFechar,
  imprimir: P.mapaImprimir,
  acompanhante: P.acompanhanteRegistrar,
};
const ACOES_SOCIAL: Readonly<Record<string, string>> = { registrar: P.socialRegistrar };

/** As categorias que agem (cap-05b §5.9): a triagem é da nutricionista; a terapia, da EMTN; o social, da assistente social. */
const CATEGORIAS_TRIAGEM: readonly CategoriaAssistencial[] = ['nutricao'];
const CATEGORIAS_EMTN: readonly CategoriaAssistencial[] = ['medico', 'nutricao', 'enfermagem', 'farmacia'];
const CATEGORIAS_SOCIAL: readonly CategoriaAssistencial[] = ['servico-social'];
const NOME_CATEGORIAS: Readonly<Record<string, string>> = {
  triagem: 'A triagem nutricional é registrada pela nutricionista',
  emtn: 'A terapia nutricional é registrada pela EMTN (médico, nutricionista, enfermeiro ou farmacêutico)',
  social: 'A avaliação social é registrada pela assistente social',
  npt: 'A avaliação farmacêutica da NPT é registrada pelo farmacêutico',
};

const recusaDominio = (x: unknown): never => {
  if (x instanceof ErroCorrecao)
    throw new ErroProblema(
      x.status === 403 ? 'sem-permissao' : 'recusa-de-negocio',
      x.status,
      x.status === 403 ? 'Correção do próprio autor' : 'Registro inativo',
      x.message,
      { codigo: x.codigo },
    );
  if (
    x instanceof ErroTriagem ||
    x instanceof ErroTerapia ||
    x instanceof ErroMapa ||
    x instanceof ErroSocial
  )
    throw new ErroProblema('recusa-de-negocio', 409, 'Registro recusado', x.message, { codigo: x.codigo });
  throw x;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UNIDADE = /^[A-Za-z0-9]{1,5}$/;

/** A unidade (bloco) da consulta, ou null se ausente ou fora do formato. */
const unidadeDa = (u: string | undefined) => (u && UNIDADE.test(u.trim()) ? u.trim() : null);

type Resolvedor = (chave: string, unidade?: string | null) => unknown;
const numero = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
/** Os prazos da triagem na unidade (o nível `unidade` do parâmetro é o bloco). */
const prazosDe = (r: Resolvedor, unidade: string | null) => ({
  prazoHoras: numero(r(PARAMETRO_TRIAGEM_PRAZO_HORAS, unidade)) || 48,
  preferencialHoras: numero(r(PARAMETRO_TRIAGEM_PREFERENCIAL_HORAS, unidade)) || 24,
  reavaliacaoDias: numero(r(PARAMETRO_TRIAGEM_REAVALIACAO_DIAS, unidade)) || 7,
});

const MOTIVO_CONTA_COMPARTILHADA =
  'Conta compartilhada: o login está ligado a vários cadastros de profissional, e a categoria não é reconhecida. Entre com o login pessoal.';


/** A sessão com a Idempotency-Key do pedido no contexto da porta: o reenvio do mesmo pedido não grava de novo. */
const sessaoDe = (req: Parameters<typeof sessaoCadastroDe>[0]): SessaoCadastro => comPedido(sessaoCadastroDe(req));

@Controller()
export class NutricaoController {
  private readonly apoio: ApoioGravacao<GravadorNutricao>;
  private readonly apoioSocial: ApoioGravacao<GravadorNutricao>;
  private readonly servico: ServicoNutricao;
  private readonly acesso: AcessoPacientePep;

  constructor(
    @Inject(PORTA_NUTRICAO) private readonly porta: PortaNutricao,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(ESTADO_PRONTUARIO) estado: EstadoProntuario,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(CONFIGURACAO_M16) private readonly cfg16: ConfiguracaoM16 | null = null,
    @Optional() @Inject(FONTE_DOCUMENTO) private readonly documento: FonteDocumento | null = null,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional()
    @Inject(VINCULO_ASSISTENCIAL)
    vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) emergencia: RegistroEmergencia | null = null,
    @Optional() @Inject(PORTA_PORTARIA) portaria: PortaPortaria | null = null,
  ) {
    this.apoio = new ApoioGravacao<GravadorNutricao>(
      { chave: CHAVE_LIBERACAO_NUTRICAO, nome: 'a nutrição', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.apoioSocial = new ApoioGravacao<GravadorNutricao>(
      { chave: CHAVE_LIBERACAO_SERVICO_SOCIAL, nome: 'o serviço social', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    // M50.5: o acompanhante registrado na portaria com direito à refeição entra no mapa (fonte única da pessoa).
    this.servico = new ServicoNutricao(
      porta,
      portaria ? (c, unidade) => acompanhantesComRefeicao(portaria, c, unidade) : null,
    );
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  /**
   * O login é conta compartilhada? Ligado a mais cadastros de profissional que o limite do parâmetro (falha fechada:
   * sem a leitura, também). A categoria dele não vale: o ato e o parecer sigiloso exigem o login pessoal.
   */
  private async contaCompartilhada(s: SessaoCadastro): Promise<boolean> {
    const limite = (await this.apoio.parametro(s, PARAMETRO_CADASTROS_POR_LOGIN_MAX, null)) || 3;
    const n = await this.porta.cadastrosDoLogin(s.porta, s.login).catch(() => Number.POSITIVE_INFINITY);
    return n > limite;
  }

  /** As categorias dos vínculos ativos do login (CBO com conselho); nenhuma na conta compartilhada. */
  private async categorias(s: SessaoCadastro) {
    const [vs, compartilhada] = await Promise.all([
      this.porta.vinculos(s.porta, s.login).catch(() => []),
      this.contaCompartilhada(s),
    ]);
    const lista = compartilhada
      ? []
      : vs.filter((v) => v.ativo).map((v) => ({ ...v, categoria: categoriaDoCbo(v.cbo) }));
    return Object.assign(lista, { compartilhada });
  }

  /** O vínculo ativo de uma das categorias que agem; senão 403 com o motivo. */
  private async vinculoDa(s: SessaoCadastro, aceitas: readonly CategoriaAssistencial[], nome: string) {
    const cats = await this.categorias(s);
    if (cats.compartilhada)
      throw new ErroProblema('sem-permissao', 403, 'Conta compartilhada', MOTIVO_CONTA_COMPARTILHADA, {
        codigo: 'conta-compartilhada',
      });
    const v = cats.find((x) => x.categoria !== null && aceitas.includes(x.categoria));
    if (!v)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Categoria profissional',
        `${NOME_CATEGORIAS[nome] ?? 'Ação privativa'}: a sessão precisa do vínculo da categoria com o conselho ativo.`,
        { codigo: 'categoria-nao-autorizada' },
      );
    return v;
  }

  /**
   * Os parâmetros da nutrição. O nível `unidade` é o da unidade CONSULTADA (o bloco do mapa ou da fila; regra 11:
   * "corte por unidade"), nunca o setor de quem consulta; sem unidade, o estabelecimento.
   */
  private async parametros(
    s: SessaoCadastro,
    unidade: string | null = null,
    lidos?: Resolvedor,
  ): Promise<ParametrosNutricao> {
    const r = lidos ?? (await this.apoio.resolvedorParametros(s));
    const n = (chave: string, padrao: number) => numero(r(chave, unidade)) || padrao;
    const t = (chave: string) => {
      const v = r(chave, unidade);
      return typeof v === 'string' ? v : '';
    };
    let intensivas: readonly number[] = TIPOS_INTENSIVA_PADRAO;
    try {
      if (this.cfg16) intensivas = (await this.cfg16.parametros(s)).intensivas;
    } catch {
      intensivas = TIPOS_INTENSIVA_PADRAO;
    }
    return {
      prazos: prazosDe(r, unidade),
      adequadaPct: n(PARAMETRO_META_ADEQUADA_PCT, 80),
      antecedenciaMin: n(PARAMETRO_CORTE_ANTECEDENCIA_MIN, 120),
      cortesProprios: t(PARAMETRO_CORTES_REFEICAO),
      jejumCirurgiaHoras: n(PARAMETRO_JEJUM_CIRURGIA_HORAS, 8),
      jejumExameHoras: n(PARAMETRO_JEJUM_EXAME_HORAS, 8),
      examesComJejum: t(PARAMETRO_EXAMES_COM_JEJUM),
      intensivas,
      fechamentoToleranciaHoras: n(PARAMETRO_FECHAMENTO_TOLERANCIA_HORAS, 24),
      alertaMetaDias: n(PARAMETRO_ALERTA_META_DIAS, 3),
      nptOrigem: t(PARAMETRO_NPT_ORIGEM) === 'cpoe' ? 'cpoe' : 'ficha-emtn',
    };
  }

  /** Os prazos da triagem de cada unidade da fila (o bloco do internado), com a configuração lida uma vez. */
  private async prazosDaUnidade(s: SessaoCadastro): Promise<PrazosDaUnidade> {
    const r = await this.apoio.resolvedorParametros(s);
    return async (bloco) => prazosDe(r, bloco);
  }

  /** A internação da leitura clínica (404 se não existe) com o vínculo assistencial conferido (restrição ligada). */
  private async internacaoComVinculo(s: SessaoCadastro, reg: string, permissao: string) {
    const i = await this.porta.internacao(s.porta, idDaRota(reg));
    if (!i)
      throw new ErroProblema('nao-encontrado', 404, 'Internação não encontrada', 'A internação não existe.');
    await this.acesso.exigirVinculo(s, i.paciente, permissao, 'pep.evolucao');
    return i;
  }

  /** W0-05: com a NPT pela prescrição (parâmetro 'cpoe'), a parenteral informada na ficha não entra. */
  private exigirOrigemNpt(via: string, itemDieta: number | null, origem: 'ficha-emtn' | 'cpoe') {
    if (via === 'parenteral' && itemDieta === null && origem === 'cpoe')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'NPT pela prescrição',
        'Neste estabelecimento a nutrição parenteral vem da ordem de NPT da prescrição: escolha a NPT prescrita.',
        { codigo: 'npt-pela-prescricao', campos: ['itemDieta'] },
      );
  }

  /** W0-05: o acompanhamento só vale sobre a meta vigente (a substituída ou encerrada recusa: 409). */
  private async exigirMetaVigente(s: SessaoCadastro, meta: number) {
    const k = await this.porta.correcoes(s.porta, 'meta', [meta]);
    if (k.inativa.has(meta))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Meta inativa',
        'A meta foi alterada (há versão nova) ou encerrada: registre o acompanhamento na meta vigente.',
        { codigo: 'meta-inativa', campos: ['meta'] },
      );
  }

  /**
   * O dia da terapia calculado pelo domínio: o volume da checagem da dieta (enteral) ou do balanço hídrico (parenteral),
   * sem digitação; o informado só quando a fonte não traz o volume. Abaixo do adequado exige o motivo.
   */
  private async calcularDia(
    s: SessaoCadastro,
    i: { atendimento: number | null },
    meta: Parameters<typeof calcularAcompanhamento>[0] & {
      via: 'enteral' | 'parenteral' | 'oral';
      itemDieta: number | null;
    },
    data: string,
    informadoMl: number | null,
    motivo: Parameters<typeof exigirMotivo>[1],
    p: ParametrosNutricao,
  ) {
    let checado: { volumeMl: number | null } | null = null;
    let balanco: { volumeMl: number; lancamentos: number } | null = null;
    let prescrito: number | null = null;
    if (meta.via !== 'parenteral' && meta.itemDieta !== null && i.atendimento) {
      const dietas = await this.porta.dietasEnterais(s.porta, i.atendimento, `${somarDias(data, -14)}T00:00`);
      const d = dietas.find((x) => x.itemDieta === meta.itemDieta);
      if (d) {
        prescrito = d.quantidade;
        const cs = await this.porta.checagens(s.porta, [d.item], `${data}T00:00`);
        checado = volumesPorDia(cs).find((x) => x.data === data) ?? null;
      }
    }
    if (meta.via === 'parenteral' && i.atendimento) {
      const bs = await this.porta.balancoParenteral(s.porta, i.atendimento, `${data}T00:00`);
      balanco = bs.find((x) => x.data === data) ?? null;
    }
    try {
      const a = calcularAcompanhamento(
        meta,
        volumeDoDiaPorVia(meta.via, { checado, balanco, informadoMl }),
        p.adequadaPct,
      );
      exigirMotivo(a, motivo);
      return { a, prescrito };
    } catch (x) {
      return recusaDominio(x);
    }
  }

  // ── Estado da gravação ─────────────────────────────────────────────────────────────────────────

  @Get('nutricao/gravacao')
  @Permissao(P.nutricaoLer)
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoNutricao> {
    return this.estadoGravacao(sessaoDe(req));
  }

  /** O mesmo estado para a copa (quem lê o mapa de dietas sem ler a fila da triagem). */
  @Get('nutricao/mapa/gravacao')
  @Permissao(P.mapaLer)
  gravacaoMapa(@Req() req: RequisicaoAutorizada): Promise<GravacaoNutricao> {
    return this.estadoGravacao(sessaoDe(req));
  }

  private async estadoGravacao(s: SessaoCadastro): Promise<GravacaoNutricao> {
    const [g, cats] = await Promise.all([this.apoio.gravacao(s, ACOES_NUTRICAO), this.categorias(s)]);
    const tem = (aceitas: readonly CategoriaAssistencial[]) =>
      cats.some((c) => c.categoria !== null && aceitas.includes(c.categoria));
    const operacoes = { ...g.operacoes };
    const exigeCategoria = (acao: string, aceitas: readonly CategoriaAssistencial[], nome: string) => {
      if (operacoes[acao]?.pode && !tem(aceitas))
        operacoes[acao] = {
          pode: false,
          motivo: cats.compartilhada
            ? MOTIVO_CONTA_COMPARTILHADA
            : `${NOME_CATEGORIAS[nome]}: a sessão precisa do vínculo da categoria com o conselho ativo.`,
        };
    };
    exigeCategoria('triar', CATEGORIAS_TRIAGEM, 'triagem');
    exigeCategoria('terapia', CATEGORIAS_EMTN, 'emtn');
    exigeCategoria('avaliarNpt', ['farmacia'], 'npt');
    return { ligada: g.ligada, motivo: g.motivo, operacoes, categoria: cats[0]?.categoria ?? null };
  }

  @Get('servico-social/gravacao')
  @Permissao(P.socialLer)
  async gravacaoSocial(@Req() req: RequisicaoAutorizada): Promise<GravacaoNutricao> {
    const s = sessaoDe(req);
    const [g, cats] = await Promise.all([this.apoioSocial.gravacao(s, ACOES_SOCIAL), this.categorias(s)]);
    const social = cats.some((c) => c.categoria === 'servico-social');
    const operacoes = { ...g.operacoes };
    if (operacoes['registrar']?.pode && !social)
      operacoes['registrar'] = {
        pode: false,
        motivo: cats.compartilhada
          ? MOTIVO_CONTA_COMPARTILHADA
          : `${NOME_CATEGORIAS['social']}: a sessão precisa do vínculo da categoria com o conselho ativo.`,
      };
    return {
      ligada: g.ligada,
      motivo: g.motivo,
      operacoes,
      categoria: social ? 'servico-social' : (cats[0]?.categoria ?? null),
    };
  }

  // ── Fila e triagem ─────────────────────────────────────────────────────────────────────────────

  @Get('nutricao/fila')
  @Permissao(P.nutricaoLer)
  @Auditar(E.nutricaoFilaLida.codigo)
  async fila(@Req() req: RequisicaoAutorizada, @Query('unidade') unidade?: string) {
    const s = sessaoDe(req);
    const u = unidadeDa(unidade);
    return this.servico.fila(s.porta, await this.parametros(s, u), u, await this.prazosDaUnidade(s));
  }

  @Get('nutricao/internacoes/:reg/triagens')
  @Permissao(P.nutricaoLer)
  @Auditar(E.nutricaoFilaLida.codigo)
  async triagens(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    // Leitura clínica: o vínculo assistencial como no PEP (a restrição do estabelecimento ligada).
    const i = await this.internacaoComVinculo(s, reg, P.nutricaoLer);
    const p = await this.parametros(s, i.bloco);
    const ts = await this.porta.triagens(s.porta, [i.reg]);
    const k = await this.porta.correcoes(
      s.porta,
      'triagem',
      ts.map((t) => t.id),
    );
    return { itens: ts.map((t) => triagemLida(t, p.prazos.prazoHoras, k)) };
  }

  @Post('nutricao/triagens')
  @HttpCode(201)
  @Permissao(P.nutricaoTriar)
  @AuditadoNoHandler('pep.triarNutricao (triagem_nutricional) com a trilha na mesma transação')
  async triar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTriagem> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarTriagem, b);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoDa(s, CATEGORIAS_TRIAGEM, 'triagem');
    const i = await this.servico.internacaoAberta(s.porta, e.internacao);
    await this.acesso.exigirVinculo(s, i.paciente, P.nutricaoTriar, 'pep.evolucao');
    const { agora, hoje } = await this.porta.relogio(s.porta);
    const p = await this.parametros(s, i.bloco);
    const idade = idadeNoDia(i.nascimento, hoje);
    let r: ReturnType<typeof calcularTriagem>;
    try {
      r = calcularTriagem(e.respostas, idade);
    } catch (x) {
      return recusaDominio(x);
    }
    const horas = horasDesdeAdmissao(i.admissao, agora);
    const dentro = horas <= p.prazos.prazoHoras;
    const id = await this.apoio.sgh(
      s,
      E.nutricaoTriagemRegistrada.codigo,
      P.nutricaoTriar,
      (x: number) => ({
        tabela: 'triagem_nutricional',
        id: String(x),
        paciente: i.paciente,
        chave: `${i.reg}:${r.instrumento}:${r.total}:${r.risco}`,
      }),
      (g) =>
        g.triar({
          reg: i.reg,
          pront: i.pront,
          paciente: i.paciente,
          instrumento: r.instrumento,
          versao: r.versao,
          respostas: respostasCompactas(e.respostas),
          estado: r.parcelas.estado,
          gravidade: r.parcelas.gravidade,
          idade: r.parcelas.idade,
          total: r.total,
          risco: r.risco,
          conduta: e.conduta ?? null,
          pesoKg: e.pesoKg,
          alturaCm: e.alturaCm,
          imc: imc(e.pesoKg, e.alturaCm),
          admissao: i.admissao,
          horasDesdeAdmissao: horas,
          dentroDoPrazo: dentro,
          reavaliarEm: reavaliarEm(r.risco, hoje, p.prazos),
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id,
      total: r.total,
      risco: r.risco,
      dentroDoPrazo: dentro,
      mensagem: `Triagem registrada: ${r.total} ponto(s), ${r.risco === 'sem-risco' ? 'sem risco nutricional' : r.risco === 'alto' ? 'alto risco nutricional' : 'em risco nutricional'}${dentro ? '' : ' (fora do prazo de ' + String(p.prazos.prazoHoras) + ' h)'}.`,
    };
  }

  // ── Terapia nutricional (EMTN) ─────────────────────────────────────────────────────────────────

  @Get('nutricao/terapias/:reg')
  @Permissao(P.terapiaLer)
  @Auditar(E.terapiaNutricionalLida.codigo)
  async terapia(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const i = await this.internacaoComVinculo(s, reg, P.terapiaLer);
    return this.servico.terapia(s.porta, i.reg, await this.parametros(s, i.bloco));
  }

  @Post('nutricao/terapias/metas')
  @HttpCode(201)
  @Permissao(P.terapiaAcompanhar)
  @AuditadoNoHandler(
    'pep.acompanharTerapiaNutricional (terapia_nutricional, meta) com a trilha na mesma transação',
  )
  async meta(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTerapia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarMetaTerapia, b);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoDa(s, CATEGORIAS_EMTN, 'emtn');
    const i = await this.servico.internacaoAberta(s.porta, e.internacao);
    await this.acesso.exigirVinculo(s, i.paciente, P.terapiaAcompanhar, 'pep.evolucao');
    this.exigirOrigemNpt(e.via, e.itemDieta, (await this.parametros(s, i.bloco)).nptOrigem);
    let dieta: number | null = null;
    if (e.itemDieta !== null) {
      const { agora } = await this.porta.relogio(s.porta);
      const dietas = i.atendimento
        ? await this.porta.dietasEnterais(
            s.porta,
            i.atendimento,
            `${somarDias(agora.slice(0, 10), -14)}T00:00`,
          )
        : [];
      const d = dietas.find((x) => x.itemDieta === e.itemDieta && !x.suspensa);
      if (!d || (d.plano === 5) !== (e.via === 'parenteral'))
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Dieta não encontrada',
          'A dieta escolhida não é uma dieta enteral ou parenteral vigente desta internação: abra a terapia de novo.',
          { codigo: 'dieta-nao-enteral', campos: ['itemDieta'] },
        );
      dieta = d.dieta;
    }
    // W0-05 (revisão): uma meta vigente por via na internação. A nova versão da meta é pelo "Alterar" (nova-versao); a
    // enteral e a parenteral complementar convivem e somam no progresso do dia.
    const t = await this.porta.terapia(s.porta, i.reg);
    const daVia = t.metas.filter((x) => x.via === e.via).map((x) => x.id);
    if (daVia.length > 0) {
      const k = await this.porta.correcoes(s.porta, 'meta', daVia);
      if (daVia.some((x) => !k.inativa.has(x)))
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Meta vigente na via',
          'Esta internação já tem uma meta vigente nesta via: altere a meta (nova versão) ou encerre-a antes de registrar outra.',
          { codigo: 'meta-vigente-na-via', campos: ['via'] },
        );
    }
    let m: ReturnType<typeof calcularMeta>;
    try {
      m = calcularMeta(e);
    } catch (x) {
      return recusaDominio(x);
    }
    const id = await this.apoio.sgh(
      s,
      E.terapiaNutricionalRegistrada.codigo,
      P.terapiaAcompanhar,
      (x: number) => ({
        tabela: 'terapia_nutricional',
        id: String(x),
        paciente: i.paciente,
        chave: `${i.reg}:meta:${e.via}`,
      }),
      (g) =>
        g.registrarMeta({
          reg: i.reg,
          pront: i.pront,
          paciente: i.paciente,
          via: e.via,
          itemDieta: e.itemDieta,
          dieta,
          pesoKg: e.pesoKg,
          kcalPorKg: e.kcalPorKg,
          proteinaGPorKg: e.proteinaGPorKg,
          metaKcal: m.metaKcal,
          metaProteinaG: m.metaProteinaG,
          densidadeKcalMl: e.densidadeKcalMl,
          proteinaGL: e.proteinaGL,
          metaVolumeMl: m.metaVolumeMl,
          observacao: e.observacao ?? null,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id,
      pctKcal: null,
      pctProteina: null,
      mensagem: `Meta registrada: ${String(m.metaKcal).replace('.', ',')} kcal, ${String(m.metaProteinaG).replace('.', ',')} g de proteína e ${m.metaVolumeMl} mL por dia.`,
    };
  }

  @Post('nutricao/terapias/acompanhamentos')
  @HttpCode(201)
  @Permissao(P.terapiaAcompanhar)
  @AuditadoNoHandler(
    'pep.acompanharTerapiaNutricional (terapia_nutricional, acompanhamento) com a trilha na mesma transação',
  )
  async acompanhamento(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoTerapia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarAcompanhamentoTerapia, b);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoDa(s, CATEGORIAS_EMTN, 'emtn');
    const i = await this.servico.internacaoAberta(s.porta, e.internacao);
    await this.acesso.exigirVinculo(s, i.paciente, P.terapiaAcompanhar, 'pep.evolucao');
    const meta = await this.porta.meta(s.porta, e.meta);
    if (!meta || meta.reg !== i.reg)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Meta de outra internação',
        'A meta de terapia nutricional não é desta internação (ou não existe): abra a terapia do paciente de novo.',
        { codigo: 'meta-de-outra-internacao', campos: ['meta'] },
      );
    const p = await this.parametros(s, i.bloco);
    const { hoje } = await this.porta.relogio(s.porta);
    if (e.data > hoje)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Data no futuro',
        'O acompanhamento é do dia que passou ou de hoje.',
        {
          campos: ['data'],
        },
      );
    await this.exigirMetaVigente(s, meta.id);
    const { a, prescrito } = await this.calcularDia(s, i, meta, e.data, e.volumeInformadoMl, e.motivo, p);
    const id = await this.apoio.sgh(
      s,
      E.terapiaNutricionalRegistrada.codigo,
      P.terapiaAcompanhar,
      (x: number) => ({
        tabela: 'terapia_nutricional',
        id: String(x),
        paciente: i.paciente,
        chave: `${i.reg}:acompanhamento:${e.data}`,
      }),
      (g) =>
        g.registrarAcompanhamento({
          reg: i.reg,
          pront: i.pront,
          paciente: i.paciente,
          via: meta.via,
          meta: meta.id,
          data: e.data,
          volumePrescritoMl: prescrito,
          volumeInfundidoMl: a.volumeInfundidoMl,
          origemVolume: a.origemVolume,
          kcalAtingida: a.kcalAtingida,
          proteinaAtingidaG: a.proteinaAtingidaG,
          pctKcal: a.pctKcal,
          pctProteina: a.pctProteina,
          motivo: e.motivo,
          observacao: e.observacao ?? null,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id,
      pctKcal: a.pctKcal,
      pctProteina: a.pctProteina,
      mensagem: `Acompanhamento registrado: ${String(a.pctKcal).replace('.', ',')}% da meta calórica e ${String(a.pctProteina).replace('.', ',')}% da proteica (volume ${a.origemVolume === 'checagem' ? 'da checagem' : 'informado'}).`,
    };
  }

  // ── Mapa de dietas ─────────────────────────────────────────────────────────────────────────────

  @Get('nutricao/mapa/opcoes')
  @Permissao(P.mapaLer)
  async opcoesMapa(@Req() req: RequisicaoAutorizada, @Query('unidade') unidade?: string) {
    const s = sessaoDe(req);
    // Os cortes das refeições são os da unidade escolhida (sem ela, os do estabelecimento).
    return this.servico.opcoes(s.porta, await this.parametros(s, unidadeDa(unidade)));
  }

  private consultaMapa(unidade: string | undefined, refeicao: string | undefined, data: string | undefined) {
    const u = (unidade ?? '').trim();
    const r = Number(refeicao);
    if (!UNIDADE.test(u) || !Number.isInteger(r) || r < 0 || !DATA.test(data ?? ''))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Consulta inválida',
        'Informe a unidade, a refeição e o dia (AAAA-MM-DD).',
        {
          campos: ['unidade', 'refeicao', 'data'],
        },
      );
    return { unidade: u, refeicao: r, data: data as string };
  }

  @Get('nutricao/mapa')
  @Permissao(P.mapaLer)
  @Auditar(E.mapaDietaLido.codigo)
  async mapa(
    @Req() req: RequisicaoAutorizada,
    @Query('unidade') unidade?: string,
    @Query('refeicao') refeicao?: string,
    @Query('data') data?: string,
  ) {
    const s = sessaoDe(req);
    const q = this.consultaMapa(unidade, refeicao, data);
    const m = await this.servico.mapa(s.porta, q, await this.parametros(s, q.unidade));
    return { ...m.mapa, hash: m.hash };
  }

  @Post('nutricao/mapa/fechar')
  @HttpCode(201)
  @Permissao(P.mapaFechar)
  @AuditadoNoHandler(
    'internacao.fecharMapaDietas (mapa_dieta e as linhas) com a trilha na mesma transação',
  )
  async fecharMapa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoMapa> {
    const s = sessaoDe(req);
    const e = corpo(esquemaFecharMapa, b);
    await this.apoio.exigirLiberacao(s);
    const m = await this.servico.mapa(s.porta, e, await this.parametros(s, e.unidade));
    if (m.mapa.retrato)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Mapa já fechado',
        'O mapa desta refeição já foi fechado: o retrato não é regravado.',
        {
          codigo: 'mapa-ja-fechado',
        },
      );
    if (!m.mapa.passouDoCorte)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Antes do corte',
        `O mapa fecha no corte da refeição (${m.mapa.corteEm.slice(11, 16)}): até lá, a prescrição ainda pode mudar.`,
        { codigo: 'antes-do-corte' },
      );
    if (m.mapa.lidoEm > m.mapa.fechamentoAte)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Fechamento fora da janela',
        `O mapa desta refeição fechava até ${m.mapa.fechamentoAte.slice(8, 10)}/${m.mapa.fechamentoAte.slice(5, 7)} às ${m.mapa.fechamentoAte.slice(11, 16)}: os internados de agora já não são os do corte, e o retrato não é feito depois.`,
        { codigo: 'fora-da-janela' },
      );
    if (m.hash !== e.hashVisto)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'O mapa mudou',
        'O mapa mudou depois que você abriu (outra prescrição ou internado): confira de novo antes de fechar.',
        { codigo: 'mapa-mudou' },
      );
    const id = await this.apoio.sgh(
      s,
      E.mapaDietaFechado.codigo,
      P.mapaFechar,
      (x: number) => ({
        tabela: 'mapa_dieta',
        id: String(x),
        chave: `${e.unidade}:${e.refeicao}:${e.data}:${m.hash.slice(0, 16)}`,
      }),
      (g) =>
        g.fecharMapa({
          unidade: e.unidade,
          refeicao: e.refeicao,
          data: e.data,
          corteEm: m.mapa.corteEm,
          hash: m.hash,
          linhas: m.retrato,
          usuario: s.login,
        }),
    );
    return { ok: true, id, mensagem: `Mapa fechado no corte: ${m.retrato.length} internado(s).` };
  }

  @Post('nutricao/mapa/etiquetas')
  @HttpCode(200)
  @Permissao(P.mapaImprimir)
  @AuditadoNoHandler(
    'etiquetas de bandeja em ZPL: a trilha registra a impressão (unidade, refeição, quantidade e o hash)',
  )
  async etiquetas(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<EtiquetasGeradas> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEtiquetasBandeja, b);
    await this.apoio.exigirLiberacao(s);
    const m = await this.servico.mapa(s.porta, e, await this.parametros(s, e.unidade));
    const escolhidas = e.internacoes.length
      ? m.mapa.linhas.filter((l) => e.internacoes.includes(l.internacao))
      : m.mapa.linhas;
    const comBandeja = escolhidas.filter(
      (l) => l.tipo !== 'jejum' && l.tipo !== 'parenteral' && l.tipo !== 'sem-prescricao',
    );
    const [ano, mes, dia] = e.data.split('-');
    const zpls: string[] = [];
    let semIdentificador = 0;
    for (const l of comBandeja) {
      try {
        zpls.push(
          zplEtiquetaBandeja({
            nomeCompleto: l.nome,
            nascimento: l.nascimento ?? '',
            prontuario: l.prontuario,
            internacao: l.internacao,
            leito: `${l.leito.bloco} ${l.leito.acomodacao} ${l.leito.leito}`,
            refeicao: `${m.refeicao.nome} ${m.refeicao.horario}`,
            data: `${dia}/${mes}/${ano}`,
            dieta: [l.dieta ?? 'Dieta', l.quantidade].filter(Boolean).join(' '),
            restricoes:
              l.caracteristicas.map((c) => (c.resposta ? `${c.nome}: ${c.resposta}` : c.nome)).join(', ') ||
              null,
            alergias: l.alergiasAlimentares,
            acompanhante: l.acompanhante !== null,
            codigoRefeicao: m.refeicao.codigo,
          }),
        );
      } catch (x) {
        if (!(x instanceof ErroZpl)) throw x;
        semIdentificador += 1;
      }
    }
    const conteudo = zpls.join('');
    const nomeArquivo = `bandejas-${e.unidade}-${e.refeicao}-${e.data}.zpl`.replace(/[^A-Za-z0-9.-]/g, '-');
    let fila: EtiquetasGeradas['fila'] = null;
    if (this.documento && zpls.length > 0) {
      const bruto = s.req.headers['idempotency-key'];
      const k = Array.isArray(bruto) ? bruto[0] : bruto;
      if (typeof k !== 'string' || k.length < 8)
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Pedido incompleto',
          'Falta a Idempotency-Key do pedido de impressão.',
        );
      try {
        fila = await enfileirarZpl(
          {
            chaveIdempotencia: k,
            rede: s.rede || 'rede',
            estabelecimento: s.hospital,
            estacao: estacaoDaRequisicao(s.req)
              .replace(/[^A-Za-z0-9._-]/g, '-')
              .slice(0, 64),
            modelo: 'etiqueta-bandeja',
            zpl: conteudo,
          },
          this.documento.armazem,
          this.documento.destino,
          this.documento.novoId,
        );
      } catch {
        throw new ErroProblema(
          'indisponivel',
          503,
          'Fila de impressão indisponível',
          'Não foi possível mandar à impressora da estação agora: tente de novo.',
        );
      }
    }
    await this.trilha.registrar({
      evento: E.etiquetaBandejaImpressa.codigo,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, 'etiqueta-bandeja').slice(0, 64),
      recurso: 'hotelaria.mapaDieta',
      resultado: 'sucesso',
      tabelaAlvo: 'mapa_dieta',
      idAlvo: m.mapa.retrato ? String(m.mapa.retrato.id) : `${e.unidade}:${e.refeicao}:${e.data}`,
      chaveNaturalAlvo: `etiqueta-bandeja:${zpls.length}:${createHash('sha256').update(conteudo).digest('hex').slice(0, 16)}`,
    });
    return {
      formato: 'zpl',
      conteudo,
      nomeArquivo,
      etiquetas: zpls.length,
      semBandeja: escolhidas.length - comBandeja.length,
      semIdentificador,
      fila,
    };
  }

  // ── Acompanhante ───────────────────────────────────────────────────────────────────────────────

  @Get('nutricao/acompanhantes/:reg')
  @Permissao(P.mapaLer)
  async acompanhantes(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const itens = await this.porta.acompanhantes(s.porta, idDaRota(reg));
    const log = await this.porta.alteracoesAcompanhante(
      s.porta,
      itens.map((a) => a.id),
    );
    return { itens: itens.map((a) => ({ ...a, historico: log.filter((x) => x.idRegistro === a.id) })) };
  }

  @Post('nutricao/acompanhantes')
  @HttpCode(201)
  @Permissao(P.acompanhanteRegistrar)
  @AuditadoNoHandler(
    'internacao.registrarDietaAcompanhante (plano_refeicao_acompanhante) com a trilha na mesma transação',
  )
  async registrarAcompanhante(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoMapa> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarDietaAcompanhante, b);
    await this.apoio.exigirLiberacao(s);
    const i = await this.servico.internacaoAberta(s.porta, e.internacao);
    const { hoje } = await this.porta.relogio(s.porta);
    try {
      conferirDireitoLegal(e.baseLegal, idadeNoDia(i.nascimento, hoje));
    } catch (x) {
      return recusaDominio(x);
    }
    const id = await this.apoio.sgh(
      s,
      E.dietaAcompanhanteRegistrada.codigo,
      P.acompanhanteRegistrar,
      (x: number) => ({
        tabela: 'plano_refeicao_acompanhante',
        id: String(x),
        paciente: i.paciente,
        chave: `${i.reg}:${e.baseLegal}`,
      }),
      (g) =>
        g.registrarAcompanhante({
          reg: i.reg,
          pront: i.pront,
          baseLegal: e.baseLegal,
          refeicoes: e.refeicoes,
          inicio: e.inicio,
          fim: e.fim,
          observacao: e.observacao ?? null,
          usuario: s.login,
        }),
    );
    return { ok: true, id, mensagem: 'Refeição do acompanhante registrada.' };
  }

  @Post('nutricao/acompanhantes/:id/encerrar')
  @HttpCode(200)
  @Permissao(P.acompanhanteRegistrar)
  @AuditadoNoHandler(
    'internacao.registrarDietaAcompanhante (o encerramento em plano_refeicao_acompanhante) com a trilha',
  )
  async encerrarAcompanhante(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoMapa> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarDietaAcompanhante, b);
    await this.apoio.exigirLiberacao(s);
    const a = await this.porta.acompanhante(s.porta, idDaRota(id));
    if (!a)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Refeição não encontrada',
        'A refeição do acompanhante não existe.',
      );
    await this.apoio.sgh(
      s,
      E.dietaAcompanhanteRegistrada.codigo,
      P.acompanhanteRegistrar,
      { tabela: 'plano_refeicao_acompanhante', id: String(a.id), chave: `${a.reg}:encerrada` },
      (g) => g.encerrarAcompanhante({ id: a.id, motivo: e.motivo, usuario: s.login }),
    );
    return { ok: true, id: a.id, mensagem: 'Refeição do acompanhante encerrada.' };
  }

  // ── Serviço social ─────────────────────────────────────────────────────────────────────────────

  @Get('servico-social/fila')
  @Permissao(P.socialLer)
  @Auditar(E.avaliacaoSocialLida.codigo)
  async filaSocial(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = await this.servico.filaSocial(s.porta);
    // Regra 13 (D-SOCIAL-455): o risco e as barreiras sociais só para a equipe com vínculo. Com a restrição do
    // estabelecimento ligada, a fila traz só os pacientes com vínculo da sessão (como as listas gerais do D-VINC-24).
    const com = await this.acesso.pacientesComVinculo(
      s,
      f.itens.map((i) => i.paciente),
    );
    return { ...f, itens: f.itens.filter((i) => com.has(i.paciente)) };
  }

  @Get('servico-social/internacoes/:reg')
  @Permissao(P.socialLer)
  @Auditar(E.avaliacaoSocialLida.codigo)
  async social(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada): Promise<ServicoSocialPaciente> {
    const s = sessaoDe(req);
    const i = await this.porta.internacao(s.porta, idDaRota(reg));
    if (!i)
      throw new ErroProblema('nao-encontrado', 404, 'Internação não encontrada', 'A internação não existe.');
    // Dado sensível (regra 13): o acesso exige o vínculo assistencial (com a restrição do estabelecimento ligada).
    await this.acesso.exigirVinculo(s, i.paciente, P.socialLer, 'pep.evolucao');
    const [{ hoje }, registros, barreiras, cats] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.sociais(s.porta, i.reg),
      this.porta.barreiras(s.porta, [i.reg]),
      this.categorias(s),
    ]);
    const leitor =
      cats.find((c) => c.categoria === 'servico-social')?.categoria ?? cats[0]?.categoria ?? null;
    const k = await this.porta.correcoes(
      s.porta,
      'social',
      registros.map((r) => r.id),
    );
    return {
      internacao: i.reg,
      paciente: i.paciente,
      nome: i.nome,
      leito: { bloco: i.bloco, acomodacao: i.acomodacao, leito: i.leito },
      admissao: i.admissao,
      idade: idadeNoDia(i.nascimento, hoje),
      registros: registros.map((r) =>
        comSigiloSocial(
          {
            id: r.id,
            tipo: r.tipo,
            redeApoio: r.redeApoio,
            vulnerabilidades: r.vulnerabilidades,
            risco: r.risco,
            encaminhamentos: r.encaminhamentos,
            parecer: r.parecer,
            sigilo: false,
            orientacoes: r.orientacoes,
            barreira: r.barreira,
            por: r.por,
            em: r.em,
            adendoDe: r.adendoDe,
            motivoAdendo: r.motivoAdendo,
            situacao: comCorrecao(r.id, k).situacao,
            correcao: comCorrecao(r.id, k).correcao,
          },
          leitor,
        ),
      ),
      barreiras: barreiras
        .filter((x) => x.situacao === 'aberta')
        .map((x) => ({
          id: x.id,
          tipo: x.tipo,
          descricao: x.descricao,
          responsavel: x.responsavel,
          prazo: x.prazo,
          vencida: x.prazo < hoje,
        })),
      daCategoria: leitor === 'servico-social',
      lidoEm: hoje,
    };
  }

  @Post('servico-social/registros')
  @HttpCode(201)
  @Permissao(P.socialRegistrar)
  @AuditadoNoHandler(
    'pep.registrarAvaliacaoSocial (registro_social e a barreira social em barreira_alta) com a trilha na mesma transação',
  )
  async registrarSocial(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSocial> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarAvaliacaoSocial, b);
    await this.apoioSocial.exigirLiberacao(s);
    const v = await this.vinculoDa(s, CATEGORIAS_SOCIAL, 'social');
    const i = await this.servico.internacaoAberta(s.porta, e.internacao);
    await this.acesso.exigirVinculo(s, i.paciente, P.socialRegistrar, 'pep.evolucao');
    let risco: ReturnType<typeof conferirRiscoSocial>;
    try {
      risco = conferirRiscoSocial(e.risco, e.redeApoio, e.vulnerabilidades);
    } catch (x) {
      return recusaDominio(x);
    }
    const r = await this.apoioSocial.sgh(
      s,
      E.avaliacaoSocialRegistrada.codigo,
      P.socialRegistrar,
      (x: { id: number; barreira: number | null }) => ({
        tabela: 'registro_social',
        id: String(x.id),
        paciente: i.paciente,
        chave: `${i.reg}:${e.tipo}:${risco}${x.barreira ? `:barreira:${x.barreira}` : ''}`,
      }),
      (g) =>
        g.registrarSocial({
          reg: i.reg,
          pront: i.pront,
          paciente: i.paciente,
          tipo: e.tipo,
          redeApoio: e.redeApoio,
          vulnerabilidades: e.vulnerabilidades,
          risco,
          encaminhamentos: e.encaminhamentos,
          parecer: e.parecer,
          orientacoes: e.orientacoes ?? null,
          barreira: e.barreira,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: r.id,
      barreira: r.barreira,
      risco,
      mensagem: `Registro do serviço social salvo (risco ${risco === 'medio' ? 'médio' : risco})${r.barreira ? '; a barreira social foi para o NIR' : ''}.`,
    };
  }

  // ── W0-05: correção, estorno, versão e alteração ───────────────────────────────────────────────

  /** A internação do registro (404 se não existe) aberta, com o vínculo assistencial conferido. */
  private async internacaoDoRegistro(
    s: SessaoCadastro,
    registro: 'triagem' | 'meta' | 'acompanhamento' | 'social',
    idRota: string,
    permissao: string,
  ) {
    const id = idDaRota(idRota);
    const reg = await this.porta.internacaoDoRegistro(s.porta, registro, id);
    if (reg === null)
      throw new ErroProblema('nao-encontrado', 404, 'Registro não encontrado', 'O registro não existe.');
    const i = await this.servico.internacaoAberta(s.porta, reg);
    await this.acesso.exigirVinculo(s, i.paciente, permissao, 'pep.evolucao');
    return { id, i };
  }

  @Post('nutricao/triagens/:id/retificar')
  @HttpCode(201)
  @Permissao(P.nutricaoTriar)
  @AuditadoNoHandler(
    'pep.triarNutricao (a nova versão em triagem_nutricional e a anterior inativa em correcao_registro_nutricao) com a trilha',
  )
  async retificarTriagem(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCorrecao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRetificarTriagem, b);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoDa(s, CATEGORIAS_TRIAGEM, 'triagem');
    const { id, i } = await this.internacaoDoRegistro(s, 'triagem', idRota, P.nutricaoTriar);
    const ts = await this.porta.triagens(s.porta, [i.reg]);
    const t = ts.find((x) => x.id === id);
    // As correções de todas as triagens da internação: a da retificada e a cadeia até a triagem original.
    const k = await this.porta.correcoes(
      s.porta,
      'triagem',
      ts.map((x) => x.id),
    );
    const { hoje } = await this.porta.relogio(s.porta);
    const p = await this.parametros(s, i.bloco);
    let r: ReturnType<typeof calcularTriagem>;
    try {
      if (!t) throw new ErroCorrecao('registro-ja-corrigido', 409, 'A triagem não existe.');
      exigirProprioAutor(t, s.login, 'A triagem');
      exigirAtivo({ correcao: k.inativa.get(id) ?? null });
      r = calcularTriagem(e.respostas, idadeNoDia(i.nascimento, hoje));
    } catch (x) {
      return recusaDominio(x);
    }
    // A retificação corrige o conteúdo, não o momento da triagem (D-W005-PRAZO): a reavaliação conta do dia da triagem
    // ORIGINAL (a primeira da cadeia de retificações), nunca de hoje; retificar não adia o prazo.
    let original = t;
    for (let passo = 0; passo < ts.length; passo++) {
      const anterior = k.substitui.get(original.id);
      const o = anterior === undefined ? undefined : ts.find((x) => x.id === anterior);
      if (!o) break;
      original = o;
    }
    const diaDaTriagem = original.em.slice(0, 10);
    const novo = await this.apoio.sgh(
      s,
      E.nutricaoRegistroCorrigido.codigo,
      P.nutricaoTriar,
      (x: number) => ({
        tabela: 'correcao_registro_nutricao',
        id: String(x),
        paciente: i.paciente,
        chave: `triagem:${id}:retificacao:${x}`,
      }),
      async (g) => {
        const x = await g.triar({
          reg: i.reg,
          pront: i.pront,
          paciente: i.paciente,
          instrumento: r.instrumento,
          versao: r.versao,
          respostas: respostasCompactas(e.respostas),
          estado: r.parcelas.estado,
          gravidade: r.parcelas.gravidade,
          idade: r.parcelas.idade,
          total: r.total,
          risco: r.risco,
          conduta: e.conduta ?? null,
          pesoKg: e.pesoKg,
          alturaCm: e.alturaCm,
          imc: imc(e.pesoKg, e.alturaCm),
          admissao: i.admissao,
          // A retificação corrige o conteúdo, não o momento da triagem: o prazo continua o da versão original.
          horasDesdeAdmissao: t.horasDesdeAdmissao,
          dentroDoPrazo: t.horasDesdeAdmissao <= p.prazos.prazoHoras,
          reavaliarEm: reavaliarEm(r.risco, diaDaTriagem, p.prazos),
          vinculo: v.vinculo,
          usuario: s.login,
        });
        await g.corrigir({
          registro: 'triagem',
          id,
          reg: i.reg,
          acao: 'retificacao',
          idNovo: x,
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        });
        return x;
      },
    );
    return {
      ok: true,
      id,
      idNovo: novo,
      mensagem: `Triagem retificada: a versão nova tem ${r.total} ponto(s); a anterior fica inativa e visível.`,
    };
  }

  /** Estorno (inativação) de triagem, acompanhamento ou registro social: o próprio autor, com a justificativa. */
  private async estornar(
    req: RequisicaoAutorizada,
    registro: 'triagem' | 'acompanhamento' | 'social',
    idRota: string,
    b: unknown,
  ): Promise<ResultadoCorrecao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSoMotivo, b);
    const social = registro === 'social';
    const apoio = social ? this.apoioSocial : this.apoio;
    const permissao =
      registro === 'triagem' ? P.nutricaoTriar : social ? P.socialRegistrar : P.terapiaAcompanhar;
    await apoio.exigirLiberacao(s);
    const v = social
      ? await this.vinculoDa(s, CATEGORIAS_SOCIAL, 'social')
      : registro === 'triagem'
        ? await this.vinculoDa(s, CATEGORIAS_TRIAGEM, 'triagem')
        : await this.vinculoDa(s, CATEGORIAS_EMTN, 'emtn');
    const { id, i } = await this.internacaoDoRegistro(s, registro, idRota, permissao);
    const autor =
      registro === 'triagem'
        ? (await this.porta.triagens(s.porta, [i.reg])).find((x) => x.id === id)
        : social
          ? (await this.porta.sociais(s.porta, i.reg)).find((x) => x.id === id)
          : (await this.porta.terapia(s.porta, i.reg)).acompanhamentos.find((x) => x.id === id);
    const k = await this.porta.correcoes(s.porta, registro, [id]);
    try {
      if (!autor) throw new ErroCorrecao('registro-ja-corrigido', 409, 'O registro não existe.');
      exigirProprioAutor(
        autor,
        s.login,
        registro === 'triagem' ? 'A triagem' : social ? 'O registro social' : 'O acompanhamento',
      );
      exigirAtivo({ correcao: k.inativa.get(id) ?? null });
    } catch (x) {
      return recusaDominio(x);
    }
    await apoio.sgh(
      s,
      social ? E.avaliacaoSocialCorrigida.codigo : E.nutricaoRegistroCorrigido.codigo,
      permissao,
      (x: number) => ({
        tabela: 'correcao_registro_nutricao',
        id: String(x),
        paciente: i.paciente,
        chave: `${registro}:${id}:estorno`,
      }),
      (g) =>
        g.corrigir({
          registro,
          id,
          reg: i.reg,
          acao: 'estorno',
          idNovo: null,
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id,
      idNovo: null,
      mensagem: 'Registro estornado: fica inativo e visível no prontuário, com o motivo.',
    };
  }

  @Post('nutricao/triagens/:id/estornar')
  @HttpCode(200)
  @Permissao(P.nutricaoTriar)
  @AuditadoNoHandler('pep.triarNutricao (o estorno em correcao_registro_nutricao) com a trilha')
  estornarTriagem(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.estornar(req, 'triagem', id, b);
  }

  @Post('nutricao/terapias/acompanhamentos/:id/estornar')
  @HttpCode(200)
  @Permissao(P.terapiaAcompanhar)
  @AuditadoNoHandler(
    'pep.acompanharTerapiaNutricional (o estorno em correcao_registro_nutricao) com a trilha',
  )
  estornarAcompanhamento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.estornar(req, 'acompanhamento', id, b);
  }

  @Post('servico-social/registros/:id/estornar')
  @HttpCode(200)
  @Permissao(P.socialRegistrar)
  @AuditadoNoHandler('pep.registrarAvaliacaoSocial (o estorno em correcao_registro_nutricao) com a trilha')
  estornarSocial(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.estornar(req, 'social', id, b);
  }

  @Post('nutricao/terapias/acompanhamentos/:id/retificar')
  @HttpCode(201)
  @Permissao(P.terapiaAcompanhar)
  @AuditadoNoHandler(
    'pep.acompanharTerapiaNutricional (a nova versão do dia e a anterior inativa em correcao_registro_nutricao) com a trilha',
  )
  async retificarAcompanhamento(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCorrecao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRetificarAcompanhamento, b);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoDa(s, CATEGORIAS_EMTN, 'emtn');
    const { id, i } = await this.internacaoDoRegistro(s, 'acompanhamento', idRota, P.terapiaAcompanhar);
    const t = await this.porta.terapia(s.porta, i.reg);
    const o = t.acompanhamentos.find((x) => x.id === id);
    const k = await this.porta.correcoes(s.porta, 'acompanhamento', [id]);
    try {
      if (!o) throw new ErroCorrecao('registro-ja-corrigido', 409, 'O acompanhamento não existe.');
      exigirProprioAutor(o, s.login, 'O acompanhamento');
      exigirAtivo({ correcao: k.inativa.get(id) ?? null });
      conferirRetificacaoVolume(o.origemVolume);
    } catch (x) {
      return recusaDominio(x);
    }
    const meta = await this.porta.meta(s.porta, o.meta);
    if (!meta)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Meta não encontrada',
        'A meta do acompanhamento não existe.',
      );
    const p = await this.parametros(s, i.bloco);
    // O dia corrigido continua na meta dele (a versão em que foi registrado) e só o volume informado muda.
    const { a, prescrito } = await this.calcularDia(s, i, meta, o.data, e.volumeInformadoMl, e.motivoMeta, p);
    if (a.origemVolume !== 'informado')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Volume da fonte',
        'A checagem ou o balanço do dia já trazem o volume: estorne este acompanhamento e registre de novo.',
        { codigo: 'volume-nao-informado' },
      );
    const novo = await this.apoio.sgh(
      s,
      E.nutricaoRegistroCorrigido.codigo,
      P.terapiaAcompanhar,
      (x: number) => ({
        tabela: 'correcao_registro_nutricao',
        id: String(x),
        paciente: i.paciente,
        chave: `acompanhamento:${id}:retificacao:${x}`,
      }),
      async (g) => {
        const x = await g.registrarAcompanhamento({
          reg: i.reg,
          pront: i.pront,
          paciente: i.paciente,
          via: meta.via,
          meta: meta.id,
          data: o.data,
          volumePrescritoMl: prescrito ?? o.volumePrescritoMl,
          volumeInfundidoMl: a.volumeInfundidoMl,
          origemVolume: a.origemVolume,
          kcalAtingida: a.kcalAtingida,
          proteinaAtingidaG: a.proteinaAtingidaG,
          pctKcal: a.pctKcal,
          pctProteina: a.pctProteina,
          motivo: e.motivoMeta,
          observacao: e.observacao ?? null,
          vinculo: v.vinculo,
          usuario: s.login,
        });
        await g.corrigir({
          registro: 'acompanhamento',
          id,
          reg: i.reg,
          acao: 'retificacao',
          idNovo: x,
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        });
        return x;
      },
    );
    return {
      ok: true,
      id,
      idNovo: novo,
      mensagem: `Acompanhamento retificado: ${String(a.pctKcal).replace('.', ',')}% da meta calórica com o volume corrigido; a versão anterior fica inativa e visível.`,
    };
  }

  @Post('nutricao/terapias/metas/:id/alterar')
  @HttpCode(201)
  @Permissao(P.terapiaAcompanhar)
  @AuditadoNoHandler(
    'pep.acompanharTerapiaNutricional (a nova versão da meta e a anterior inativa em correcao_registro_nutricao) com a trilha',
  )
  async alterarMeta(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCorrecao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarMetaTerapia, b);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoDa(s, CATEGORIAS_EMTN, 'emtn');
    const { id, i } = await this.internacaoDoRegistro(s, 'meta', idRota, P.terapiaAcompanhar);
    const anterior = await this.porta.meta(s.porta, id);
    if (!anterior) throw new ErroProblema('nao-encontrado', 404, 'Meta não encontrada', 'A meta não existe.');
    await this.exigirMetaVigente(s, id);
    this.exigirOrigemNpt(anterior.via, e.itemDieta, (await this.parametros(s, i.bloco)).nptOrigem);
    let dieta: number | null = null;
    if (e.itemDieta !== null) {
      const { agora } = await this.porta.relogio(s.porta);
      const dietas = i.atendimento
        ? await this.porta.dietasEnterais(
            s.porta,
            i.atendimento,
            `${somarDias(agora.slice(0, 10), -14)}T00:00`,
          )
        : [];
      const d = dietas.find((x) => x.itemDieta === e.itemDieta && !x.suspensa);
      if (!d || (d.plano === 5) !== (anterior.via === 'parenteral'))
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Dieta não encontrada',
          'A dieta escolhida não é uma dieta da mesma via vigente desta internação: abra a terapia de novo.',
          { codigo: 'dieta-nao-enteral', campos: ['itemDieta'] },
        );
      dieta = d.dieta;
    }
    let m: ReturnType<typeof calcularMeta>;
    try {
      m = calcularMeta(e);
    } catch (x) {
      return recusaDominio(x);
    }
    const novo = await this.apoio.sgh(
      s,
      E.nutricaoRegistroCorrigido.codigo,
      P.terapiaAcompanhar,
      (x: number) => ({
        tabela: 'correcao_registro_nutricao',
        id: String(x),
        paciente: i.paciente,
        chave: `meta:${id}:nova-versao:${x}`,
      }),
      async (g) => {
        const x = await g.registrarMeta({
          reg: i.reg,
          pront: i.pront,
          paciente: i.paciente,
          via: anterior.via,
          itemDieta: e.itemDieta,
          dieta,
          pesoKg: e.pesoKg,
          kcalPorKg: e.kcalPorKg,
          proteinaGPorKg: e.proteinaGPorKg,
          metaKcal: m.metaKcal,
          metaProteinaG: m.metaProteinaG,
          densidadeKcalMl: e.densidadeKcalMl,
          proteinaGL: e.proteinaGL,
          metaVolumeMl: m.metaVolumeMl,
          observacao: e.observacao ?? null,
          vinculo: v.vinculo,
          usuario: s.login,
        });
        await g.corrigir({
          registro: 'meta',
          id,
          reg: i.reg,
          acao: 'nova-versao',
          idNovo: x,
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        });
        return x;
      },
    );
    return {
      ok: true,
      id,
      idNovo: novo,
      mensagem: `Meta alterada (nova versão): ${String(m.metaKcal).replace('.', ',')} kcal e ${String(m.metaProteinaG).replace('.', ',')} g de proteína por dia; os dias já registrados continuam na versão anterior.`,
    };
  }

  @Post('nutricao/terapias/metas/:id/encerrar')
  @HttpCode(200)
  @Permissao(P.terapiaAcompanhar)
  @AuditadoNoHandler(
    'pep.acompanharTerapiaNutricional (o encerramento em correcao_registro_nutricao) com a trilha',
  )
  async encerrarMeta(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCorrecao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSoMotivo, b);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoDa(s, CATEGORIAS_EMTN, 'emtn');
    const { id, i } = await this.internacaoDoRegistro(s, 'meta', idRota, P.terapiaAcompanhar);
    await this.exigirMetaVigente(s, id);
    await this.apoio.sgh(
      s,
      E.nutricaoRegistroCorrigido.codigo,
      P.terapiaAcompanhar,
      (x: number) => ({
        tabela: 'correcao_registro_nutricao',
        id: String(x),
        paciente: i.paciente,
        chave: `meta:${id}:encerramento`,
      }),
      (g) =>
        g.corrigir({
          registro: 'meta',
          id,
          reg: i.reg,
          acao: 'encerramento',
          idNovo: null,
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id,
      idNovo: null,
      mensagem: 'Terapia nutricional encerrada: a meta fica inativa e visível.',
    };
  }

  @Post('nutricao/terapias/metas/:id/avaliacao-npt')
  @HttpCode(201)
  @Permissao(P.terapiaAvaliarNpt)
  @AuditadoNoHandler(
    'pep.acompanharTerapiaNutricional (avaliacao_npt) com a trilha na mesma transação',
  )
  async avaliarNpt(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCorrecao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAvaliarNpt, b);
    await this.apoio.exigirLiberacao(s);
    const v = await this.vinculoDa(s, ['farmacia'], 'npt');
    const { id, i } = await this.internacaoDoRegistro(s, 'meta', idRota, P.terapiaAvaliarNpt);
    await this.exigirMetaVigente(s, id);
    try {
      conferirAvaliacaoNpt(e);
    } catch (x) {
      return recusaDominio(x);
    }
    const x = await this.apoio.sgh(
      s,
      E.nptAvaliada.codigo,
      P.terapiaAvaliarNpt,
      (r: number) => ({
        tabela: 'avaliacao_npt',
        id: String(r),
        paciente: i.paciente,
        chave: `meta:${id}:${e.parecer}:${e.acesso}`,
      }),
      (g) =>
        g.avaliarNpt({
          reg: i.reg,
          meta: id,
          parecer: e.parecer,
          acesso: e.acesso,
          osmolaridade: e.osmolaridade,
          estabilidade: e.estabilidade,
          compatibilidade: e.compatibilidade,
          observacao: e.observacao ?? null,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: x,
      idNovo: null,
      mensagem: `Avaliação farmacêutica da NPT registrada: ${e.parecer === 'adequada' ? 'adequada' : e.parecer === 'ajustar' ? 'ajustar' : 'inadequada'}.`,
    };
  }

  @Post('servico-social/registros/:id/adendo')
  @HttpCode(201)
  @Permissao(P.socialRegistrar)
  @AuditadoNoHandler(
    'pep.registrarAvaliacaoSocial (o adendo em registro_social) com a trilha na mesma transação',
  )
  async adendoSocial(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCorrecao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAdendoSocial, b);
    await this.apoioSocial.exigirLiberacao(s);
    const v = await this.vinculoDa(s, CATEGORIAS_SOCIAL, 'social');
    const { id, i } = await this.internacaoDoRegistro(s, 'social', idRota, P.socialRegistrar);
    const k = await this.porta.correcoes(s.porta, 'social', [id]);
    try {
      exigirAtivo({ correcao: k.inativa.get(id) ?? null });
    } catch (x) {
      return recusaDominio(x);
    }
    const x = await this.apoioSocial.sgh(
      s,
      E.avaliacaoSocialCorrigida.codigo,
      P.socialRegistrar,
      (r: number) => ({
        tabela: 'registro_social',
        id: String(r),
        paciente: i.paciente,
        chave: `social:${id}:adendo`,
      }),
      (g) =>
        g.adendoSocial({
          reg: i.reg,
          de: id,
          texto: e.texto,
          motivo: e.motivo,
          vinculo: v.vinculo,
          usuario: s.login,
        }),
    );
    return { ok: true, id, idNovo: x, mensagem: 'Adendo registrado; o registro original continua ativo.' };
  }

  @Post('nutricao/acompanhantes/:id/alterar')
  @HttpCode(200)
  @Permissao(P.acompanhanteRegistrar)
  @AuditadoNoHandler(
    'internacao.registrarDietaAcompanhante (a alteração em plano_refeicao_acompanhante e o log em alteracao_hotelaria) com a trilha',
  )
  async alterarAcompanhante(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoMapa> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarDietaAcompanhante, b);
    await this.apoio.exigirLiberacao(s);
    const a = await this.porta.acompanhante(s.porta, idDaRota(idRota));
    if (!a)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Refeição não encontrada',
        'A refeição do acompanhante não existe.',
      );
    if (a.situacao !== 'ativa')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Refeição encerrada',
        'A refeição do acompanhante foi encerrada: registre uma nova.',
        { codigo: 'acompanhante-desatualizado' },
      );
    if (e.fim !== null && e.fim < a.inicio)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Fim antes do início',
        'O fim não pode ser antes do início.',
        {
          campos: ['fim'],
        },
      );
    // O valor anterior e o novo com tudo o que o UPDATE troca (a observação também).
    const valor = (x: {
      dieta: string | null;
      refeicoes: readonly number[];
      fim: string | null;
      observacao: string | null;
    }) =>
      JSON.stringify({
        dieta: x.dieta,
        refeicoes: [...x.refeicoes].sort((p, q) => p - q),
        fim: x.fim,
        observacao: x.observacao,
      });
    const depois = {
      dieta: e.dieta ?? null,
      refeicoes: e.refeicoes,
      fim: e.fim,
      observacao: e.observacao ?? a.observacao,
    };
    await this.apoio.sgh(
      s,
      E.dietaAcompanhanteAlterada.codigo,
      P.acompanhanteRegistrar,
      { tabela: 'plano_refeicao_acompanhante', id: String(a.id), chave: `${a.reg}:alterada` },
      async (g) => {
        // O anterior é o relido na transação (linha travada): duas alterações simultâneas não perdem a do meio.
        const antes = await g.alterarAcompanhante({ id: a.id, ...depois });
        return g.registrarAlteracao({
          tabela: 'plano_refeicao_acompanhante',
          id: a.id,
          evento: 'alterada',
          antes: valor(antes),
          depois: valor(depois),
          motivo: e.motivo,
          usuario: s.login,
        });
      },
    );
    return {
      ok: true,
      id: a.id,
      mensagem: 'Refeição do acompanhante alterada; o valor anterior fica no histórico.',
    };
  }
}
