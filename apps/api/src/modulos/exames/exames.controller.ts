// Agenda de exames (M18; ficha, seção 7):
//   GET  /api/agenda/exames/opcoes                          convênios, catálogo do SADT, motivos, canais e relógio
//   GET  /api/agenda/exames/gravacao                        a funcionalidade e cada ação gravam agora? (motivo)
//   GET  /api/agenda/exames/agendas?termo&situacao&categoria   agendas de exame (com a contagem da cobertura)
//   GET  /api/agenda/exames/agendas/:id                     convênios, exames cobertos, escala e gerações
//   POST /api/agenda/exames/agendas/:id/convenios           agenda.definirCoberturaExame (a última pede confirmação)
//   POST /api/agenda/exames/agendas/:id/exames              cobertura por exame (agenda_servico_exame)
//   POST /api/agenda/exames/grade/previa                    prévia da geração (nada é gravado)
//   POST /api/agenda/exames/grade/gerar                     agenda.gerarGradeExame (a prévia aprovada, pela impressão)
//   GET  /api/agenda/exames/grade?agenda&de&ate             horários do período (paciente mascarado; resíduo)
//   GET  /api/agenda/exames/vagas?agenda&categoria&convenio&exame&de&ate   busca de vaga (31 dias)
//   POST /api/agenda/exames/marcacoes                       agenda.agendarExame
//   POST /api/agenda/exames/marcacoes/sem-prontuario        agenda.agendarExameSemProntuario (desligada, POL-3)
//   GET  /api/agenda/exames/marcacoes?data&agenda           marcações do dia (paciente mascarado)
//   GET  /api/agenda/exames/marcacoes/:id                   detalhe com o contato (auditado)
//   POST /api/agenda/exames/marcacoes/:id/cancelar          agenda.cancelarExame (motivo padronizado)
//   POST /api/agenda/exames/marcacoes/:id/remarcar          agenda.remarcarExame (transferir ou liberar)
//   GET  /api/agenda/exames/pacientes/:id/marcacoes         marcações de exame do paciente (auditado)
//   GET  /api/agenda/exames/cancelamentos?de&ate&agenda&pagina   cancelados pela data do cancelamento (31 dias)
//   GET  /api/agenda/exames/residuo?de&ate                  resíduo (coordenação): confirmado sem paciente, ocupado sem marcação
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type BuscaVagasExame,
  type DetalheAgendaExame,
  esquemaAgendarExame,
  esquemaAgendarExameSemProntuario,
  esquemaCancelarExame,
  esquemaDefinirCoberturaExame,
  esquemaPedidoCoberturaExame,
  esquemaPedidoGerarGradeExame,
  esquemaPedidoGradeExame,
  esquemaRemarcarExame,
  EVENTOS_AUDITAVEIS,
  type GradeExame,
  type GravacaoAgenda,
  type ListaAgendasExame,
  type ListaCancelamentosExame,
  type ListaMarcacoesExame,
  type MarcacaoExameDetalhe,
  type OpcoesExame,
  type PedidoGrade,
  type PreviaGradeExame,
  type ResiduoExameResposta,
  type ResultadoAgenda,
} from '@sgh/contratos';
import { filtroDeEscopo } from '@sgh/dominio-acesso';
import { avaliarCoberturaExame, somarDias } from '@sgh/dominio-agenda';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, idDaRota, pagina, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao } from './apoio-gravacao.js';
import { type GravadorCoberturaExame, PORTA_EXAME, type PortaExame } from './porta.js';
import { type ContextoExame, exigirJanela, ServicoExame } from './servico.js';

export const CHAVE_LIBERACAO_EXAME = 'agenda.exame';

/** Operações da tela e a permissão de agir de cada uma (a tela esconde a ação sem as duas). */
export const OPERACOES_EXAME: Readonly<Record<string, string>> = {
  'agenda.agendarExame': 'agenda.exame.agendar',
  'agenda.agendarExameSemProntuario': 'agenda.exame.agendar',
  'agenda.cancelarExame': 'agenda.exame.cancelar',
  'agenda.remarcarExame': 'agenda.exame.remarcar',
  'agenda.gerarGradeExame': 'agenda.gradeExame.gerar',
  'agenda.definirCoberturaExame': 'agenda.agendaExame.editar',
};
const ACOES_DIRETAS_EXAME = { coberturaExame: 'agenda.agendaExame.editar' };

