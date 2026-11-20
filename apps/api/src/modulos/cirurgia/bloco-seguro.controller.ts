// Cirurgia segura e rastreio no bloco (M46, etapa 2; ficha, seções 4, 5, 7 e 8; regras 1, 2, 5, 12 e 13):
//   GET  /api/cirurgia/bloco/quadro?data=&sala=            o quadro do bloco: o mapa do dia com o estado de segurança
//   GET  /api/cirurgia/bloco/quadro/eventos                canal de eventos (text/event-stream): só avisa; a tela relê
//   GET  /api/cirurgia/bloco/checklist/cirurgias?data=     o mesmo mapa para a escolha do checklist (circulante)
//   GET  /api/cirurgia/bloco/dominios                      os locais do bloco, os tipos de movimentação e as salas
//   GET  /api/cirurgia/bloco/:agenda/checklist             o checklist em três momentos (leitura de prontuário)
//   POST /api/cirurgia/bloco/:agenda/checklist/itens       cirurgia.confirmarItemChecklist (circulante)
//   POST /api/cirurgia/bloco/:agenda/checklist/momentos    cirurgia.concluirMomentoChecklist (CHECKLIST_MOMENTO_CONCLUIDO)
//   POST /api/cirurgia/bloco/:agenda/checklist/excecao     a exceção da trava da incisão em urgência (INCISAO_EXCECAO)
//   GET  /api/cirurgia/bloco/:agenda/rastreio              o rastreio do paciente (movimentos e o código do painel)
//   POST /api/cirurgia/bloco/:agenda/rastreio              cirurgia.moverPacienteBloco
// Só do novo (SGH_), com a SGH_TRILHA na mesma transação e o ator real; o estabelecimento vem da sessão. A gravação relê
// o checklist travado e a sequência do rastreio na MESMA transação e o domínio confere ali de novo. Nasce desligado
// (chaves `bloco.checklistFormulario` e `bloco.rastreio`, POL-3); a trava da incisão tem a sua (`bloco.checklistTrava`).
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
  type ChecklistResposta,
  DESTINOS_SAIDA_BLOCO,
  type DominiosRastreioResposta,
  esquemaConcluirMomentoChecklist,
  esquemaConfirmarItensChecklist,
  esquemaExcecaoIncisao,
  esquemaMoverPacienteBloco,
  EVENTOS_AUDITAVEIS,
  LISTA_CHECKLIST_VIGENTE,
  type LinhaQuadroBloco,
  listaChecklist,
  LOCAIS_BLOCO,
  MOMENTOS_CHECKLIST,
  type MovimentoBlocoResposta,
  PERMISSOES_BLOCO_SEGURO_CODIGOS as P,
  type QuadroBlocoResposta,
  type ResultadoBlocoSeguro,
  type TelaChecklistResposta,
  type TelaRastreioResposta,
  TIPOS_MOVIMENTO_BLOCO,
} from '@sgh/contratos';
import {
  alertasDoChecklist,
  conferirConclusao,
  conferirExcecao,
  conferirMovimento,
  conferirResposta,
  estadoDoAgendamentoPeloLocal,
  estadoDoRastreio,
  gerarCodigoPainel,
  impedimentoDoMomento,
  incisaoLiberada,
  itensDoMomento,
  minutosDoInstante,
  movimentosPermitidos,
  pendentesDoMomento,
  podeConfirmar,
  podeIr,
  estadoValido,
  rotuloLocal,
  segurancaNoQuadro,
  validadeDoCodigo,
  vigentes,
} from '@sgh/dominio-cirurgia';
import type { ChecklistLidoSgh, ContextoAnestesiaLido, MovimentoLidoSgh } from '@sgh/legado';
import { randomBytes } from 'node:crypto';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  AvisosAtendimento,
  type RequisicaoBrutaAtendimento,
  type RespostaEventosAtendimento,
} from '../atendimento/public-api.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { BATIDA_EVENTOS_MS, BATIDA_EVENTOS_PADRAO_MS } from '../internacao/public-api.js';
import { PORTA_ANESTESIA, type PortaAnestesia } from './anestesia-porta.js';
import { chaveDoPedidoAnestesia, montarContextoAnestesia } from './anestesia.controller.js';
import { type GravadorBlocoSeguro, PORTA_BLOCO_SEGURO, type PortaBlocoSeguro } from './bloco-seguro-porta.js';
import { PORTA_CIRURGIA, type PortaCirurgia } from './porta.js';
import { recusaBloco, TRAVA_INCISAO, type TravaIncisao } from './trava-incisao.js';

