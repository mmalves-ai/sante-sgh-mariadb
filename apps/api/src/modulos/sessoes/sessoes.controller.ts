// Agenda de sessões e recursos (M50, etapa 6; ficha, seções 4, 5, 7 e 8; regras 11 e 13; cap-05a §5.1):
//   GET  /api/sessoes/gravacao                a funcionalidade e a ação valem agora? (motivo)
//   GET  /api/sessoes/grade?de&dias&agenda     as cadeiras e salas com as sessões do período (auditado)
//   GET  /api/sessoes/pacientes/:id            as sessões do paciente a partir de hoje (auditado)
//   POST /api/sessoes/previa                   as datas da série e o que impede cada uma (não grava)
//   POST /api/sessoes                          agenda.agendarSessao (a série inteira: plano_sessao e sessao_terapeutica)
//   POST /api/sessoes/:id/situacao             agenda.atualizarSessao (realizada, falta, cancelada, restantes)
// As datas, a sobreposição e a conferência do recurso são SEMPRE do domínio (@sgh/dominio-agenda); a gravação reconfere a
// ocupação sob a trava do recurso e do paciente, na mesma transação, com a trilha junto. Desligada até o serviço
// existir (chave `sessoes`, DP-32; POL-3): as telas ficam em consulta.
// Melhoria: a série leva o item agendado, o profissional solicitante e a fonte pagadora ao plano de sessões; quem grava
// é o usuário da sessão pelo id (o contexto).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AgendarSessaoEntrada,
  CHAVE_LIBERACAO_SESSOES,
  DIAS_GRADE_SESSOES,
  esquemaAgendarSessao,
  esquemaAtualizarSessao,
  EVENTOS_AUDITAVEIS as E,
  type GradeSessoes,
  type GravacaoSessoes,
  PERMISSOES_SESSOES as P,
  type PreviaSerieSessoes,
  type RecursoSessao,
  type ResultadoSessao,
  type SessaoLida,
  type SessoesDoPaciente,
} from '@sgh/contratos';
import {
  conferirRecurso,
  conflitosDaSerie,
  datasDaSerie,
  ErroSessao,
  faixaDoRecurso,
  idadeEmAnos,
  transicaoSessao,
} from '@sgh/dominio-agenda';
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
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import {
  type GravadorSessoes,
  PORTA_SESSOES,
  type PortaSessoes,
  type RecursoDeSessao,
  type SessaoAgendada,
} from './porta.js';

const DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DIA_MS = 86_400_000;

const recusaDominio = (x: unknown): never => {
  if (x instanceof ErroSessao)
    throw new ErroProblema('recusa-de-negocio', 409, 'Sessão recusada', x.message, { codigo: x.codigo });
  throw x;
};

