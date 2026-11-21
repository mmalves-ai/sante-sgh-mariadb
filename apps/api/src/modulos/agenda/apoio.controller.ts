// Bloqueios, lista de espera e indicadores da agenda de consultas (M17; ficha, seção 7):
//   GET  /api/agenda/consultas/bloqueios?agenda&ativos           bloqueios (com os horários que bloquearam)
//   POST /api/agenda/consultas/bloqueios/previa                  horários vagos e marcados do período (nada é gravado)
//   POST /api/agenda/consultas/bloqueios                         agenda.bloquearHorarios nos vagos (ou só o período)
//   POST /api/agenda/consultas/bloqueios/:agenda/:id/encerrar    agenda.bloquearHorarios (desbloquear) nos que restam
//   GET  /api/agenda/consultas/espera?situacao&agenda&especialidade   fila de espera (prioridade e antiguidade)
//   POST /api/agenda/consultas/espera                            inclui na fila (lista_espera)
//   POST /api/agenda/consultas/espera/:id/ofertar                oferta uma vaga (lista_espera; nada vai ao paciente aqui)
//   POST /api/agenda/consultas/espera/:id/marcar                 agenda.agendarConsulta e a fila atendida
//   POST /api/agenda/consultas/espera/:id/encerrar               cancela ou devolve à fila (lista_espera)
//   GET  /api/agenda/consultas/indicadores?de&ate                funil, ocupação, absenteísmo e canais (agregados)
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type Bloqueio,
  esquemaPedidoBloqueio,
  esquemaPedidoEncerrarEspera,
  esquemaPedidoEspera,
  esquemaPedidoMarcarEspera,
  esquemaPedidoOfertaEspera,
  esquemaPedidoPeriodoBloqueio,
  EVENTOS_AUDITAVEIS,
  type IndicadoresAgenda,
  type ItemEspera,
  type ListaEspera,
  MOTIVOS_BLOQUEIO,
  ordemDaFila,
  type PreviaBloqueio,
  PRIORIDADES_ESPERA,
  type ResultadoAgenda,
  SITUACOES_ESPERA,
  TETO_HORARIOS_POR_GRAVACAO,
} from '@sgh/contratos';
import { nomeMascarado, podeBloquear, podeDesbloquear, somarDias } from '@sgh/dominio-agenda';
import type { BloqueioAgenda } from './tipos.js';
import { type AgendaVista, horaIso, horaIsoOuNull, LeituraAgenda } from './visao.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
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
import { corpo, dataDaConsulta } from './agendas.controller.js';
import { ApoioAgenda, ctxAgenda } from './apoio.js';
import { PORTA_AGENDA, type PortaAgenda } from './porta.js';
import { ServicoAgenda } from './servico.js';

/** Tabela real da lista de espera (script 0185), também na linha da trilha. */
const TABELA_ESPERA = 'lista_espera';
const rotuloBloqueio = (c: string) => MOTIVOS_BLOQUEIO.find((m) => m.codigo === c)?.rotulo ?? c;

export function bloqueioResposta(b: BloqueioAgenda): Bloqueio {
  return {
    id: b.id,
    agenda: b.agenda,
    nomeAgenda: b.nomeAgenda,
    inicio: b.inicio,
    fim: b.fim,
    horaInicio: b.horaInicio,
    horaFim: b.horaFim,
    motivo: b.motivo,
    rotuloMotivo: rotuloBloqueio(b.motivo),
    complemento: b.complemento,
    previsaoRetorno: b.previsaoRetorno,
    horarios: b.horarios,
    autor: b.autor,
    em: b.criadoEm,
    ativo: b.ativo,
  };
}

const dentroDasHoras = (hora: string, ini: string | null | undefined, fim: string | null | undefined) =>
  !ini || !fim || (hora >= ini && hora < fim);

@Controller('agenda/consultas')
export class ApoioAgendaController {
  private readonly apoio: ApoioAgenda;
  private readonly servico: ServicoAgenda;
  private readonly leitura: LeituraAgenda;
  constructor(
    @Inject(PORTA_AGENDA) private readonly porta: PortaAgenda,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioAgenda(porta, trilha, configuracao, cache);
    this.servico = new ServicoAgenda(porta);
    this.leitura = new LeituraAgenda(porta);
  }

  // ── Bloqueios ────────────────────────────────────────────────────────────────────────────────────

