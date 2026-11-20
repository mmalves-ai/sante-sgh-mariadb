// Pronto atendimento (M20; ficha, seção 4 "Quadro de acompanhamento do PA", "Observação" e "Desfecho do PA"):
//   GET  /api/pa/quadro                    os abertos por etapa, com os tempos e o alerta da observação (auditado); as
//                                          saídas pela outra ponta sem desfecho codificado, à parte
//   GET  /api/pa/quadro/eventos            canal de eventos (text/event-stream): só avisa que mudou
//   POST /api/pa/:reg/etapa                a etapa registrada no quadro (SGH_PA_ETAPA, marca de tempo do novo)
//   GET  /api/pa/observacao                leitos e poltronas de observação com a ocupação e o alerta de 24 h
//   POST /api/pa/:reg/observacao           pôr no leito ou na poltrona (SGH_PA_OBSERVACAO)
//   POST /api/pa/:reg/observacao/liberar   tirar da observação (com 24 h ou mais, só com justificativa; também depois
//                                          do desfecho ou fora da janela do quadro)
//   POST /api/pa/:reg/observacao/transferir W0-07: troca de leito numa operação só (liberar e alocar na mesma transação;
//                                          falhou no meio, nada muda e o paciente fica no leito de origem)
//   POST /api/pa/:reg/desfecho             atendimento.encerrarAtendimento (ato médico só por médico com conselho)
//   GET  /api/pa/:reg/escores              W0-07 (M1): NEWS2, qSOFA e SIRS do atendimento (o alerta vigente, os sinais
//                                          recentes para pré-preencher, os limiares e o histórico com os estornados)
//   POST /api/pa/:reg/escores              W0-07 (M1): registrar o escore (o servidor calcula; SGH_PA_ESCORE)
//   POST /api/pa/:reg/escores/estornar     W0-07 (M1): estornar o escore errado com o motivo e, se vier, relançar o certo
//                                          na mesma transação (SGH_PA_ESCORE_ESTORNO)
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req, Res } from '@nestjs/common';
import {
  esquemaAlocarObservacao,
  esquemaEstornarEscorePa,
  esquemaRegistrarEscorePa,
  type AlertaEscorePa,
  type EscoresPaDoAtendimento,
  PARAMETRO_LIMIAR_NEWS2_SEPSE,
  PARAMETRO_LIMIAR_QSOFA_SEPSE,
  type SinaisEscorePa,
  esquemaLiberarObservacao,
  esquemaRegistrarEtapaPa,
  esquemaTransferirObservacao,
  EVENTOS_AUDITAVEIS,
  OBSERVACAO_LIMITE_HORAS,
  type ObservacaoPa,
  PERMISSOES_PROTOCOLO_GERENCIADO_CODIGOS,
  type QuadroPa,
  type ResultadoAtendimento,
} from '@sgh/contratos';
import { pode } from '@sgh/dominio-acesso';
import { etapaAtual, podeRegistrarEtapa } from '@sgh/dominio-atendimento';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS } from '../internacao/public-api.js';
import { ApoiosAtendimento, avisando, encerrarPelaSessao } from './atendimento.controller.js';
import {
  AVISOS_ATENDIMENTO,
  type AvisosAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from './avisos.js';
import {
  type ContextoAtendimento,
  FONTE_RISCO_PA,
  type FonteRiscoPa,
  PORTA_ATENDIMENTO,
  type PortaAtendimento,
} from './porta.js';
import { ServicoAtendimento } from './servico.js';
import { alertaVigente, calcularEscorePa, escoreLidoNoContrato, sinaisDoProntuario } from './escore-pa.js';
import { LIMIARES_SEPSE_PA_PADRAO, type LimiaresSepsePa } from '@sgh/dominio-enfermagem';

const TABELA_ETAPA = 'SGH_PA_ETAPA';
const TABELA_OBSERVACAO = 'SGH_PA_OBSERVACAO';
const TABELA_ESCORE = 'SGH_PA_ESCORE';

const ctx = (s: SessaoCadastro): ContextoAtendimento => s.porta;

@Controller('pa')
export class PaController {
  private readonly apoios: ApoiosAtendimento;
  private readonly servico: ServicoAtendimento;
  constructor(
    @Inject(PORTA_ATENDIMENTO) private readonly porta: PortaAtendimento,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(AVISOS_ATENDIMENTO) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
    @Optional() @Inject(FONTE_RISCO_PA) private readonly risco: FonteRiscoPa | null = null,
  ) {
    this.apoios = new ApoiosAtendimento(porta, trilha, configuracao, cache);
    this.servico = new ServicoAtendimento(porta);
  }

  private async avisoHoras(s: SessaoCadastro): Promise<number> {
    const v = await this.apoios.pa.parametro(s, 'atendimento.observacaoAvisoHoras');
    return v > 0 && v < OBSERVACAO_LIMITE_HORAS ? v : 20;
  }

  /** W0-07 (M1): os limiares da sugestão de sepse (parâmetro; fora da faixa ou sem valor, o padrão de mercado). */
  private async limiares(s: SessaoCadastro): Promise<LimiaresSepsePa> {
    const [news2, qsofa] = await Promise.all([
      this.apoios.pa.parametro(s, PARAMETRO_LIMIAR_NEWS2_SEPSE).catch(() => 0),
      this.apoios.pa.parametro(s, PARAMETRO_LIMIAR_QSOFA_SEPSE).catch(() => 0),
    ]);
    return {
      news2: news2 >= 1 && news2 <= 20 ? news2 : LIMIARES_SEPSE_PA_PADRAO.news2,
      qsofa: qsofa >= 1 && qsofa <= 3 ? qsofa : LIMIARES_SEPSE_PA_PADRAO.qsofa,
    };
  }

  /** W0-07 (M1): o alerta de cada atendimento aberto (os escores do PA e os sinais recentes numa leitura por lote). */
  private alertasDoQuadro(s: SessaoCadastro) {
    return async (itens: readonly { reg: number; cabecalho: string; chegada: string }[]) => {
      const [limiares, escores, sinais, { agora }] = await Promise.all([
        this.limiares(s),
        this.porta.escoresPa(
          ctx(s),
          itens.map((x) => x.cabecalho),
        ),
        this.porta
          .sinaisPa(
            ctx(s),
            itens.map((x) => ({ cabecalho: x.cabecalho, desde: x.chegada })),
          )
          .catch(() => new Map()),
        this.porta.relogio(ctx(s)),
      ]);
      const m = new Map<number, AlertaEscorePa | null>();
      for (const x of itens)
        m.set(
          x.reg,
          alertaVigente(
            escores.filter((e) => e.cabecalho === x.cabecalho),
            sinais.get(x.cabecalho) ?? null,
            limiares,
            agora,
          ),
        );
      return m;
    };
  }

  @Get('quadro')
  @Permissao('pa.quadro.ler')
  @Auditar(EVENTOS_AUDITAVEIS.atendimentoFilaLida.codigo)
  async quadro(@Req() req: RequisicaoAutorizada): Promise<QuadroPa> {
    const s = sessaoDe(req);
    const alvo = (await this.apoios.pa.parametro(s, 'atendimento.paAlvoPortaMedicoMinutos')) || 60;
    // O chip do protocolo gerenciado (dado clínico sensível) só para quem tem a leitura dos protocolos do paciente.
    const verProtocolos =
      !!req.sgh && pode(req.sgh.ability, PERMISSOES_PROTOCOLO_GERENCIADO_CODIGOS.protocoloPacienteLer);
    return this.servico.quadro(
      ctx(s),
      alvo,
      await this.avisoHoras(s),
      this.risco,
      verProtocolos,
      this.alertasDoQuadro(s),
    );
  }

  @Get('quadro/eventos')
  @Permissao('pa.quadro.ler')
  eventos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(req, res, sessaoDe(req).hospital, 'pa.quadro.ler', this.resolvedor, this.batidaMs);
  }

  @Post(':reg/etapa')
  @HttpCode(201)
  @Permissao('pa.etapa.registrar')
  @AuditadoNoHandler('etapa do PA (SGH_PA_ETAPA) com a SGH_TRILHA na mesma transação')
  async etapa(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtendimento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarEtapaPa, { ...(b as object), atendimento: idDaRota(reg) });
    const aberto = await this.exigirPaAberto(s, e.atendimento);
    const atual = etapaAtual({
      reg: aberto.reg,
      chegada: aberto.chegada,
      prioridade: aberto.prioridade,
      marcas: aberto.marcas as never,
      emObservacao: aberto.observacaoDesde !== null,
    });
    if (!podeRegistrarEtapa(atual.etapa))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Etapa encerrada',
        'O atendimento já tem a decisão registrada.',
        {
          codigo: 'etapa-encerrada',
        },
      );
    const id = await this.apoios.pa.sgh(
      s,
      EVENTOS_AUDITAVEIS.paEtapaRegistrada.codigo,
      'pa.etapa.registrar',
      (n: number) => ({ tabela: TABELA_ETAPA, id: String(n), chave: `${aberto.reg}:${e.etapa}` }),
      (g) =>
        g.registrarEtapa({
          cabecalho: aberto.cabecalho,
          reg: aberto.reg,
          senha: null,
          etapa: e.etapa,
          usuario: s.login,
        }),
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: { reg: aberto.reg, etapa: e.etapa, registro: id },
      repetida: false,
      mensagem: 'Etapa registrada.',
    };
  }

  @Get('observacao')
  @Permissao('pa.observacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.atendimentoFilaLida.codigo)
  async observacao(@Req() req: RequisicaoAutorizada): Promise<ObservacaoPa> {
    const s = sessaoDe(req);
    return this.servico.observacao(ctx(s), await this.avisoHoras(s));
  }

  @Post(':reg/observacao')
  @HttpCode(201)
  @Permissao('pa.observacao.alocar')
  @AuditadoNoHandler('observação do PA (SGH_PA_OBSERVACAO) com a SGH_TRILHA na mesma transação')
  async alocar(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtendimento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlocarObservacao, { ...(b as object), atendimento: idDaRota(reg) });
    const aberto = await this.exigirPaAberto(s, e.atendimento);
    const leitos = await this.porta.observacao(ctx(s));
    const leito = leitos.leitos.find((l) => l.id === e.leito);
    if (!leito || !leito.ativo)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Leito desconhecido',
        'Escolha um leito ou poltrona de observação ativo.',
        {
          campos: ['leito'],
        },
      );
    const id = await this.apoios.pa.sgh(
      s,
      EVENTOS_AUDITAVEIS.paObservacaoAlterada.codigo,
      'pa.observacao.alocar',
      (n: number) => ({ tabela: TABELA_OBSERVACAO, id: String(n), chave: `${aberto.reg}:${e.leito}` }),
      async (g) => {
        const n = await g.alocarObservacao({
          cabecalho: aberto.cabecalho,
          reg: aberto.reg,
          leito: e.leito,
          usuario: s.login,
        });
        await g.registrarEtapa({
          cabecalho: aberto.cabecalho,
          reg: aberto.reg,
          senha: null,
          etapa: 'observacao',
          usuario: s.login,
        });
        return n;
      },
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: { reg: aberto.reg, leito: e.leito, registro: id },
      repetida: false,
      mensagem: `Paciente em observação (${leito.local} ${leito.codigo}).`,
    };
  }

  @Post(':reg/observacao/liberar')
  @HttpCode(200)
  @Permissao('pa.observacao.alocar')
  @AuditadoNoHandler('saída da observação do PA (SGH_PA_OBSERVACAO) com a SGH_TRILHA na mesma transação')
  async liberar(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtendimento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaLiberarObservacao, { ...(b as object), atendimento: idDaRota(reg) });
    // A saída da observação vale para qualquer atendimento com alocação aberta: também o já encerrado e o que saiu
    // da janela de 48 horas do quadro (o leito nunca fica preso). Sem alocação: 'fora-de-observacao'.
    const aberto = await this.servico.detalhe(ctx(s), e.atendimento);
    const r = await this.apoios.pa.sgh(
      s,
      EVENTOS_AUDITAVEIS.paObservacaoAlterada.codigo,
      'pa.observacao.alocar',
      { tabela: TABELA_OBSERVACAO, id: aberto.cabecalho, chave: `${aberto.reg}:saida` },
      (g) =>
        g.liberarObservacao({
          cabecalho: aberto.cabecalho,
          usuario: s.login,
          justificativa: e.justificativa ?? null,
          limiteHoras: OBSERVACAO_LIMITE_HORAS,
        }),
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: { reg: aberto.reg, horas: r.horas },
      repetida: false,
      mensagem: `Paciente saiu da observação depois de ${String(r.horas).replace('.', ',')} h.`,
    };
  }

  @Post(':reg/observacao/transferir')
  @HttpCode(200)
  @Permissao('pa.observacao.alocar')
  @AuditadoNoHandler(
    'transferência de leito na observação do PA (SGH_PA_OBSERVACAO: saída e entrada na mesma transação) com a SGH_TRILHA',
  )
  async transferir(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtendimento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaTransferirObservacao, { ...(b as object), atendimento: idDaRota(reg) });
    const aberto = await this.exigirPaAberto(s, e.atendimento);
    const leitos = await this.porta.observacao(ctx(s));
    const leito = leitos.leitos.find((l) => l.id === e.leito);
    if (!leito || !leito.ativo)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Leito desconhecido',
        'Escolha um leito ou poltrona de observação ativo.',
        { campos: ['leito'] },
      );
    const id = await this.apoios.pa.sgh(
      s,
      EVENTOS_AUDITAVEIS.paObservacaoAlterada.codigo,
      'pa.observacao.alocar',
      (n: number) => ({
        tabela: TABELA_OBSERVACAO,
        id: String(n),
        chave: `${aberto.reg}:transferir:${e.leito}`,
      }),
      async (g) => {
        // Liberar e alocar na MESMA transação: se a alocação falhar (leito ocupado em outro terminal, queda), a saída
        // é desfeita junto e o paciente continua no leito de origem.
        const saida = await g.liberarObservacao({
          cabecalho: aberto.cabecalho,
          usuario: s.login,
          justificativa: `Transferência de leito: ${e.motivo}`.slice(0, 200),
          limiteHoras: OBSERVACAO_LIMITE_HORAS,
          transferencia: true,
        });
        return g.alocarObservacao({
          cabecalho: aberto.cabecalho,
          reg: aberto.reg,
          leito: e.leito,
          usuario: s.login,
          anterior: saida.id,
          motivoTransferencia: e.motivo,
        });
      },
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: { reg: aberto.reg, leito: e.leito, registro: id },
      repetida: false,
      mensagem: `Paciente transferido para ${leito.local} ${leito.codigo}.`,
    };
  }

  @Post(':reg/desfecho')
  @HttpCode(200)
  @Permissao('pa.desfecho.registrar')
  @AuditadoNoHandler('atendimento.encerrarAtendimento pelo executor (trilha na mesma transação)')
  desfecho(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtendimento> {
    const s = sessaoDe(req);
    return avisando(
      this.avisos,
      s,
      encerrarPelaSessao(this.porta, this.servico, this.apoios, s, reg, b, 'pa'),
    );
  }

  @Get(':reg/escores')
  @Permissao('pa.quadro.ler')
  @Auditar(EVENTOS_AUDITAVEIS.escoresLidos.codigo)
  async escores(
    @Param('reg') reg: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<EscoresPaDoAtendimento> {
    const s = sessaoDe(req);
    const aberto = await this.exigirPaAberto(s, idDaRota(reg));
    const [limiares, escores, sinais, { agora }] = await Promise.all([
      this.limiares(s),
      this.porta.escoresPa(ctx(s), [aberto.cabecalho]),
      this.porta
        .sinaisPa(ctx(s), [{ cabecalho: aberto.cabecalho, desde: aberto.chegada }])
        .catch(() => new Map()),
      this.porta.relogio(ctx(s)),
    ]);
    const recentes = sinais.get(aberto.cabecalho) ?? null;
    return {
      reg: aberto.reg,
      limiares,
      sinaisRecentes: recentes ? sinaisDoProntuario(recentes) : null,
      alerta: alertaVigente(escores, recentes, limiares, agora),
      historico: escores.map(escoreLidoNoContrato),
      atualizadoEm: agora,
    };
  }

  @Post(':reg/escores')
  @HttpCode(201)
  @Permissao('pa.etapa.registrar')
  @AuditadoNoHandler(
    'escore de deterioração do PA (SGH_PA_ESCORE, só inclusão) com a SGH_TRILHA na mesma transação',
  )
  async registrarEscore(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtendimento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarEscorePa, { ...(b as object), atendimento: idDaRota(reg) });
    const aberto = await this.exigirPaAberto(s, e.atendimento);
    const limiares = await this.limiares(s);
    const r = calcularEscorePa(e.sinais, limiares);
    const id = await this.apoios.pa.sgh(
      s,
      EVENTOS_AUDITAVEIS.escoreRegistrado.codigo,
      'pa.etapa.registrar',
      (n: number) => ({ tabela: TABELA_ESCORE, id: String(n), chave: `${aberto.reg}:${e.origem}` }),
      (g) =>
        g.registrarEscorePa(
          this.registroDoEscore(aberto, e.origem, e.sinais, r, limiares, null, null, s.login),
        ),
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: {
        reg: aberto.reg,
        registro: id,
        news2: r.news2.total,
        qsofa: r.qsofa.total,
        sirs: r.sirs.total,
        nivel: r.nivel,
        sugereSepse: r.sugereSepse,
        conduta: r.conduta,
      },
      repetida: false,
      mensagem: r.sugereSepse
        ? `Escore registrado: NEWS2 ${r.news2.total}, qSOFA ${r.qsofa.total}. Limiar de sepse atingido.`
        : `Escore registrado: NEWS2 ${r.news2.total}, qSOFA ${r.qsofa.total}.`,
    };
  }

  @Post(':reg/escores/estornar')
  @HttpCode(200)
  @Permissao('pa.etapa.registrar')
  @AuditadoNoHandler(
    'estorno do escore do PA (SGH_PA_ESCORE_ESTORNO) e o relançamento na mesma transação, com a SGH_TRILHA',
  )
  async estornarEscore(
    @Param('reg') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAtendimento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEstornarEscorePa, { ...(b as object), atendimento: idDaRota(reg) });
    const aberto = await this.exigirPaAberto(s, e.atendimento);
    const limiares = await this.limiares(s);
    const r = e.relancar ? calcularEscorePa(e.relancar, limiares) : null;
    const relancado = await this.apoios.pa.sgh(
      s,
      EVENTOS_AUDITAVEIS.paEscoreEstornado.codigo,
      'pa.etapa.registrar',
      () => ({ tabela: TABELA_ESCORE, id: String(e.escore), chave: `${aberto.reg}:estorno` }),
      async (g) => {
        // Estornar e relançar na MESMA transação: o certo só entra se o errado saiu (e vice-versa).
        await g.estornarEscorePa({
          cabecalho: aberto.cabecalho,
          id: e.escore,
          motivo: e.motivo,
          usuario: s.login,
        });
        if (!e.relancar || !r) return null;
        return g.registrarEscorePa(
          this.registroDoEscore(aberto, 'relancamento', e.relancar, r, limiares, e.escore, e.motivo, s.login),
        );
      },
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      resultado: { reg: aberto.reg, estornado: e.escore, relancado },
      repetida: false,
      mensagem: relancado ? 'Escore estornado e relançado.' : 'Escore estornado.',
    };
  }

  private registroDoEscore(
    aberto: { cabecalho: string; reg: number },
    origem: 'classificacao' | 'reavaliacao' | 'relancamento',
    sinais: SinaisEscorePa,
    r: ReturnType<typeof calcularEscorePa>,
    limiares: LimiaresSepsePa,
    substitui: number | null,
    motivo: string | null,
    usuario: string,
  ) {
    return {
      cabecalho: aberto.cabecalho,
      reg: aberto.reg,
      origem,
      sinais,
      news2: r.news2.total,
      news2Completo: r.news2.completo,
      qsofa: r.qsofa.total,
      qsofaCompleto: r.qsofa.completo,
      sirs: r.sirs.total,
      sirsCompleto: r.sirs.completo,
      nivel: r.nivel,
      sugereSepse: r.sugereSepse,
      limiarNews2: limiares.news2,
      limiarQsofa: limiares.qsofa,
      substitui,
      motivo,
      usuario,
    };
  }

  private async exigirPaAberto(s: SessaoCadastro, reg: number) {
    const { hoje } = await this.porta.relogio(ctx(s));
    const r = await this.porta.paAbertos(ctx(s), { hoje });
    // Só os abertos: a ficha que saiu pela outra ponta (liberada ou com alta) não recebe etapa nem leito.
    const a = r.itens.find((x) => x.reg === reg && x.saida === null);
    if (!a)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Atendimento não encontrado',
        'O atendimento não está aberto no pronto atendimento.',
      );
    return a;
  }
}
