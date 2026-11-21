// Marcação, encaixe, remarcação, confirmação, falta, painel do dia e cancelamentos (M17; ficha, seção 7):
//   GET  /api/agenda/consultas/vagas?agenda&especialidade&profissional&convenio&turno&de&ate   busca de vaga (31 dias)
//   POST /api/agenda/consultas/marcacoes                         agenda.agendarConsulta
//   POST /api/agenda/consultas/encaixes                          agenda.encaixar (motivo; limite por turno)
//   GET  /api/agenda/consultas/encaixes/avaliacao?agenda&data&hora   vetos e alertas do encaixe (nada é gravado)
//   GET  /api/agenda/consultas/marcacoes/:id                     detalhe com o contato (auditado)
//   POST /api/agenda/consultas/marcacoes/:id/cancelar            agenda.cancelarConsulta (motivo padronizado)
//   POST /api/agenda/consultas/marcacoes/:id/desfazer-encaixe    agenda.desfazerEncaixe
//   POST /api/agenda/consultas/marcacoes/:id/remarcar            agenda.remarcarConsulta (transferir ou liberar)
//   POST /api/agenda/consultas/marcacoes/:id/confirmar           confirmado: agenda.confirmarConsulta; demais: tentativa
//   POST /api/agenda/consultas/marcacoes/:id/falta               agenda.registrarFalta
//   POST /api/agenda/consultas/remarcar-lote                     remarcação em lote (uma transação por item)
//   GET  /api/agenda/consultas/dia?data&agenda                   painel do dia (estados, risco, candidatos a falta)
//   GET  /api/agenda/consultas/pacientes/:id/marcacoes           marcações do paciente (auditado)
//   GET  /api/agenda/consultas/cancelamentos?de&ate&agenda&pagina   cancelados (31 dias por consulta)
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type BuscaVagas,
  esquemaAgendarConsulta,
  esquemaCancelarConsulta,
  esquemaDesfazerEncaixe,
  esquemaEncaixar,
  esquemaPedidoConfirmacao,
  esquemaPedidoRemarcarLote,
  esquemaRemarcarConsulta,
  EVENTOS_AUDITAVEIS,
  type ListaCancelamentos,
  type MarcacaoDetalhe,
  type MarcacoesPaciente,
  motivoCancelamento,
  type PainelDia,
  RESULTADOS_CONFIRMACAO,
  type ResultadoAgenda,
  type ResultadoLote,
} from '@sgh/contratos';
import { avaliarEncaixe, nomeMascarado, normalizarHora } from '@sgh/dominio-agenda';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { definicaoParametro } from '@sgh/contratos';
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
import { corpo, dataDaConsulta } from './agendas.controller.js';
import { ApoioAgenda, ctxAgenda } from './apoio.js';
import { PORTA_AGENDA, type PortaAgenda } from './porta.js';
import { ServicoAgenda } from './servico.js';
import { LeituraAgenda } from './visao.js';

const POR_PAGINA = 50;
const inteiroOuNulo = (v: string | undefined) => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 2_147_483_647 ? n : null;
};

@Controller('agenda/consultas')
export class MarcacoesController {
  private readonly apoio: ApoioAgenda;
  private readonly servico: ServicoAgenda;
  private readonly leitura: LeituraAgenda;
  constructor(
    @Inject(PORTA_AGENDA) private readonly porta: PortaAgenda,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioAgenda(porta, trilha, configuracao, cache);
    this.servico = new ServicoAgenda(porta);
    this.leitura = new LeituraAgenda(porta);
  }