function somarDias(data: string, dias: number): string {
  return new Date(Date.parse(`${data}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

export function recursoPublico(r: RecursoDeSessao): RecursoSessao {
  return {
    recurso: r.recurso,
    identificacao: r.identificacao,
    agenda: r.agenda,
    nomeAgenda: r.nomeAgenda,
    unidade: r.unidade,
    tipo: r.tipo,
    prioridade: r.prioridade,
    complexidade: r.complexidade,
    duracao: r.duracao,
    faixa: faixaDoRecurso(r.faixaInicial, r.faixaFinal),
    ativo: r.ativo,
  };
}

const sessaoPublica = (x: SessaoAgendada, nomes: Map<number, string>): SessaoLida => ({
  id: x.id,
  serie: x.serie,
  ordem: x.ordem,
  total: x.total,
  recurso: x.recurso,
  agenda: x.agenda,
  paciente: x.paciente,
  prontuario: x.prontuario,
  nome: nomes.get(x.paciente) ?? '',
  inicio: x.inicio,
  fim: x.fim,
  situacao: x.situacao,
  planoTipo: x.planoTipo,
  plano: x.plano,
  complexidade: x.complexidade,
  duracao: x.duracao,
  observacao: x.observacao,
  motivo: x.motivo,
  por: x.por,
  em: x.em,
  alteradoPor: x.alteradoPor,
  alteradoEm: x.alteradoEm,
  versao: x.versao,
});

@Controller()
export class SessoesController {
  private readonly apoio: ApoioGravacao<GravadorSessoes>;

  constructor(
    @Inject(PORTA_SESSOES) private readonly porta: PortaSessoes,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao<GravadorSessoes>(
      { chave: CHAVE_LIBERACAO_SESSOES, nome: 'a agenda de sessões', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  @Get('sessoes/gravacao')
  @Permissao(P.ler)
  async gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoSessoes> {
    return this.apoio.gravacao(sessaoDe(req), { agendar: P.agendar });
  }

  @Get('sessoes/grade')
  @Permissao(P.ler)
  @Auditar(E.sessaoGradeLida.codigo)
  async grade(
    @Req() req: RequisicaoAutorizada,
    @Query('de') de?: string,
    @Query('dias') dias?: string,
    @Query('agenda') agenda?: string,
  ): Promise<GradeSessoes> {
    const s = sessaoDe(req);
    const { hoje, agora } = await this.porta.relogio(s.porta);
    const inicio = de && DATA.test(de) ? de : hoje;
    const n = Math.min(Math.max(Number(dias ?? 7) || 7, 1), DIAS_GRADE_SESSOES);
    const ate = somarDias(inicio, n);
    const [todos, dominios] = await Promise.all([this.porta.recursos(s.porta), this.porta.dominios(s.porta)]);
    const filtroAgenda = agenda && /^\d{1,10}$/.test(agenda) ? Number(agenda) : null;
    const recursos = todos.filter((r) => filtroAgenda === null || r.agenda === filtroAgenda);
    const p = await this.porta.periodo(
      s.porta,
      inicio,
      ate,
      filtroAgenda === null ? null : recursos.map((r) => r.recurso),
    );
    const nomes = await this.porta.nomes(
      s.porta,
      p.sessoes.map((x) => x.paciente),
    );
    return {
      de: inicio,
      ate,
      recursos: recursos.map(recursoPublico),
      sessoes: p.sessoes.map((x) => sessaoPublica(x, nomes)),
      complexidades: dominios.complexidades,
      duracoes: dominios.duracoes,
      cortada: p.cortada,
      lidoEm: agora,
    };
  }

  @Get('sessoes/pacientes/:id')
  @Permissao(P.ler)
  @Auditar(E.sessaoGradeLida.codigo)
  async doPaciente(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<SessoesDoPaciente> {
    const s = sessaoDe(req);
    const paciente = await this.porta.paciente(s.porta, idDaRota(id));
    if (!paciente)
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado', 'O cadastro não existe.');
    const { hoje } = await this.porta.relogio(s.porta);
    const r = await this.porta.doPaciente(s.porta, paciente.id, hoje);
    const nomes = new Map([[paciente.id, paciente.nome]]);
    return {
      paciente: paciente.id,
      nome: paciente.nome,
      sessoes: r.sessoes.map((x) => sessaoPublica(x, nomes)),
      cortada: r.cortada,
    };
  }

  /** Confere o pedido (paciente, recurso, domínios, datas) e devolve a série com os conflitos relidos. */
  private async planejar(s: SessaoCadastro, e: AgendarSessaoEntrada) {
    const [paciente, recursos, dominios, { hoje }] = await Promise.all([
      this.porta.paciente(s.porta, e.paciente),
      this.porta.recursos(s.porta),
      this.porta.dominios(s.porta),
      this.porta.relogio(s.porta),
    ]);
    if (!paciente)
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado', 'O cadastro não existe.');
    if (!paciente.ativo)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sessão recusada',
        'O cadastro do paciente está inativo ou foi unificado em outro.',
        { codigo: 'paciente-inativo' },
      );
    const r = recursos.find((x) => x.recurso === e.recurso);
    if (!r)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Cadeira ou sala não encontrada',
        'O recurso não existe.',
      );
    if (!dominios.complexidades.some((d) => d.codigo === e.complexidade))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Complexidade inexistente',
        'Escolha uma complexidade.',
      );
    if (!dominios.duracoes.some((d) => d.codigo === e.duracao))
      throw new ErroProblema('entrada-invalida', 400, 'Duração inexistente', 'Escolha uma duração.');
    if (e.inicio < hoje)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sessão recusada',
        'A primeira sessão não pode ser antes de hoje.',
        { codigo: 'data-passada' },
      );
    let datas: ReturnType<typeof datasDaSerie>;
    try {
      conferirRecurso(recursoPublico(r), {
        complexidade: e.complexidade,
        duracao: e.duracao,
        idade: idadeEmAnos(paciente.nascimento, e.inicio),
      });
      datas = datasDaSerie({
        inicio: e.inicio,
        hora: e.hora,
        sessoes: e.sessoes,
        intervaloDias: e.intervaloDias,
        pularFimDeSemana: e.pularFimDeSemana,
        duracaoMin: e.duracaoMin,
      });
    } catch (x) {
      return recusaDominio(x);
    }
    // Horário a horário: a janela da série inteira pode passar de mil ocupações (o corte deixaria passar conflito).
    const [doRecurso, doPaciente] = await Promise.all([
      this.porta.ocupacoes(s.porta, { recurso: r.recurso }, datas),
      this.porta.ocupacoes(s.porta, { paciente: paciente.id }, datas),
    ]);
    return { paciente, recurso: r, datas: conflitosDaSerie(datas, doRecurso, doPaciente) };
  }

  @Post('sessoes/previa')
  @HttpCode(200)
  @Permissao(P.agendar)
  @AuditadoNoHandler('a prévia só lê (datas e conflitos): nada é gravado')
  async previa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaSerieSessoes> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAgendarSessao, b);
    try {
      const p = await this.planejar(s, e);
      return {
        ok: p.datas.every((d) => d.conflito === null),
        datas: p.datas,
        recusa: null,
      };
    } catch (x) {
      if (x instanceof ErroProblema && x.getStatus() === 409) {
        const extras = x.extras as { codigo?: string };
        return {
          ok: false,
          datas: [],
          recusa: { codigo: extras.codigo ?? 'recusa', motivo: x.detalhe ?? x.titulo },
        };
      }
      throw x;
    }
  }

  @Post('sessoes')
  @HttpCode(201)
  @Permissao(P.agendar)
  @AuditadoNoHandler(
    'agenda.agendarSessao (plano_sessao e sessao_terapeutica, com as travas) com a trilha na mesma transação',
  )
  async agendar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSessao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAgendarSessao, b);
    await this.apoio.exigirLiberacao(s);
    const p = await this.planejar(s, e);
    const conflito = p.datas.find((d) => d.conflito !== null);
    if (conflito)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Sessão recusada',
        conflito.conflito === 'recurso'
          ? `A sessão ${conflito.ordem} cai num horário já ocupado nesta cadeira ou sala: veja a prévia.`
          : `O paciente já tem outra sessão no horário da sessão ${conflito.ordem}: veja a prévia.`,
        { codigo: conflito.conflito === 'recurso' ? 'recurso-ocupado' : 'paciente-ocupado' },
      );
    const r = await this.apoio.sgh(
      s,
      E.sessaoAgendada.codigo,
      P.agendar,
      (x: { serie: number; ids: number[] }) => ({
        tabela: 'plano_sessao',
        id: String(x.serie),
        paciente: p.paciente.id,
        chave: `serie=${x.serie}:recurso=${p.recurso.recurso}:${p.datas.length}x${e.intervaloDias}d:${e.planoTipo}`,
      }),
      (g) =>
        g.agendarSerie({
          agenda: p.recurso.agenda,
          recurso: p.recurso.recurso,
          complexidade: e.complexidade,
          duracao: e.duracao,
          paciente: p.paciente.id,
          prontuario: p.paciente.prontuario,
          duracaoMin: e.duracaoMin,
          intervaloDias: e.intervaloDias,
          pularFimDeSemana: e.pularFimDeSemana,
          planoTipo: e.planoTipo,
          plano: e.plano,
          observacao: e.observacao?.length ? e.observacao : null,
          itemAgendavel: e.itemAgendavel ?? null,
          solicitante: e.solicitante ?? null,
          fontePagadora: e.fontePagadora ?? null,
          sessoes: p.datas.map((d) => ({ ordem: d.ordem, inicio: d.inicio, fim: d.fim })),
        }),
    );
    return {
      ok: true,
      serie: r.serie,
      sessoes: r.ids,
      mensagem: `Série de ${r.ids.length} sessão(ões) agendada em ${p.recurso.identificacao}.`,
    };
  }

  @Post('sessoes/:id/situacao')
  @HttpCode(200)
  @Permissao(P.agendar)
  @AuditadoNoHandler(
    'agenda.atualizarSessao (sessao_terapeutica, pela versão) com a trilha na mesma transação',
  )
  async situacao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSessao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAtualizarSessao, b);
    if (e.sessao !== idDaRota(id))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Sessão divergente',
        'A sessão da rota e a do corpo diferem.',
      );
    await this.apoio.exigirLiberacao(s);
    const [x, { agora }] = await Promise.all([
      this.porta.sessao(s.porta, e.sessao),
      this.porta.relogio(s.porta),
    ]);
    if (!x) throw new ErroProblema('nao-encontrado', 404, 'Sessão não encontrada', 'A sessão não existe.');
    let nova: ReturnType<typeof transicaoSessao>;
    try {
      nova = transicaoSessao(x.situacao, e.acao, x.inicio, agora);
    } catch (erro) {
      return recusaDominio(erro);
    }
    const motivo = e.motivo?.length ? e.motivo : null;
    const n = await this.apoio.sgh(
      s,
      E.sessaoAtualizada.codigo,
      P.agendar,
      (k: number) => ({
        tabela: 'sessao_terapeutica',
        id: String(x.id),
        paciente: x.paciente,
        chave: `serie=${x.serie}:${e.acao}${e.acao === 'cancelar-restantes' ? `:${k}` : ''}`,
      }),
      async (g) => {
        if (e.acao === 'cancelar-restantes')
          return g.cancelarRestantes({
            id: x.id,
            serie: x.serie,
            ordem: x.ordem,
            motivo: motivo ?? '',
            versao: e.versao,
          });
        await g.atualizar({
          id: x.id,
          situacao: nova as Exclude<typeof nova, 'agendada'>,
          motivo,
          versao: e.versao,
        });
        return 1;
      },
    );
    const texto: Record<typeof e.acao, string> = {
      realizar: 'Sessão registrada como realizada.',
      falta: 'Falta registrada.',
      cancelar: 'Sessão cancelada.',
      'cancelar-restantes': `${n} sessão(ões) da série cancelada(s).`,
    };
    return { ok: true, serie: x.serie, sessoes: [x.id], mensagem: texto[e.acao] };
  }
}
