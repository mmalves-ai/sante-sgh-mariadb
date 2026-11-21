// Centro cirúrgico (M18; ficha, seção 7):
//   GET  /api/cirurgia/opcoes                               salas, anestesias, caráter, convênios, profissionais, motivos
//   GET  /api/cirurgia/gravacao                             as funcionalidades e cada ação gravam agora? (motivo)
//   GET  /api/cirurgia/mapa?inicio&dias&sala                mapa das salas (até 7 dias), com sobreposição e solicitações
//   GET  /api/cirurgia/agendamentos/:id                     detalhe (nome completo; auditado)
//   POST /api/cirurgia/agendamentos                         cirurgia.agendarCirurgia (preparo mínimo do parâmetro)
//   POST /api/cirurgia/agendamentos/:id/mover               cirurgia.remarcarCirurgia (controle otimista)
//   POST /api/cirurgia/agendamentos/:id/cancelar            cirurgia.cancelarCirurgia (cancelar ou suspender)
//   POST /api/cirurgia/solicitacoes                         solicitação (não ocupa a sala)
//   GET  /api/cirurgia/estados/:id                          detalhe da solicitação ou do agendamento pelo registro do novo
//   POST /api/cirurgia/estados/:id/andamento                no bloco, em sala, retomar (banco)
//   POST /api/cirurgia/estados/:id/cancelar                 cancela ou suspende a solicitação (banco)
//   POST /api/cirurgia/estados/:id/pendencias               pendência pré-operatória (banco)
//   GET  /api/cirurgia/cancelamentos?de&ate                 agendamentos cancelados (31 dias)
//   GET  /api/cirurgia/historico?de&ate                     inclusões e remarcações da agenda (31 dias)
//   GET  /api/cirurgia/realizadas?de&ate&reg&sala           cirurgias realizadas com o casamento (31 dias; só atendimento: sem janela)
//   POST /api/cirurgia/realizadas                           cirurgia.registrarCirurgia
//   POST /api/cirurgia/realizadas/:id/ligacao               revisão da ligação com o agendamento (banco)
//   GET  /api/cirurgia/salas                                salas e usuários permitidos (contagem)
//   GET  /api/cirurgia/salas/:sala/usuarios                 usuários permitidos da sala
//   POST /api/cirurgia/salas/:sala/usuarios                 cirurgia.definirSalaUsuario
//   GET  /api/cirurgia/profissionais?q    GET /api/cirurgia/procedimentos?q   buscas (teto 30)
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type DetalheAgendamento,
  esquemaAgendarCirurgia,
  esquemaCancelarCirurgia,
  esquemaDefinirSalaUsuario,
  esquemaPedidoAndamento,
  esquemaPedidoLigacaoCirurgia,
  esquemaPedidoPendencia,
  esquemaPedidoSolicitarCirurgia,
  esquemaRegistrarCirurgia,
  esquemaRemarcarCirurgia,
  EVENTOS_AUDITAVEIS,
  type GravacaoAgenda,
  type ListaCancelamentosCirurgia,
  type ListaHistoricoCirurgia,
  type ListaRealizadas,
  type MapaCirurgico,
  type OpcoesCirurgia,
  type ResultadoAgenda,
  type SalaCirurgica,
  type UsuariosDaSala,
} from '@sgh/contratos';
import { somarDias } from '@sgh/dominio-agenda';
import {
  type EstadoAgendamento,
  estadoValido,
  instanteDaIncisao,
  podeIr,
  ROTULOS_ESTADO,
} from '@sgh/dominio-cirurgia';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo, dataDaConsulta, inteiroOuNulo } from '../exames/public-api.js';
import {
  type ContextoGravacaoCirurgia,
  type GravadorSghCirurgia,
  PORTA_CIRURGIA,
  type PortaCirurgia,
} from './porta.js';
import { salaResposta, ServicoCirurgia } from './servico.js';
import { TRAVA_INCISAO, type TravaIncisao } from './trava-incisao.js';

export const CHAVE_LIBERACAO_CIRURGIA = 'cirurgia.agenda';
export const CHAVE_LIBERACAO_REGISTRO = 'cirurgia.registro';
export const PARAMETRO_PREPARO = 'cirurgia.intervaloPreparoMinutos';