  /** Parâmetro do novo resolvido para a sessão (unidade, estabelecimento, rede). */
  private async parametro(s: SessaoCadastro, chave: string): Promise<number> {
    const def = definicaoParametro(chave);
    if (!def) return 0;
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>>;
    try {
      valores = this.configuracao ? await this.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const v = valorTipado(
      def,
      resolverParametro(
        def,
        valores,
        {
          rede: s.rede,
          empresa: null,
          estabelecimento: s.hospital,
          unidade: setor === null || setor === undefined ? null : String(setor),
          perfis: [],
          usuario: s.login,
        },
        new Date(),
      ).valor,
    );
    return typeof v === 'number' ? v : Number(v ?? 0) || 0;
  }

  @Get('vagas')
  @Permissao('agenda.marcacao.ler')
  vagas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<BuscaVagas> {
    const turno = ['manha', 'tarde', 'noite'].includes(q['turno'] ?? '') ? (q['turno'] as string) : null;
    return this.servico.buscarVagas(ctxAgenda(sessaoDe(req)), {
      agenda: inteiroOuNulo(q['agenda']),
      especialidade: inteiroOuNulo(q['especialidade']),
      profissional: (q['profissional'] ?? '').slice(0, 60) || null,
      convenio: inteiroOuNulo(q['convenio']),
      turno,
      de: dataDaConsulta(q['de']),
      ate: dataDaConsulta(q['ate']),
      unidade: inteiroOuNulo(q['unidade']),
      local: inteiroOuNulo(q['local']),
    });
  }

  @Post('marcacoes')
  @HttpCode(201)
  @Permissao('agenda.marcacao.agendar')
  @AuditadoNoHandler('agenda.agendarConsulta pelo executor (trilha na mesma transação)')
  async marcar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAgendarConsulta, b);
    // M50, etapa 4: a teleconsulta nasce só da marcação pelo portal (termo, chave da telemedicina, conta do paciente).
    if (e.teleconsulta)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Teleconsulta pelo portal',
        'A teleconsulta é marcada pelo paciente no portal.',
        { codigo: 'teleconsulta-pelo-portal' },
      );
    await this.exigirAntecedencia(s, e.data, e.hora);
    return this.apoio.executar(s, 'agenda.agendarConsulta', e, 'Consulta marcada.');
  }

  private async exigirAntecedencia(s: SessaoCadastro, data: string, hora: string): Promise<void> {
    const ant = await this.parametro(s, 'agenda.antecedenciaMinimaMinutos');
    if (ant <= 0) return;
    const r = await this.leitura.relogio(ctxAgenda(s));
    const agora = Date.parse(`${r.hoje}T${normalizarHora(r.hhmm)}:00Z`);
    const alvo = Date.parse(`${data}T${normalizarHora(hora)}:00Z`);
    if (alvo - agora < ant * 60_000)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Antecedência mínima',
        `A marcação exige ${ant} minuto(s) de antecedência (parâmetro do estabelecimento).`,
        { codigo: 'antecedencia-minima' },
      );
  }

  @Get('encaixes/avaliacao')
  @Permissao('agenda.marcacao.ler')
  async avaliarEncaixe(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agenda = idDaRota(q['agenda'] ?? '');
    const data = dataDaConsulta(q['data']);
    if (!data) throw new ErroProblema('entrada-invalida', 400, 'Data obrigatória');
    let hora: string;
    try {
      hora = normalizarHora(q['hora'] ?? '');
    } catch {
      throw new ErroProblema('entrada-invalida', 400, 'Hora inválida', 'Use HH:MM.');
    }
    const a = await this.servico.exigirAgenda(ctxAgenda(s), agenda);
    const [r, h, marcadas, limite] = await Promise.all([
      this.leitura.relogio(ctxAgenda(s)),
      this.leitura.horarios(ctxAgenda(s), a.id, data, data),
      this.leitura.horasMarcadas(ctxAgenda(s), a.id, data),
      this.parametro(s, 'agenda.encaixesPorTurno'),
    ]);
    return avaliarEncaixe(
      { data, hora },
      {
        relogio: r,
        agendaAtiva: a.ativa,
        gradeDoDia: h.itens.map((x) => ({ ...x })),
        marcadasNoDia: marcadas,
        duracaoAgendaMin: a.duracaoMinutos,
        pacienteTemProntuario: true,
        prontuarioAmbiguo: false,
        limitePorTurno: limite > 0 ? limite : null,
      },
    );
  }

  @Post('encaixes')
  @HttpCode(201)
  @Permissao('agenda.encaixe.criar')
  @AuditadoNoHandler('agenda.encaixar pelo executor (trilha na mesma transação)')
  async encaixar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncaixar, b);
    const limite = await this.parametro(s, 'agenda.encaixesPorTurno');
    if (limite > 0) {
      const av = await this.avaliarEncaixe({ agenda: String(e.agenda), data: e.data, hora: e.hora }, req);
      const veto = av.vetos.find((v) => v.codigo === 'limite-do-turno');
      if (veto)
        throw new ErroProblema('recusa-de-negocio', 409, 'Encaixe recusado', veto.texto, {
          codigo: veto.codigo,
        });
    }
    return this.apoio.executar(s, 'agenda.encaixar', e, 'Encaixe feito.');
  }

  @Get('marcacoes/:id')
  @Permissao('agenda.marcacao.ler')
  @Auditar('agenda.marcacao.lida')
  async detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<MarcacaoDetalhe> {
    const m = await this.servico.detalheMarcacao(ctxAgenda(sessaoDe(req)), idDaRota(id));
    req.sghAlvo = { tabelaAlvo: 'marcacao_horario', idAlvo: String(m.id) };
    return m;
  }

  @Post('marcacoes/:id/cancelar')
  @HttpCode(200)
  @Permissao('agenda.marcacao.cancelar')
  @AuditadoNoHandler('agenda.cancelarConsulta pelo executor (trilha na mesma transação)')
  cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const e = corpo(esquemaCancelarConsulta, { ...(b as object), marcacao: idDaRota(id) });
    return this.apoio.executar(sessaoDe(req), 'agenda.cancelarConsulta', e, 'Consulta cancelada.');
  }

  @Post('marcacoes/:id/desfazer-encaixe')
  @HttpCode(200)
  @Permissao('agenda.encaixe.criar')
  @AuditadoNoHandler('agenda.desfazerEncaixe pelo executor (trilha na mesma transação)')
  desfazer(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const e = corpo(esquemaDesfazerEncaixe, { ...((b as object) ?? {}), marcacao: idDaRota(id) });
    return this.apoio.executar(sessaoDe(req), 'agenda.desfazerEncaixe', e, 'Encaixe desfeito.');
  }

  @Post('marcacoes/:id/remarcar')
  @HttpCode(200)
  @Permissao('agenda.marcacao.remarcar')
  @AuditadoNoHandler('agenda.remarcarConsulta pelo executor (trilha na mesma transação)')
  async remarcar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRemarcarConsulta, { ...(b as object), marcacao: idDaRota(id) });
    await this.exigirAntecedencia(s, e.destino.data, e.destino.hora);
    return this.apoio.executar(s, 'agenda.remarcarConsulta', e, 'Consulta remarcada.');
  }

  @Post('marcacoes/:id/confirmar')
  @HttpCode(200)
  @Permissao('agenda.marcacao.confirmar')
  @AuditadoNoHandler('confirmado pelo executor; as demais tentativas com a trilha na mesma transação')
  async confirmar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const marcacao = idDaRota(id);
    const p = corpo(esquemaPedidoConfirmacao, b);
    if (p.resultado === 'confirmado')
      return this.apoio.executar(s, 'agenda.confirmarConsulta', { marcacao }, 'Consulta confirmada.');
    const m = await this.servico.exigirMarcacao(ctxAgenda(s), marcacao);
    const r = RESULTADOS_CONFIRMACAO.find((x) => x.codigo === p.resultado) ?? RESULTADOS_CONFIRMACAO[0];
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaConfirmacaoRegistrada.codigo,
      'agenda.consulta',
      { tabela: 'confirmacao_marcacao', id: String(marcacao), paciente: m.marcacao.idPaciente },
      (g) =>
        g.gravarConfirmacao({
          marcacao,
          resultado: r.codigo,
          canal: p.canal,
          observacao: p.observacao ?? null,
        }),
    );
    return {
      ok: true,
      resultado: { marcacao },
      repetida: false,
      mensagem: `Tentativa registrada: ${r.rotulo}.`,
    };
  }

  @Post('marcacoes/:id/falta')
  @HttpCode(200)
  @Permissao('agenda.falta.registrar')
  @AuditadoNoHandler('agenda.registrarFalta pelo executor (trilha na mesma transação)')
  falta(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    return this.apoio.executar(
      sessaoDe(req),
      'agenda.registrarFalta',
      { marcacao: idDaRota(id) },
      'Falta registrada.',
    );
  }

  @Post('remarcar-lote')
  @HttpCode(200)
  @Permissao('agenda.marcacao.remarcar')
  @AuditadoNoHandler('agenda.remarcarConsulta pelo executor, uma transação por item')
  async lote(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoLote> {
    const s = sessaoDe(req);
    await exigir(s, 'agenda.marcacao.remarcar', this.trilha);
    const p = corpo(esquemaPedidoRemarcarLote, b);
    await this.apoio.exigirLiberacao(s);
    const base = String(req.headers['idempotency-key'] ?? '');
    const itens: ResultadoLote['itens'] = [];
    for (const [i, x] of p.itens.entries()) {
      const r2 = Object.assign(
        Object.create(Object.getPrototypeOf(req) as object) as RequisicaoAutorizada,
        req,
        {
          headers: { ...req.headers, 'idempotency-key': `${base}.${i}`.slice(0, 80) },
        },
      );
      try {
        const r = await this.apoio.executar(
          sessaoDe(r2),
          'agenda.remarcarConsulta',
          { marcacao: x.marcacao, destino: x.destino, modo: p.modo, canal: p.canal, motivo: p.motivo },
          'Remarcada.',
        );
        itens.push({
          marcacao: x.marcacao,
          ok: true,
          mensagem: 'Remarcada.',
          nova: Number(r.resultado['marcacao']),
        });
      } catch (e) {
        const msg = e instanceof ErroProblema ? (e.detalhe ?? e.titulo) : 'Erro inesperado.';
        itens.push({ marcacao: x.marcacao, ok: false, mensagem: String(msg), nova: null });
      }
    }
    return { itens, feitos: itens.filter((x) => x.ok).length, recusados: itens.filter((x) => !x.ok).length };
  }

  @Get('dia')
  @Permissao('agenda.marcacao.ler')
  async dia(
    @Query('data') data: string | undefined,
    @Query('agenda') agenda: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelDia> {
    const s = sessaoDe(req);
    const r = await this.leitura.relogio(ctxAgenda(s));
    const tol = await this.parametro(s, 'agenda.toleranciaFaltaMinutos');
    return this.servico.painelDia(
      ctxAgenda(s),
      dataDaConsulta(data) ?? r.hoje,
      agenda ? idDaRota(agenda) : null,
      tol || 30,
    );
  }

  @Get('pacientes/:id/marcacoes')
  @Permissao('agenda.marcacao.ler')
  @Auditar('agenda.marcacao.lida')
  async doPaciente(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<MarcacoesPaciente> {
    const pac = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'paciente', idAlvo: String(pac) };
    return this.servico.marcacoesDoPaciente(ctxAgenda(sessaoDe(req)), pac);
  }

  @Get('cancelamentos')
  @Permissao('agenda.marcacao.ler')
  async cancelados(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaCancelamentos> {
    const s = sessaoDe(req);
    const r = await this.leitura.relogio(ctxAgenda(s));
    const jan = this.servico.janelaCancelamentos(dataDaConsulta(q['de']), dataDaConsulta(q['ate']), r.hoje);
    const pg = pagina(q['pagina']);
    const c = ctxAgenda(s);
    let agendas: number[] | null = null;
    if (q['agenda']) agendas = [(await this.servico.exigirAgenda(c, idDaRota(q['agenda']))).id];
    else {
      // Escopo restrito: só os cancelamentos das agendas do escopo.
      const ids = await this.servico.agendasDoEscopo(c);
      if (ids) agendas = [...ids];
    }
    const motivoFiltro = motivoCancelamento((q['motivo'] ?? '').trim().slice(0, 40));
    const l =
      agendas !== null && agendas.length === 0
        ? { itens: [], total: 0 }
        : await this.porta.cancelamentos(c, {
            de: jan.de,
            ate: jan.ate,
            agendas,
            motivo: motivoFiltro ? motivoFiltro.codigo : null,
            pagina: pg,
            porPagina: POR_PAGINA,
          });
    return {
      itens: l.itens.map((c) => ({
        protocolo: c.protocolo,
        agenda: c.nomeAgenda,
        data: c.data,
        hora: c.hora.length === 4 ? `${c.hora.slice(0, 2)}:${c.hora.slice(2)}` : c.hora,
        paciente: nomeMascarado(c.paciente),
        canceladoEm: `${c.canceladoEm} ${c.horaCancelamento.length === 4 ? `${c.horaCancelamento.slice(0, 2)}:${c.horaCancelamento.slice(2)}` : c.horaCancelamento}`,
        canceladoPor: c.canceladoPor,
        motivo: c.motivoCodigo ? (motivoCancelamento(c.motivoCodigo)?.texto ?? c.motivo) : c.motivo,
        motivoCodigo: c.motivoCodigo,
        solicitante: c.solicitante,
      })),
      total: l.total,
      pagina: pg,
      porPagina: POR_PAGINA,
      de: jan.de,
      ate: jan.ate,
      recortada: jan.recortada,
    };
  }
}
