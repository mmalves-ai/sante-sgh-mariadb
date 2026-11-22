// Notificação de incidentes e eventos adversos, etapa 1 do M48 (ficha, seções 4, 5, 7 e 8; ADR 0031):
//   GET  /api/qualidade/notificacoes/formulario            o diálogo global: a liberação, as unidades e se a anônima
//                                                          vale nesta sessão (na sessão "como", não: D-COMO-48.1)
//   POST /api/qualidade/notificacoes                       qualidade.notificarIncidente (regras 1, 2 e 11): o contexto
//                                                          relido pelo atendimento, a proposta de classificação; devolve
//                                                          o número e o código de acompanhamento (mostrado uma vez)
//   POST /api/qualidade/notificacoes/acompanhar            a devolutiva pelo número e pelo código (mesma resposta para
//                                                          "não existe" e "código errado"; 5 tentativas por minuto)
//   GET  /api/qualidade/nsp/notificacoes                   a lista do NSP (filtros e página de 50)
//   GET  /api/qualidade/nsp/notificacoes/proxima           "Triar próxima": a recebida mais antiga, as graves primeiro
//   GET  /api/qualidade/nsp/notificacoes/:id               o detalhe com a linha do tempo e os prazos
//   POST /api/qualidade/nsp/notificacoes/:id/triar         qualidade.triarNotificacao (confirma ou reclassifica)
//   POST /api/qualidade/nsp/notificacoes/:id/descartar     qualidade.triarNotificacao com o desfecho "descartada"
//   POST /api/qualidade/nsp/notificacoes/:id/distribuir    qualidade.distribuirNotificacao (gestor, unidade e prazo)
//   POST /api/qualidade/nsp/notificacoes/:id/devolutiva    qualidade.devolverAoNotificador
//   GET  /api/qualidade/gestor/notificacoes                as distribuídas ao gestor da sessão (sem o notificador)
//   GET  /api/qualidade/gestor/notificacoes/:id            o detalhe do gestor (sem o notificador; linha do tempo sem autor)
//   GET  /api/qualidade/nsp/prazos                         a fila por prazo regulatório (regra 3) e o resumo do cartão
//   POST /api/qualidade/nsp/notificacoes/:id/notivisa/campos      os campos para transcrição (evento uma vez só)
//   POST /api/qualidade/nsp/notificacoes/:id/notivisa/transcricao qualidade.registrarTranscricaoNotivisa
// Tudo pela chave `qualidade.notificacao` (POL-3). Regra 1 (não punitiva): na anônima, nada liga a pessoa à notificação
// (nem a linha, nem a linha do tempo, nem a trilha, que vai por 'anonimo' sem estação nem correlação do cliente); o
// detalhe do NSP mostra o notificador só da identificada; a resposta de erro nunca traz o paciente. Regra 11: a trilha
// leva só o ID da notificação e o protocolo.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ContextoNotificacaoLido,
  esquemaAcompanharNotificacao,
  esquemaDescartarNotificacao,
  esquemaDevolverAoNotificador,
  esquemaDistribuirNotificacao,
  esquemaFiltroNotificacoes,
  esquemaNotificarIncidente,
  esquemaRegistrarTranscricaoNotivisa,
  esquemaTriarNotificacao,
  EVENTOS_AUDITAVEIS,
  type GrauDano,
  PERMISSOES_QUALIDADE as P,
  type TipoIncidente,
} from '@sgh/contratos';
import {
  acompanhamentoDe,
  ATOR_ANONIMO,
  camposNotivisa,
  conferirDescarte,
  conferirDevolutiva,
  conferirDistribuicao,
  conferirOcorrencia,
  conferirTranscricaoNotivisa,
  conferirTriagem,
  exigeAtencaoImediata,
  formatarProtocolo,
  lerOrigem,
  MENSAGENS_RECUSA_NOTIFICACAO,
  origemParaGravar,
  MENSAGENS_RECUSA_OCORRENCIA,
  projetarNotificacao,
  propostaDeClassificacao,
  type RecusaFluxo,
} from '@sgh/dominio-qualidade';
import type { NotificacaoRegistrada } from './tipos.js';
import { comAto } from '../enfermagem/gravacao-direta.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { type GravadorQualidade, PORTA_QUALIDADE, type PortaQualidade } from './porta.js';
import {
  anosDosPrazos,
  calendario,
  codigoAcompanhamento,
  codigoConfere,
  detalheDe,
  estadoDe,
  prazosDe,
  resumoDaChave,
  resumoDe,
  resumoDosPrazos,
  resumoSha256,
} from './servico.js';
import { inicioDoTurno, RESUMO_SUGESTAO, type ResumoSugestao } from './servico-seguranca.js';