const E = EVENTOS_AUDITAVEIS;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const CHAVE_LIBERACAO_CHECKLIST = 'bloco.checklistFormulario';
export const CHAVE_LIBERACAO_RASTREIO = 'bloco.rastreio';
export const AVISOS_BLOCO = Symbol('AVISOS_BLOCO');
/** Tolerância do relógio do aparelho para o horário informado (o tablet pode estar um pouco adiantado). */
const TOLERANCIA_FUTURO_MIN = 5;
const instanteT = (v: string) => v.trim().replace(' ', 'T').slice(0, 16);

@Controller('cirurgia/bloco')
export class BlocoSeguroController {
  private readonly checklistApoio: ApoioGravacao<GravadorBlocoSeguro>;
  private readonly rastreioApoio: ApoioGravacao<GravadorBlocoSeguro>;

  constructor(
    @Inject(PORTA_BLOCO_SEGURO) private readonly porta: PortaBlocoSeguro,
    @Inject(PORTA_CIRURGIA) private readonly cirurgia: PortaCirurgia,
    @Inject(PORTA_ANESTESIA) private readonly anestesia: PortaAnestesia,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(AVISOS_BLOCO) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(TRAVA_INCISAO) private readonly trava: TravaIncisao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
    @Optional() @Inject(BATIDA_EVENTOS_MS) private readonly batidaMs: number = BATIDA_EVENTOS_PADRAO_MS,
  ) {
    this.checklistApoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_CHECKLIST, nome: 'o checklist de cirurgia segura', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.rastreioApoio = new ApoioGravacao(
      {
        chave: CHAVE_LIBERACAO_RASTREIO,
        nome: 'o rastreio do paciente no bloco e o painel para familiares',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Apoio ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async agora(s: SessaoCadastro): Promise<string> {
    const r = await this.cirurgia.relogio(s.porta);
    return `${r.hoje}T${r.hhmm.slice(0, 2)}:${r.hhmm.slice(2, 4)}`;
  }

  private naoNoFuturo(agora: string, em: string): void {
    if (minutosDoInstante(em) > minutosDoInstante(agora) + TOLERANCIA_FUTURO_MIN)
      throw recusaBloco('bloco-horario-futuro');
  }

  private corpoDaRota<T extends { agendamento: number }>(e: T, agenda: string): number {
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    return id;
  }

  private naoEncontrado(): ErroProblema {
    return new ErroProblema(
      'nao-encontrado',
      404,
      'Cirurgia não encontrada',
      'O agendamento não existe mais (pode ter sido cancelado).',
    );
  }

  private async contextoLido(s: SessaoCadastro, agenda: number): Promise<ContextoAnestesiaLido> {
    const c = await this.anestesia.contexto(s.porta, agenda);
    if (!c) throw this.naoEncontrado();
    return c;
  }

  private async registro(s: SessaoCadastro): Promise<number | null> {
    return (await this.anestesia.profissional(s.porta, s.login))?.registros[0] ?? null;
  }

  /** O agendamento relido na transação: a linha da agenda existe e não foi cancelado. */
  private async conferirNaTransacao(g: GravadorBlocoSeguro, agendamento: number): Promise<void> {
    const a = await g.agendamentoNaTransacao(agendamento);
    if (!a.existe) throw this.naoEncontrado();
    if (a.estado === 'cancelado' || a.estado === 'suspenso')
      throw recusaBloco('checklist-agendamento-fechado');
  }

  private avisar(s: SessaoCadastro): void {
    this.avisos?.avisar(s.hospital);
  }

  // ── Quadro do bloco ────────────────────────────────────────────────────────────────────────────────────────────

  private async quadro(
    s: SessaoCadastro,
    data: string | undefined,
    sala: string | undefined,
    apoio: ApoioGravacao<GravadorBlocoSeguro>,
    extras: Readonly<Record<string, string>>,
  ): Promise<QuadroBlocoResposta> {
    const agora = await this.agora(s);
    const dia = data && DATA.test(data) ? data : agora.slice(0, 10);
    const salas = sala && /^\d{1,4}$/.test(sala) ? [Number(sala)] : null;
    const { itens, truncado } = await this.cirurgia.agendamentos(s.porta, dia, dia, salas);
    const ids = itens.map((a) => a.id);
    const [checklists, movs, codigos, estados, situacoes, procs, gravacao] = await Promise.all([
      this.porta.checklists(s.porta, ids),
      this.porta.movimentosDe(s.porta, ids),
      this.porta.codigos(s.porta, agora, ids),
      this.cirurgia.estadosDosAgendamentos(s.porta, ids),
      this.anestesia.situacoes(s.porta, ids),
      this.cirurgia.nomesProcedimentos(s.porta, [...new Set(itens.map((a) => a.procedimento))]),
      apoio.gravacao(s, extras),
    ]);
    const linhas: LinhaQuadroBloco[] = itens.map((a) => {
      const k = checklists.get(a.id) ?? null;
      const lista = (k && listaChecklist(k.lista)) || LISTA_CHECKLIST_VIGENTE;
      const m = movs.get(a.id) ?? [];
      const r = estadoDoRastreio(m);
      const sit = situacoes.get(a.id);
      return {
        agendamento: a.id,
        sala: a.sala,
        inicio: instanteT(a.inicio),
        paciente: a.paciente.trim(),
        procedimento: procs.get(a.procedimento) ?? null,
        estado: estados.get(a.id)?.estado ?? 'confirmado',
        apa: (sit?.apa ?? null) as LinhaQuadroBloco['apa'],
        ficha: (sit?.ficha ?? null) as LinhaQuadroBloco['ficha'],
        checklist: k ? segurancaNoQuadro(lista, k, k.confirmacoes) : null,
        local:
          r.dentro && r.local !== null
            ? { id: r.local, rotulo: rotuloLocal(r.local)!, desde: r.desde!, salaCirurgica: r.salaCirurgica }
            : null,
        saiu: r.saida,
        codigoPainel: codigos.get(a.id)?.codigo ?? null,
        ultimoMovimento: r.ultimo?.sequencia ?? 0,
      };
    });
    return {
      data: dia,
      agora,
      linhas,
      truncado,
      totais: {
        cirurgias: linhas.length,
        noBloco: linhas.filter((l) => l.local !== null).length,
        emSala: linhas.filter((l) => l.local?.id === 3).length,
        naRecuperacao: linhas.filter((l) => l.local?.id === 4).length,
        pausaConcluida: linhas.filter((l) => l.checklist?.incisao).length,
      },
      gravacao,
    };
  }

  @Get('quadro')
  @Permissao(P.rastreioLer)
  @Auditar(E.quadroBlocoLido.codigo)
  async quadroDoBloco(
    @Query('data') data: string | undefined,
    @Query('sala') sala: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<QuadroBlocoResposta> {
    req.sghAlvo = { tabelaAlvo: 'SGH_CC_MOVIMENTO' };
    return this.quadro(sessaoDe(req), data, sala, this.rastreioApoio, { mover: P.rastreioMover });
  }

  @Get('quadro/eventos')
  @Permissao(P.rastreioLer)
  eventos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(req, res, sessaoDe(req).hospital, P.rastreioLer, this.resolvedor, this.batidaMs);
  }

  @Get('checklist/cirurgias')
  @Permissao(P.checklistLer)
  @Auditar(E.quadroBlocoLido.codigo)
  async cirurgiasDoChecklist(
    @Query('data') data: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<QuadroBlocoResposta> {
    req.sghAlvo = { tabelaAlvo: 'SGH_CC_CHECKLIST' };
    return this.quadro(sessaoDe(req), data, undefined, this.checklistApoio, {
      confirmar: P.checklistConfirmar,
    });
  }

  @Get('dominios')
  @Permissao(P.rastreioLer)
  async dominios(@Req() req: RequisicaoAutorizada): Promise<DominiosRastreioResposta> {
    const s = sessaoDe(req);
    const [d, salas] = await Promise.all([
      this.porta.dominios(s.porta),
      this.cirurgia.salas(s.porta, s.login),
    ]);
    return {
      locais: d.locais
        .filter((l) => l.ativo)
        .map((l) => ({ id: l.id, rotulo: rotuloLocal(l.id)!, nome: l.nome })),
      tipos: TIPOS_MOVIMENTO_BLOCO.filter((t) => d.tipos.some((x) => x.id === t.id && x.ativo)).map((t) => ({
        id: t.id,
        codigo: t.codigo,
        rotulo: t.rotulo,
      })),
      salas: salas.map((x) => ({ codigo: x.codigo, nome: x.nome })),
    };
  }

  // ── Checklist ──────────────────────────────────────────────────────────────────────────────────────────────────

  private checklistResposta(k: ChecklistLidoSgh | null): ChecklistResposta {
    const lista = (k && listaChecklist(k.lista)) || LISTA_CHECKLIST_VIGENTE;
    const conf = k?.confirmacoes ?? [];
    const v = vigentes(conf);
    const alertas = new Set(alertasDoChecklist(lista, conf).map((i) => i.codigo));
    return {
      id: k?.id ?? null,
      versao: k?.versao ?? 0,
      lista: lista.versao,
      situacao: k?.situacao ?? null,
      momentos: MOMENTOS_CHECKLIST.map((m) => ({
        momento: m.codigo,
        rotulo: m.rotulo,
        concluidoEm:
          m.codigo === 'inducao'
            ? (k?.inducaoEm ?? null)
            : m.codigo === 'incisao'
              ? (k?.timeoutEm ?? null)
              : (k?.saidaEm ?? null),
        concluidoPor:
          m.codigo === 'inducao'
            ? (k?.inducaoPor ?? null)
            : m.codigo === 'incisao'
              ? (k?.timeoutPor ?? null)
              : (k?.saidaPor ?? null),
        itens: itensDoMomento(lista, m.codigo).map((i) => {
          const c = v.get(`${m.codigo}:${i.codigo}`);
          return {
            codigo: i.codigo,
            rotulo: i.rotulo,
            tipo: i.tipo,
            observacaoSe: i.observacaoSe ?? null,
            resposta: c?.resposta ?? null,
            observacao: c?.observacao ?? null,
            confirmadoEm: c?.em ?? null,
            confirmadoPor: c?.usuario ?? null,
            alerta: alertas.has(i.codigo),
          };
        }),
        pendentes: pendentesDoMomento(lista, m.codigo, conf).map((i) => i.rotulo),
        impedimento: impedimentoDoMomento(lista, k, m.codigo, conf),
      })),
      excecao:
        k?.excecaoEm && k.excecaoPor
          ? { em: k.excecaoEm, por: k.excecaoPor, motivo: k.excecaoMotivo ?? '' }
          : null,
      incisaoLiberada: incisaoLiberada(k),
      alertas: lista.itens.filter((i) => alertas.has(i.codigo)).map((i) => i.rotulo),
      registroProntuario: k?.registroProntuario ?? null,
    };
  }

  @Get(':agenda/checklist')
  @Permissao(P.checklistLer)
  @Auditar(E.quadroBlocoLido.codigo)
  async checklist(
    @Param('agenda') agenda: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<TelaChecklistResposta> {
    const s = sessaoDe(req);
    const c = await this.contextoLido(s, idDaRota(agenda));
    req.sghAlvo = {
      ...(c.paciente !== null ? { paciente: c.paciente } : {}),
      tabelaAlvo: 'SGH_CC_CHECKLIST',
    };
    const [contexto, k, estados, agora, gravacao, trava] = await Promise.all([
      montarContextoAnestesia(this.cirurgia, s, c),
      this.porta.checklist(s.porta, c.agendamento),
      this.cirurgia.estadosDosAgendamentos(s.porta, [c.agendamento]),
      this.agora(s),
      this.checklistApoio.gravacao(s, { confirmar: P.checklistConfirmar, excecao: P.checklistExcecao }),
      this.trava ? this.trava.liberacao(s) : Promise.resolve({ ligada: false, motivo: null }),
    ]);
    return {
      contexto,
      checklist: this.checklistResposta(k),
      carater: estados.get(c.agendamento)?.carater ?? null,
      trava,
      agora,
      gravacao,
    };
  }

  @Post(':agenda/checklist/itens')
  @HttpCode(201)
  @Permissao(P.checklistConfirmar)
  @AuditadoNoHandler(
    'cirurgia.confirmarItemChecklist: SGH_CC_CHECKLIST_ITEM com a SGH_TRILHA na mesma transação',
  )
  async confirmarItens(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBlocoSeguro> {
    const s = sessaoDe(req);
    const e = corpo(esquemaConfirmarItensChecklist, b);
    const id = this.corpoDaRota(e, agenda);
    const chave = chaveDoPedidoAnestesia(s, e.chave);
    const [c, profissional, agora] = await Promise.all([
      this.contextoLido(s, id),
      this.registro(s),
      this.agora(s),
    ]);
    this.naoNoFuturo(agora, e.em);
    const r = await this.checklistApoio.sgh(
      s,
      E.checklistItensConfirmados.codigo,
      P.checklistConfirmar,
      (x: { id: number }) => ({
        tabela: 'SGH_CC_CHECKLIST_ITEM',
        id: String(x.id),
        paciente: c.paciente,
        chave: `${id}:${e.momento}`,
      }),
      async (g) => {
        await this.conferirNaTransacao(g, id);
        let k = await g.checklist(id);
        // O reenvio do mesmo pedido (a mesma chave) não grava de novo, antes de qualquer conferência.
        const ja = await g.confirmacaoPelaChave(chave, e.itens[0]!.item);
        if (ja) {
          if (ja.checklist !== k?.id) throw recusaBloco('chave-reutilizada');
          return { id: ja.id };
        }
        const lista = (k && listaChecklist(k.lista)) || LISTA_CHECKLIST_VIGENTE;
        const pode = podeConfirmar(k, e.momento);
        if (!pode.ok) throw recusaBloco(pode.codigo);
        const doMomento = new Map(itensDoMomento(lista, e.momento).map((i) => [i.codigo, i]));
        for (const i of e.itens) {
          const x = conferirResposta(doMomento.get(i.item), i);
          if (!x.ok) throw recusaBloco(x.codigo);
        }
        if ((k?.versao ?? 0) !== e.versaoVista) throw recusaBloco('checklist-mudou');
        let versao = e.versaoVista;
        if (!k) {
          const aberto = await g.abrirChecklist({
            agendamento: id,
            sala: c.sala,
            dataHora: instanteT(c.inicio),
            reg: c.reg,
            paciente: c.paciente,
            lista: lista.versao,
            usuario: s.login,
          });
          versao = aberto.versao;
          k = { id: aberto.id } as ChecklistLidoSgh;
        }
        const x = await g.confirmarItens({
          checklist: k.id,
          versaoVista: versao,
          momento: e.momento,
          em: e.em,
          itens: e.itens,
          profissional,
          usuario: s.login,
          chave,
        });
        return { id: x.ids[0] ?? k.id };
      },
    );
    this.avisar(s);
    return { ok: true, id: r.id, mensagem: 'Itens do checklist confirmados.' };
  }

  @Post(':agenda/checklist/momentos')
  @HttpCode(201)
  @Permissao(P.checklistConfirmar)
  @AuditadoNoHandler(
    'cirurgia.concluirMomentoChecklist: SGH_CC_CHECKLIST com a SGH_TRILHA na mesma transação',
  )
  async concluirMomento(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBlocoSeguro> {
    const s = sessaoDe(req);
    const e = corpo(esquemaConcluirMomentoChecklist, b);
    const id = this.corpoDaRota(e, agenda);
    chaveDoPedidoAnestesia(s, e.chave);
    const [c, agora] = await Promise.all([this.contextoLido(s, id), this.agora(s)]);
    this.naoNoFuturo(agora, e.em);
    const r = await this.checklistApoio.sgh(
      s,
      E.checklistMomentoConcluido.codigo,
      P.checklistConfirmar,
      (x: { id: number }) => ({
        tabela: 'SGH_CC_CHECKLIST',
        id: String(x.id),
        paciente: c.paciente,
        chave: `${id}:${e.momento}`,
      }),
      async (g) => {
        await this.conferirNaTransacao(g, id);
        const k = await g.checklist(id);
        if (!k) throw recusaBloco('checklist-itens-pendentes');
        if (k.versao !== e.versaoVista) throw recusaBloco('checklist-mudou');
        const lista = listaChecklist(k.lista) ?? LISTA_CHECKLIST_VIGENTE;
        const ok = conferirConclusao(lista, k, e.momento, k.confirmacoes, e.em);
        if (!ok.ok) throw recusaBloco(ok.codigo);
        await g.concluirMomento({
          checklist: k.id,
          versaoVista: k.versao,
          momento: e.momento,
          em: e.em,
          usuario: s.login,
          cirurgia: { agendamento: id, sala: k.sala, dataHora: k.dataHora, reg: k.reg },
        });
        return { id: k.id };
      },
    );
    this.avisar(s);
    const rotulo = MOMENTOS_CHECKLIST.find((m) => m.codigo === e.momento)!.curto;
    return { ok: true, id: r.id, mensagem: `Momento concluído: ${rotulo}.` };
  }

  @Post(':agenda/checklist/excecao')
  @HttpCode(201)
  @Permissao(P.checklistExcecao)
  @AuditadoNoHandler('exceção da trava da incisão: SGH_CC_CHECKLIST com a SGH_TRILHA na mesma transação')
  async excecao(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBlocoSeguro> {
    const s = sessaoDe(req);
    const e = corpo(esquemaExcecaoIncisao, b);
    const id = this.corpoDaRota(e, agenda);
    chaveDoPedidoAnestesia(s, e.chave);
    const [c, estados, agora] = await Promise.all([
      this.contextoLido(s, id),
      this.cirurgia.estadosDosAgendamentos(s.porta, [id]),
      this.agora(s),
    ]);
    this.naoNoFuturo(agora, e.em);
    const carater = estados.get(id)?.carater ?? null;
    const r = await this.checklistApoio.sgh(
      s,
      E.incisaoExcecao.codigo,
      P.checklistExcecao,
      (x: { id: number }) => ({
        tabela: 'SGH_CC_CHECKLIST',
        id: String(x.id),
        paciente: c.paciente,
        chave: `${id}:excecao`,
      }),
      async (g) => {
        await this.conferirNaTransacao(g, id);
        let k = await g.checklist(id);
        const rec = conferirExcecao(k, carater);
        if (rec) throw recusaBloco(rec);
        if ((k?.versao ?? 0) !== e.versaoVista) throw recusaBloco('checklist-mudou');
        let versao = e.versaoVista;
        if (!k) {
          const aberto = await g.abrirChecklist({
            agendamento: id,
            sala: c.sala,
            dataHora: instanteT(c.inicio),
            reg: c.reg,
            paciente: c.paciente,
            lista: LISTA_CHECKLIST_VIGENTE.versao,
            usuario: s.login,
          });
          versao = aberto.versao;
          k = { id: aberto.id } as ChecklistLidoSgh;
        }
        await g.registrarExcecao({
          checklist: k.id,
          versaoVista: versao,
          em: e.em,
          motivo: e.motivo,
          usuario: s.login,
        });
        return { id: k.id };
      },
    );
    this.avisar(s);
    return { ok: true, id: r.id, mensagem: 'Exceção da trava da incisão registrada.' };
  }

  // ── Rastreio ───────────────────────────────────────────────────────────────────────────────────────────────────

  private movimentoResposta(m: MovimentoLidoSgh): MovimentoBlocoResposta {
    return {
      id: m.id,
      sequencia: m.sequencia,
      tipo: m.tipo,
      rotulo: TIPOS_MOVIMENTO_BLOCO.find((t) => t.codigo === m.tipo)!.rotulo,
      local: m.local,
      localRotulo: rotuloLocal(m.local),
      salaCirurgica: m.salaCirurgica,
      em: m.em,
      destino: m.destino,
      observacao: m.observacao,
      usuario: m.usuario,
    };
  }

  private async agendamentoLido(s: SessaoCadastro, agenda: number) {
    const a = await this.cirurgia.agendamento(s.porta, agenda);
    if (!a) throw this.naoEncontrado();
    const p = a.prontuario > 0 ? await this.cirurgia.pacientePorProntuario(s.porta, a.prontuario) : null;
    return { a, paciente: p?.id ?? null };
  }

  @Get(':agenda/rastreio')
  @Permissao(P.rastreioLer)
  @Auditar(E.quadroBlocoLido.codigo)
  async rastreio(
    @Param('agenda') agenda: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<TelaRastreioResposta> {
    const s = sessaoDe(req);
    const { a, paciente } = await this.agendamentoLido(s, idDaRota(agenda));
    req.sghAlvo = { ...(paciente !== null ? { paciente } : {}), tabelaAlvo: 'SGH_CC_MOVIMENTO' };
    const [movs, agora, gravacao] = await Promise.all([
      this.porta.movimentos(s.porta, a.id),
      this.agora(s),
      this.rastreioApoio.gravacao(s, { mover: P.rastreioMover }),
    ]);
    const codigos = await this.porta.codigos(s.porta, agora, [a.id]);
    const r = estadoDoRastreio(movs);
    const cod = codigos.get(a.id) ?? null;
    return {
      agendamento: a.id,
      sala: a.sala,
      inicio: instanteT(a.inicio),
      paciente: a.paciente.trim(),
      movimentos: movs.map((m) => this.movimentoResposta(m)),
      local:
        r.dentro && r.local !== null
          ? { id: r.local, rotulo: rotuloLocal(r.local)!, desde: r.desde!, salaCirurgica: r.salaCirurgica }
          : null,
      dentro: r.dentro,
      codigoPainel: cod?.codigo ?? null,
      codigoValidoAte: cod?.validoAte ?? null,
      permitidos: movimentosPermitidos(r, agora),
      ultimoMovimento: r.ultimo?.sequencia ?? 0,
      agora,
      gravacao,
    };
  }

  @Post(':agenda/rastreio')
  @HttpCode(201)
  @Permissao(P.rastreioMover)
  @AuditadoNoHandler('cirurgia.moverPacienteBloco: SGH_CC_MOVIMENTO com a SGH_TRILHA na mesma transação')
  async mover(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBlocoSeguro> {
    const s = sessaoDe(req);
    const e = corpo(esquemaMoverPacienteBloco, b);
    const id = this.corpoDaRota(e, agenda);
    const chave = chaveDoPedidoAnestesia(s, e.chave);
    const [{ a, paciente }, dominios, agora] = await Promise.all([
      this.agendamentoLido(s, id),
      this.porta.dominios(s.porta),
      this.agora(s),
    ]);
    this.naoNoFuturo(agora, e.em);
    const locais = dominios.locais.filter((l) => l.ativo).map((l) => l.id);
    if (e.salaCirurgica !== null) {
      const salas = await this.cirurgia.salas(s.porta, s.login);
      if (!salas.some((x) => x.codigo === e.salaCirurgica)) throw recusaBloco('rastreio-local-desconhecido');
    }
    const r = await this.rastreioApoio.sgh(
      s,
      E.pacienteMovidoBloco.codigo,
      P.rastreioMover,
      (x: { id: number }) => ({
        tabela: 'SGH_CC_MOVIMENTO',
        id: String(x.id),
        paciente,
        chave: `${id}:${e.tipo}`,
      }),
      async (g) => {
        await this.conferirNaTransacao(g, id);
        // O reenvio do mesmo pedido (a mesma chave) não grava de novo, antes de qualquer conferência.
        const ja = await g.movimentoPelaChave(chave);
        if (ja) {
          if (ja.agendamento !== id) throw recusaBloco('chave-reutilizada');
          return { id: ja.id, sequencia: ja.sequencia, repetida: true, codigo: null };
        }
        const h = await g.movimentos(id);
        const ultimo = h.at(-1)?.sequencia ?? 0;
        if (ultimo !== e.ultimoVisto) throw recusaBloco('rastreio-mudou');
        const ok = conferirMovimento(
          h,
          { tipo: e.tipo, local: e.local, salaCirurgica: e.salaCirurgica, em: e.em },
          locais,
          agora,
        );
        if (!ok.ok) throw recusaBloco(ok.codigo, 'Rastreio no bloco');
        // A marcação do agendamento do M18 ("no bloco", "em sala"), quando há o registro do novo e a transição cabe.
        const alvo = estadoDoAgendamentoPeloLocal(ok.local);
        const est = alvo && e.tipo !== 'alta' ? await g.estadoDoAgendamento(id) : null;
        const marcar =
          est && alvo && estadoValido(est.estado) && est.estado !== alvo && podeIr(est.estado, alvo)
            ? { id: est.id, estado: alvo }
            : null;
        const entra = e.tipo === 'admissao' || e.tipo === 'readmissao';
        const dia = e.em.slice(0, 10);
        return g.mover({
          agendamento: id,
          sala: a.sala,
          dataHora: instanteT(a.inicio),
          reg: a.reg,
          paciente,
          ultimoVisto: e.ultimoVisto,
          tipo: e.tipo,
          local: ok.local,
          localAnterior: ok.localAnterior,
          salaCirurgica: ok.salaCirurgica,
          em: e.em,
          destino: e.destino,
          observacao: e.observacao,
          estadoAgendamento: marcar,
          codigo: entra
            ? {
                dia,
                sortear: () => gerarCodigoPainel((n) => randomBytes(n)),
                validoAte: validadeDoCodigo(dia),
              }
            : null,
          usuario: s.login,
          chave,
        });
      },
    );
    this.avisar(s);
    const destino = e.destino ? DESTINOS_SAIDA_BLOCO.find((d) => d.codigo === e.destino)?.rotulo : null;
    const local = LOCAIS_BLOCO.find((l) => l.id === e.local)?.rotulo;
    return {
      ok: true,
      id: r.id,
      mensagem:
        e.tipo === 'alta'
          ? `Saída do bloco registrada (${destino ?? 'destino informado'}).`
          : e.tipo === 'cancelamentoAlta'
            ? 'Saída do bloco desfeita.'
            : `Paciente em: ${local ?? 'local informado'}.`,
      codigoPainel: r.codigo,
    };
  }
}
