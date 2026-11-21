// Agenda de consultas, cadastro, escala e geração (M17; ficha, seção 7):
//   GET  /api/agenda/consultas/opcoes                       vocabulário (convênios, especialidades, motivos, canais) e relógio
//   GET  /api/agenda/consultas/gravacao                     a funcionalidade e cada ação gravam agora? (motivo)
//   GET  /api/agenda/consultas/agendas?termo&situacao&especialidade   lista com vigência (grade de agora em diante)
//   GET  /api/agenda/consultas/agendas/:id                  agenda com convênios, especialidades e escala
//   POST /api/agenda/consultas/agendas                      agenda.incluirAgenda
//   PUT  /api/agenda/consultas/agendas/:id                  agenda.alterarAgenda (controle otimista)
//   POST /api/agenda/consultas/agendas/:id/convenios        agenda.definirCobertura (a última pede confirmação)
//   GET  /api/agenda/consultas/agendas/:id/convenios/:c/marcados   marcações futuras com o convênio (mascaradas)
//   POST /api/agenda/consultas/agendas/:id/especialidades   agenda.definirEspecialidade
//   POST /api/agenda/consultas/agendas/:id/ligacao          vínculos revisados (profissional, especialidade, local, unidade)
//   GET  /api/agenda/consultas/escalas/:id                  escala atual, planejadas e gerações
//   POST /api/agenda/consultas/escalas/:id                  escala planejada com vigência (agenda_escala)
//   POST /api/agenda/consultas/escalas/:id/planejadas/:versao/cancelar
//   POST /api/agenda/consultas/grade/previa                 prévia da geração (nada é gravado)
//   POST /api/agenda/consultas/grade/gerar                  agenda.gerarGrade (a prévia aprovada, pela impressão)
//   POST /api/agenda/consultas/grade/geracoes/:id/reverter  agenda.reverterGrade
//   GET  /api/agenda/consultas/grade?agenda&inicio          grade da semana (paciente mascarado)
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  type DetalheAgenda,
  type EscalaAgenda,
  esquemaAlterarAgenda,
  esquemaIncluirAgenda,
  esquemaPedidoEscala,
  esquemaPedidoGerarGrade,
  esquemaPedidoGrade,
  esquemaPedidoLigacao,
  EVENTOS_AUDITAVEIS,
  type GradeSemana,
  type GravacaoAgenda,
  type ListaAgendas,
  type MarcadosComConvenio,
  type OpcoesAgenda,
  type PreviaGrade,
  type ResultadoAgenda,
} from '@sgh/contratos';
import { segundaDaSemana } from '@sgh/dominio-agenda';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { exigir, idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioAgenda, ctxAgenda } from './apoio.js';
import { PORTA_AGENDA, type PortaAgenda } from './porta.js';
import { ServicoAgenda } from './servico.js';
import { horaIso, horaIsoOuNull, LeituraAgenda } from './visao.js';

export function corpo<T>(
  esquema: {
    safeParse(
      v: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[] }[] } };
  },
  v: unknown,
): T {
  const r = esquema.safeParse(v);
  if (!r.success)
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Confira os campos indicados.', {
      campos: [...new Set(r.error.issues.map((i) => i.path.map(String).join('.') || '(corpo)'))],
    });
  return r.data;
}

const inteiro = (v: string | undefined): number | null => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
};