/** A chave da funcionalidade (recursos de liberação do M08; ficha, seção 12). */
export const CHAVE_QUALIDADE_NOTIFICACAO = 'qualidade.notificacao';
const E = EVENTOS_AUDITAVEIS;
const TABELA = 'notificacao_incidente';
const POR_PAGINA = 50;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
/** Tentativas de acompanhamento por sessão e minuto (o código não se adivinha por força bruta). */
const TENTATIVAS_POR_MINUTO = 5;

const recusaFluxo = (motivo: RecusaFluxo) =>
  new ErroProblema('recusa-de-negocio', 409, 'Notificação', MENSAGENS_RECUSA_NOTIFICACAO[motivo] ?? motivo, {
    codigo: motivo,
    bloqueios: [motivo],
  });
const entrada = (detalhe: string, campos: readonly string[], codigo = 'entrada-invalida') =>
  new ErroProblema('entrada-invalida', 422, 'Notificação', detalhe, { codigo, campos: [...campos] });
const naoEncontrada = () => new ErroProblema('nao-encontrado', 404, 'Notificação não encontrada');
/** A mesma resposta para "não existe" e "código errado" (não revela se o número existe). */
const acompanhamentoNegado = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Notificação não encontrada',
    'Confira o número de acompanhamento e o código.',
  );

/** A notificação foi distribuída a este login (a distribuição grava o gestor em maiúsculas). */
const mesmoGestor = (n: { readonly gestor: string | null }, login: string) =>
  n.gestor !== null && n.gestor.trim().toUpperCase() === login.trim().toUpperCase();

function cabecalhoChave(s: SessaoCadastro): string | null {
  const bruto = s.req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (k === undefined || k === '') return null;
  if (typeof k !== 'string' || !CHAVE.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'A Idempotency-Key do pedido é inválida.',
    );
  return k;
}

@Controller('qualidade')
export class NotificacaoController {
  private readonly apoio: ApoioGravacao<GravadorQualidade>;
  /** Tentativas de acompanhamento por sessão (só em memória; nunca gravadas). */
  private readonly tentativas = new Map<string, number[]>();

