// Agência transfusional, etapa 1 (M47; ficha, seções 4, 5, 7 e 8; escopo comum às duas respostas da DP-21):
//   GET  /api/sadt/transfusao/itens                       os itens de hemoterapia da prescrição vigente a atender
//   GET  /api/sadt/transfusao/itens/:item                 o item com a proposta da requisição, os termos e a tipagem
//   GET  /api/sadt/transfusao/requisicoes                 a lista com o filtro (situação, urgência, período)
//   GET  /api/sadt/transfusao/requisicoes/:id             a requisição com a amostra, os atos, as tarefas de sinais e
//                                                         o horário da prescrição pendente (a tela à beira do leito)
//   POST /api/sadt/transfusao/requisicoes                 sadt.requisitarTransfusao (regra 1)
//   POST /api/sadt/transfusao/requisicoes/:id/cancelar    o cancelamento antes da transfusão
//   POST /api/sadt/transfusao/requisicoes/:id/alterar     W0-03: hemocomponente, volume e urgência antes do atendimento
//                                                         (a versão anterior legível; 409 depois)
//   POST /api/sadt/transfusao/atos/:id/adendo             W0-03: o adendo dos sinais digitados errado (o ato não muda)
//   POST /api/sadt/transfusao/requisicoes/:id/amostra     sadt.registrarAmostraTransfusional (pulseira lida)
//   POST /api/sadt/transfusao/requisicoes/:id/atos        o início com a dupla checagem (regras 2 e 3): com o horário
//                                                         pendente, enfermagem.checarAdministracao (cenário
//                                                         hemocomponente) com o ato na mesma transação; sem, só SGH_
//   POST /api/sadt/transfusao/atos/:id/sinais             os sinais aos 10 a 15 minutos e ao término (regra 4)
//   POST /api/sadt/transfusao/atos/:id/concluir           a conclusão ou a interrupção, com o ganho no balanço (regra 7)
//   POST /api/sadt/transfusao/atos/:id/reacao             sadt.registrarReacaoTransfusional (regra 5)
//   GET  /api/sadt/transfusao/hemovigilancia              as reações e os indicadores com numerador e denominador
//   GET  /api/sadt/transfusao/reacoes/:id/notificacao     os campos da notificação (só iniciais, sexo e idade)
//   POST /api/sadt/transfusao/reacoes/:id/notificacao     a notificação digitada no portal da vigilância (a data)
// Tudo pela chave `agencia.transfusao` (POL-3). Com a etapa 2 ligada (`agencia.completa`, DP-21; agência própria), o
// início confere a bolsa contra o estoque (liberada ou reservada para a requisição, a etiqueta igual à do recebimento)
// e a compatibilidade da agência (a tipagem liberada pela agência prevalece sobre a do cadastro; a prova cruzada das
// hemácias), dentro da transação também (`estoque`). O segundo profissional é autenticado na hora pelo serviço de sessão
// (a senha nunca é guardada nem registrada).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type AtoTransfusionalLido,
  classeDoHemocomponente,
  CODIGOS_ESTADO_REQUISICAO_TRANSFUSAO,
  esquemaAdendoAtoTransfusional,
  esquemaAlterarRequisicaoTransfusao,
  esquemaCancelarRequisicaoTransfusao,
  HEMOCOMPONENTES_VISTOS,
  MENSAGENS_CORRECAO_HEMO,
  esquemaConcluirTransfusao,
  esquemaFiltroTransfusao,
  esquemaIniciarTransfusao,
  esquemaNotificacaoEnviada,
  esquemaRegistrarAmostraTransfusional,
  esquemaRegistrarReacaoTransfusional,
  esquemaRegistrarSinaisTransfusao,
  esquemaRequisitarTransfusao,
  EVENTOS_AUDITAVEIS,
  ID_FATOR_RH,
  ID_GRUPO_ABO,
  PARAMETRO_BALANCO_HORA_CORTE,
  PERMISSOES_TRANSFUSAO_CODIGOS as P,
  type RequisicaoTransfusionalLida,
  URGENCIAS_TRANSFUSAO,
} from '@sgh/contratos';
import {
  categoriaPorCbo,
  conferirPulseira,
  horaDoCorte,
  janelaDoInstante,
  podeChecar,
} from '@sgh/dominio-enfermagem';
import {
  amostraValidaAte,
  camposNotificacao,
  CHAVE_AGENCIA_COMPLETA,
  CHAVE_AGENCIA_TRANSFUSAO,
  conferirBolsa,
  conferirBolsaDaAgenciaNoAto,
  conferirInicioTransfusao,
  conferirReacao,
  conferirRequisicao,
  gravacaoNoHorario,
  indicadoresHemovigilancia,
  medidaForaDaJanela,
  MENSAGENS_BOLSA,
  MENSAGENS_IMUNO,
  MENSAGENS_INICIO,
  MENSAGENS_REACAO,
  MENSAGENS_REQUISICAO,
  passosDoFluxo,
  prazoDaRequisicao,
  propostaDoItem,
  sinaisCompletos,
  sugestaoDeNotificacao,
  tarefasDoAto,
  tipagemDoReceptor,
} from '@sgh/dominio-sadt';
import type { ChecagemGravacao } from './tipos-vinculados.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
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
import { ApoiosEnfermagem } from './apoios.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { chaveDoPedido } from './sae.controller.js';

/** A chave do pedido quando a tela a mandou (a repetição é reconhecida); sem ela, a gravação segue sem chave. */
function chaveSeHouver(s: Parameters<typeof chaveDoPedido>[0]): string | null {
  try {
    return chaveDoPedido(s);
  } catch {
    return null;
  }
}
import { PORTA_AGENCIA, type PortaAgencia } from './agencia-porta.js';
import { type GravadorTransfusao, PORTA_TRANSFUSAO, type PortaTransfusao } from './transfusao-porta.js';

const E = EVENTOS_AUDITAVEIS;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** A permissão de conferir a transfusão (segundo profissional): a da agência ou a da dupla checagem do M25. */
const CONFERIR = ['sadt.transfusao.administrar', 'enfermagem.administracao.conferir'];

const recusaDominio = (
  titulo: string,
  codigos: readonly string[],
  mensagens: Readonly<Partial<Record<string, string>>>,
) =>
  new ErroProblema('recusa-de-negocio', 409, titulo, codigos.map((c) => mensagens[c] ?? c).join(' '), {
    codigo: codigos[0] ?? 'recusa',
    bloqueios: codigos,
  });

const urgenciaId = (u: string) => URGENCIAS_TRANSFUSAO.find((x) => x.codigo === u)?.id ?? 2;

function idade(nascimento: string | null, em: string): number | null {
  if (!nascimento) return null;
  const [a, m, d] = nascimento.split('-').map(Number) as [number, number, number];
  const [ea, em_, ed] = em.slice(0, 10).split('-').map(Number) as [number, number, number];
  return ea - a - (em_ < m || (em_ === m && ed < d) ? 1 : 0);
}

@Controller('sadt/transfusao')
export class TransfusaoController {
  private readonly log = new Logger('TransfusaoController');
  private readonly apoio: ApoioGravacao<GravadorTransfusao>;
  private readonly completa: ApoioGravacao<GravadorTransfusao>;
  private readonly apoios: ApoiosEnfermagem;