  @Get('bloqueios')
  @Permissao('agenda.bloqueio.ler')
  async bloqueios(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: Bloqueio[] }> {
    const s = sessaoDe(req);
    const c = ctxAgenda(s);
    const agenda = q['agenda'] ? idDaRota(q['agenda']) : null;
    if (agenda !== null) await this.servico.exigirAgenda(c, agenda);
    const [l, ids] = await Promise.all([
      this.porta.bloqueios(c, { agenda, ativos: q['ativos'] !== 'nao' }),
      this.servico.agendasDoEscopo(c),
    ]);
    return { itens: l.filter((b) => !ids || ids.has(b.agenda)).map(bloqueioResposta) };
  }

  /** Horários do período: os vagos (que o bloqueio fecha) e os marcados (que ele não toca: remarcar antes). */
  private async horariosDoPeriodo(
    s: SessaoCadastro,
    a: AgendaVista,
    p: {
      inicio: string;
      fim: string;
      horaInicio?: string | null | undefined;
      horaFim?: string | null | undefined;
    },
  ) {
    const r = await this.leitura.relogio(ctxAgenda(s));
    const de = p.inicio < r.hoje ? r.hoje : p.inicio;
    if (p.fim < de) return { livres: [], marcados: [], jaBloqueados: 0, relogio: r };
    const [h, m] = await Promise.all([
      this.leitura.horarios(ctxAgenda(s), a.id, de, p.fim),
      this.leitura.marcacoesDaJanela(ctxAgenda(s), a.id, de, p.fim),
    ]);
    const hi = p.horaInicio ? horaIso(p.horaInicio) : null;
    const hf = p.horaFim ? horaIso(p.horaFim) : null;
    const noRecorte = h.itens.filter(
      (x) => dentroDasHoras(x.hora, hi, hf) && (x.data > r.hoje || x.hora > r.hhmm),
    );
    const livres = noRecorte.filter((x) => podeBloquear(x)).map((x) => ({ data: x.data, hora: x.hora }));
    const jaBloqueados = noRecorte.filter((x) => podeDesbloquear(x)).length;
    const marcados = m.itens.filter((x) => dentroDasHoras(x.hora, hi, hf) && x.atendido.trim() !== 'S');
    return { livres, marcados, jaBloqueados, relogio: r };
  }