  constructor(
    @Inject(PORTA_QUALIDADE) private readonly porta: PortaQualidade,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(RESUMO_SUGESTAO) private readonly resumoSugestao: ResumoSugestao | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      {
        chave: CHAVE_QUALIDADE_NOTIFICACAO,
        nome: 'a notificação de incidentes',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private agora(s: SessaoCadastro): Promise<string> {
    return this.porta.relogio(s.porta);
  }

  private async nomesDasUnidades(s: SessaoCadastro): Promise<(c: number | null) => string | null> {
    const us = await this.porta.unidades(s.porta).catch(() => []);
    const m = new Map(us.map((u) => [u.codigo, u.nome]));
    return (c) => (c === null ? null : (m.get(c) ?? `Unidade ${String(c)}`));
  }

  private async feriadosDos(s: SessaoCadastro, anos: readonly number[]): Promise<ReadonlySet<string>> {
    const de = `${String(Math.min(...anos))}-01-01`;
    const ate = `${String(Math.max(...anos))}-12-31`;
    return calendario(await this.porta.feriados(s.porta, de, ate), anos);
  }

  private async notificacaoOu404(s: SessaoCadastro, id: number): Promise<NotificacaoRegistrada> {
    const n = await this.porta.notificacao(s.porta, id);
    if (!n) throw naoEncontrada();
    return n;
  }

  /** As ações do NSP para a tela (a liberação e as permissões). */
  private async gravacao(s: SessaoCadastro) {
    const l = await this.apoio.liberacao(s);
    return {
      ligada: l.ligada,
      motivo: l.motivo,
      acoes: {
        triar: l.ligada && s.pode(P.notificacaoTriar),
        notivisa: l.ligada && s.pode(P.notivisaExportar),
      },
    };
  }

  /** Gravação do fluxo do NSP com a trilha só com o ID e o protocolo (regra 11). */
  private fluxo<T>(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    n: NotificacaoRegistrada,
    fn: (g: GravadorQualidade) => Promise<T>,
  ): Promise<T> {
    return this.apoio.sgh(s, evento, recurso, { tabela: TABELA, id: String(n.id), chave: n.protocolo }, fn);
  }

  // ── O botão global (todo perfil de pessoa) ─────────────────────────────────────────────────────

  /** O botão da barra superior: aparece só com a funcionalidade liberada (leitura leve, sem o legado). */
  @Get('notificacoes/botao')
  @Permissao(P.notificacaoCriar)
  async botao(@Req() req: RequisicaoAutorizada) {
    const l = await this.apoio.liberacao(sessaoDe(req));
    return { ligada: l.ligada };
  }

  @Get('notificacoes/formulario')
  @Permissao(P.notificacaoCriar)
  async formulario(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [l, unidades, agora] = await Promise.all([
      this.apoio.liberacao(s),
      this.porta.unidades(s.porta),
      this.agora(s),
    ]);
    return { ligada: l.ligada, motivo: l.motivo, unidades, anonimaPermitida: !req.sghComo, agora };
  }

  @Post('notificacoes')
  @HttpCode(201)
  @Permissao(P.notificacaoCriar)
  @AuditadoNoHandler(
    'qualidade.notificarIncidente: notificacao_incidente e o evento recebida com a trilha_auditoria na mesma transação (anônima por anonimo, sem estação)',
  )
  async notificar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaNotificarIncidente, b);
    await this.apoio.exigirLiberacao(s);
    // D-COMO-48.1: na sessão "como", a notificação sai identificada (o alvo, com a marca do suporte técnico nos eventos: ADR 0021, R1), nunca anônima.
    if (e.anonima && req.sghComo)
      throw entrada(
        'No acesso de suporte a notificação não pode ser anônima: ela sai identificada, com a marca do suporte técnico em nome de quem você atende.',
        ['anonima'],
        'anonima-no-suporte',
      );
    const agora = await this.agora(s);
    const ocorrencia = conferirOcorrencia(e.ocorridoEm, agora);
    if (ocorrencia) throw entrada(MENSAGENS_RECUSA_OCORRENCIA[ocorrencia], ['ocorridoEm'], ocorrencia);
    let ctx: ContextoNotificacaoLido | null = null;
    if (e.atendimento !== null) {
      ctx = await this.porta.contexto(s.porta, e.atendimento);
      // Sem o nome nem o motivo: quem notifica não precisa ter acesso ao prontuário (IDOR).
      if (!ctx)
        throw entrada(
          'O atendimento da tela não foi encontrado: escolha a unidade.',
          ['atendimento'],
          'sem-atendimento',
        );
    }
    const unidade = ctx?.unidade ?? e.unidade;
    if (!ctx && e.unidade !== null) {
      const us = await this.porta.unidades(s.porta);
      if (!us.some((u) => u.codigo === e.unidade))
        throw entrada('Escolha uma unidade da lista.', ['unidade']);
    }
    const chave = cabecalhoChave(s);
    const codigo = codigoAcompanhamento(s.hospital, chave);
    const classificacao = propostaDeClassificacao(e.chegouAoPaciente, e.danoPercebido);
    const evento = E.qualidadeIncidenteNotificado.codigo;
    const operacao = 'qualidade.notificarIncidente';
    // Regra de anonimato: a trilha da anônima vai sem a conta e sem a estação (só o evento, o alvo e o protocolo).
    const trilhaDe = (r: { id: number; protocolo: string }): TrilhaDaGravacao => {
      const l = linhaTrilha(s, evento, P.notificacaoCriar, operacao, {
        tabela: TABELA,
        id: String(r.id),
        chave: r.protocolo,
      });
      return e.anonima
        ? {
            ...l,
            usuario: null,
            correlacao: 'notificacao',
            dadosDepois: { evento, recurso: P.notificacaoCriar, operacao, chave: r.protocolo },
          }
        : l;
    };
    // Etapa 2 (regra 4 e regra 1): a sugestão de onde o diálogo veio fica resolvida pelo resumo (origem + login, sem
    // ligar a pessoa à notificação), e a anônima guarda só a fonte da sugestão (sem o ID do registro de origem).
    const sugestao = e.origem.sugestao && lerOrigem(e.origem.sugestao) ? e.origem.sugestao : null;
    // Regra de anonimato: a gravação anônima vai sem a conta E sem a correlação da requisição (o cabeçalho poderia ligar
    // a linha da trilha às outras requisições da mesma pessoa); a correlação é a fixa `notificacao`.
    // O reenvio pela mesma chave do diálogo é o mesmo ato (idempotência do Executor: o resultado guardado, sem trilha nova);
    // o ato guarda só o resumo da chave, nunca a chave crua.
    const semAto = e.anonima ? { ...s.porta, usuario: null, correlacao: 'notificacao' } : s.porta;
    const contextoGravacao = chave ? comAto(semAto, resumoDaChave(s.hospital, chave), e) : semAto;
    const r = await this.porta.gravarSgh(contextoGravacao, trilhaDe, async (g) => {
      const x = await g.notificar({
        agora,
        protocoloDe: formatarProtocolo,
        codigoResumo: resumoSha256(codigo),
        chaveResumo: chave ? resumoDaChave(s.hospital, chave) : null,
        // Regra 1: a anônima vinda de sugestão vai com a hora pelo início do turno (a hora exata, com o atendimento e a
        // fonte, apontaria o registro de origem e quem o fez).
        ocorridoEm: e.anonima && sugestao !== null ? inicioDoTurno(e.ocorridoEm) : e.ocorridoEm,
        atendimento: ctx?.atendimento ?? null,
        paciente: ctx?.paciente ?? null,
        unidade,
        leito: ctx?.leito ?? null,
        local: e.local,
        tipo: e.tipo,
        tipoOutro: e.tipo === 'outro' ? e.tipoOutro : null,
        chegouAoPaciente: e.chegouAoPaciente,
        danoPercebido: e.danoPercebido,
        classificacao,
        descricao: e.descricao,
        anonima: e.anonima,
        notificador: s.login,
        origemTela: e.origem.tela,
        origemSugestao: origemParaGravar(sugestao, e.anonima),
      });
      if (sugestao !== null && !x.repetida && this.resumoSugestao)
        await g.resolverSugestao({
          resumo: this.resumoSugestao.resumo(s.hospital, s.login, sugestao),
          dia: agora.slice(0, 10),
        });
      return x;
    });
    if (this.porta.destino === 'memoria' && !r.repetida) {
      const l = trilhaDe(r);
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: e.anonima ? ATOR_ANONIMO : s.login,
        estacao: '',
        correlacao: l.correlacao ?? 'notificacao',
        recurso: P.notificacaoCriar,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: String(r.id),
      });
    }
    // Repetida sem a chave do pedido nunca acontece (sem chave não há repetição); com a chave, o código é o mesmo.
    return { protocolo: r.protocolo, codigoAcompanhamento: codigo, repetida: r.repetida };
  }

  @Post('notificacoes/acompanhar')
  @HttpCode(200)
  @Permissao(P.notificacaoCriar)
  @AuditadoNoHandler(
    'só leitura da devolutiva pelo número e código; sem trilha, para não ligar quem consulta à notificação (regra 1)',
  )
  async acompanhar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAcompanharNotificacao, b);
    const chave = resumoSha256(`${s.hospital}:${s.login.toUpperCase()}`);
    const agoraMs = Date.now();
    const recentes = (this.tentativas.get(chave) ?? []).filter((t) => agoraMs - t < 60_000);
    if (recentes.length >= TENTATIVAS_POR_MINUTO)
      throw new ErroProblema(
        'muitas-tentativas',
        429,
        'Muitas tentativas',
        'Aguarde um minuto antes de consultar de novo.',
      );
    this.tentativas.set(chave, [...recentes, agoraMs]);
    const n = await this.porta.porProtocolo(s.porta, e.protocolo);
    if (!n || !codigoConfere(e.codigo, n.codigoResumo)) throw acompanhamentoNegado();
    const eventos = await this.porta.eventos(s.porta, n.id);
    const agora = await this.agora(s);
    const d = detalheDe(n, eventos, null, agora, new Set(), () => null);
    return acompanhamentoDe(d);
  }

  // ── Núcleo de Segurança do Paciente ────────────────────────────────────────────────────────────

  /** A fila de prazos (regra 3), em ordem do prazo que vence primeiro. */
  private async filaDePrazos(s: SessaoCadastro, agora: string) {
    const r = await this.porta.comPrazo(s.porta);
    const anos = anosDosPrazos(r.itens, agora);
    const [feriados, nomes] = await Promise.all([this.feriadosDos(s, anos), this.nomesDasUnidades(s)]);
    const itens = r.itens
      .map((n) => resumoDe(n, agora, feriados, nomes))
      .filter((x) => x.proximoPrazo !== null)
      .sort(
        (a, b) => (a.proximoPrazo?.venceEm ?? '').localeCompare(b.proximoPrazo?.venceEm ?? '') || a.id - b.id,
      );
    return { itens, cortada: r.cortada, feriados };
  }

  @Get('nsp/notificacoes')
  @Permissao(P.notificacaoLer)
  @Auditar(E.qualidadeNotificacaoLida.codigo)
  async lista(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(
      esquemaFiltroNotificacoes,
      Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '')),
    );
    const agora = await this.agora(s);
    // O filtro por prazo é calculado (regra 3): os IDs da fila com a situação pedida.
    const ids = f.prazo
      ? (await this.filaDePrazos(s, agora)).itens
          .filter((x) => x.proximoPrazo?.situacao === f.prazo)
          .map((x) => x.id)
      : undefined;
    const r = await this.porta.lista(s.porta, {
      ...(f.situacao ? { situacao: f.situacao } : {}),
      ...(f.tipo ? { tipo: f.tipo } : {}),
      ...(f.classificacao ? { classificacao: f.classificacao } : {}),
      ...(f.unidade !== undefined ? { unidade: f.unidade } : {}),
      ...(f.de ? { de: f.de } : {}),
      ...(f.ate ? { ate: f.ate } : {}),
      ...(f.protocolo ? { protocolo: f.protocolo } : {}),
      ...(ids ? { ids } : {}),
      pagina: f.pagina,
      porPagina: POR_PAGINA,
    });
    const anos = anosDosPrazos(r.itens, agora);
    const [feriados, nomes, gravacao] = await Promise.all([
      this.feriadosDos(s, anos),
      this.nomesDasUnidades(s),
      this.gravacao(s),
    ]);
    req.sghAlvo = { tabelaAlvo: TABELA, chaveNaturalAlvo: `lista:${String(r.itens.length)}` };
    return {
      itens: r.itens.map((n) => resumoDe(n, agora, feriados, nomes)),
      temMais: r.temMais,
      pagina: f.pagina,
      agora,
      gravacao,
    };
  }

  @Get('nsp/notificacoes/proxima')
  @Permissao(P.notificacaoTriar)
  @Auditar(E.qualidadeNotificacaoLida.codigo)
  async proxima(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const r = await this.porta.lista(s.porta, { situacao: 'recebida', pagina: 1, porPagina: 500 });
    const graves = r.itens.filter((n) => exigeAtencaoImediata(n.dano as GrauDano, n.neverEvent));
    const maisAntiga = (xs: readonly NotificacaoRegistrada[]) =>
      [...xs].sort((a, b) => a.notificadaEm.localeCompare(b.notificadaEm) || a.id - b.id)[0] ?? null;
    const n = maisAntiga(graves) ?? maisAntiga(r.itens);
    req.sghAlvo = { tabelaAlvo: TABELA, ...(n ? { idAlvo: String(n.id) } : { chaveNaturalAlvo: 'nenhuma' }) };
    return { id: n?.id ?? null, protocolo: n?.protocolo ?? null };
  }

  /** A escolha do gestor da área na distribuição (busca por login ou nome; contas ativas; teto 20). */
  @Get('nsp/gestores')
  @Permissao(P.notificacaoTriar)
  async gestores(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const termo = String(busca ?? '')
      .trim()
      .slice(0, 40);
    return { itens: termo.length < 2 ? [] : await this.porta.gestores(s.porta, termo) };
  }

  @Get('nsp/notificacoes/:id')
  @Permissao(P.notificacaoLer)
  @Auditar(E.qualidadeNotificacaoLida.codigo)
  async detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = await this.notificacaoOu404(s, idDaRota(id));
    const agora = await this.agora(s);
    const [eventos, contexto, feriados, nomes, gravacao] = await Promise.all([
      this.porta.eventos(s.porta, n.id),
      n.atendimento !== null ? this.porta.contexto(s.porta, n.atendimento) : Promise.resolve(null),
      this.feriadosDos(s, anosDosPrazos([n], agora)),
      this.nomesDasUnidades(s),
      this.gravacao(s),
    ]);
    req.sghAlvo = { tabelaAlvo: TABELA, idAlvo: String(n.id), chaveNaturalAlvo: n.protocolo };
    const d = projetarNotificacao(detalheDe(n, eventos, contexto, agora, feriados, nomes), { papel: 'nsp' });
    return { notificacao: d, agora, gravacao };
  }

  // ── O gestor da área (regra 1: só as distribuídas a ele, nunca quem notificou nem quem fez cada passo) ──────────
  // D-GESTOR-LEITURA-48.1: o acesso vem da distribuição (GESTOR = login da sessão), não de um perfil: o NSP escolhe o
  // gestor entre as contas ativas (D-GESTOR-48.1), e a leitura vale para quem foi escolhido. A conferência por
  // `qualidade.analise.ler` e a tela do gestor entram na etapa 2, com a análise e o plano de ação.

  @Get('gestor/notificacoes')
  @Permissao(P.notificacaoCriar)
  @Auditar(E.qualidadeNotificacaoLida.codigo)
  async listaDoGestor(@Query('pagina') pagina: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const p = Math.max(1, Math.min(10_000, Number.parseInt(pagina ?? '1', 10) || 1));
    const agora = await this.agora(s);
    // O filtro vai na consulta (pelo índice do gestor); o filtro de novo aqui é a última barreira, não a única.
    const r = await this.porta.lista(s.porta, { gestor: s.login, pagina: p, porPagina: POR_PAGINA });
    const doGestor = r.itens.filter((n) => mesmoGestor(n, s.login));
    const anos = anosDosPrazos(doGestor, agora);
    const [feriados, nomes] = await Promise.all([this.feriadosDos(s, anos), this.nomesDasUnidades(s)]);
    req.sghAlvo = { tabelaAlvo: TABELA, chaveNaturalAlvo: `gestor:${String(doGestor.length)}` };
    return {
      itens: doGestor.map((n) => resumoDe(n, agora, feriados, nomes)),
      temMais: r.temMais,
      pagina: p,
      agora,
    };
  }

  @Get('gestor/notificacoes/:id')
  @Permissao(P.notificacaoCriar)
  @Auditar(E.qualidadeNotificacaoLida.codigo)
  async detalheDoGestor(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = await this.notificacaoOu404(s, idDaRota(id));
    // Não distribuída a ele: a mesma resposta de "não existe" (não revela que existe).
    if (!mesmoGestor(n, s.login)) throw naoEncontrada();
    const agora = await this.agora(s);
    const [eventos, contexto, feriados, nomes] = await Promise.all([
      this.porta.eventos(s.porta, n.id),
      n.atendimento !== null ? this.porta.contexto(s.porta, n.atendimento) : Promise.resolve(null),
      this.feriadosDos(s, anosDosPrazos([n], agora)),
      this.nomesDasUnidades(s),
    ]);
    req.sghAlvo = { tabelaAlvo: TABELA, idAlvo: String(n.id), chaveNaturalAlvo: n.protocolo };
    const d = projetarNotificacao(detalheDe(n, eventos, contexto, agora, feriados, nomes), {
      papel: 'gestor',
      login: s.login,
    });
    if (!d) throw naoEncontrada();
    return { notificacao: d, agora };
  }

  @Post('nsp/notificacoes/:id/triar')
  @HttpCode(200)
  @Permissao(P.notificacaoTriar)
  @AuditadoNoHandler(
    'qualidade.triarNotificacao: notificacao_incidente e a linha do tempo com a trilha_auditoria',
  )
  async triar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaTriarNotificacao, { ...(b as object), notificacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const n = await this.notificacaoOu404(s, e.notificacao);
    const r = await this.fluxo(s, E.qualidadeNotificacaoTriada.codigo, P.notificacaoTriar, n, async (g) => {
      const atual = await g.travar(n.id);
      const c = conferirTriagem(estadoDe(atual), e);
      if (!c.ok) throw recusaFluxo(c.motivo);
      if (c.valor.eventos.length === 0) return { versao: atual.versao, mudou: false };
      const v = await g.triar({
        id: n.id,
        versao: e.versao,
        usuario: s.login,
        agora,
        tipo: e.tipo,
        tipoOutro: e.tipoOutro,
        classificacao: e.classificacao,
        dano: e.dano,
        neverEvent: e.neverEvent,
        justificativa: e.justificativa,
        eventos: c.valor.eventos as ('triada' | 'reclassificada')[],
        antes: {
          tipo: atual.tipo,
          classificacao: atual.classificacao,
          dano: atual.dano,
          neverEvent: atual.neverEvent,
        },
      });
      return { versao: v.versao, mudou: true };
    });
    return {
      ok: true,
      id: n.id,
      versao: r.versao,
      mensagem: r.mudou ? 'Notificação triada.' : 'Nada mudou.',
    };
  }

  @Post('nsp/notificacoes/:id/descartar')
  @HttpCode(200)
  @Permissao(P.notificacaoTriar)
  @AuditadoNoHandler(
    'qualidade.triarNotificacao (descartada): notificacao_incidente e a linha do tempo com a trilha_auditoria',
  )
  async descartar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDescartarNotificacao, { ...(b as object), notificacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const n = await this.notificacaoOu404(s, e.notificacao);
    if (e.duplicadaDe !== null && e.duplicadaDe !== n.protocolo) {
      const original = await this.porta.porProtocolo(s.porta, e.duplicadaDe);
      if (!original) throw entrada('A notificação original não foi encontrada.', ['duplicadaDe']);
    }
    const r = await this.fluxo(s, E.qualidadeNotificacaoTriada.codigo, P.notificacaoTriar, n, async (g) => {
      const c = conferirDescarte(estadoDe(await g.travar(n.id)), e);
      if (!c.ok) throw recusaFluxo(c.motivo);
      return g.descartar({
        id: n.id,
        versao: e.versao,
        usuario: s.login,
        agora,
        motivo: e.motivo,
        justificativa: e.justificativa,
        duplicadaDe: e.duplicadaDe,
      });
    });
    return { ok: true, id: n.id, versao: r.versao, mensagem: 'Notificação descartada.' };
  }

  @Post('nsp/notificacoes/:id/distribuir')
  @HttpCode(200)
  @Permissao(P.notificacaoTriar)
  @AuditadoNoHandler(
    'qualidade.distribuirNotificacao: notificacao_incidente e a linha do tempo com a trilha_auditoria',
  )
  async distribuir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDistribuirNotificacao, { ...(b as object), notificacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const n = await this.notificacaoOu404(s, e.notificacao);
    const [ativo, unidades] = await Promise.all([
      this.porta.usuarioAtivo(s.porta, e.gestor),
      this.porta.unidades(s.porta),
    ]);
    if (!ativo) throw entrada('O gestor escolhido não tem acesso ativo neste estabelecimento.', ['gestor']);
    if (!unidades.some((u) => u.codigo === e.unidade))
      throw entrada('Escolha uma unidade da lista.', ['unidade']);
    const r = await this.fluxo(
      s,
      E.qualidadeNotificacaoDistribuida.codigo,
      P.notificacaoTriar,
      n,
      async (g) => {
        const c = conferirDistribuicao(estadoDe(await g.travar(n.id)), e, agora.slice(0, 10));
        if (!c.ok) throw recusaFluxo(c.motivo);
        return g.distribuir({
          id: n.id,
          versao: e.versao,
          usuario: s.login,
          agora,
          gestor: e.gestor.toUpperCase(),
          unidade: e.unidade,
          prazoAnalise: e.prazoAnalise,
          orientacao: e.orientacao,
        });
      },
    );
    return { ok: true, id: n.id, versao: r.versao, mensagem: 'Notificação distribuída ao gestor da área.' };
  }

  @Post('nsp/notificacoes/:id/devolutiva')
  @HttpCode(200)
  @Permissao(P.notificacaoTriar)
  @AuditadoNoHandler('qualidade.devolverAoNotificador: a linha do tempo com a trilha_auditoria')
  async devolutiva(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDevolverAoNotificador, { ...(b as object), notificacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const n = await this.notificacaoOu404(s, e.notificacao);
    const r = await this.fluxo(
      s,
      E.qualidadeNotificacaoDevolvida.codigo,
      P.notificacaoTriar,
      n,
      async (g) => {
        const c = conferirDevolutiva(estadoDe(await g.travar(n.id)), e.versao);
        if (!c.ok) throw recusaFluxo(c.motivo);
        return g.devolver({ id: n.id, versao: e.versao, usuario: s.login, agora, texto: e.texto });
      },
    );
    return { ok: true, id: n.id, versao: r.versao, mensagem: 'Devolutiva registrada.' };
  }

  @Get('nsp/prazos')
  @Permissao(P.notivisaExportar)
  @Auditar(E.qualidadeNotificacaoLida.codigo)
  async prazos(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const [f, gravacao] = await Promise.all([this.filaDePrazos(s, agora), this.gravacao(s)]);
    req.sghAlvo = { tabelaAlvo: TABELA, chaveNaturalAlvo: `prazos:${String(f.itens.length)}` };
    return {
      itens: f.itens,
      cortada: f.cortada,
      resumo: resumoDosPrazos(f.itens, Number(agora.slice(0, 4)), f.feriados),
      agora,
      gravacao,
    };
  }

  @Get('nsp/prazos/resumo')
  @Permissao(P.notivisaExportar)
  async resumoPrazos(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const f = await this.filaDePrazos(s, agora);
    return { ...resumoDosPrazos(f.itens, Number(agora.slice(0, 4)), f.feriados), cortada: f.cortada, agora };
  }

  @Post('nsp/notificacoes/:id/notivisa/campos')
  @HttpCode(200)
  @Permissao(P.notivisaExportar)
  @AuditadoNoHandler(
    'os campos do Notivisa: NOTIVISA_EXPORTADA_EM e o evento notivisaExportada (uma vez) com a trilha_auditoria',
  )
  async camposNotivisa(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    await this.apoio.exigirLiberacao(s);
    const n = await this.notificacaoOu404(s, idDaRota(id));
    if (!n.triada || n.situacao === 'descartada') throw recusaFluxo('situacao-nao-permite');
    const agora = await this.agora(s);
    const [contexto, feriados, nomes] = await Promise.all([
      n.atendimento !== null ? this.porta.contexto(s.porta, n.atendimento) : Promise.resolve(null),
      this.feriadosDos(s, anosDosPrazos([n], agora)),
      this.nomesDasUnidades(s),
    ]);
    const campos = camposNotivisa(
      {
        protocolo: n.protocolo,
        tipo: n.tipo as TipoIncidente,
        tipoOutro: n.tipoOutro,
        classificacao: estadoDe(n).classificacao,
        dano: n.dano as GrauDano,
        neverEvent: n.neverEvent,
        ocorridoEm: n.ocorridoEm,
        unidade: nomes(n.unidade),
        local: n.local ?? n.leito,
        descricao: n.descricao,
        paciente: contexto
          ? { nome: contexto.nomePaciente, sexo: contexto.sexo, nascimento: contexto.nascimento }
          : null,
      },
      prazosDe(n, agora, feriados),
    );
    if (n.notivisaExportadaEm === null)
      await this.fluxo(s, E.qualidadeNotivisaExportada.codigo, P.notivisaExportar, n, (g) =>
        g.notivisaExportada({ id: n.id, usuario: s.login, agora }),
      );
    return { campos };
  }

  @Post('nsp/notificacoes/:id/notivisa/transcricao')
  @HttpCode(200)
  @Permissao(P.notivisaExportar)
  @AuditadoNoHandler(
    'qualidade.registrarTranscricaoNotivisa: notificacao_incidente e a linha do tempo com a trilha_auditoria',
  )
  async transcricao(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarTranscricaoNotivisa, { ...(b as object), notificacao: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const agora = await this.agora(s);
    const n = await this.notificacaoOu404(s, e.notificacao);
    const r = await this.fluxo(s, E.qualidadeNotivisaTranscrita.codigo, P.notivisaExportar, n, async (g) => {
      const c = conferirTranscricaoNotivisa(estadoDe(await g.travar(n.id)), e, agora);
      if (!c.ok) throw recusaFluxo(c.motivo);
      return g.transcricao({
        id: n.id,
        versao: e.versao,
        usuario: s.login,
        agora,
        numeroNotivisa: e.numeroNotivisa,
        transcritaEm: e.transcritaEm,
      });
    });
    return { ok: true, id: n.id, versao: r.versao, mensagem: 'Transcrição no Notivisa registrada.' };
  }
}
