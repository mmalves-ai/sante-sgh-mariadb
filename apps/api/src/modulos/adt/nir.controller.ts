// NIR (M44, etapa 2; ficha, seções 4, 5, 7 e 8): solicitação de leito pelo médico, fila priorizada com prazo, reserva
// com validade e confirmação, alta prevista (DPA) e barreiras de alta, quadro de permanência com a reunião de leitos, a
// calibragem dos limites e o de-para das situações de regulação do sistema anterior:
//   GET  /api/nir/gravacao                         a funcionalidade e cada ação valem agora? (motivo)
//   GET  /api/nir/fila                             as solicitações abertas, os conflitos e as cirurgias que pedem UTI (auditado)
//   GET  /api/nir/eventos                          canal de eventos (text/event-stream): só avisa que mudou
//   GET  /api/nir/origens                          de onde pedir: o PA aberto, os internados e as cirurgias (auditado)
//   POST /api/nir/solicitacoes                     internacao.solicitarLeito (ato médico: médico com conselho ativo)
//   POST /api/nir/solicitacoes/:id/transicoes      internacao.transicionarSolicitacao (analisar, trânsito, priorizar…)
//   GET  /api/nir/solicitacoes/:id/leitos          os leitos livres e se atendem o perfil
//   GET  /api/nir/reservas                         as vigentes e as encerradas recentes
//   POST /api/nir/reservas                         internacao.registrarReserva (exceção ao perfil: supervisor, senha)
//   POST /api/nir/reservas/:id/confirmar           internacao.confirmarReserva
//   POST /api/nir/reservas/:id/cancelar            internacao.cancelarReserva (a solicitação volta à análise)
//   GET  /api/nir/altas-previstas                  os internados com a DPA, o histórico e as barreiras (auditado)
//   POST /api/nir/dpa                              internacao.registrarDpa (médico; mudar pede o motivo)
//   POST /api/nir/barreiras                        internacao.registrarBarreiraAlta
//   POST /api/nir/barreiras/:id/resolver           internacao.resolverBarreiraAlta
//   GET  /api/nir/permanencia                      o quadro (verde, amarelo, vermelho) e a reunião de leitos (auditado)
//   GET  /api/nir/permanencia/calibragem           as duas réguas e a proposta de limite (agregadas no banco)
//   POST /api/nir/limites                          internacao.registrarLimitePermanencia
//   GET  /api/nir/situacoes                        o de-para das 23 situações (proposto e aprovado)
//   POST /api/nir/situacoes/:id/aprovar            internacao.aprovarDeparaSituacao
// W0-07 (programa CRUD completo; todas com o motivo, a versão anterior na trilha de auditoria):
//   POST /api/nir/solicitacoes/:id/corrigir        perfil, recursos e observação (a versão vista confere)
//   POST /api/nir/solicitacoes/:id/excluir         a criada por engano, sem desdobramento (senha; recusa com a contagem)
//   POST /api/nir/reservas/:id/alterar             outro leito e/ou nova validade
//   POST /api/nir/reservas/:id/excluir             a ativa criada por engano (a convertida em internação: 409)
//   POST /api/nir/dpa/retirar                      retira a alta prevista vigente (versão nova marcada)
//   POST /api/nir/barreiras/:id/alterar            descrição, responsável e prazo da barreira aberta
//   POST /api/nir/barreiras/:id/encerrar           resolvida ou cancelada, com o motivo (também a social)
//   POST /api/nir/limites/remover                  tira o limite próprio: volta ao padrão
// A admissão e a transferência que atendem a solicitação são as do M21 (`POST /api/internacoes` e
// `POST /api/leitos/transferencias` com `solicitacaoNir`), com a solicitação concluída na mesma transação.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  CHAVE_LIBERACAO_NIR,
  ehMedico,
  esquemaAlterarBarreira,
  esquemaAlterarReserva,
  esquemaAprovarDepara,
  esquemaCorrigirSolicitacao,
  esquemaEncerrarBarreira,
  esquemaExcluirReserva,
  esquemaExcluirSolicitacao,
  esquemaRemoverLimite,
  esquemaRetirarDpa,
  esquemaEncerrarReserva,
  esquemaRegistrarBarreira,
  esquemaRegistrarDpa,
  esquemaRegistrarLimite,
  esquemaRegistrarReserva,
  esquemaResolverBarreira,
  esquemaSolicitarLeito,
  esquemaTransicionarSolicitacao,
  ESCOPOS_LIMITE_PERMANENCIA,
  EVENTOS_AUDITAVEIS,
  type EscopoLimitePermanencia,
  type GravacaoNir,
  type OrigensNir,
  PARAMETRO_PERMANENCIA_AMARELO,
  PARAMETRO_PERMANENCIA_VERMELHO,
  PARAMETRO_PRAZO_NIR,
  PARAMETRO_VALIDADE_RESERVA,
  PERMISSOES_NIR_CODIGOS as P,
  PRIORIDADES_NIR,
  type PrioridadeNir,
  type ResultadoNir,
} from '@sgh/contratos';
import {
  decidirReserva,
  idadeEmAnos,
  PRAZOS_PADRAO_NIR,
  situacaoEquivalente,
  transicao,
} from '@sgh/dominio-internacao';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { ApoioGravacaoIdempotente } from './apoio-idempotente.js';
import {
  BATIDA_EVENTOS_MS,
  BATIDA_EVENTOS_PADRAO_MS,
  CONFIGURACAO_M16,
  type ConfiguracaoM16,
} from '../internacao/public-api.js';
import {
  type AvisosAtendimento,
  PORTA_ATENDIMENTO,
  type PortaAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from '../atendimento/public-api.js';
import { ctxAdt, janelaOutroSistema } from './apoios.js';
import { intensivasDe } from './internacao.controller.js';
import { PORTA_ADT, type PortaAdt } from './porta.js';
import { ServicoAdt } from './servico.js';
import { AVISOS_ADT } from './simbolos.js';
import { type GravadorNir, PORTA_NIR, type PortaNir } from './nir-porta.js';
import { type ParametrosNir, ServicoNir } from './nir-servico.js';

/** As ações da tela do NIR e a permissão de agir de cada uma (vale também no servidor). */
const ACOES_NIR: Readonly<Record<string, string>> = {
  solicitar: P.solicitacaoCriar,
  analisar: P.solicitacaoPriorizar,
  priorizar: P.solicitacaoPriorizar,
  transito: P.solicitacaoAtender,
  cancelar: P.solicitacaoCancelar,
  rejeitar: P.solicitacaoCancelar,
  reservar: P.reservaCriar,
  confirmarReserva: P.reservaConfirmar,
  cancelarReserva: P.reservaCancelar,
  excecao: P.reservaExcecao,
  dpa: P.altaPrevistaEditar,
  barreira: P.barreiraRegistrar,
  resolverBarreira: P.barreiraResolver,
  limite: P.parametroEditar,
  depara: P.parametroEditar,
  // W0-07
  corrigir: P.solicitacaoPriorizar,
  excluir: P.solicitacaoCancelar,
  alterarReserva: P.reservaCriar,
  excluirReserva: P.reservaCancelar,
  retirarDpa: P.altaPrevistaEditar,
  alterarBarreira: P.barreiraRegistrar,
  encerrarBarreira: P.barreiraResolver,
  removerLimite: P.parametroEditar,
};

const ok = (id: number, mensagem: string): ResultadoNir => ({ ok: true, id, mensagem });

@Controller('nir')
export class NirController {
  private readonly apoio: ApoioGravacao<GravadorNir>;
  private readonly servicoAdt: ServicoAdt;
  private readonly servico: ServicoNir;

  constructor(
    @Inject(PORTA_NIR) private readonly porta: PortaNir,
    @Inject(PORTA_ADT) private readonly portaAdt: PortaAdt,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(PORTA_ATENDIMENTO) private readonly atendimento: PortaAtendimento | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(CONFIGURACAO_M16) private readonly cfg16: ConfiguracaoM16 | null = null,
    @Optional() @Inject(AVISOS_ADT) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
  ) {
    this.apoio = new ApoioGravacaoIdempotente<GravadorNir>(
      { chave: CHAVE_LIBERACAO_NIR, nome: 'o NIR', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.servicoAdt = new ServicoAdt(portaAdt, janelaOutroSistema(configuracao));
    this.servico = new ServicoNir(porta, this.servicoAdt, portaAdt);
  }

  private exigir(s: SessaoCadastro, permissao: string): void {
    if (!s.pode(permissao))
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.', {
        codigo: 'sem-permissao',
      });
  }

  /** Ato médico (regra 9; ATO-01): o vínculo da sessão de médico com o conselho ativo. */
  private async exigirMedico(s: SessaoCadastro, acao: string) {
    const prof = await this.portaAdt.profissional(ctxAdt(s), s.login).catch(() => null);
    if (!prof?.conselhoAtivo || !ehMedico(prof.codigoCbo))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Ato médico',
        `${acao} é ato médico: só médico com o conselho ativo registra.`,
        { codigo: 'ato-medico' },
      );
    return prof;
  }

  private avisar(s: SessaoCadastro): void {
    this.avisos?.avisar(s.hospital);
  }

  private async parametros(s: SessaoCadastro): Promise<ParametrosNir> {
    const valor = async (chave: string, padrao: number) => (await this.apoio.parametro(s, chave)) || padrao;
    const prazos = {} as Record<PrioridadeNir, number>;
    for (const p of PRIORIDADES_NIR)
      prazos[p.codigo] = await valor(PARAMETRO_PRAZO_NIR[p.codigo], PRAZOS_PADRAO_NIR[p.codigo]);
    return {
      prazos,
      validadeReservaMin: await valor(PARAMETRO_VALIDADE_RESERVA, 120),
      amareloDias: await valor(PARAMETRO_PERMANENCIA_AMARELO, 7),
      vermelhoDias: await valor(PARAMETRO_PERMANENCIA_VERMELHO, 10),
      intensivas: await intensivasDe(this.cfg16, s),
    };
  }

  // ── Leituras ──

  @Get('gravacao')
  @Permissao(P.solicitacaoLer)
  async gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoNir & { medico: boolean }> {
    const s = sessaoDe(req);
    const [g, prof] = await Promise.all([
      this.apoio.gravacao(s, ACOES_NIR),
      this.portaAdt.profissional(ctxAdt(s), s.login).catch(() => null),
    ]);
    const medico = !!prof?.conselhoAtivo && ehMedico(prof.codigoCbo);
    const operacoes = { ...g.operacoes };
    for (const a of ['solicitar', 'dpa', 'retirarDpa'] as const)
      if (operacoes[a]?.pode && !medico)
        operacoes[a] = {
          pode: false,
          motivo: 'É ato médico: a sessão precisa do vínculo de médico com o conselho ativo.',
        };
    return { ligada: g.ligada, motivo: g.motivo, operacoes, medico };
  }

  @Get('fila')
  @Permissao(P.solicitacaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.nirFilaLida.codigo)
  fila(@Req() req: RequisicaoAutorizada) {
    return this.servico.fila(ctxAdt(sessaoDe(req)));
  }

  @Get('eventos')
  @Permissao(P.solicitacaoLer)
  eventos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(
      req,
      res,
      sessaoDe(req).hospital,
      P.solicitacaoLer,
      this.resolvedor,
      this.batidaMs,
    );
  }

  @Get('origens')
  @Permissao(P.solicitacaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.nirFilaLida.codigo)
  async origens(@Req() req: RequisicaoAutorizada): Promise<OrigensNir> {
    const s = sessaoDe(req);
    const c = ctxAdt(s);
    const { hoje } = await this.porta.relogio(c);
    const [pa, internados, cirurgias, tiposAcomodacao] = await Promise.all([
      this.atendimento ? this.atendimento.paAbertos(c, { hoje }).catch(() => ({ itens: [] })) : { itens: [] },
      this.portaAdt.internacoes(c, { intensivas: [], situacao: 'internados' }).catch(() => ({ itens: [] })),
      this.porta.cirurgiasUti(c).catch(() => []),
      intensivasDe(this.cfg16, s)
        .then((i) => this.servico.tiposAcomodacao(c, i))
        .catch(() => []),
    ]);
    return {
      pa: pa.itens
        .filter((a) => a.saida === null)
        .map((a) => ({ atendimento: a.reg, nome: a.paciente, chegada: a.chegada, senha: a.senha })),
      internados: internados.itens.map((i) => ({
        internacao: i.reg,
        paciente: i.paciente,
        nome: i.nome,
        leito: `${i.leito.bloco} ${i.leito.acomodacao} ${i.leito.leito}`,
      })),
      cirurgias: cirurgias.map((x) => ({
        agendamento: x.agendamento,
        paciente: x.paciente,
        nome: x.nome,
        dataHora: x.dataHora,
      })),
      tiposAcomodacao,
    };
  }

  @Get('solicitacoes/:id/leitos')
  @Permissao(P.reservaLer)
  async leitos(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.servico.leitosCompativeis(ctxAdt(s), idDaRota(id), await intensivasDe(this.cfg16, s));
  }

  @Get('reservas')
  @Permissao(P.reservaLer)
  reservas(@Req() req: RequisicaoAutorizada) {
    return this.servico.reservas(ctxAdt(sessaoDe(req)));
  }

  @Get('altas-previstas')
  @Permissao(P.altaPrevistaLer)
  @Auditar(EVENTOS_AUDITAVEIS.nirFilaLida.codigo)
  async altasPrevistas(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.servico.internados(ctxAdt(s), await this.parametros(s));
  }

  @Get('permanencia')
  @Permissao(P.permanenciaLer)
  @Auditar(EVENTOS_AUDITAVEIS.nirFilaLida.codigo)
  async permanencia(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.servico.quadro(ctxAdt(s), await this.parametros(s));
  }

  @Get('permanencia/calibragem')
  @Permissao(P.permanenciaLer)
  async calibragem(
    @Req() req: RequisicaoAutorizada,
    @Query('escopo') escopo?: string,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    const s = sessaoDe(req);
    const e = (ESCOPOS_LIMITE_PERMANENCIA as readonly string[]).includes(escopo ?? '')
      ? (escopo as EscopoLimitePermanencia)
      : 'clinica';
    const data = (v: string | undefined, padrao: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : padrao);
    const { hoje } = await this.porta.relogio(ctxAdt(s));
    return this.servico.calibragem(ctxAdt(s), {
      escopo: e,
      inicio: data(inicio, '2020-01-01'),
      fim: data(fim, hoje),
      intensivas: await intensivasDe(this.cfg16, s),
    });
  }

  @Get('situacoes')
  @Permissao(P.solicitacaoLer)
  situacoes(@Req() req: RequisicaoAutorizada) {
    return this.servico.situacoesDepara(ctxAdt(sessaoDe(req)));
  }

  // ── Gravações (com a trilha de auditoria na mesma transação) ──

  @Post('solicitacoes')
  @HttpCode(201)
  @Permissao(P.solicitacaoCriar)
  @AuditadoNoHandler('internacao.solicitarLeito (pedido_leito) com a trilha de auditoria na mesma transação')
  async solicitar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSolicitarLeito, b);
    const prof = await this.exigirMedico(s, 'A indicação de internação');
    const c = ctxAdt(s);
    // O paciente sai do atendimento do PA, da internação ou da cirurgia (nunca só do que a tela mandou).
    let paciente = e.paciente ?? null;
    let cabecalho: string | null = null;
    if (e.origem === 'pa' && e.atendimento) {
      const d = this.atendimento ? await this.atendimento.detalhe(c, e.atendimento).catch(() => null) : null;
      if (!d?.paciente.id)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Atendimento não encontrado',
          'O atendimento do PA não existe.',
        );
      paciente = d.paciente.id;
      cabecalho = d.cabecalho ?? null;
    }
    if (e.origem === 'internado' && e.internacao) {
      const d = await this.portaAdt.detalhe(c, e.internacao, []).catch(() => null);
      if (!d || d.resumo.alta !== null)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Internação não encontrada',
          'A internação não está aberta.',
        );
      paciente = d.resumo.paciente;
    }
    if (e.paciente && paciente !== e.paciente)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Paciente diferente',
        'O paciente não é o do atendimento.',
        {
          campos: ['paciente'],
        },
      );
    if (!paciente)
      throw new ErroProblema('entrada-invalida', 422, 'Paciente', 'Escolha o paciente.', {
        campos: ['paciente'],
      });
    const p = await this.parametros(s);
    const depara = await this.servico.deparaLinhas(c);
    const id = await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirSolicitacaoCriada.codigo,
      'internacao.solicitacaoLeito.criar',
      (x: number) => ({
        tabela: 'pedido_leito',
        id: String(x),
        paciente,
        chave: `${e.origem}:${e.prioridade}`,
      }),
      (g) =>
        g.solicitar({
          origem: e.origem,
          paciente: paciente as number,
          atendimento: e.atendimento ?? null,
          cabecalho,
          internacao: e.internacao ?? null,
          cirurgia: e.cirurgia ?? null,
          prioridade: e.prioridade,
          prazoMin: p.prazos[e.prioridade],
          perfil: e.perfil,
          clinica: e.clinica,
          especialidade: e.especialidade ?? null,
          cid: e.cid ?? null,
          justificativa: e.justificativa,
          situacaoCodigo: situacaoEquivalente('solicitado', depara)?.codigo ?? null,
          vinculo: prof.vinculo,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(id, 'Solicitação de leito enviada ao NIR.');
  }

  @Post('solicitacoes/:id/transicoes')
  @HttpCode(200)
  @Permissao(P.solicitacaoLer)
  @AuditadoNoHandler(
    'internacao.transicionarSolicitacao (pedido_leito) com a trilha de auditoria na mesma transação',
  )
  async transicionar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaTransicionarSolicitacao, b);
    this.exigir(s, ACOES_NIR[e.acao] as string);
    const c = ctxAdt(s);
    const sol = await this.servico.solicitacaoAberta(c, idDaRota(id));
    if (sol.estado !== e.estadoVisto)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Solicitação mudou',
        'A solicitação mudou depois que você abriu (outra pessoa agiu nela). Abra a fila de novo.',
        { codigo: 'solicitacao-desatualizada' },
      );
    const t = transicao(sol.estado, e.acao);
    if (!t.ok)
      throw new ErroProblema('recusa-de-negocio', 409, 'Transição recusada', t.motivo, { codigo: t.codigo });
    const p = await this.parametros(s);
    const depara = await this.servico.deparaLinhas(c);
    const reservas = await this.porta.reservasVigentes(c);
    const reserva = reservas.find((r) => r.solicitacao === sol.id) ?? null;
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirSolicitacaoTransicao.codigo,
      ACOES_NIR[e.acao] as string,
      {
        tabela: 'pedido_leito',
        id: String(sol.id),
        paciente: sol.paciente,
        chave: `${t.de}>${t.para}`,
      },
      async (g) => {
        // Cancelar ou rejeitar com o leito reservado: a reserva é cancelada na mesma transação (o leito volta a livre).
        if ((t.para === 'cancelado' || t.para === 'rejeitado') && reserva)
          await g.encerrarReserva({
            reserva: reserva.id,
            situacao: 'cancelada',
            motivo:
              `Solicitação ${t.para === 'cancelado' ? 'cancelada' : 'rejeitada'}: ${e.motivo ?? ''}`.slice(
                0,
                300,
              ),
            usuario: s.login,
          });
        return g.transicionar({
          solicitacao: sol.id,
          acao: e.acao,
          de: t.de,
          para: t.para,
          prioridade: e.acao === 'priorizar' ? (e.prioridade ?? null) : null,
          prazoMinDesdeOPedido: e.acao === 'priorizar' && e.prioridade ? p.prazos[e.prioridade] : null,
          motivo: e.motivo ?? null,
          situacaoCodigo: situacaoEquivalente(t.para, depara)?.codigo ?? null,
          reserva: reserva?.id ?? null,
          usuario: s.login,
        });
      },
    );
    this.avisar(s);
    return ok(sol.id, e.acao === 'priorizar' ? 'Prioridade alterada.' : 'Solicitação atualizada.');
  }

  @Post('reservas')
  @HttpCode(201)
  @Permissao(P.reservaCriar)
  @AuditadoNoHandler(
    'internacao.registrarReserva (reserva_leito) com a trilha de auditoria na mesma transação',
  )
  async reservar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarReserva, b);
    const c = ctxAdt(s);
    if (e.excecao) {
      this.exigir(s, P.reservaExcecao);
      if (!this.sessoes || !this.resolvedor)
        throw new ErroProblema('nao-autenticado', 401, 'Confirme a senha', 'Entre com o seu usuário.');
      await reautenticar(this.sessoes, this.resolvedor, req, e.senha ?? '');
    }
    const sol = await this.servico.solicitacaoAberta(c, e.solicitacao);
    const t = transicao(sol.estado, 'reservar');
    if (!t.ok)
      throw new ErroProblema('recusa-de-negocio', 409, 'Reserva recusada', t.motivo, { codigo: t.codigo });
    const p = await this.parametros(s);
    const chave = this.servico.chaveDe(e.leito);
    const leito = await this.servico.leitoParaReserva(c, chave, p.intensivas);
    const [pac, { hoje }] = await Promise.all([
      this.portaAdt.pacienteParaLeito(c, { paciente: sol.paciente }),
      this.porta.relogio(c),
    ]);
    const decisao = decidirReserva(
      leito,
      { intensiva: sol.intensiva, precaucao: sol.precaucao, tiposAcomodacao: sol.tiposAcomodacao },
      { sexo: pac?.sexo ?? sol.sexo, idade: idadeEmAnos(pac?.nascimento ?? sol.nascimento, hoje) },
      e.excecao ?? null,
    );
    if (!decisao.ok)
      throw new ErroProblema('recusa-de-negocio', 409, 'Leito recusado', decisao.motivo, {
        codigo: decisao.codigo,
        campos: ['leito'],
      });
    const depara = await this.servico.deparaLinhas(c);
    const id = await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirReservaRegistrada.codigo,
      P.reservaCriar,
      (x: number) => ({ tabela: 'reserva_leito', id: String(x), paciente: sol.paciente, chave }),
      async (g) => {
        const reserva = await g.reservar({
          solicitacao: sol.id,
          leito: e.leito,
          validadeMin: e.validadeMin ?? p.validadeReservaMin,
          excecao: decisao.comExcecao ? (e.excecao ?? null) : null,
          usuario: s.login,
        });
        await g.transicionar({
          solicitacao: sol.id,
          acao: 'reservar',
          de: t.de,
          para: 'reservado',
          situacaoCodigo: situacaoEquivalente('reservado', depara)?.codigo ?? null,
          reserva,
          motivo: decisao.comExcecao ? 'Exceção ao perfil autorizada pelo supervisor' : null,
          usuario: s.login,
        });
        return reserva;
      },
    );
    this.avisar(s);
    return ok(id, 'Leito reservado.');
  }

  @Post('reservas/:id/confirmar')
  @HttpCode(200)
  @Permissao(P.reservaConfirmar)
  @AuditadoNoHandler(
    'internacao.confirmarReserva (reserva_leito) com a trilha de auditoria na mesma transação',
  )
  async confirmar(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const reserva = idDaRota(id);
    const p = await this.parametros(s);
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirReservaConfirmada.codigo,
      P.reservaConfirmar,
      { tabela: 'reserva_leito', id: String(reserva) },
      (g) => g.confirmarReserva({ reserva, validadeMin: p.validadeReservaMin, usuario: s.login }),
    );
    this.avisar(s);
    return ok(reserva, 'Reserva confirmada.');
  }

  @Post('reservas/:id/cancelar')
  @HttpCode(200)
  @Permissao(P.reservaCancelar)
  @AuditadoNoHandler(
    'internacao.cancelarReserva (reserva_leito) com a trilha de auditoria na mesma transação',
  )
  async cancelarReserva(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarReserva, b);
    const c = ctxAdt(s);
    const reserva = (await this.porta.reservasVigentes(c)).find((r) => r.id === idDaRota(id));
    if (!reserva)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Reserva encerrada',
        'A reserva já não está vigente.',
        {
          codigo: 'reserva-desatualizada',
        },
      );
    const sol = await this.servico.solicitacaoAberta(c, reserva.solicitacao);
    const depara = await this.servico.deparaLinhas(c);
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirReservaCancelada.codigo,
      P.reservaCancelar,
      { tabela: 'reserva_leito', id: String(reserva.id), paciente: sol.paciente },
      async (g) => {
        const n = await g.encerrarReserva({
          reserva: reserva.id,
          situacao: 'cancelada',
          motivo: e.motivo,
          usuario: s.login,
        });
        if (n === 0)
          throw new ErroProblema(
            'recusa-de-negocio',
            409,
            'Reserva encerrada',
            'A reserva já não está vigente.',
            {
              codigo: 'reserva-desatualizada',
            },
          );
        // A reservada ou a a caminho volta à análise (regra 11): nunca fica em trânsito sem leito.
        if (transicao(sol.estado, 'liberarReserva').ok)
          await g.transicionar({
            solicitacao: sol.id,
            acao: 'liberarReserva',
            de: sol.estado,
            para: 'em_analise',
            situacaoCodigo: situacaoEquivalente('em_analise', depara)?.codigo ?? null,
            reserva: reserva.id,
            motivo: e.motivo,
            usuario: s.login,
          });
        return n;
      },
    );
    this.avisar(s);
    return ok(reserva.id, 'Reserva cancelada: a solicitação voltou à análise.');
  }

  @Post('dpa')
  @HttpCode(201)
  @Permissao(P.altaPrevistaEditar)
  @AuditadoNoHandler('internacao.registrarDpa (previsao_alta) com a trilha de auditoria na mesma transação')
  async dpa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarDpa, b);
    const prof = await this.exigirMedico(s, 'A alta prevista');
    const c = ctxAdt(s);
    const i = await this.porta.internacao(c, e.internacao);
    if (!i?.internado)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Internação encerrada',
        'A internação não está aberta.',
        {
          codigo: 'internacao-com-alta',
        },
      );
    const { hoje } = await this.porta.relogio(c);
    if (e.data < hoje)
      throw new ErroProblema('entrada-invalida', 422, 'Data passada', 'A alta prevista é hoje ou depois.', {
        campos: ['data'],
      });
    const id = await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirDpaAlterada.codigo,
      P.altaPrevistaEditar,
      (x: number) => ({
        tabela: 'previsao_alta',
        id: String(x),
        chave: `${i.reg}:${e.anterior ? 'mudanca' : 'inicial'}`,
      }),
      (g) =>
        g.registrarDpa({
          reg: i.reg,
          pront: i.pront,
          data: e.data,
          anterior: e.anterior,
          motivo: e.motivo ?? null,
          vinculo: prof.vinculo,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(id, 'Alta prevista registrada.');
  }

  @Post('barreiras')
  @HttpCode(201)
  @Permissao(P.barreiraRegistrar)
  @AuditadoNoHandler(
    'internacao.registrarBarreiraAlta (barreira_alta) com a trilha de auditoria na mesma transação',
  )
  async barreira(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarBarreira, b);
    const c = ctxAdt(s);
    const i = await this.porta.internacao(c, e.internacao);
    if (!i?.internado)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Internação encerrada',
        'A internação não está aberta.',
        {
          codigo: 'internacao-com-alta',
        },
      );
    const id = await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirBarreiraRegistrada.codigo,
      P.barreiraRegistrar,
      (x: number) => ({ tabela: 'barreira_alta', id: String(x), chave: `${i.reg}:${e.tipo}` }),
      (g) =>
        g.registrarBarreira({
          reg: i.reg,
          pront: i.pront,
          tipo: e.tipo,
          descricao: e.descricao,
          responsavel: e.responsavel,
          prazo: e.prazo,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(id, 'Barreira de alta registrada.');
  }

  @Post('barreiras/:id/resolver')
  @HttpCode(200)
  @Permissao(P.barreiraResolver)
  @AuditadoNoHandler(
    'internacao.resolverBarreiraAlta (barreira_alta) com a trilha de auditoria na mesma transação',
  )
  async resolver(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaResolverBarreira, b ?? {});
    const barreira = idDaRota(id);
    const x = await this.porta.barreira(ctxAdt(s), barreira);
    if (!x)
      throw new ErroProblema('nao-encontrado', 404, 'Barreira não encontrada', 'A barreira não existe.');
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirBarreiraResolvida.codigo,
      P.barreiraResolver,
      { tabela: 'barreira_alta', id: String(barreira), chave: `${x.reg}` },
      (g) =>
        g.resolverBarreira({
          barreira,
          cancelar: e.cancelar,
          observacao: e.observacao ?? null,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(barreira, e.cancelar ? 'Barreira cancelada.' : 'Barreira resolvida.');
  }

  @Post('limites')
  @HttpCode(200)
  @Permissao(P.parametroEditar)
  @AuditadoNoHandler(
    'internacao.registrarLimitePermanencia (limite_permanencia) com a trilha de auditoria na mesma transação',
  )
  async limite(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarLimite, b);
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirLimiteDefinido.codigo,
      P.parametroEditar,
      { tabela: 'limite_permanencia', chave: `${e.escopo}:${e.chave}` },
      (g) =>
        g.gravarLimite({
          escopo: e.escopo,
          chave: e.chave,
          amareloDias: e.amareloDias,
          vermelhoDias: e.vermelhoDias,
          origem: e.origem,
          amostra: e.amostra ?? null,
          motivo: e.motivo ?? null,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(0, 'Limite de permanência definido.');
  }

  @Post('situacoes/:id/aprovar')
  @HttpCode(200)
  @Permissao(P.parametroEditar)
  @AuditadoNoHandler(
    'internacao.aprovarDeparaSituacao (situacao_pedido_leito) com a trilha de auditoria na mesma transação',
  )
  async aprovar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAprovarDepara, b);
    const situacao = idDaRota(id);
    if (situacao < 1 || situacao > 23)
      throw new ErroProblema('nao-encontrado', 404, 'Situação não encontrada', 'A situação não existe.');
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirDeparaAprovado.codigo,
      P.parametroEditar,
      { tabela: 'situacao_pedido_leito', id: String(situacao), chave: `${situacao}>${e.estado}` },
      (g) =>
        g.aprovarDepara({ situacao, estado: e.estado, observacao: e.observacao ?? null, usuario: s.login }),
    );
    return ok(situacao, 'De-para aprovado.');
  }

  // ── W0-07: correção, alteração e exclusão (programa CRUD completo) ──

  @Post('solicitacoes/:id/corrigir')
  @HttpCode(200)
  @Permissao(P.solicitacaoPriorizar)
  @AuditadoNoHandler(
    'correção da solicitação de leito (pedido_leito) com a trilha de auditoria na mesma transação',
  )
  async corrigir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCorrigirSolicitacao, b);
    const sol = await this.servico.solicitacaoAberta(ctxAdt(s), idDaRota(id));
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirSolicitacaoTransicao.codigo,
      P.solicitacaoPriorizar,
      { tabela: 'pedido_leito', id: String(sol.id), paciente: sol.paciente, chave: 'corrigir' },
      (g) =>
        g.corrigirSolicitacao({
          solicitacao: sol.id,
          versaoVista: e.versaoVista,
          perfil: e.perfil,
          recursos: e.recursos,
          observacao: e.observacao,
          motivo: e.motivo,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(sol.id, 'Solicitação corrigida.');
  }

  @Post('solicitacoes/:id/excluir')
  @HttpCode(200)
  @Permissao(P.solicitacaoCancelar)
  @AuditadoNoHandler(
    'exclusão da solicitação criada por engano (pedido_leito, retrato na trilha de auditoria) com a trilha de auditoria na mesma transação',
  )
  async excluir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaExcluirSolicitacao, b);
    if (!this.sessoes || !this.resolvedor)
      throw new ErroProblema('nao-autenticado', 401, 'Confirme a senha', 'Entre com o seu usuário.');
    await reautenticar(this.sessoes, this.resolvedor, req, e.senha);
    const sol = await this.servico.solicitacaoAberta(ctxAdt(s), idDaRota(id));
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirSolicitacaoTransicao.codigo,
      P.solicitacaoCancelar,
      { tabela: 'pedido_leito', id: String(sol.id), paciente: sol.paciente, chave: 'excluir' },
      (g) => g.excluirSolicitacao({ solicitacao: sol.id, motivo: e.motivo, usuario: s.login }),
    );
    this.avisar(s);
    return ok(sol.id, 'Solicitação excluída (criada por engano).');
  }

  /** A reserva pelo número, vigente ou encerrada; a convertida em internação recusa 409 antes de gravar. */
  private async reservaParaMudar(s: SessaoCadastro, id: number) {
    const c = ctxAdt(s);
    const [vigentes, encerradas] = await Promise.all([
      this.porta.reservasVigentes(c),
      this.porta.reservasEncerradas(c),
    ]);
    const r = [...vigentes, ...encerradas].find((x) => x.id === id);
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Reserva não encontrada', 'A reserva não existe.');
    if (r.situacao === 'consumida')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Reserva convertida',
        'A reserva já virou internação: não se altera nem se retira (corrija pela internação).',
        { codigo: 'reserva-convertida' },
      );
    return r;
  }

  @Post('reservas/:id/alterar')
  @HttpCode(200)
  @Permissao(P.reservaCriar)
  @AuditadoNoHandler('alteração da reserva (reserva_leito) com a trilha de auditoria na mesma transação')
  async alterarReserva(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarReserva, b);
    const c = ctxAdt(s);
    const r = await this.reservaParaMudar(s, idDaRota(id));
    const sol = await this.servico.solicitacaoAberta(c, r.solicitacao);
    if (e.leito) {
      // O leito novo segue o perfil da solicitação, como na reserva (sem exceção: a exceção pede reservar de novo).
      const p = await this.parametros(s);
      const chave = this.servico.chaveDe(e.leito);
      const leito = await this.servico.leitoParaReserva(c, chave, p.intensivas);
      const [pac, { hoje }] = await Promise.all([
        this.portaAdt.pacienteParaLeito(c, { paciente: sol.paciente }),
        this.porta.relogio(c),
      ]);
      const decisao = decidirReserva(
        leito,
        { intensiva: sol.intensiva, precaucao: sol.precaucao, tiposAcomodacao: sol.tiposAcomodacao },
        { sexo: pac?.sexo ?? sol.sexo, idade: idadeEmAnos(pac?.nascimento ?? sol.nascimento, hoje) },
        null,
      );
      if (!decisao.ok)
        throw new ErroProblema('recusa-de-negocio', 409, 'Leito recusado', decisao.motivo, {
          codigo: decisao.codigo,
          campos: ['leito'],
        });
    }
    const y = await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirReservaRegistrada.codigo,
      P.reservaCriar,
      { tabela: 'reserva_leito', id: String(r.id), paciente: sol.paciente, chave: 'alterar' },
      (g) =>
        g.alterarReserva({
          reserva: r.id,
          leito: e.leito ?? null,
          validadeMin: e.validadeMin ?? null,
          motivo: e.motivo,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(
      r.id,
      y.confirmacaoDesfeita
        ? 'Reserva alterada (só no novo). O leito mudou: a reserva volta a aguardar a confirmação do setor.'
        : 'Reserva alterada (só no novo).',
    );
  }

  @Post('reservas/:id/excluir')
  @HttpCode(200)
  @Permissao(P.reservaCancelar)
  @AuditadoNoHandler(
    'exclusão da reserva criada por engano (reserva_leito, retrato na trilha de auditoria) com a trilha de auditoria na mesma transação',
  )
  async excluirReserva(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaExcluirReserva, b);
    const c = ctxAdt(s);
    const r = await this.reservaParaMudar(s, idDaRota(id));
    const sol = await this.servico.solicitacaoAberta(c, r.solicitacao);
    const depara = await this.servico.deparaLinhas(c);
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirReservaCancelada.codigo,
      P.reservaCancelar,
      { tabela: 'reserva_leito', id: String(r.id), paciente: sol.paciente, chave: 'excluir' },
      async (g) => {
        const { retrato } = await g.excluirReserva({ reserva: r.id, motivo: e.motivo, usuario: s.login });
        // A solicitação reservada volta à análise na mesma transação (nunca fica reservada sem reserva). O evento
        // cita o número da reserva e o do retrato: o 'reservar' anterior aponta uma reserva que já não existe, e é
        // por esta referência que se acha a linha no histórico de exclusões.
        if (transicao(sol.estado, 'liberarReserva').ok)
          await g.transicionar({
            solicitacao: sol.id,
            acao: 'liberarReserva',
            de: sol.estado,
            para: 'em_analise',
            situacaoCodigo: situacaoEquivalente('em_analise', depara)?.codigo ?? null,
            reserva: null,
            motivo:
              `Reserva nº ${r.id} excluída (criada por engano; retrato nº ${retrato} no histórico de exclusões): ${e.motivo}`.slice(
                0,
                300,
              ),
            usuario: s.login,
          });
        return r.id;
      },
    );
    this.avisar(s);
    return ok(r.id, 'Reserva excluída: a solicitação voltou à análise.');
  }

  @Post('dpa/retirar')
  @HttpCode(201)
  @Permissao(P.altaPrevistaEditar)
  @AuditadoNoHandler(
    'retirada da alta prevista (previsao_alta, versão nova) com a trilha de auditoria na mesma transação',
  )
  async retirarDpa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRetirarDpa, b);
    const prof = await this.exigirMedico(s, 'A alta prevista');
    const i = await this.porta.internacao(ctxAdt(s), e.internacao);
    if (!i?.internado)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Internação encerrada',
        'A internação não está aberta.',
        { codigo: 'internacao-com-alta' },
      );
    const id = await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirDpaAlterada.codigo,
      P.altaPrevistaEditar,
      (x: number) => ({ tabela: 'previsao_alta', id: String(x), chave: `${i.reg}:retirada` }),
      (g) =>
        g.retirarDpa({
          reg: i.reg,
          anterior: e.anterior,
          motivo: e.motivo,
          vinculo: prof.vinculo,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(id, 'Alta prevista retirada.');
  }

  @Post('barreiras/:id/alterar')
  @HttpCode(200)
  @Permissao(P.barreiraRegistrar)
  @AuditadoNoHandler(
    'alteração da barreira de alta (barreira_alta) com a trilha de auditoria na mesma transação',
  )
  async alterarBarreira(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarBarreira, b);
    const barreira = idDaRota(id);
    const x = await this.porta.barreira(ctxAdt(s), barreira);
    if (!x)
      throw new ErroProblema('nao-encontrado', 404, 'Barreira não encontrada', 'A barreira não existe.');
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirBarreiraRegistrada.codigo,
      P.barreiraRegistrar,
      { tabela: 'barreira_alta', id: String(barreira), chave: `${x.reg}:alterar` },
      (g) =>
        g.alterarBarreira({
          barreira,
          descricao: e.descricao ?? null,
          responsavel: e.responsavel ?? null,
          prazo: e.prazo ?? null,
          motivo: e.motivo,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(barreira, 'Barreira alterada.');
  }

  @Post('barreiras/:id/encerrar')
  @HttpCode(200)
  @Permissao(P.barreiraResolver)
  @AuditadoNoHandler(
    'encerramento da barreira de alta (barreira_alta) com a trilha de auditoria na mesma transação',
  )
  async encerrarBarreira(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEncerrarBarreira, b);
    const barreira = idDaRota(id);
    const x = await this.porta.barreira(ctxAdt(s), barreira);
    if (!x)
      throw new ErroProblema('nao-encontrado', 404, 'Barreira não encontrada', 'A barreira não existe.');
    // A barreira nunca se apaga: encerrada, continua ligada à avaliação do serviço social que a abriu.
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirBarreiraResolvida.codigo,
      P.barreiraResolver,
      { tabela: 'barreira_alta', id: String(barreira), chave: `${x.reg}:${e.resultado}` },
      (g) =>
        g.resolverBarreira({
          barreira,
          cancelar: e.resultado === 'cancelada',
          observacao: e.motivo,
          usuario: s.login,
        }),
    );
    this.avisar(s);
    return ok(barreira, e.resultado === 'cancelada' ? 'Barreira cancelada.' : 'Barreira resolvida.');
  }

  @Post('limites/remover')
  @HttpCode(200)
  @Permissao(P.parametroEditar)
  @AuditadoNoHandler(
    'remoção do limite de permanência (limite_permanencia) com a trilha de auditoria na mesma transação',
  )
  async removerLimite(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRemoverLimite, b);
    await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.nirLimiteDefinido.codigo,
      P.parametroEditar,
      { tabela: 'limite_permanencia', chave: `${e.escopo}:${e.chave}:remover` },
      (g) => g.removerLimite({ escopo: e.escopo, chave: e.chave, motivo: e.motivo, usuario: s.login }),
    );
    this.avisar(s);
    return ok(0, 'Limite removido: vale o padrão.');
  }
}