/** Tabela da cobertura por exame (pedido de DDL do lote 01-05), também na linha da trilha. */
const TABELA_COBERTURA = 'agenda_servico_exame';

type Esquema<T> = {
  safeParse(
    v: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[] }[] } };
};
export function corpo<T>(esquema: Esquema<T>, v: unknown): T {
  const r = esquema.safeParse(v);
  if (!r.success)
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.', {
      campos: [...new Set(r.error.issues.map((i) => i.path.map(String).join('.') || '(corpo)'))],
    });
  return r.data;
}

export const dataDaConsulta = (v: string | undefined): string | null => {
  if (v === undefined || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return v;
};
export const inteiroOuNulo = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 2_147_483_647 ? n : null;
};

/** Contexto da porta com o escopo da unidade (as permissões agenda.exame.* aceitam o escopo `unidade`). */
export function ctxExame(s: SessaoCadastro): ContextoExame {
  const a = s.req.sgh;
  const f = a ? filtroDeEscopo(a.permissao ?? 'agenda.exame.ler', a.sessao.escopos) : {};
  return { ...s.porta, unidades: f.unidade ?? null };
}

@Controller('agenda/exames')
export class ExamesController {
  private readonly apoio: ApoioGravacao<GravadorCoberturaExame>;
  private readonly servico: ServicoExame;
  constructor(
    @Inject(PORTA_EXAME) private readonly porta: PortaExame,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_EXAME, nome: 'a agenda de exames', operacoes: OPERACOES_EXAME },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.servico = new ServicoExame(porta);
  }

  @Get('opcoes')
  @Permissao('agenda.exame.ler')
  opcoes(@Req() req: RequisicaoAutorizada): Promise<OpcoesExame> {
    return this.servico.opcoes(ctxExame(sessaoDe(req)));
  }

  @Get('gravacao')
  @Permissao('agenda.exame.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoAgenda> {
    return this.apoio.gravacao(sessaoDe(req), ACOES_DIRETAS_EXAME);
  }

  @Get('agendas')
  @Permissao('agenda.exame.ler')
  agendas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaAgendasExame> {
    return this.servico.listar(ctxExame(sessaoDe(req)), {
      termo: (q['termo'] ?? '').slice(0, 60) || null,
      situacao: ['ativas', 'inativas'].includes(q['situacao'] ?? '') ? (q['situacao'] as string) : null,
      categoria: inteiroOuNulo(q['categoria']),
    });
  }

  @Get('agendas/:id')
  @Permissao('agenda.exame.ler')
  agenda(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheAgendaExame> {
    return this.servico.detalhe(ctxExame(sessaoDe(req)), idDaRota(id));
  }

  @Post('agendas/:id/convenios')
  @HttpCode(200)
  @Permissao('agenda.agendaExame.editar')
  @AuditadoNoHandler('agenda.definirCoberturaExame pelo executor (trilha na mesma transação)')
  async convenios(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDefinirCoberturaExame, { ...(b as object), agenda: idDaRota(id) });
    await this.servico.exigirAgendaDaEntrada(ctxExame(s), e.agenda);
    return this.apoio.executar(
      s,
      'agenda.definirCoberturaExame',
      e,
      e.acao === 'incluir' ? 'Convênio incluído na agenda.' : 'Convênio retirado da agenda.',
    );
  }

  @Post('agendas/:id/exames')
  @HttpCode(200)
  @Permissao('agenda.agendaExame.editar')
  @AuditadoNoHandler('cobertura por exame com a trilha na mesma transação')
  async exames(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoCoberturaExame, b);
    const a = await this.servico.exigirAgenda(ctxExame(s), idDaRota(id));
    const opcoes = await this.porta.opcoes(ctxExame(s));
    if (!opcoes.exames.some((x) => x.id === p.exame))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Exame desconhecido',
        'Escolha o exame no catálogo do SADT.',
        {
          campos: ['exame'],
        },
      );
    if (p.convenio !== null && !opcoes.convenios.some((x) => x.codigo === p.convenio))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Convênio desconhecido',
        'Escolha o convênio na lista.',
        {
          campos: ['convenio'],
        },
      );
    const evento = EVENTOS_AUDITAVEIS.agendaCoberturaExameDefinida.codigo;
    const n = await this.apoio.sgh(
      s,
      evento,
      'agenda.agendaExame.editar',
      (r: number) => ({
        tabela: TABELA_COBERTURA,
        id: String(r),
        chave: `${a.id}:${p.exame}:${p.convenio ?? '-'}`,
      }),
      async (g) => {
        if (p.acao === 'incluir')
          return g.incluirCobertura({ agenda: a.id, exame: p.exame, convenio: p.convenio });
        const k = await g.encerrarCobertura({ agenda: a.id, exame: p.exame, convenio: p.convenio });
        if (k === 0)
          throw new ErroProblema(
            'nao-encontrado',
            404,
            'Cobertura não encontrada',
            'Esta cobertura não está na agenda.',
          );
        return k;
      },
    );
    return {
      ok: true,
      resultado: { agenda: a.id, exame: p.exame, registro: n },
      repetida: false,
      mensagem:
        p.acao === 'incluir' ? 'Exame incluído na cobertura da agenda.' : 'Exame retirado da cobertura.',
    };
  }

  @Post('grade/previa')
  @HttpCode(200)
  @AuditadoNoHandler('prévia: só leitura, nada é gravado (POST pelo tamanho do pedido)')
  @Permissao('agenda.exame.ler')
  async previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaGradeExame> {
    const p = corpo(esquemaPedidoGradeExame, b);
    return (await this.servico.previa(ctxExame(sessaoDe(req)), pedidoDaPrevia(p))).previa;
  }

  @Post('grade/gerar')
  @HttpCode(201)
  @Permissao('agenda.gradeExame.gerar')
  @AuditadoNoHandler('agenda.gerarGradeExame pelo executor (trilha na mesma transação)')
  async gerar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoGerarGradeExame, b);
    const { previa, entrada } = await this.servico.previa(ctxExame(s), pedidoDaPrevia(p));
    if (previa.assinatura !== p.assinatura)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'A prévia mudou',
        'A agenda mudou desde a prévia (horários ou escala): refaça a prévia e confira a lista antes de gravar.',
        { codigo: 'previa-desatualizada' },
      );
    return this.apoio.executar(
      s,
      'agenda.gerarGradeExame',
      entrada,
      `${previa.horarios} horário(s) gerado(s).`,
    );
  }

  @Get('grade')
  @Permissao('agenda.exame.ler')
  async grade(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<GradeExame> {
    const c = ctxExame(sessaoDe(req));
    const r = await this.porta.relogio(c);
    const j = exigirJanela(dataDaConsulta(q['de']), dataDaConsulta(q['ate']), 31, r.hoje);
    return this.servico.grade(c, idDaRota(q['agenda'] ?? ''), j.de, j.ate);
  }

  @Get('vagas')
  @Permissao('agenda.exame.ler')
  async vagas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<BuscaVagasExame> {
    const c = ctxExame(sessaoDe(req));
    const r = await this.porta.relogio(c);
    const j = exigirJanela(dataDaConsulta(q['de']), dataDaConsulta(q['ate']), 31, r.hoje);
    return this.servico.buscarVagas(c, {
      agenda: inteiroOuNulo(q['agenda']),
      categoria: inteiroOuNulo(q['categoria']),
      convenio: inteiroOuNulo(q['convenio']),
      exame: inteiroOuNulo(q['exame']),
      de: j.de,
      ate: j.ate,
    });
  }

  @Post('marcacoes')
  @HttpCode(201)
  @Permissao('agenda.exame.agendar')
  @AuditadoNoHandler('agenda.agendarExame pelo executor (trilha na mesma transação)')
  async marcar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAgendarExame, b);
    await this.servico.exigirAgendaDaEntrada(ctxExame(s), e.agenda);
    // A cobertura por exame da agenda (a operação confere as fontes pagadoras aceitas pela agenda).
    if (e.exame !== null) {
      const av = avaliarCoberturaExame(
        await this.porta.cobertura(ctxExame(s), e.agenda),
        e.exame,
        e.convenio,
      );
      if (!av.ok)
        throw new ErroProblema('recusa-de-negocio', 409, 'Exame não coberto', av.texto, {
          codigo: av.codigo,
        });
    }
    return this.apoio.executar(s, 'agenda.agendarExame', e, 'Exame marcado.');
  }

  @Post('marcacoes/sem-prontuario')
  @HttpCode(201)
  @Permissao('agenda.exame.agendar')
  @AuditadoNoHandler('agenda.agendarExameSemProntuario pelo executor (desligada até a prova, POL-3)')
  async marcarSemProntuario(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAgendarExameSemProntuario, b);
    await this.servico.exigirAgendaDaEntrada(ctxExame(s), e.agenda);
    return this.apoio.executar(s, 'agenda.agendarExameSemProntuario', e, 'Exame marcado sem prontuário.');
  }

  @Get('marcacoes')
  @Permissao('agenda.exame.ler')
  async marcacoes(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaMarcacoesExame> {
    const c = ctxExame(sessaoDe(req));
    const data = dataDaConsulta(q['data']) ?? (await this.porta.relogio(c)).hoje;
    return this.servico.marcacoesDoDia(c, data, inteiroOuNulo(q['agenda']));
  }

  @Get('marcacoes/:id')
  @Permissao('agenda.exame.ler')
  @Auditar('agenda.exame.lido')
  async detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<MarcacaoExameDetalhe> {
    const m = await this.servico.detalheMarcacao(ctxExame(sessaoDe(req)), idDaRota(id));
    req.sghAlvo = { tabelaAlvo: 'marcacao_horario', idAlvo: String(m.id) };
    return m;
  }

  @Post('marcacoes/:id/cancelar')
  @HttpCode(200)
  @Permissao('agenda.exame.cancelar')
  @AuditadoNoHandler('agenda.cancelarExame pelo executor (trilha na mesma transação)')
  async cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarExame, { ...(b as object), marcacao: idDaRota(id) });
    await this.servico.detalheMarcacao(ctxExame(s), e.marcacao);
    return this.apoio.executar(
      s,
      'agenda.cancelarExame',
      e,
      'Exame cancelado: o horário voltou a ficar vago.',
    );
  }

  @Post('marcacoes/:id/remarcar')
  @HttpCode(200)
  @Permissao('agenda.exame.remarcar')
  @AuditadoNoHandler('agenda.remarcarExame pelo executor (trilha na mesma transação)')
  async remarcar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRemarcarExame, { ...(b as object), marcacao: idDaRota(id) });
    await this.servico.detalheMarcacao(ctxExame(s), e.marcacao);
    await this.servico.exigirAgendaDaEntrada(ctxExame(s), e.destino.agenda);
    return this.apoio.executar(s, 'agenda.remarcarExame', e, 'Exame remarcado.');
  }

  @Get('pacientes/:id/marcacoes')
  @Permissao('agenda.exame.ler')
  @Auditar('agenda.exame.lido')
  async doPaciente(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ListaMarcacoesExame> {
    const pac = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'paciente', idAlvo: String(pac) };
    return this.servico.marcacoesDoPaciente(ctxExame(sessaoDe(req)), pac);
  }

  @Get('cancelamentos')
  @Permissao('agenda.exame.ler')
  async cancelamentos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaCancelamentosExame> {
    const s = sessaoDe(req);
    await exigir(s, 'agenda.exame.ler', this.trilha);
    const c = ctxExame(s);
    const r = await this.porta.relogio(c);
    const j = exigirJanela(dataDaConsulta(q['de']) ?? r.hoje, dataDaConsulta(q['ate']) ?? r.hoje, 31);
    return this.servico.cancelamentos(c, {
      ...j,
      agenda: inteiroOuNulo(q['agenda']),
      pagina: pagina(q['pagina']),
      porPagina: 50,
    });
  }

  @Get('residuo')
  @Permissao('agenda.agendaExame.editar')
  async residuo(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResiduoExameResposta> {
    const c = ctxExame(sessaoDe(req));
    const r = await this.porta.relogio(c);
    // Sem período: os 30 dias passados e os 60 seguintes (92 dias no total, o teto da consulta).
    const de = dataDaConsulta(q['de']) ?? somarDias(r.hoje, -30);
    return this.servico.residuo(c, de, dataDaConsulta(q['ate']) ?? somarDias(de, 91));
  }
}

function pedidoDaPrevia(p: PedidoGrade) {
  return {
    agenda: p.agenda,
    de: p.de,
    ate: p.ate,
    duracaoMinutos: p.duracaoMinutos ?? null,
    faixas:
      p.faixas?.map((f) => ({
        semana: f.semana,
        inicio: f.inicio,
        fim: f.fim,
        intervaloInicio: f.intervaloInicio ?? null,
        intervaloFim: f.intervaloFim ?? null,
      })) ?? null,
    incluirFeriados: p.incluirFeriados,
  };
}