export const OPERACOES_AGENDA_CIRURGIA: Readonly<Record<string, string>> = {
  'cirurgia.agendarCirurgia': 'cirurgia.agenda.agendar',
  'cirurgia.remarcarCirurgia': 'cirurgia.agenda.remarcar',
  'cirurgia.cancelarCirurgia': 'cirurgia.agenda.cancelar',
  'cirurgia.definirSalaUsuario': 'cirurgia.sala.editar',
};
export const OPERACOES_REGISTRO_CIRURGIA: Readonly<Record<string, string>> = {
  'cirurgia.registrarCirurgia': 'cirurgia.registro.criar',
};
const ACOES_DIRETAS_AGENDA = {
  solicitar: 'cirurgia.agenda.solicitar',
  andamento: 'cirurgia.agenda.agendar',
  pendencia: 'cirurgia.pendencia.editar',
  excecao: 'cirurgia.agenda.excecao',
};
const ACOES_DIRETAS_REGISTRO = { ligacao: 'cirurgia.ligacao.revisar' };

/** Tabelas do modelo, também na linha da trilha (a porta própria grava a tabela que de fato escreveu). */
const TABELA_ESTADO = 'agendamento_cirurgico';
const TABELA_PENDENCIA = 'pendencia_agendamento_cirurgico';
const TABELA_LIGACAO = 'ato_cirurgico';
const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,100}$/;

/** A sessão com a chave de idempotência da requisição no contexto da porta: o reenvio da gravação direta não grava de novo. */
function comChave(s: SessaoCadastro): SessaoCadastro {
  const bruto = s.req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave)) return s;
  const porta: typeof s.porta & ContextoGravacaoCirurgia = { ...s.porta, chaveIdempotencia: chave };
  return { ...s, porta };
}

const janela31 = (de: string | null, ate: string | null, hoje: string) => {
  const d = de ?? hoje;
  const a = ate ?? d;
  if (a < d)
    throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O fim vem antes do início.');
  const lim = new Date(`${d}T00:00:00Z`);
  lim.setUTCDate(lim.getUTCDate() + 30);
  if (a > lim.toISOString().slice(0, 10))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Período longo',
      'Consulte até 31 dias por vez: divida o período.',
    );
  return { de: d, ate: a };
};