  @Post('bloqueios/previa')
  @AuditadoNoHandler('prévia: só leitura, nada é gravado (POST pelo tamanho do pedido)')
  @HttpCode(200)
  @Permissao('agenda.bloqueio.ler')
  async previaBloqueio(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaBloqueio> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoPeriodoBloqueio, b);
    const a = await this.servico.exigirAgenda(ctxAgenda(s), p.agenda);
    const x = await this.horariosDoPeriodo(s, a, p);
    const ext = await this.porta.complementos(
      ctxAgenda(s),
      x.marcados.map((m) => m.id),
    );
    return {
      horariosLivres: x.livres.map((h) => ({ data: h.data, hora: h.hora })),
      marcados: x.marcados.map((m) => this.servico.resumoMarcacao(m, ext.get(m.id), x.relogio, true)),
      jaBloqueados: x.jaBloqueados,
    };
  }

  @Post('bloqueios')
  @HttpCode(201)
  @Permissao('agenda.bloqueio.criar')
  @AuditadoNoHandler(
    'agenda.bloquearHorarios pelo executor; o período sem horários, em bloqueio_agenda com a trilha',
  )
  async bloquear(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoBloqueio, b);
    const a = await this.servico.exigirAgenda(ctxAgenda(s), p.agenda);
    const x = await this.horariosDoPeriodo(s, a, p);
    if (x.livres.length > TETO_HORARIOS_POR_GRAVACAO)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período grande demais',
        `O período tem ${x.livres.length} horários vagos; bloqueie no máximo ${TETO_HORARIOS_POR_GRAVACAO} de cada vez.`,
      );
    if (x.livres.length > 0)
      return this.apoio.executar(
        s,
        'agenda.bloquearHorarios',
        {
          agenda: a.id,
          acao: 'bloquear',
          horarios: x.livres,
          motivo: p.motivo,
          complemento: p.complemento ?? undefined,
          previsaoRetorno: p.previsaoRetorno ?? null,
        },
        `${x.livres.length} horário(s) bloqueado(s).`,
      );
    // Sem horários gerados no período: o bloqueio vale para a geração da grade (que pula o período).
    const id = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaHorariosBloqueados.codigo,
      'agenda.bloqueio',
      (x: number) => ({ tabela: 'bloqueio_agenda', id: String(x) }),
      (g) =>
        g.gravarBloqueioPeriodo({
          agenda: a.id,
          inicio: p.inicio,
          fim: p.fim,
          horaInicio: horaIsoOuNull(p.horaInicio),
          horaFim: horaIsoOuNull(p.horaFim),
          motivo: p.motivo,
          complemento: p.complemento ?? null,
          previsaoRetorno: p.previsaoRetorno ?? null,
        }),
    );
    return {
      ok: true,
      resultado: { bloqueio: id, horarios: 0 },
      repetida: false,
      mensagem: 'Período bloqueado: a geração da grade não abrirá horários nele.',
    };
  }

  @Post('bloqueios/:agenda/:id/encerrar')
  @HttpCode(200)
  @Permissao('agenda.bloqueio.criar')
  @AuditadoNoHandler(
    'agenda.bloquearHorarios (desbloquear) pelo executor; o período sem horários, em bloqueio_agenda',
  )
  async encerrar(
    @Param('agenda') agendaRota: string,
    @Param('id') idRota: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const a = await this.servico.exigirAgenda(ctxAgenda(s), idDaRota(agendaRota));
    const id = idDaRota(idRota);
    const b = (await this.porta.bloqueios(ctxAgenda(s), { agenda: a.id, ativos: true })).find(
      (x) => x.id === id,
    );
    if (!b) throw new ErroProblema('nao-encontrado', 404, 'Bloqueio não encontrado ou já encerrado');
    const lista = await this.porta.horariosDoBloqueio(ctxAgenda(s), id);
    const r = await this.leitura.relogio(ctxAgenda(s));
    const restantes: { data: string; hora: string }[] = [];
    if (lista.length > 0) {
      const datas = lista.map((h) => h.data).sort();
      const de = (datas[0] as string) < r.hoje ? r.hoje : (datas[0] as string);
      const atual =
        de <= (datas.at(-1) as string)
          ? await this.leitura.horarios(ctxAgenda(s), a.id, de, datas.at(-1) as string)
          : { itens: [] };
      const chaves = new Set(lista.map((h) => `${h.data} ${horaIso(h.hora)}`));
      for (const h of atual.itens)
        if (chaves.has(`${h.data} ${h.hora}`) && podeDesbloquear(h))
          restantes.push({ data: h.data, hora: h.hora });
    }
    if (restantes.length > 0)
      return this.apoio.executar(
        s,
        'agenda.bloquearHorarios',
        {
          agenda: a.id,
          acao: 'desbloquear',
          horarios: restantes.slice(0, TETO_HORARIOS_POR_GRAVACAO),
          motivo: b.motivo,
        },
        `${Math.min(restantes.length, TETO_HORARIOS_POR_GRAVACAO)} horário(s) desbloqueado(s).`,
      );
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaHorariosBloqueados.codigo,
      'agenda.bloqueio',
      { tabela: 'bloqueio_agenda', id: String(id) },
      (g) => g.encerrarBloqueio({ agenda: a.id, id }),
    );
    return {
      ok: true,
      resultado: { bloqueio: id, horarios: 0 },
      repetida: false,
      mensagem: 'Bloqueio encerrado.',
    };
  }

  // ── Lista de espera ──────────────────────────────────────────────────────────────────────────────

  @Get('espera')
  @Permissao('agenda.espera.ler')
  @Auditar('agenda.marcacao.lida')
  async espera(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaEspera> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: TABELA_ESPERA, idAlvo: 'lista' };
    const situacoes = (q['situacao'] ?? 'aguardando,ofertado')
      .split(',')
      .filter((x): x is (typeof SITUACOES_ESPERA)[number] =>
        (SITUACOES_ESPERA as readonly string[]).includes(x),
      );
    const filtroAgenda = q['agenda'] ? idDaRota(q['agenda']) : null;
    if (filtroAgenda !== null) await this.servico.exigirAgenda(ctxAgenda(s), filtroAgenda);
    const [l0, agendas, opcoes, ids] = await Promise.all([
      this.porta.espera(ctxAgenda(s), {
        situacoes: situacoes.length ? situacoes : ['aguardando'],
        agenda: filtroAgenda,
        especialidade:
          q['especialidade'] !== undefined && q['especialidade'] !== '' ? Number(q['especialidade']) : null,
      }),
      this.leitura.agendas(ctxAgenda(s)),
      this.porta.opcoes(ctxAgenda(s)),
      this.servico.agendasDoEscopo(ctxAgenda(s)),
    ]);
    // Escopo restrito: só os pedidos de agendas do escopo (pedido sem agenda fica fora: falha fechada).
    const l = ids ? l0.filter((e) => e.agenda !== null && ids.has(e.agenda)) : l0;
    const pacientes = new Map(
      (await this.porta.pacientes(ctxAgenda(s), [...new Set(l.map((e) => e.paciente))])).map((p) => [
        p.id,
        p,
      ]),
    );
    const nomeAgenda = new Map(agendas.map((a) => [a.id, a.nome]));
    const esp = new Map(opcoes.especialidades.map((e) => [e.codigo, e]));
    const prio = (p: string) =>
      (PRIORIDADES_ESPERA as readonly string[]).includes(p) ? (p as ItemEspera['prioridade']) : 'normal';
    const sit = (p: string) =>
      (SITUACOES_ESPERA as readonly string[]).includes(p) ? (p as ItemEspera['situacao']) : 'aguardando';
    const itens: ItemEspera[] = l.map((e) => ({
      id: e.id,
      // Lista: nome mascarado, como nas outras listas da agenda (o completo fica na ação sobre o pedido).
      paciente: pacientes.get(e.paciente)
        ? nomeMascarado(pacientes.get(e.paciente)?.nome ?? '')
        : `Prontuário ${e.prontuario ?? '-'}`,
      idPaciente: e.paciente,
      agenda: e.agenda,
      nomeAgenda: e.agenda ? (nomeAgenda.get(e.agenda) ?? null) : null,
      especialidade:
        e.especialidade !== null
          ? (esp.get(e.especialidade) ?? { codigo: e.especialidade, nome: String(e.especialidade) })
          : null,
      prioridade: prio(e.prioridade),
      situacao: sit(e.situacao),
      desde: e.desde,
      observacao: e.observacao,
      oferta: e.oferta
        ? { agenda: e.oferta.agenda, data: e.oferta.data, hora: horaIso(e.oferta.hora) }
        : null,
      posicao: null,
    }));
    const fila = ordemDaFila(itens);
    const pos = new Map(fila.map((x, i) => [x.id, i + 1]));
    const ordenados = [...fila, ...itens.filter((x) => !pos.has(x.id))].map((x) => ({
      ...x,
      posicao: pos.get(x.id) ?? null,
    }));
    return { itens: ordenados, total: ordenados.length };
  }

  private async itemEspera(s: SessaoCadastro, id: number) {
    const l = await this.porta.espera(ctxAgenda(s), { situacoes: SITUACOES_ESPERA });
    const e = l.find((x) => x.id === id);
    if (!e) throw new ErroProblema('nao-encontrado', 404, 'Pedido da fila não encontrado');
    await this.servico.exigirAgendaDoEscopo(ctxAgenda(s), e.agenda);
    return e;
  }

  @Post('espera')
  @HttpCode(201)
  @Permissao('agenda.espera.editar')
  @AuditadoNoHandler('lista_espera com a trilha na mesma transação')
  async incluirEspera(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoEspera, b);
    const [pac] = await this.porta.pacientes(ctxAgenda(s), [p.paciente]);
    if (!pac) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    if (p.agenda) await this.servico.exigirAgenda(ctxAgenda(s), p.agenda);
    else await this.servico.exigirAgendaDoEscopo(ctxAgenda(s), null);
    const ja = await this.porta.espera(ctxAgenda(s), { situacoes: ['aguardando', 'ofertado'] });
    if (
      ja.some(
        (x) =>
          x.paciente === p.paciente &&
          x.agenda === (p.agenda ?? null) &&
          x.especialidade === (p.especialidade ?? null),
      )
    )
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Já está na fila',
        'O paciente já aguarda nesta agenda ou especialidade.',
        {
          codigo: 'ja-na-fila',
        },
      );
    const id = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaEsperaAlterada.codigo,
      'agenda.espera',
      (id: number) => ({ tabela: TABELA_ESPERA, id: String(id), paciente: p.paciente }),
      (g) =>
        g.incluirEspera({
          paciente: p.paciente,
          agenda: p.agenda ?? null,
          especialidade: p.especialidade ?? null,
          prioridade: p.prioridade,
          observacao: p.observacao ?? null,
        }),
    );
    return { ok: true, resultado: { espera: id }, repetida: false, mensagem: 'Incluído na fila de espera.' };
  }

  @Post('espera/:id/ofertar')
  @HttpCode(200)
  @Permissao('agenda.espera.editar')
  @AuditadoNoHandler('lista_espera com a trilha na mesma transação')
  async ofertar(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const id = idDaRota(idRota);
    const p = corpo(esquemaPedidoOfertaEspera, b);
    const e = await this.itemEspera(s, id);
    if (e.situacao !== 'aguardando')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Pedido não está aguardando',
        'Só um pedido aguardando recebe oferta.',
        {
          codigo: 'situacao-mudou',
        },
      );
    await this.servico.exigirAgenda(ctxAgenda(s), p.agenda);
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaEsperaAlterada.codigo,
      'agenda.espera',
      { tabela: TABELA_ESPERA, id: String(id), paciente: e.paciente },
      (g) => g.ofertarEspera({ id, agenda: p.agenda, data: p.data, hora: horaIso(p.hora) }),
    );
    return {
      ok: true,
      resultado: { espera: id },
      repetida: false,
      mensagem: 'Vaga ofertada; registre a resposta do paciente.',
    };
  }

  @Post('espera/:id/marcar')
  @HttpCode(201)
  @Permissao('agenda.marcacao.agendar')
  @AuditadoNoHandler('agenda.agendarConsulta pelo executor; a fila atendida em lista_espera com a trilha')
  async marcarEspera(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const id = idDaRota(idRota);
    const p = corpo(esquemaPedidoMarcarEspera, b);
    const e = await this.itemEspera(s, id);
    if (e.situacao !== 'aguardando' && e.situacao !== 'ofertado')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Pedido já encerrado',
        'O pedido da fila já foi atendido ou cancelado.',
        {
          codigo: 'situacao-mudou',
        },
      );
    const r = await this.apoio.executar(
      s,
      'agenda.agendarConsulta',
      {
        agenda: p.agenda,
        data: p.data,
        hora: p.hora,
        paciente: e.paciente,
        convenio: p.convenio,
        retorno: false,
        canal: p.canal,
        ...(e.observacao ? { observacao: e.observacao.slice(0, 200) } : {}),
      },
      'Consulta marcada a partir da fila de espera.',
    );
    const marcacao = Number(r.resultado['marcacao'] ?? 0) || null;
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaEsperaAlterada.codigo,
      'agenda.espera',
      { tabela: TABELA_ESPERA, id: String(id), paciente: e.paciente },
      (g) => g.encerrarEspera({ id, situacao: 'atendido', marcacao }),
    );
    return r;
  }

  @Post('espera/:id/encerrar')
  @HttpCode(200)
  @Permissao('agenda.espera.editar')
  @AuditadoNoHandler('lista_espera com a trilha na mesma transação')
  async encerrarEspera(
    @Param('id') idRota: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const id = idDaRota(idRota);
    const p = corpo(esquemaPedidoEncerrarEspera, b);
    const e = await this.itemEspera(s, id);
    if (e.situacao === 'atendido' || e.situacao === 'cancelado')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Pedido já encerrado',
        'O pedido da fila já foi atendido ou cancelado.',
        {
          codigo: 'situacao-mudou',
        },
      );
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaEsperaAlterada.codigo,
      'agenda.espera',
      { tabela: TABELA_ESPERA, id: String(id), paciente: e.paciente },
      (g) => g.encerrarEspera({ id, situacao: p.situacao, marcacao: null }),
    );
    return {
      ok: true,
      resultado: { espera: id },
      repetida: false,
      mensagem: p.situacao === 'cancelado' ? 'Pedido retirado da fila.' : 'Pedido devolvido à fila.',
    };
  }

  // ── Indicadores ──────────────────────────────────────────────────────────────────────────────────

  @Get('indicadores')
  @Permissao('agenda.indicador.ler')
  async indicadores(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadoresAgenda> {
    const s = sessaoDe(req);
    const r = await this.leitura.relogio(ctxAgenda(s));
    const fim = dataDaConsulta(ate) ?? r.hoje;
    const ini = dataDaConsulta(de) ?? somarDias(fim, -29);
    if (ini > fim)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O início vem depois do fim.');
    return this.servico.indicadores(ctxAgenda(s), ini, fim);
  }
}