export const dataDaConsulta = (v: string | undefined): string | null => {
  if (v === undefined || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return v;
};

@Controller('agenda/consultas')
export class AgendasController {
  private readonly apoio: ApoioAgenda;
  private readonly servico: ServicoAgenda;
  private readonly leitura: LeituraAgenda;
  constructor(
    @Inject(PORTA_AGENDA) porta: PortaAgenda,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioAgenda(porta, trilha, configuracao, cache);
    this.servico = new ServicoAgenda(porta);
    this.leitura = new LeituraAgenda(porta);
  }

  @Get('opcoes')
  @Permissao('agenda.agenda.ler')
  opcoes(@Req() req: RequisicaoAutorizada): Promise<OpcoesAgenda> {
    return this.servico.opcoes(ctxAgenda(sessaoDe(req)));
  }

  @Get('gravacao')
  @Permissao('agenda.agenda.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoAgenda> {
    return this.apoio.gravacao(sessaoDe(req));
  }

  @Get('agendas')
  @Permissao('agenda.agenda.ler')
  listar(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaAgendas> {
    const esp = q['especialidade'] ? Number(q['especialidade']) : null;
    return this.servico.listar(ctxAgenda(sessaoDe(req)), {
      termo: (q['termo'] ?? '').slice(0, 60) || null,
      situacao: ['ativas', 'inativas', 'vigentes'].includes(q['situacao'] ?? '')
        ? (q['situacao'] as string)
        : null,
      especialidade: esp !== null && Number.isInteger(esp) ? esp : null,
      unidade: inteiro(q['unidade']),
      local: inteiro(q['local']),
    });
  }

  @Get('agendas/:id')
  @Permissao('agenda.agenda.ler')
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<DetalheAgenda> {
    return this.servico.detalhe(ctxAgenda(sessaoDe(req)), idDaRota(id));
  }

  @Post('agendas')
  @HttpCode(201)
  @Permissao('agenda.agenda.editar')
  @AuditadoNoHandler('agenda.incluirAgenda pelo executor (trilha na mesma transação)')
  incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    return this.apoio.executar(
      sessaoDe(req),
      'agenda.incluirAgenda',
      corpo(esquemaIncluirAgenda, b),
      'Agenda incluída.',
    );
  }

  @Put('agendas/:id')
  @Permissao('agenda.agenda.editar')
  @AuditadoNoHandler('agenda.alterarAgenda pelo executor (trilha na mesma transação)')
  alterar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const e = corpo(esquemaAlterarAgenda, { ...(b as object), agenda: idDaRota(id) });
    return this.apoio.executar(sessaoDe(req), 'agenda.alterarAgenda', e, 'Agenda alterada.');
  }

  @Post('agendas/:id/convenios')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.definirCobertura pelo executor (trilha na mesma transação)')
  async convenios(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const e = { ...(b as object), agenda: idDaRota(id) };
    const acao = (b as { acao?: string })?.acao;
    return this.apoio.executar(
      sessaoDe(req),
      'agenda.definirCobertura',
      e,
      acao === 'remover' ? 'Convênio removido da agenda.' : 'Convênio incluído na agenda.',
    );
  }

  /** Marcações futuras com o convênio (antes de removê-lo da cobertura); nome mascarado na lista. */
  @Get('agendas/:id/convenios/:convenio/marcados')
  @Permissao('agenda.marcacao.ler')
  marcados(
    @Param('id') id: string,
    @Param('convenio') convenio: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<MarcadosComConvenio> {
    return this.servico.marcadosComConvenio(ctxAgenda(sessaoDe(req)), idDaRota(id), idDaRota(convenio));
  }

  @Post('agendas/:id/especialidades')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.definirEspecialidade pelo executor (trilha na mesma transação)')
  especialidades(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    return this.apoio.executar(
      sessaoDe(req),
      'agenda.definirEspecialidade',
      { ...(b as object), agenda: idDaRota(id) },
      'Especialidade da agenda atualizada.',
    );
  }

  @Post('agendas/:id/ligacao')
  @HttpCode(200)
  @Permissao('agenda.agenda.editar')
  @AuditadoNoHandler('vínculos da agenda com a trilha na mesma transação')
  async ligacao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoLigacao, b);
    const a = await this.servico.exigirAgenda(ctxAgenda(s), idDaRota(id));
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaLigacaoRevisada.codigo,
      'agenda.agenda',
      { tabela: 'agenda_servico', id: String(a.id) },
      (g) =>
        g.gravarVinculo({
          agenda: a.id,
          profissional: p.profissional,
          especialidade: p.especialidade,
          local: p.local,
          unidade: p.unidade,
        }),
    );
    return {
      ok: true,
      resultado: { agenda: a.id },
      repetida: false,
      mensagem: 'Ligação da agenda revisada.',
    };
  }

  @Get('escalas/:id')
  @Permissao('agenda.escala.ler')
  escala(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<EscalaAgenda> {
    return this.servico.escala(ctxAgenda(sessaoDe(req)), idDaRota(id));
  }

  @Post('escalas/:id')
  @HttpCode(201)
  @Permissao('agenda.escala.editar')
  @AuditadoNoHandler('escala planejada com a trilha na mesma transação')
  async planejar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const p = corpo(esquemaPedidoEscala, b);
    const a = await this.servico.exigirAgenda(ctxAgenda(s), idDaRota(id));
    const r = await this.leitura.relogio(ctxAgenda(s));
    if (p.vigenteDesde < r.hoje)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Data inválida',
        'A escala passa a valer a partir de hoje ou depois.',
      );
    const versao = await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaEscalaPlanejada.codigo,
      'agenda.escala',
      { tabela: 'agenda_escala', id: String(a.id) },
      (g) =>
        g.planejarEscala({
          agenda: a.id,
          vigenteDesde: p.vigenteDesde,
          faixas: p.faixas.map((f) => ({
            diaSemana: f.semana,
            duracaoMinutos: p.duracaoMinutos,
            inicio: horaIso(f.inicio),
            fim: horaIso(f.fim),
            intervaloInicio: horaIsoOuNull(f.intervaloInicio),
            intervaloFim: horaIsoOuNull(f.intervaloFim),
          })),
        }),
    );
    return { ok: true, resultado: { versao }, repetida: false, mensagem: 'Escala planejada.' };
  }

  @Post('escalas/:id/planejadas/:versao/cancelar')
  @HttpCode(200)
  @Permissao('agenda.escala.editar')
  @AuditadoNoHandler('escala planejada com a trilha na mesma transação')
  async cancelarPlanejada(
    @Param('id') id: string,
    @Param('versao') versao: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    const agenda = (await this.servico.exigirAgenda(ctxAgenda(s), idDaRota(id))).id;
    const v = idDaRota(versao);
    await this.apoio.gravar(
      s,
      EVENTOS_AUDITAVEIS.agendaEscalaPlanejada.codigo,
      'agenda.escala',
      { tabela: 'agenda_escala', id: String(v) },
      (g) => g.cancelarEscalaPlanejada({ agenda, id: v }),
    );
    return { ok: true, resultado: { versao: v }, repetida: false, mensagem: 'Escala planejada cancelada.' };
  }

  @Post('grade/previa')
  @AuditadoNoHandler('prévia: só leitura, nada é gravado (POST pelo tamanho do pedido)')
  @HttpCode(200)
  @Permissao('agenda.grade.ler')
  async previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaGrade> {
    const p = corpo(esquemaPedidoGrade, b);
    return (
      await this.servico.previa(ctxAgenda(sessaoDe(req)), {
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
      })
    ).previa;
  }

  @Post('grade/gerar')
  @HttpCode(201)
  @Permissao('agenda.grade.gerar')
  @AuditadoNoHandler('agenda.gerarGrade pelo executor (trilha na mesma transação)')
  async gerar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const s = sessaoDe(req);
    await exigir(s, 'agenda.grade.gerar', this.trilha);
    const p = corpo(esquemaPedidoGerarGrade, b);
    const { previa, entrada } = await this.servico.previa(ctxAgenda(s), {
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
    });
    if (previa.assinatura !== p.assinatura)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'A prévia mudou',
        'A agenda mudou desde a prévia (horários, bloqueios ou escala): refaça a prévia e confira a lista antes de gravar.',
        { codigo: 'previa-desatualizada' },
      );
    return this.apoio.executar(s, 'agenda.gerarGrade', entrada, `${previa.horarios} horário(s) gerado(s).`);
  }

  @Post('grade/geracoes/:id/reverter')
  @HttpCode(200)
  @Permissao('agenda.grade.reverter')
  @AuditadoNoHandler('agenda.reverterGrade pelo executor (trilha na mesma transação)')
  async reverter(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ResultadoAgenda> {
    const r = await this.apoio.executar(
      sessaoDe(req),
      'agenda.reverterGrade',
      { geracao: idDaRota(id) },
      'Geração revertida.',
    );
    const removidos = Number(r.resultado['removidos'] ?? 0);
    const mantidos = Number(r.resultado['mantidos'] ?? 0);
    return {
      ...r,
      mensagem:
        mantidos > 0
          ? `Geração revertida: ${removidos} horário(s) removido(s); ${mantidos} ficaram porque ganharam paciente.`
          : `Geração revertida: ${removidos} horário(s) removido(s).`,
    };
  }

  @Get('grade')
  @Permissao('agenda.grade.ler')
  async grade(
    @Query('agenda') agenda: string,
    @Query('inicio') inicio: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<GradeSemana> {
    const s = sessaoDe(req);
    const r = await this.leitura.relogio(ctxAgenda(s));
    const d = dataDaConsulta(inicio) ?? r.hoje;
    return this.servico.gradeSemana(ctxAgenda(s), idDaRota(agenda ?? ''), segundaDaSemana(d));
  }
}