@Controller('cirurgia')
export class CirurgiaController {
  private readonly agenda: ApoioGravacao<GravadorSghCirurgia>;
  private readonly registro: ApoioGravacao<GravadorSghCirurgia>;
  private readonly servico: ServicoCirurgia;
  constructor(
    @Inject(PORTA_CIRURGIA) private readonly porta: PortaCirurgia,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    // M46 (etapa 2, regra 2): a trava da incisão pelo checklist (desligada, nada muda no registro).
    @Optional() @Inject(TRAVA_INCISAO) private readonly trava: TravaIncisao | null = null,
  ) {
    this.agenda = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_CIRURGIA, nome: 'a agenda cirúrgica', operacoes: OPERACOES_AGENDA_CIRURGIA },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.registro = new ApoioGravacao(
      {
        chave: CHAVE_LIBERACAO_REGISTRO,
        nome: 'o registro do ato cirúrgico',
        operacoes: OPERACOES_REGISTRO_CIRURGIA,
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.servico = new ServicoCirurgia(porta);
  }

  private preparo(s: SessaoCadastro): Promise<number> {
    return this.agenda.parametro(s, PARAMETRO_PREPARO);
  }

  @Get('opcoes')
  @Permissao('cirurgia.agenda.ler')
  async opcoes(@Req() req: RequisicaoAutorizada): Promise<OpcoesCirurgia> {
    const s = sessaoDe(req);
    return this.servico.opcoes(s.porta, s.login, await this.preparo(s));
  }

  @Get('gravacao')
  @Permissao('cirurgia.agenda.ler')
  async gravacao(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ agenda: GravacaoAgenda; registro: GravacaoAgenda }> {
    const s = sessaoDe(req);
    const [agenda, registro] = await Promise.all([
      this.agenda.gravacao(s, ACOES_DIRETAS_AGENDA),
      this.registro.gravacao(s, ACOES_DIRETAS_REGISTRO),
    ]);
    return { agenda, registro };
  }

  @Get('mapa')
  @Permissao('cirurgia.agenda.ler')
  async mapa(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<MapaCirurgico> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(s.porta);
    const dias = inteiroOuNulo(q['dias']) ?? 7;
    const sala = inteiroOuNulo(q['sala']);
    return this.servico.mapa(s.porta, s.login, {
      inicio: dataDaConsulta(q['inicio']) ?? r.hoje,
      dias: Math.min(Math.max(dias, 1), 7),
      salas: sala ? [sala] : null,
      preparoMinimoMin: await this.preparo(s),
    });
  }

  @Get('agendamentos/:id')
  @Permissao('cirurgia.agenda.ler')
  @Auditar('cirurgia.agenda.lida')
  async detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheAgendamento> {
    const s = sessaoDe(req);
    const d = await this.servico.detalhe(s.porta, idDaRota(id), await this.preparo(s));
    req.sghAlvo = { tabelaAlvo: 'agendamento_cirurgico', idAlvo: String(d.agendamento.id) };
    return d;
  }

  /** O servidor preenche o preparo mínimo (parâmetro) e exige a permissão de exceção quando pedida. */
  private async prepararAgenda<T extends { preparoMinimoMin: number; excecao: unknown; sala: number }>(
    s: SessaoCadastro,
    e: T,
  ): Promise<T> {
    if (e.excecao) await exigir(s, 'cirurgia.agenda.excecao', this.trilha);
    await this.servico.exigirSalaPermitida(s.porta, s.login, e.sala);
    return { ...e, preparoMinimoMin: await this.preparo(s) };
  }

  @Post('agendamentos')
  @HttpCode(201)
  @Permissao('cirurgia.agenda.agendar')
  @AuditadoNoHandler('cirurgia.agendarCirurgia pelo executor (trilha na mesma transação)')
  async agendar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = await this.prepararAgenda(s, corpo(esquemaAgendarCirurgia, b));
    if (e.solicitacao !== null) {
      const sol = await this.servico.exigirEstado(s.porta, e.solicitacao);
      if (sol.estado !== 'solicitado')
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Solicitação encerrada',
          'A solicitação já foi confirmada, cancelada ou suspensa.',
          {
            codigo: 'solicitacao-encerrada',
          },
        );
      // A solicitação é de outra sala: quem confirma também precisa estar entre os usuários dela.
      if (sol.sala !== e.sala) await this.servico.exigirSalaPermitida(s.porta, s.login, sol.sala);
    }
    return this.agenda.executar(s, 'cirurgia.agendarCirurgia', e, 'Cirurgia agendada na sala.');
  }

  @Post('agendamentos/:id/mover')
  @HttpCode(200)
  @Permissao('cirurgia.agenda.remarcar')
  @AuditadoNoHandler('cirurgia.remarcarCirurgia pelo executor (trilha na mesma transação)')
  async mover(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = await this.prepararAgenda(
      s,
      corpo(esquemaRemarcarCirurgia, { ...(b as object), agendamento: idDaRota(id) }),
    );
    const a = await this.servico.exigirAgendamento(s.porta, e.agendamento);
    if (a.sala !== e.sala) await this.servico.exigirSalaPermitida(s.porta, s.login, a.sala);
    return this.agenda.executar(s, 'cirurgia.remarcarCirurgia', e, 'Cirurgia movida.');
  }

  @Post('agendamentos/:id/cancelar')
  @HttpCode(200)
  @Permissao('cirurgia.agenda.cancelar')
  @AuditadoNoHandler('cirurgia.cancelarCirurgia pelo executor (trilha na mesma transação)')
  async cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarCirurgia, { ...(b as object), agendamento: idDaRota(id) });
    const a = await this.servico.exigirAgendamento(s.porta, e.agendamento);
    await this.servico.exigirSalaPermitida(s.porta, s.login, a.sala);
    return this.agenda.executar(
      s,
      'cirurgia.cancelarCirurgia',
      e,
      e.suspender ? 'Cirurgia suspensa: a sala foi liberada.' : 'Cirurgia cancelada: a sala foi liberada.',
    );
  }

  @Post('solicitacoes')
  @HttpCode(201)
  @Permissao('cirurgia.agenda.solicitar')
  @AuditadoNoHandler('solicitação (banco) com a trilha de auditoria na mesma transação')
  async solicitar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoSolicitarCirurgia, b);
    await this.servico.exigirSalaPermitida(s.porta, s.login, p.sala);
    const [pac] = await this.porta.pacientes(s.porta, [p.paciente]);
    if (!pac)
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado', 'O cadastro não existe.');
    if (pac.prontuario <= 0)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sem prontuário',
        'O paciente não tem prontuário: complete o cadastro antes de pedir a sala.',
        {
          codigo: 'sem-prontuario',
        },
      );
    const id = await this.agenda.sgh(
      comChave(s),
      EVENTOS_AUDITAVEIS.cirurgiaSolicitada.codigo,
      'cirurgia.agenda.solicitar',
      (r: number) => ({ tabela: TABELA_ESTADO, id: String(r), paciente: p.paciente }),
      (g) =>
        g.solicitar({
          sala: p.sala,
          data: p.data,
          hora: p.hora,
          duracaoMin: p.duracaoMin,
          reg: p.reg,
          pront: pac.prontuario,
          idPaciente: p.paciente,
          procedimento: p.procedimento,
          convenio: p.convenio,
          cirurgiao: p.cirurgiao,
          carater: p.carater,
          anestesia: p.anestesia,
          observacao: p.observacao ?? null,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      resultado: { solicitacao: id },
      repetida: false,
      mensagem: 'Cirurgia solicitada: a sala ainda não está ocupada.',
    };
  }

  @Get('estados/:id')
  @Permissao('cirurgia.agenda.ler')
  @Auditar('cirurgia.agenda.lida')
  async estado(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheAgendamento> {
    const d = await this.servico.detalheSolicitacao(sessaoDe(req).porta, idDaRota(id));
    req.sghAlvo = { tabelaAlvo: TABELA_ESTADO, idAlvo: String(d.agendamento.estadoId ?? id) };
    return d;
  }

  @Post('estados/:id/andamento')
  @HttpCode(200)
  @Permissao('cirurgia.agenda.agendar')
  @AuditadoNoHandler('andamento (banco) com a trilha de auditoria na mesma transação')
  async andamento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoAndamento, b);
    const e = await this.servico.exigirEstado(s.porta, idDaRota(id));
    await this.servico.exigirSalaPermitida(s.porta, s.login, e.sala);
    if (!estadoValido(e.estado) || !podeIr(e.estado, p.estado))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Mudança não permitida',
        `De "${estadoValido(e.estado) ? ROTULOS_ESTADO[e.estado] : e.estado}" não se passa a "${ROTULOS_ESTADO[p.estado]}".`,
        { codigo: 'estado-invalido' },
      );
    // Retomar a suspensa volta a solicitação (a sala foi liberada na suspensão): exige o pedido de sala.
    if (p.estado === 'solicitado') await exigir(s, 'cirurgia.agenda.solicitar', this.trilha);
    await this.agenda.sgh(
      comChave(s),
      EVENTOS_AUDITAVEIS.cirurgiaAndamento.codigo,
      'cirurgia.agenda.agendar',
      { tabela: TABELA_ESTADO, id: String(e.id), paciente: e.idPaciente },
      (g) =>
        g.mudarEstado({
          id: e.id,
          estado: p.estado,
          visto: { estado: e.estado as EstadoAgendamento, versao: e.versao ?? null },
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      resultado: { estado: e.id },
      repetida: false,
      mensagem: `Marcado: ${ROTULOS_ESTADO[p.estado]}.`,
    };
  }

  @Post('estados/:id/cancelar')
  @HttpCode(200)
  @Permissao('cirurgia.agenda.cancelar')
  @AuditadoNoHandler('cancelamento da solicitação (banco) com a trilha de auditoria na mesma transação')
  async cancelarSolicitacao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = await this.servico.exigirEstado(s.porta, idDaRota(id));
    await this.servico.exigirSalaPermitida(s.porta, s.login, e.sala);
    const p = corpo(esquemaCancelarCirurgia, { ...(b as object), agendamento: e.id });
    if (e.agendamento !== null || (e.estado !== 'solicitado' && e.estado !== 'suspenso'))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Já está na sala',
        'A cirurgia já ocupa a sala: cancele pelo agendamento (a sala é liberada e a cópia fica guardada).',
        { codigo: 'estado-invalido' },
      );
    const destino = p.suspender ? 'suspenso' : 'cancelado';
    if (!estadoValido(e.estado) || (e.estado !== destino && !podeIr(e.estado, destino)))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Mudança não permitida',
        'A solicitação não pode ir a esse estado.',
        {
          codigo: 'estado-invalido',
        },
      );
    await this.agenda.sgh(
      comChave(s),
      EVENTOS_AUDITAVEIS.cirurgiaCancelada.codigo,
      'cirurgia.agenda.cancelar',
      { tabela: TABELA_ESTADO, id: String(e.id), paciente: e.idPaciente },
      (g) =>
        g.mudarEstado({
          id: e.id,
          estado: destino,
          visto: { estado: e.estado as EstadoAgendamento, versao: e.versao ?? null },
          motivo: p.motivo,
          complemento: p.complemento ?? null,
          solicitante: p.solicitante,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      resultado: { estado: e.id },
      repetida: false,
      mensagem: p.suspender ? 'Solicitação suspensa.' : 'Solicitação cancelada.',
    };
  }

  @Post('estados/:id/pendencias')
  @HttpCode(200)
  @Permissao('cirurgia.pendencia.editar')
  @AuditadoNoHandler('pendência pré-operatória (banco) com a trilha de auditoria na mesma transação')
  async pendencia(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoPendencia, b);
    const e = await this.servico.exigirEstado(s.porta, idDaRota(id));
    await this.servico.exigirSalaPermitida(s.porta, s.login, e.sala);
    if (e.estado === 'cancelado' || e.estado === 'realizado')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Agendamento encerrado',
        'O agendamento já foi encerrado.',
        {
          codigo: 'estado-invalido',
        },
      );
    const n = await this.agenda.sgh(
      comChave(s),
      EVENTOS_AUDITAVEIS.cirurgiaPendencia.codigo,
      'cirurgia.pendencia.editar',
      (r: number) => ({ tabela: TABELA_PENDENCIA, id: String(r), paciente: e.idPaciente }),
      (g) =>
        g.gravarPendencia({
          idEstado: e.id,
          idCcagenda: e.agendamento,
          tipo: p.tipo,
          situacao: p.situacao,
          observacao: p.observacao ?? null,
          usuario: s.login,
        }),
    );
    return { ok: true, resultado: { pendencia: n }, repetida: false, mensagem: 'Pendência registrada.' };
  }

  @Get('cancelamentos')
  @Permissao('cirurgia.agenda.ler')
  async cancelamentos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaCancelamentosCirurgia> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(s.porta);
    // Sem período: 15 dias antes e 15 depois de hoje (pelo início marcado da cirurgia).
    const de = dataDaConsulta(q['de']) ?? somarDias(r.hoje, -15);
    const j = janela31(de, dataDaConsulta(q['ate']) ?? somarDias(de, 30), r.hoje);
    return this.servico.cancelamentos(s.porta, j.de, j.ate);
  }

  @Get('historico')
  @Permissao('cirurgia.agenda.ler')
  async historico(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaHistoricoCirurgia> {
    const s = sessaoDe(req);
    const r = await this.porta.relogio(s.porta);
    // Sem período: as operações dos 30 dias até hoje (pelo momento da inclusão ou da remarcação).
    const ate = dataDaConsulta(q['ate']) ?? r.hoje;
    const j = janela31(dataDaConsulta(q['de']) ?? somarDias(ate, -30), ate, r.hoje);
    return this.servico.historicoDoPeriodo(s.porta, j.de, j.ate);
  }

  @Get('realizadas')
  @Permissao('cirurgia.registro.ler')
  async realizadas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaRealizadas> {
    const s = sessaoDe(req);
    const reg = inteiroOuNulo(q['reg']) || null;
    const sala = inteiroOuNulo(q['sala']) || null;
    const de = dataDaConsulta(q['de']);
    const ateQ = dataDaConsulta(q['ate']);
    // Pelo atendimento sem período: todas as cirurgias dele (teto de 500), sem janela.
    if (reg !== null && de === null && ateQ === null)
      return this.servico.realizadas(s.porta, { de: null, ate: null, reg, sala });
    const r = await this.porta.relogio(s.porta);
    // Sem período: os 30 dias até hoje (pela data do ato).
    const ate = ateQ ?? r.hoje;
    const j = janela31(de ?? somarDias(ate, -30), ate, r.hoje);
    return this.servico.realizadas(s.porta, { de: j.de, ate: j.ate, reg, sala });
  }

  @Post('realizadas')
  @HttpCode(201)
  @Permissao('cirurgia.registro.criar')
  @AuditadoNoHandler('cirurgia.registrarCirurgia pelo executor (trilha na mesma transação)')
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarCirurgia, b);
    await this.servico.exigirSalaPermitida(s.porta, s.login, e.sala);
    // M46 (etapa 2, regra 2): sem a pausa cirúrgica concluída, a incisão não é registrada (trava ligada por bloco).
    await this.trava?.conferir(s, {
      agendamento: e.agendamento,
      incisao: instanteDaIncisao(e.data, e.extensao.incisao),
      carater: e.carater,
      motivo: e.motivoExcecaoIncisao ?? null,
    });
    return this.registro.executar(s, 'cirurgia.registrarCirurgia', e, 'Ato cirúrgico registrado.');
  }

  @Post('realizadas/:id/ligacao')
  @HttpCode(200)
  @Permissao('cirurgia.ligacao.revisar')
  @AuditadoNoHandler('revisão da ligação (banco) com a trilha de auditoria na mesma transação')
  async ligacao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoLigacaoCirurgia, { ...(b as object), realizada: idDaRota(id) });
    const alvo = await this.porta.realizada(s.porta, p.realizada);
    if (!alvo)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Cirurgia não encontrada',
        'A cirurgia realizada não existe.',
      );
    if (p.agendamento !== null) {
      const a = await this.servico.exigirAgendamento(s.porta, p.agendamento);
      if (a.reg !== alvo.reg)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Outro atendimento',
          'O agendamento é de outro atendimento.',
          {
            codigo: 'atendimento-de-outro-paciente',
          },
        );
    }
    await this.registro.sgh(
      comChave(s),
      EVENTOS_AUDITAVEIS.cirurgiaLigacaoRevisada.codigo,
      'cirurgia.ligacao.revisar',
      { tabela: TABELA_LIGACAO, id: String(alvo.id), chave: `${alvo.id}:${p.agendamento ?? '-'}` },
      (g) =>
        g.gravarLigacao({
          idCccadcir: alvo.id,
          idCcagenda: p.agendamento,
          reg: alvo.reg,
          sala: alvo.sala,
          data: alvo.data,
          usuario: s.login,
        }),
    );
    return { ok: true, resultado: { realizada: alvo.id }, repetida: false, mensagem: 'Ligação revisada.' };
  }

  @Get('salas')
  @Permissao('cirurgia.agenda.ler')
  async salas(@Req() req: RequisicaoAutorizada): Promise<SalaCirurgica[]> {
    const s = sessaoDe(req);
    return (await this.porta.salas(s.porta, s.login)).map(salaResposta);
  }

  @Get('salas/:sala/usuarios')
  @Permissao('cirurgia.sala.ler')
  usuarios(@Param('sala') sala: string, @Req() req: RequisicaoAutorizada): Promise<UsuariosDaSala> {
    const s = sessaoDe(req);
    return this.servico.usuariosDaSala(s.porta, s.login, idDaRota(sala));
  }

  @Post('salas/:sala/usuarios')
  @HttpCode(200)
  @Permissao('cirurgia.sala.editar')
  @AuditadoNoHandler('cirurgia.definirSalaUsuario pelo executor (trilha na mesma transação)')
  async definirUsuario(
    @Param('sala') sala: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDefinirSalaUsuario, { ...(b as object), sala: idDaRota(sala) });
    return this.agenda.executar(
      s,
      'cirurgia.definirSalaUsuario',
      e,
      e.acao === 'incluir' ? 'Usuário incluído na sala.' : 'Usuário retirado da sala.',
    );
  }

  @Get('profissionais')
  @Permissao('cirurgia.agenda.ler')
  profissionais(@Query('q') q: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.buscarProfissionais(sessaoDe(req).porta, (q ?? '').slice(0, 60));
  }

  @Get('procedimentos')
  @Permissao('cirurgia.agenda.ler')
  procedimentos(@Query('q') q: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.porta.buscarProcedimentos(sessaoDe(req).porta, (q ?? '').slice(0, 60));
  }
}