  constructor(
    @Inject(PORTA_TRANSFUSAO) private readonly porta: PortaTransfusao,
    @Inject(PORTA_ENFERMAGEM) private readonly enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(PORTA_AGENCIA) private readonly agencia: PortaAgencia | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      {
        chave: CHAVE_AGENCIA_TRANSFUSAO,
        nome: 'a agência transfusional (requisição, ato e hemovigilância)',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.completa = new ApoioGravacao(
      { chave: CHAVE_AGENCIA_COMPLETA, nome: 'a agência transfusional completa', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.apoios = new ApoiosEnfermagem(enfermagem, trilha, configuracao, cache);
  }

  private async agora(s: SessaoCadastro): Promise<string> {
    return (await this.enfermagem.relogio(s.porta)).slice(0, 19);
  }

  private async vinculo(s: SessaoCadastro) {
    const vs = await this.enfermagem.vinculos(s.porta, s.login).catch(() => []);
    const v = vs.find((x) => categoriaPorCbo(x.codigo) === 'enfermeiro') ?? vs[0] ?? null;
    return { vinculo: v, categoria: v ? categoriaPorCbo(v.codigo) : ('outro' as const) };
  }

  /** O estado da gravação para a tela: a liberação, as ações por permissão e os passos do fluxo (DP-21). */
  private async gravacao(s: SessaoCadastro) {
    const [l, c] = await Promise.all([this.apoio.liberacao(s), this.completa.liberacao(s)]);
    const pode = (perm: string) => l.ligada && s.pode(perm);
    return {
      ligada: l.ligada,
      motivo: l.motivo,
      agenciaCompleta: c.ligada,
      passos: passosDoFluxo({ transfusaoLigada: l.ligada, agenciaCompleta: c.ligada }),
      acoes: {
        requisitar: pode(P.transfusaoRequisitar),
        cancelar: pode(P.transfusaoCancelar),
        alterar: pode(P.transfusaoRequisitar),
        adendo: pode(P.transfusaoAdministrar),
        amostra: pode(P.transfusaoRegistrarAmostra),
        administrar: pode(P.transfusaoAdministrar),
        reacao: pode(P.reacaoRegistrar),
      },
    };
  }

  private async requisicaoOu404(
    s: SessaoCadastro,
    id: number,
    agora: string,
  ): Promise<RequisicaoTransfusionalLida> {
    const r = await this.porta.requisicao(s.porta, id, agora);
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Requisição não encontrada');
    return r;
  }

  private async atoOu404(s: SessaoCadastro, id: number): Promise<AtoTransfusionalLido> {
    const [a] = await this.porta.atos(s.porta, { ato: id });
    if (!a) throw new ErroProblema('nao-encontrado', 404, 'Transfusão não encontrada');
    return a;
  }

  /** Os termos de consentimento assinados e vigentes (a última versão de cada um) do atendimento. */
  private async termosAssinados(s: SessaoCadastro, paciente: number, atendimento: number) {
    const ts = await this.porta.termos(s.porta, paciente);
    const substituidos = new Set(ts.map((t) => t.anterior).filter((x): x is number => x !== null));
    return ts
      .filter((t) => !substituidos.has(t.id) && t.situacao === 'assinado' && t.atendimento === atendimento)
      .map((t) => ({ id: t.id, procedimento: t.procedimento, em: t.em }));
  }

  /** O segundo profissional: a senha dele conferida e a permissão de conferir (a senha nunca é guardada). */
  private async conferente(s: SessaoCadastro, login: string, senha: string) {
    // A mesma pessoa nem chega a ser autenticada: o bloqueio é "segundo profissional igual".
    if (login.trim().toUpperCase() === s.login.trim().toUpperCase())
      return { login, autenticado: true, temPermissao: false };
    const id = this.resolvedor?.idSessao(s.req) ?? null;
    if (!this.sessoes || !id) return { login, autenticado: false, temPermissao: false };
    const r = await this.sessoes
      .conferirSegundoProfissional(id, this.resolvedor?.rede(s.req) ?? null, login, senha)
      .catch(() => ({ conferiu: false, permissoes: [] as readonly string[] }));
    return { login, autenticado: r.conferiu, temPermissao: r.permissoes.some((p) => CONFERIR.includes(p)) };
  }

  // ── Leituras ────────────────────────────────────────────────────────────────────────────────────

  @Get('itens')
  @Permissao(P.transfusaoLer)
  @Auditar(E.sadtTransfusaoLida.codigo)
  async itens(@Query('atendimento') atendimento: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const at = atendimento ? idDaRota(atendimento) : undefined;
    const [r, gravacao] = await Promise.all([
      this.porta.itensAAtender(s.porta, { agora, ...(at !== undefined ? { atendimento: at } : {}) }),
      this.gravacao(s),
    ]);
    // A lista mostra nome e registro: leitura de dado pessoal auditada (só a contagem no alvo).
    req.sghAlvo = { tabelaAlvo: 'prescricao_item', chaveNaturalAlvo: `itens:${String(r.itens.length)}` };
    return { ...r, agora, gravacao };
  }

  @Get('itens/:item')
  @Permissao(P.transfusaoLer)
  @Auditar(E.sadtTransfusaoLida.codigo)
  async item(@Param('item') item: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const i = await this.porta.item(s.porta, idDaRota(item), agora);
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Item de hemoterapia não encontrado');
    req.sghAlvo = { paciente: i.paciente.id, tabelaAlvo: 'prescricao_item', idAlvo: String(i.item) };
    const [termos, tipagem, horarios] = await Promise.all([
      this.termosAssinados(s, i.paciente.id, i.atendimento),
      this.porta.tipagem(s.porta, i.paciente.id),
      this.porta.horarios(s.porta, i.item),
    ]);
    return {
      item: i,
      proposta: propostaDoItem({ ...i, hemocomponente: i.hemocomponente.codigo }),
      termos,
      tipagem,
      horarios: horarios.length,
      agora,
    };
  }

  @Get('requisicoes')
  @Permissao(P.transfusaoLer)
  @Auditar(E.sadtTransfusaoLida.codigo)
  async requisicoes(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(
      esquemaFiltroTransfusao,
      Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '')),
    );
    const agora = await this.agora(s);
    const r = await this.porta.requisicoes(s.porta, {
      agora,
      ...(f.estado ? { estado: f.estado } : {}),
      ...(f.urgencia ? { urgencia: urgenciaId(f.urgencia) } : {}),
      ...(f.de ? { de: f.de } : {}),
      ...(f.ate ? { ate: f.ate } : {}),
      // O termo vai à leitura (antes do teto): `cortada` vale para a lista já filtrada.
      ...(f.termo?.trim() ? { termo: f.termo.trim() } : {}),
    });
    const itens = r.itens;
    req.sghAlvo = { tabelaAlvo: 'SGH_SADT_HEMO_REQ', chaveNaturalAlvo: `lista:${String(itens.length)}` };
    return { itens, cortada: r.cortada, agora, gravacao: await this.gravacao(s) };
  }

  @Get('requisicoes/:id')
  @Permissao(P.transfusaoLer)
  @Auditar(E.sadtTransfusaoLida.codigo)
  async requisicao(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const r = await this.requisicaoOu404(s, idDaRota(id), agora);
    req.sghAlvo = { paciente: r.paciente.id, tabelaAlvo: 'SGH_SADT_HEMO_REQ', idAlvo: String(r.id) };
    const [atos, horarios, gravacao, internado, versoes] = await Promise.all([
      this.porta.atos(s.porta, { requisicao: r.id }),
      this.porta.horarios(s.porta, r.item),
      this.gravacao(s),
      this.enfermagem.internado(s.porta, r.atendimento),
      this.porta.versoesRequisicao(s.porta, r.id),
    ]);
    const adendos = atos.length
      ? await this.porta.adendos(
          s.porta,
          atos.map((a) => a.id),
        )
      : [];
    const pendente = horarios.find((h) => h.situacao === 'P') ?? null;
    // Etapa 2 (agência própria): a tipagem que vale (a da agência prevalece) e as bolsas reservadas para a requisição.
    const agencia =
      this.agencia && gravacao.agenciaCompleta
        ? await Promise.all([
            this.agencia.resultadosDoPaciente(s.porta, r.paciente.id),
            this.agencia.estoque(s.porta, { agora: agora.slice(0, 16), situacao: 'reservada' }),
          ]).then(([res, est]) => ({
            receptor: tipagemDoReceptor(res, r.tipagem),
            reservadas: est.itens
              .filter((b) => b.reservadaPara?.requisicao === r.id)
              .map((b) => ({
                numero: b.numero,
                hemocomponente: b.hemocomponente.codigo,
                tipagem: b.tipagem,
                validade: b.validade,
                volumeMl: b.volumeMl,
              })),
          }))
        : null;
    return {
      requisicao: r,
      // W0-03: as versões anteriores (a original primeiro) e a vigente (a requisição acima, versão N + 1).
      versoes,
      versaoVigente: versoes.length + 1,
      agencia,
      agora,
      leito: internado ? { leito: internado.leito, unidade: internado.unidade } : null,
      horarioPendente: pendente ? { id: pendente.id, previsto: pendente.previsto } : null,
      gravacaoNoHorario: gravacaoNoHorario(pendente?.situacao ?? null),
      atos: atos.map((a) => ({
        ...a,
        adendos: adendos.filter((d) => d.ato === a.id),
        tarefas: tarefasDoAto({
          inicioEm: a.inicioEm,
          terminoEm: a.terminoEm,
          estado: a.estado,
          feitos: a.sinais.map((x) => x.momento),
          agora,
        }),
      })),
      gravacao,
    };
  }

  @Get('tarefas')
  @Permissao(P.transfusaoLer)
  @Auditar(E.sadtTransfusaoLida.codigo)
  async tarefas(@Query('unidade') unidade: string | undefined, @Req() req: RequisicaoAutorizada) {
    // Regra 4: as tarefas dos sinais das transfusões da unidade na linha do tempo do turno (em curso e as do dia com
    // medida pendente).
    const s = sessaoDe(req);
    const u = (unidade ?? '').trim();
    if (!/^[A-Za-z0-9 ._-]{1,5}$/.test(u))
      throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
    const agora = await this.agora(s);
    const ontem = new Date(Date.parse(`${agora.slice(0, 10)}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const [internados, atos, reqs] = await Promise.all([
      this.enfermagem.internados(s.porta, u),
      this.porta.atos(s.porta, { de: ontem }),
      this.porta.requisicoes(s.porta, { agora, de: ontem }),
    ]);
    const porAtendimento = new Map(internados.map((i) => [i.atendimento, i]));
    const porReq = new Map(reqs.itens.map((r) => [r.id, r]));
    const itens = atos
      .map((a) => {
        const r = porReq.get(a.requisicao);
        const i = r ? porAtendimento.get(r.atendimento) : undefined;
        if (!r || !i) return null;
        const tarefas = tarefasDoAto({
          inicioEm: a.inicioEm,
          terminoEm: a.terminoEm,
          estado: a.estado,
          feitos: a.sinais.map((x) => x.momento),
          agora,
        });
        if (a.estado !== 'emCurso' && sinaisCompletos(tarefas)) return null;
        return {
          ato: a.id,
          requisicao: a.requisicao,
          paciente: { nome: i.nome, leito: i.leito },
          bolsa: { numero: a.bolsa.numero, hemocomponente: a.bolsa.hemocomponente },
          estado: a.estado,
          inicioEm: a.inicioEm,
          tarefas,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_SADT_HEMO_ATO',
      chaveNaturalAlvo: `unidade:${u};n:${String(itens.length)}`,
    };
    return { unidade: u, agora, itens };
  }

  @Get('pacientes/:paciente/historico')
  @Permissao(P.transfusaoLer)
  @Auditar(E.sadtTransfusaoLida.codigo)
  async historico(@Param('paciente') paciente: string, @Req() req: RequisicaoAutorizada) {
    // A tipagem e o histórico transfusional do paciente (ficha, seção 4): a tipagem do cadastro (ponto de partida; a da
    // agência própria, etapa 2, prevalece) e os atos com a reação, mais recentes primeiro.
    const s = sessaoDe(req);
    const p = idDaRota(paciente);
    req.sghAlvo = { paciente: p, tabelaAlvo: 'SGH_SADT_HEMO_ATO' };
    const [tipagem, atos] = await Promise.all([
      this.porta.tipagem(s.porta, p),
      this.porta.atos(s.porta, { paciente: p }),
    ]);
    return {
      tipagem,
      origemTipagem: 'cadastro' as const,
      atos: atos.slice(0, 50).map((a) => ({
        id: a.id,
        requisicao: a.requisicao,
        bolsa: a.bolsa,
        estado: a.estado,
        inicioEm: a.inicioEm,
        terminoEm: a.terminoEm,
        volumeTransfundidoMl: a.volumeTransfundidoMl,
        reacao: a.reacao,
      })),
    };
  }

  // ── Requisição e amostra ────────────────────────────────────────────────────────────────────────

  @Post('requisicoes')
  @HttpCode(201)
  @Permissao(P.transfusaoRequisitar)
  @AuditadoNoHandler('sadt.requisitarTransfusao: SGH_SADT_HEMO_REQ com a SGH_TRILHA na mesma transação')
  async requisitar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRequisitarTransfusao, b);
    const chave = chaveDoPedido(s);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    // O reenvio com a mesma chave (a resposta perdida na rede) devolve a requisição gravada, antes das conferências.
    const jaFeita = await this.porta.gravadoPorChave(s.porta, {
      tipo: 'requisicao',
      chave,
      usuario: s.login,
    });
    if (jaFeita !== null) {
      const q = await this.porta.requisicao(s.porta, jaFeita, agora);
      return {
        ok: true,
        id: jaFeita,
        repetida: true,
        prazo: q?.prazo ?? null,
        mensagem: 'Requisição transfusional registrada.',
      };
    }
    const i = await this.porta.item(s.porta, e.itemHemoterapia, agora);
    if (!i || i.atendimento !== e.atendimento)
      throw new ErroProblema('nao-encontrado', 404, 'Item de hemoterapia não encontrado neste atendimento');
    const [termos, ja] = await Promise.all([
      this.termosAssinados(s, i.paciente.id, i.atendimento),
      this.porta.requisicoes(s.porta, { agora, atendimento: i.atendimento }),
    ]);
    const problemas = conferirRequisicao({
      item: { ...i, hemocomponente: i.hemocomponente.codigo },
      agora,
      urgencia: e.urgencia,
      programadaPara: e.programadaPara,
      indicacao: e.indicacao,
      termoAssinado: e.termo !== null && termos.some((t) => t.id === e.termo),
      justificativaUrgencia: e.justificativaUrgencia,
      requisicaoEmAberto: ja.itens.some(
        (x) => x.item === i.item && x.estado !== 'cancelada' && x.estado !== 'atendida',
      ),
    });
    if (problemas.length) throw recusaDominio('Requisição transfusional', problemas, MENSAGENS_REQUISICAO);
    const prazo = prazoDaRequisicao(e.urgencia, agora, e.programadaPara);
    const r = await this.apoio.sgh(
      s,
      E.sadtTransfusaoRequisitada.codigo,
      P.transfusaoRequisitar,
      (x: { id: number }) => ({
        tabela: 'SGH_SADT_HEMO_REQ',
        id: String(x.id),
        paciente: i.paciente.id,
        chave: `item:${i.item}`,
      }),
      (g) =>
        g.requisitar({
          item: i.item,
          prescricao: i.prescricao,
          atendimento: i.atendimento,
          paciente: i.paciente.id,
          hemocomponente: i.hemocomponente.codigo,
          quantidadeBolsas: e.quantidadeBolsas,
          volumeMl: e.volumeMl,
          urgencia: urgenciaId(e.urgencia),
          programadaPara: e.programadaPara,
          prazo,
          indicacao: e.indicacao,
          examesDeApoio: e.examesDeApoio,
          termo: e.termo,
          justificativaUrgencia: e.justificativaUrgencia,
          transfusaoAnterior: e.transfusaoAnterior,
          reacaoAnterior: e.reacaoAnterior,
          gestacaoAnterior: e.gestacaoAnterior,
          usuario: s.login,
          chave,
        }),
    );
    return {
      ok: true,
      id: r.id,
      repetida: r.repetida,
      prazo,
      mensagem: 'Requisição transfusional registrada.',
    };
  }

  @Post('requisicoes/:id/cancelar')
  @HttpCode(200)
  @Permissao(P.transfusaoCancelar)
  @AuditadoNoHandler('o cancelamento da requisição em SGH_SADT_HEMO_REQ com a SGH_TRILHA')
  async cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarRequisicaoTransfusao, { ...(b as object), requisicao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const r = await this.requisicaoOu404(s, e.requisicao, await this.agora(s));
    await this.apoio.sgh(
      s,
      E.sadtTransfusaoCancelada.codigo,
      P.transfusaoCancelar,
      { tabela: 'SGH_SADT_HEMO_REQ', id: String(r.id), paciente: r.paciente.id, chave: 'cancelada' },
      (g) => g.cancelar({ requisicao: r.id, motivo: e.motivo, usuario: s.login, chave: chaveSeHouver(s) }),
    );
    return { ok: true, id: r.id, mensagem: 'Requisição cancelada.' };
  }

  /**
   * W0-03 (matriz, linha "Hemoterapia"; RDC 34/2014 art. 15 §1º): a requisição se altera (hemocomponente, volume,
   * urgência) só antes do atendimento; a versão anterior fica legível em SGH_SADT_HEMO_REQ_VERSAO. Depois, 409. O prazo
   * é recalculado a partir da hora da requisição. O motivo fica na versão, nunca na trilha.
   */
  @Post('requisicoes/:id/alterar')
  @HttpCode(200)
  @Permissao(P.transfusaoRequisitar)
  @AuditadoNoHandler(
    'a alteração da requisição em SGH_SADT_HEMO_REQ e SGH_SADT_HEMO_REQ_VERSAO com a SGH_TRILHA',
  )
  async alterar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAlterarRequisicaoTransfusao, b);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const r = await this.requisicaoOu404(s, idDaRota(id), agora);
    const conflito = (codigo: string) =>
      new ErroProblema(
        'recusa-de-negocio',
        409,
        'Requisição transfusional',
        MENSAGENS_CORRECAO_HEMO[codigo] ?? codigo,
        {
          codigo,
        },
      );
    if (r.estado !== 'requisitada' && r.estado !== 'amostraColetada')
      throw conflito('requisicao-ja-atendida');
    const hemocomponente = e.hemocomponente ?? r.hemocomponente.codigo;
    if (!HEMOCOMPONENTES_VISTOS[hemocomponente])
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Hemocomponente',
        'Escolha um hemocomponente da lista.',
        {
          campos: ['hemocomponente'],
        },
      );
    const urgencia = e.urgencia ?? r.urgencia;
    const programadaPara =
      urgencia === 'programada'
        ? e.programadaPara !== undefined
          ? e.programadaPara
          : r.programadaPara
        : null;
    if (urgencia === 'programada' && !programadaPara) throw conflito('programada-sem-data');
    // Sem o termo, só a extrema urgência (com a justificativa) se sustenta.
    if (r.termo === null && urgencia !== 'extremaUrgencia') throw conflito('termo-obrigatorio');
    const prazo = prazoDaRequisicao(urgencia, r.requisitadaEm.slice(0, 19), programadaPara);
    const x = await this.apoio.sgh(
      s,
      E.sadtTransfusaoAlterada.codigo,
      P.transfusaoRequisitar,
      { tabela: 'SGH_SADT_HEMO_REQ', id: String(r.id), paciente: r.paciente.id, chave: 'alterada' },
      (g) =>
        g.alterar({
          requisicao: r.id,
          hemocomponente,
          volumeMl: e.volumeMl !== undefined ? e.volumeMl : r.volumeMl,
          urgencia: urgenciaId(urgencia),
          programadaPara,
          prazo,
          motivo: e.motivo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: r.id,
      versao: x.versao,
      prazo,
      mensagem: 'Requisição alterada; a versão anterior ficou guardada.',
    };
  }

  @Post('requisicoes/:id/amostra')
  @HttpCode(201)
  @Permissao(P.transfusaoRegistrarAmostra)
  @AuditadoNoHandler('sadt.registrarAmostraTransfusional: SGH_SADT_HEMO_AMOSTRA com a SGH_TRILHA')
  async amostra(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarAmostraTransfusional, { ...(b as object), requisicao: idDaRota(id) });
    const chave = chaveDoPedido(s);
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const r = await this.requisicaoOu404(s, e.requisicao, agora);
    if (e.coletadaEm.slice(0, 16) > agora.slice(0, 16))
      throw new ErroProblema('entrada-invalida', 422, 'Amostra', 'A hora da coleta não pode ser do futuro.', {
        campos: ['coletadaEm'],
      });
    // A pulseira na amostra é obrigatória; só a extrema urgência aceita o motivo de não ler (como na checagem). A
    // pulseira leva o número do atendimento (o da internação).
    const internado = await this.enfermagem.internado(s.porta, r.atendimento);
    const p = conferirPulseira({
      obrigatoria: r.urgencia !== 'extremaUrgencia',
      leitura: e.pulseira.lida
        ? { lida: true, codigo: e.pulseira.codigo }
        : { lida: false, motivo: e.pulseira.motivo },
      paciente: r.paciente.id,
      atendimento: internado?.numero ?? null,
    });
    if (!p.ok) throw new ErroProblema('recusa-de-negocio', 409, 'Pulseira', p.mensagem, { codigo: p.codigo });
    const x = await this.apoio.sgh(
      s,
      E.sadtAmostraTransfusionalColetada.codigo,
      P.transfusaoRegistrarAmostra,
      (a: { id: number }) => ({ tabela: 'SGH_SADT_HEMO_AMOSTRA', id: String(a.id), paciente: r.paciente.id }),
      (g) =>
        g.amostra({
          requisicao: r.id,
          pulseiraLida: e.pulseira.lida,
          motivoSemPulseira: e.pulseira.lida ? null : e.pulseira.motivo,
          coletadaEm: e.coletadaEm.slice(0, 16),
          validaAte: amostraValidaAte(e.coletadaEm).slice(0, 16),
          usuario: s.login,
          estacao: null,
          chave,
        }),
    );
    return {
      ok: true,
      id: x.id,
      codigo: x.codigo,
      validaAte: amostraValidaAte(e.coletadaEm),
      mensagem: `Amostra ${x.codigo} registrada: rotule o tubo com este código.`,
    };
  }

  // ── Ato transfusional ───────────────────────────────────────────────────────────────────────────

  /**
   * Etapa 2 (DP-21): com a `agencia.completa` ligada, a conferência da bolsa contra o estoque e a compatibilidade da
   * agência; desligada (ou sem a porta), null (a etapa 1 segue como hoje: a bolsa do hemocentro e a tipagem do cadastro).
   */
  private async conferenciaDaAgencia(
    s: SessaoCadastro,
    r: RequisicaoTransfusionalLida,
    etiqueta: {
      numero: string;
      hemocomponente: string;
      tipagem: { abo: 'A' | 'B' | 'AB' | 'O'; rh: 'positivo' | 'negativo' };
      validade: string;
    },
    agora: string,
  ) {
    if (!this.agencia || !(await this.completa.liberacao(s)).ligada) return null;
    const [estoque, resultados, cadastro, provas] = await Promise.all([
      this.agencia.bolsa(s.porta, { numero: etiqueta.numero }, agora.slice(0, 16)),
      this.agencia.resultadosDoPaciente(s.porta, r.paciente.id),
      this.porta.tipagem(s.porta, r.paciente.id),
      this.agencia.provas(s.porta, r.id),
    ]);
    const receptor = tipagemDoReceptor(resultados, cadastro);
    const conferencia = conferirBolsaDaAgenciaNoAto({
      bolsa: estoque
        ? {
            situacao: estoque.situacao,
            reservadaPara: estoque.reservadaPara?.requisicao ?? null,
            hemocomponente: estoque.hemocomponente.codigo,
            abo: estoque.tipagem.abo,
            rh: estoque.tipagem.rh,
            validade: estoque.validade,
          }
        : null,
      etiqueta: {
        numero: etiqueta.numero,
        hemocomponente: etiqueta.hemocomponente,
        abo: etiqueta.tipagem.abo,
        rh: etiqueta.tipagem.rh,
        validade: etiqueta.validade,
      },
      requisicao: r.id,
      classe: classeDoHemocomponente(r.hemocomponente.codigo),
      extremaUrgencia: r.urgencia === 'extremaUrgencia',
      receptor,
      provas,
    });
    return { receptor, conferencia };
  }

  @Post('requisicoes/:id/atos')
  @HttpCode(201)
  @Permissao(P.transfusaoAdministrar)
  @AuditadoNoHandler(
    'início da transfusão: com o horário pendente, enfermagem.checarAdministracao pelo executor com SGH_SADT_HEMO_ATO na mesma transação; sem, SGH_SADT_HEMO_ATO com a SGH_TRILHA; a recusa com TRANSFUSAO_BLOQUEADA',
  )
  async iniciar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaIniciarTransfusao, { ...(b as object), requisicao: idDaRota(id) });
    const chave = chaveDoPedido(s);
    // A chave da agência vale para os dois caminhos (com o horário pendente a gravação vai pela checagem do M25, que
    // só confere a chave dela): desligada, nada se lê nem se grava.
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const r = await this.requisicaoOu404(s, e.requisicao, agora);
    // O reenvio com a mesma chave (a resposta perdida na rede) devolve o ato gravado, antes das conferências: a bolsa
    // já aparece usada e o reenvio seria recusado (e iria à trilha como bloqueio).
    const atoFeito = await this.porta.gravadoPorChave(s.porta, { tipo: 'ato', chave, usuario: s.login });
    if (atoFeito !== null) {
      const [a] = await this.porta.atos(s.porta, { ato: atoFeito });
      return {
        ok: true,
        ato: atoFeito,
        repetida: true,
        alertas: (a?.alertas ?? []).map((x) => MENSAGENS_BOLSA[x as keyof typeof MENSAGENS_BOLSA] ?? x),
        horarioChecado: a?.horario ?? null,
        mensagem: 'Transfusão iniciada com a dupla checagem.',
      };
    }
    const v = await this.vinculo(s);
    if (!v.vinculo || !podeChecar(v.categoria))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Transfusão',
        'O ato transfusional é da enfermagem: a sessão não tem o vínculo de enfermeiro ou técnico.',
        { codigo: 'categoria-nao-checa' },
      );
    const [horarios, usada, segundo, tipagem, termos, internado] = await Promise.all([
      this.porta.horarios(s.porta, r.item),
      this.porta.bolsaUsada(s.porta, e.bolsa.numero),
      this.conferente(s, e.segundoProfissional.login, e.segundoProfissional.senha),
      this.porta.tipagem(s.porta, r.paciente.id),
      this.termosAssinados(s, r.paciente.id, r.atendimento),
      this.enfermagem.internado(s.porta, r.atendimento),
    ]);
    const pendente =
      e.horario !== null
        ? (horarios.find((h) => h.id === e.horario) ?? null)
        : (horarios.find((h) => h.situacao === 'P') ?? null);
    const pulseira = e.pulseira.lida
      ? conferirPulseira({
          obrigatoria: true,
          leitura: { lida: true, codigo: e.pulseira.codigo },
          paciente: r.paciente.id,
          atendimento: internado?.numero ?? null,
        })
      : null;
    const extrema = r.urgencia === 'extremaUrgencia';
    const classe = classeDoHemocomponente(r.hemocomponente.codigo);
    // Etapa 2 (agência própria): a bolsa conferida contra o estoque e a compatibilidade da agência; a tipagem liberada
    // pela agência prevalece sobre a do cadastro.
    const daAgencia = await this.conferenciaDaAgencia(s, r, e.bolsa, agora);
    const bolsa = conferirBolsa({
      classe,
      hemocomponenteRequisitado: r.hemocomponente.codigo,
      hemocomponenteDaBolsa: e.bolsa.hemocomponente,
      bolsa: e.bolsa.tipagem,
      receptor: daAgencia?.receptor.tipagem ?? tipagem,
      validade: e.bolsa.validade.slice(0, 19),
      agora,
      situacao: daAgencia?.conferencia.situacao ?? null,
      extremaUrgencia: extrema,
      justificativaRh: e.justificativaRh,
    });
    const k = conferirInicioTransfusao({
      agora,
      urgencia: r.urgencia,
      estadoRequisicao: r.estado,
      pacienteDaRequisicao: r.paciente.id,
      pacienteDaPulseira: pulseira === null ? null : pulseira.ok ? r.paciente.id : -1,
      profissional: s.login,
      segundoProfissional: segundo,
      amostraColetadaEm: r.amostra?.coletadaEm ?? null,
      termoAssinado: r.termo !== null && termos.some((t) => t.id === r.termo),
      sinaisAntesEm: agora,
      bolsa,
      bolsaJaUsada: usada,
      situacaoHorario: pendente?.situacao ?? null,
    });
    const bloqueiosAgencia = daAgencia?.conferencia.bloqueios ?? [];
    const alertasAgencia = daAgencia?.conferencia.alertas ?? [];
    if (!k.pode || bloqueiosAgencia.length > 0) {
      const codigos = [...k.bloqueios, ...bloqueiosAgencia];
      // Regra 11: o bloqueio vai à trilha (TRANSFUSAO_BLOQUEADA), sem dado pessoal (só os códigos).
      await this.apoio
        .sgh(
          s,
          E.sadtTransfusaoBloqueada.codigo,
          P.transfusaoAdministrar,
          {
            tabela: 'SGH_SADT_HEMO_REQ',
            id: String(r.id),
            paciente: r.paciente.id,
            chave: codigos.join(',').slice(0, 80),
          },
          async () => ({ ok: false }),
        )
        .catch((x: unknown) => {
          // A recusa sai mesmo assim; a falha da trilha fica no log (sem dado pessoal: só o ID da requisição).
          this.log.warn(
            `Trilha do bloqueio da transfusão não gravada (requisição ${String(r.id)}): ${x instanceof Error ? x.message : String(x)}`,
          );
        });
      throw recusaDominio('Transfusão bloqueada', codigos, {
        ...MENSAGENS_BOLSA,
        ...MENSAGENS_INICIO,
        ...MENSAGENS_IMUNO,
      });
    }
    const inicioEm = agora.slice(0, 16);
    const bloco = {
      requisicao: r.id,
      bolsa: {
        numero: e.bolsa.numero,
        hemocomponente: e.bolsa.hemocomponente,
        abo: ID_GRUPO_ABO[e.bolsa.tipagem.abo],
        rh: ID_FATOR_RH[e.bolsa.tipagem.rh],
        validade: e.bolsa.validade.slice(0, 16),
        volumeMl: e.bolsa.volumeMl,
      },
      inicioEm,
      pulseiraLida: e.pulseira.lida,
      motivoSemPulseira: e.pulseira.lida ? null : e.pulseira.motivo,
      profissional: s.login,
      conferente: segundo.login,
      alertas: [...k.alertas, ...alertasAgencia].slice(0, 5),
      justificativaRh: e.justificativaRh,
      sinaisAntes: e.sinaisAntes,
      sinaisAntesEm: inicioEm,
      chave,
      ...(daAgencia ? { estoque: true } : {}),
    };
    let ato: number;
    const comHorario = gravacaoNoHorario(pendente?.situacao ?? null) === 'checar-administrado' && pendente;
    if (comHorario && pendente && this.porta.destino !== 'memoria') {
      // Banco próprio: o início do ato e a checagem do horário pendente (administrado, com o evento do horário) numa
      // única operação da porta da transfusão, com a linha da trilha da tela.
      const x = await this.apoio.sgh(
        s,
        E.sadtTransfusaoIniciada.codigo,
        P.transfusaoAdministrar,
        (a: { id: number }) => ({
          tabela: 'SGH_SADT_HEMO_ATO',
          id: String(a.id),
          paciente: r.paciente.id,
          chave: e.bolsa.numero,
        }),
        (g) => g.iniciar({ ...bloco, horario: pendente.id }),
      );
      ato = x.id;
    } else if (comHorario && pendente) {
      // Com o horário pendente: a checagem do M25 (Administrado) com o ato no registro próprio da mesma transação.
      const h = await this.enfermagem.horario(s.porta, pendente.id);
      if (!h) throw new ErroProblema('nao-encontrado', 404, 'Horário não encontrado');
      const gravacao: ChecagemGravacao = {
        prescricao: h.prescricao,
        atendimento: h.atendimento,
        paciente: r.paciente.id,
        cbo: v.vinculo.cbo,
        marcacoes: [
          {
            horario: h.id,
            item: h.item,
            situacaoLida: 'P',
            situacao: 'A',
            quantidade: h.dose ?? 1,
            justificativa: null,
            papel: 'principal',
          },
        ],
        sgh: {
          horaReal: `${inicioEm}:00`,
          pulseiraLida: e.pulseira.lida,
          motivoSemPulseira: e.pulseira.lida ? null : e.pulseira.motivo,
          gtin: null,
          lote: null,
          validade: null,
          conferente: segundo.login,
          dispositivo: null,
          origemOffline: false,
          avisos: [
            ...k.alertas.map((a) => MENSAGENS_BOLSA[a].slice(0, 200)),
            ...alertasAgencia.map((a) => (MENSAGENS_IMUNO[a] ?? a).slice(0, 200)),
          ].slice(0, 5),
          motivo: null,
          observacao: `Transfusão da bolsa ${e.bolsa.numero}`.slice(0, 200),
        },
        glicemia: null,
        hemocomponente: bloco,
      };
      await this.apoios.checagem.executar(
        s,
        'enfermagem.checarAdministracao',
        gravacao,
        'Transfusão iniciada.',
        {
          chaveIdempotencia: chave,
        },
      );
      // Na sessão sintética (memória), a checagem fica com a enfermagem em memória e o ato vai à porta daqui.
      await this.porta.gravarSgh(s.porta, null as never, (g) => g.iniciar({ ...bloco, horario: h.id }));
      const [x] = (await this.porta.atos(s.porta, { requisicao: r.id })).filter(
        (a) => a.estado === 'emCurso',
      );
      if (!x)
        throw new ErroProblema(
          'erro-interno',
          500,
          'Transfusão',
          'O ato não foi encontrado depois do início.',
        );
      ato = x.id;
      // Regra 11: a checagem vai à trilha dupla pelo evento do M25; o início da transfusão tem a linha própria.
      await this.apoio.sgh(
        s,
        E.sadtTransfusaoIniciada.codigo,
        P.transfusaoAdministrar,
        { tabela: 'SGH_SADT_HEMO_ATO', id: String(ato), paciente: r.paciente.id, chave: e.bolsa.numero },
        async () => ({ ok: true }),
      );
    } else {
      const x = await this.apoio.sgh(
        s,
        E.sadtTransfusaoIniciada.codigo,
        P.transfusaoAdministrar,
        (a: { id: number }) => ({
          tabela: 'SGH_SADT_HEMO_ATO',
          id: String(a.id),
          paciente: r.paciente.id,
          chave: e.bolsa.numero,
        }),
        (g) => g.iniciar({ ...bloco, horario: null }),
      );
      ato = x.id;
    }
    return {
      ok: true,
      ato,
      repetida: false,
      alertas: [
        ...k.alertas.map((a) => MENSAGENS_BOLSA[a]),
        ...alertasAgencia.map((a) => MENSAGENS_IMUNO[a] ?? a),
      ],
      horarioChecado: pendente?.id ?? null,
      mensagem: pendente
        ? 'Transfusão iniciada: a dose aparece administrada na prescrição, com a dupla checagem.'
        : 'Transfusão iniciada com a dupla checagem.',
    };
  }

  private async unidadeDoAto(s: SessaoCadastro, a: AtoTransfusionalLido) {
    const r = await this.requisicaoOu404(s, a.requisicao, await this.agora(s));
    const i = await this.enfermagem.internado(s.porta, r.atendimento);
    return { r, unidade: i?.unidade ?? null };
  }

  @Post('atos/:id/sinais')
  @HttpCode(201)
  @Permissao(P.transfusaoAdministrar)
  @AuditadoNoHandler('os sinais do ato em SGH_SADT_HEMO_ATO_SINAL e SGH_PEP_SINAL_VITAL com a SGH_TRILHA')
  async sinais(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarSinaisTransfusao, { ...(b as object), ato: idDaRota(id) });
    const chave = chaveDoPedido(s);
    const agora = await this.agora(s);
    if (e.medidoEm.slice(0, 16) > agora.slice(0, 16))
      throw new ErroProblema('entrada-invalida', 422, 'Sinais', 'A hora da medida não pode ser do futuro.', {
        campos: ['medidoEm'],
      });
    const a = await this.atoOu404(s, e.ato);
    const { r } = await this.unidadeDoAto(s, a);
    const fora = medidaForaDaJanela(e.momento, a.inicioEm, e.medidoEm.slice(0, 19));
    const x = await this.apoio.sgh(
      s,
      E.sadtTransfusaoSinaisRegistrados.codigo,
      P.transfusaoAdministrar,
      (y: { id: number }) => ({
        tabela: 'SGH_SADT_HEMO_ATO_SINAL',
        id: String(y.id),
        paciente: r.paciente.id,
        chave: e.momento,
      }),
      (g) =>
        g.sinais({
          ato: a.id,
          momento: e.momento,
          sinais: e.sinais,
          medidoEm: e.medidoEm.slice(0, 16),
          foraJanela: fora,
          usuario: s.login,
          chave,
        }),
    );
    return {
      ok: true,
      id: x.id,
      foraDaJanela: fora,
      mensagem: fora
        ? 'Sinais registrados fora da janela de 10 a 15 minutos (vai ao indicador).'
        : 'Sinais registrados.',
    };
  }

  /**
   * W0-03 (matriz, linha "Hemoterapia"): o adendo do ato transfusional para os sinais digitados errado num momento já
   * medido. O ato e a medida original não mudam (linha nova em SGH_SADT_HEMO_ATO_ADENDO); a tela mostra os dois.
   */
  @Post('atos/:id/adendo')
  @HttpCode(201)
  @Permissao(P.transfusaoAdministrar)
  @AuditadoNoHandler('o adendo do ato em SGH_SADT_HEMO_ATO_ADENDO com a SGH_TRILHA (o ato não muda)')
  async adendo(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAdendoAtoTransfusional, b);
    await this.apoio.exigirLiberacao(s);
    const a = await this.atoOu404(s, idDaRota(id));
    const { r } = await this.unidadeDoAto(s, a);
    const x = await this.apoio.sgh(
      s,
      E.sadtTransfusaoAdendo.codigo,
      P.transfusaoAdministrar,
      (y: { id: number }) => ({
        tabela: 'SGH_SADT_HEMO_ATO_ADENDO',
        id: String(y.id),
        paciente: r.paciente.id,
        chave: `ato:${a.id}:${e.momento}`,
      }),
      (g) =>
        g.adendo({ ato: a.id, momento: e.momento, sinais: e.sinais, motivo: e.motivo, usuario: s.login }),
    );
    return { ok: true, id: x.id, mensagem: 'Adendo registrado; o registro original não mudou.' };
  }

  @Post('atos/:id/concluir')
  @HttpCode(200)
  @Permissao(P.transfusaoAdministrar)
  @AuditadoNoHandler(
    'a conclusão do ato em SGH_SADT_HEMO_ATO, a requisição e o ganho em SGH_PEP_BALANCO com a SGH_TRILHA',
  )
  async concluir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaConcluirTransfusao, { ...(b as object), ato: idDaRota(id) });
    const agora = await this.agora(s);
    const a = await this.atoOu404(s, e.ato);
    if (e.terminoEm.slice(0, 16) > agora.slice(0, 16) || e.terminoEm.slice(0, 16) < a.inicioEm.slice(0, 16))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Término',
        'O término tem de ser depois do início e não do futuro.',
        {
          campos: ['terminoEm'],
        },
      );
    if (e.volumeTransfundidoMl > a.bolsa.volumeMl)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Volume',
        'O volume transfundido passa do volume da bolsa.',
        {
          campos: ['volumeTransfundidoMl'],
        },
      );
    const { r, unidade } = await this.unidadeDoAto(s, a);
    const janela = await this.janelaBalanco(s, unidade, e.terminoEm);
    const x = await this.apoio.sgh(
      s,
      E.sadtTransfusaoConcluida.codigo,
      P.transfusaoAdministrar,
      {
        tabela: 'SGH_SADT_HEMO_ATO',
        id: String(a.id),
        paciente: r.paciente.id,
        chave: e.interrompida ? 'interrompido' : 'concluido',
      },
      (g) =>
        g.concluir({
          ato: a.id,
          terminoEm: e.terminoEm.slice(0, 16),
          volumeTransfundidoMl: e.volumeTransfundidoMl,
          interrompida: e.interrompida,
          motivoInterrupcao: e.motivoInterrupcao,
          usuario: s.login,
          janelaBalanco: janela,
          chave: chaveSeHouver(s),
        }),
    );
    return {
      ok: true,
      id: a.id,
      estadoRequisicao: x.estadoRequisicao,
      ganhoNoBalanco: x.ganho !== null,
      mensagem: e.interrompida
        ? 'Transfusão interrompida.'
        : 'Transfusão concluída: meça os sinais do término.',
    };
  }

  /** O início da janela de 24 horas do balanço da unidade (hora de corte do parâmetro do M45). */
  private async janelaBalanco(s: SessaoCadastro, unidade: string | null, instante: string): Promise<string> {
    const v = await this.apoio.parametroValor(s, PARAMETRO_BALANCO_HORA_CORTE, unidade).catch(() => null);
    let corte: string;
    try {
      corte = horaDoCorte(String(v ?? '0700') || '0700');
    } catch {
      corte = '07:00';
    }
    return janelaDoInstante(instante.slice(0, 16), corte).inicio;
  }

  @Post('atos/:id/reacao')
  @HttpCode(201)
  @Permissao(P.reacaoRegistrar)
  @AuditadoNoHandler(
    'sadt.registrarReacaoTransfusional: SGH_SADT_HEMO_REACAO (e a interrupção do ato) com a SGH_TRILHA',
  )
  async reacao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarReacaoTransfusional, { ...(b as object), ato: idDaRota(id) });
    const chave = chaveDoPedido(s);
    const agora = await this.agora(s);
    const a = await this.atoOu404(s, e.ato);
    const emCurso = a.estado === 'emCurso';
    const problemas = conferirReacao({
      atoIniciadoEm: a.inicioEm.slice(0, 16),
      atoEmCurso: emCurso,
      inicioReacaoEm: e.inicioEm.slice(0, 16),
      tipo: e.tipo,
      grau: e.grau,
      condutas: e.condutas,
      destinoBolsa: e.destinoBolsa,
      obito: e.grau === 4,
    });
    if (emCurso && e.volumeTransfundidoMl === null)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Reação',
        'Informe o volume transfundido até a interrupção.',
        {
          campos: ['volumeTransfundidoMl'],
        },
      );
    if (problemas.length) throw recusaDominio('Reação transfusional', problemas, MENSAGENS_REACAO);
    const sugestao = sugestaoDeNotificacao({
      tipo: e.tipo,
      grau: e.grau,
      correlacao: e.correlacao,
      destinoBolsa: e.destinoBolsa,
    });
    const { r, unidade } = await this.unidadeDoAto(s, a);
    const termino = agora.slice(0, 16);
    const janela = emCurso ? await this.janelaBalanco(s, unidade, termino) : null;
    const x = await this.apoio.sgh(
      s,
      E.sadtReacaoTransfusional.codigo,
      P.reacaoRegistrar,
      (y: { id: number }) => ({
        tabela: 'SGH_SADT_HEMO_REACAO',
        id: String(y.id),
        paciente: r.paciente.id,
        chave: e.tipo,
      }),
      (g) =>
        g.reacao({
          ato: a.id,
          tipo: e.tipo,
          descricaoOutra: e.descricaoOutra,
          grau: e.grau,
          correlacao: e.correlacao,
          inicioEm: e.inicioEm.slice(0, 16),
          sinaisESintomas: e.sinaisESintomas,
          condutas: e.condutas,
          condutaOutra: e.condutaOutra,
          destinoBolsa: e.destinoBolsa,
          prioridade: sugestao.prioridade,
          usuario: s.login,
          chave,
          sinais: e.sinaisNaReacao,
          interromper: emCurso
            ? {
                terminoEm: termino,
                volumeTransfundidoMl: Math.min(e.volumeTransfundidoMl ?? 0, a.bolsa.volumeMl),
                motivoInterrupcao: `Reação transfusional: ${e.tipo}`.slice(0, 300),
                janelaBalanco: janela,
              }
            : null,
        }),
    );
    // Regra 11: a bolsa devolvida ou descartada vai à trilha (BOLSA_DESCARTADA), sem dado pessoal.
    if (sugestao.bolsaSaiDoEstoque)
      await this.apoio
        .sgh(
          s,
          E.sadtBolsaDescartada.codigo,
          P.reacaoRegistrar,
          { tabela: 'SGH_SADT_HEMO_ATO', id: String(a.id), paciente: r.paciente.id, chave: e.destinoBolsa },
          async () => ({ ok: true }),
        )
        .catch(() => undefined);
    return {
      ok: true,
      id: x.id,
      interrompeu: x.interrompeu,
      notificacao: sugestao,
      mensagem: `Reação registrada. Notificação sugerida ao núcleo de segurança do paciente (${sugestao.prioridade === 'imediata' ? 'imediata' : 'de rotina'}).`,
    };
  }

  // ── Hemovigilância ──────────────────────────────────────────────────────────────────────────────

  @Get('hemovigilancia')
  @Permissao(P.reacaoLer)
  @Auditar(E.sadtTransfusaoLida.codigo)
  async hemovigilancia(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const d = de && DATA.test(de) ? de : `${agora.slice(0, 8)}01`;
    const a = ate && DATA.test(ate) ? ate : agora.slice(0, 10);
    if (d > a)
      throw new ErroProblema('entrada-invalida', 422, 'Período', 'O início do período é depois do fim.');
    const [reacoes, atos, requisicoes, gravacao] = await Promise.all([
      this.porta.reacoes(s.porta, { de: d, ate: a }),
      this.porta.atos(s.porta, { de: d, ate: a }),
      this.porta.requisicoes(s.porta, { agora, de: d, ate: a }),
      this.gravacao(s),
    ]);
    const comReacao = new Set(reacoes.map((r) => r.ato));
    const primeiroAto = new Map<number, string>();
    for (const x of atos) {
      const p = primeiroAto.get(x.requisicao);
      if (!p || x.inicioEm < p) primeiroAto.set(x.requisicao, x.inicioEm);
    }
    const indicadores = indicadoresHemovigilancia({
      atos: atos
        .filter((x) => x.estado !== 'emCurso')
        .map((x) => ({
          sinaisCompletos: sinaisCompletos(
            tarefasDoAto({
              inicioEm: x.inicioEm,
              terminoEm: x.terminoEm,
              estado: x.estado,
              feitos: x.sinais.map((y) => y.momento),
              agora,
            }),
          ),
          comReacao: comReacao.has(x.id),
        })),
      reacoesGraves: reacoes.filter((r) => r.grau >= 3).length,
      requisicoesUrgentes: requisicoes.itens
        .filter(
          (q) => (q.urgencia === 'urgente' || q.urgencia === 'extremaUrgencia') && q.estado !== 'cancelada',
        )
        .map((q) => {
          const ini = primeiroAto.get(q.id);
          return { noPrazo: ini !== undefined && (q.prazo === null || ini <= q.prazo) };
        }),
      requisicoes: requisicoes.itens.map((q) => ({ comIndicacao: q.indicacao.trim().length >= 10 })),
    });
    req.sghAlvo = {
      tabelaAlvo: 'SGH_SADT_HEMO_REACAO',
      chaveNaturalAlvo: `${d}:${a};n:${String(reacoes.length)}`,
    };
    return { de: d, ate: a, reacoes, indicadores, estados: CODIGOS_ESTADO_REQUISICAO_TRANSFUSAO, gravacao };
  }

  @Get('reacoes/:id/notificacao')
  @Permissao(P.reacaoLer)
  @Auditar(E.sadtTransfusaoLida.codigo)
  async notificacao(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [r] = await this.porta.reacoes(s.porta, { reacao: idDaRota(id) });
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Reação não encontrada');
    req.sghAlvo = { paciente: r.paciente.id, tabelaAlvo: 'SGH_SADT_HEMO_REACAO', idAlvo: String(r.id) };
    const p = await this.porta.pessoa(s.porta, r.paciente.id);
    return {
      campos: camposNotificacao({
        inicioTransfusaoEm: r.transfusaoIniciadaEm,
        inicioReacaoEm: r.inicioEm,
        hemocomponente: r.bolsa.hemocomponente,
        numeroBolsa: r.bolsa.numero,
        tipo: r.tipo,
        descricaoOutra: r.descricaoOutra,
        grau: r.grau,
        correlacao: r.correlacao,
        sinaisESintomas: r.sinaisESintomas,
        condutas: r.condutas,
        nomePaciente: p.nome || r.paciente.nome,
        sexo: p.sexo,
        idade: idade(p.nascimento, r.inicioEm),
      }),
      enviadaEm: r.notificacao.enviadaEm,
      prioridade: r.notificacao.prioridade,
    };
  }

  @Post('reacoes/:id/notificacao')
  @HttpCode(200)
  @Permissao(P.reacaoRegistrar)
  @AuditadoNoHandler('a data do envio da notificação em SGH_SADT_HEMO_REACAO com a SGH_TRILHA')
  async notificada(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaNotificacaoEnviada, b);
    const [r] = await this.porta.reacoes(s.porta, { reacao: idDaRota(id) });
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Reação não encontrada');
    if (
      e.enviadaEm.slice(0, 16) > (await this.agora(s)).slice(0, 16) ||
      e.enviadaEm.slice(0, 16) < r.inicioEm.slice(0, 16)
    )
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Notificação',
        'A data do envio é depois da reação e não do futuro.',
        {
          campos: ['enviadaEm'],
        },
      );
    await this.apoio.sgh(
      s,
      E.sadtReacaoNotificada.codigo,
      P.reacaoRegistrar,
      { tabela: 'SGH_SADT_HEMO_REACAO', id: String(r.id), paciente: r.paciente.id, chave: 'notificada' },
      (g) => g.notificada({ reacao: r.id, enviadaEm: e.enviadaEm.slice(0, 16), chave: chaveSeHouver(s) }),
    );
    return { ok: true, id: r.id, mensagem: 'Envio da notificação registrado.' };
  }
}
