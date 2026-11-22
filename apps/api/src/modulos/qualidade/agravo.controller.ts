// Notificação compulsória de agravos (M48, etapa 4; ficha, seções 4, 5, 7 e 8, regras 3, 8 e 11; cap-05b §5.11,
// "Notificação compulsória"; manual m17 "Notificação compulsória de agravos"; DP-47.3). Tudo só do novo (SGH_QUA_AGRAVO_*
// com a trilha_auditoria na mesma transação); o outro sistema é lido (cadastro de CID, atendimentos, óbitos, resultados,
// paciente, unidade, modelos e perguntas da ficha). A chave `qualidade.agravos` liga as gravações (recolher = só
// consulta). Rotas:
//   GET  /api/qualidade/vigilancia/agravos/resumo             o cartão e o cabeçalho (abertos, imediatos, vencidos)
//   GET  /api/qualidade/vigilancia/agravos/gatilhos           a fila de gatilhos sem caso (CID, resultado, óbito)
//   GET  /api/qualidade/vigilancia/agravos/casos              os casos (abertos primeiro pelo prazo)
//   GET  /api/qualidade/vigilancia/agravos/casos/:id          o caso
//   GET  /api/qualidade/vigilancia/agravos/casos/:id/ficha    a ficha SINAN pré-preenchida
//   POST /api/qualidade/vigilancia/agravos/casos              qualidade.abrirCasoAgravo
//   POST /api/qualidade/vigilancia/agravos/casos/:id/notificacao  qualidade.registrarNotificacaoAgravo
//   POST /api/qualidade/vigilancia/agravos/casos/:id/descarte     qualidade.descartarCasoAgravo
//   GET  /api/qualidade/vigilancia/agravos/cids               a lista nacional (CIDs notificáveis do cadastro)
//   GET  /api/qualidade/vigilancia/agravos/gatilhos-exame     os exames cujo resultado reagente sugere o agravo
//   POST /api/qualidade/vigilancia/agravos/gatilhos-exame     qualidade.configurarGatilhoExame
// Nenhum nome de paciente, CID ou dado clínico vai à trilha (só os IDs das linhas SGH_); a leitura da fila, do caso e da
// ficha é auditada (`qualidade.agravo.lido`).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CasoAgravoLido,
  type CidNotificavel,
  esquemaAbrirCasoAgravo,
  esquemaConfigurarGatilhoExame,
  esquemaDescartarCasoAgravo,
  esquemaFiltroCasosAgravo,
  esquemaFiltroGatilhosAgravo,
  esquemaRegistrarNotificacaoAgravo,
  EVENTOS_AUDITAVEIS,
  type FichaAgravo,
  type PeriodicidadeAgravo,
  PERMISSOES_AGRAVO as P,
  type ResumoAgravos,
  type SituacaoCasoAgravo,
} from '@sgh/contratos';
import {
  chaveGatilho,
  cidNotificavel,
  ehResultadoReagente,
  idadeEmAnos,
  JANELA_MESMO_CASO_DIAS,
  MENSAGENS_RECUSA_AGRAVO,
  modeloDaFicha,
  normalizarTexto,
  notificadoComAtraso,
  prazoDoAgravo,
  preencherFicha,
  type RecusaAgravo,
  recusaAbertura,
  recusaDescarte,
  recusaNotificacao,
  somarDias,
  TERMOS_RESULTADO_REAGENTE,
} from '@sgh/dominio-qualidade';
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
import { type GravadorAgravo, PORTA_AGRAVO, type PortaAgravo } from './porta-agravo.js';
import {
  cadastroDe,
  casoLido,
  filaDeGatilhos,
  gatilhosExameVigentesDe,
  pacienteAgravo,
  padroesDeExame,
} from './servico-agravo.js';

/** A chave da funcionalidade (recursos de liberação do M08; ficha, seção 12). */
export const CHAVE_QUALIDADE_AGRAVOS = 'qualidade.agravos';
const E = EVENTOS_AUDITAVEIS;
/** Teto da busca na lista nacional. */
const TETO_CIDS = 100;

const recusaAgravo = (motivo: RecusaAgravo, status = 409) =>
  new ErroProblema(
    status === 422 ? 'entrada-invalida' : 'recusa-de-negocio',
    status,
    'Notificação compulsória',
    MENSAGENS_RECUSA_AGRAVO[motivo],
    { codigo: motivo, bloqueios: [motivo] },
  );
const naoEncontrado = (o = 'Caso') => new ErroProblema('nao-encontrado', 404, `${o} não encontrado`);
const semSegundos = (t: string) => (t.length === 16 ? `${t}:00` : t.slice(0, 19));

@Controller('qualidade/vigilancia/agravos')
export class AgravoController {
  private readonly apoio: ApoioGravacao<GravadorAgravo>;

  constructor(
    @Inject(PORTA_AGRAVO) private readonly porta: PortaAgravo,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_QUALIDADE_AGRAVOS, nome: 'a notificação compulsória de agravos', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private agora(s: SessaoCadastro): Promise<string> {
    return this.porta.relogio(s.porta);
  }

  /** A fila de gatilhos sem caso, da janela pedida (as leituras do outro sistema e os casos já abertos). */
  private async fila(s: SessaoCadastro, dias: number) {
    const agora = await this.agora(s);
    const desde = `${somarDias(agora.slice(0, 10), -dias)}T00:00:00`;
    const [cids, configurados] = await Promise.all([
      this.porta.cidsNotificaveis(s.porta),
      this.porta.gatilhosExame(s.porta),
    ]);
    const gatilhosExame = gatilhosExameVigentesDe(configurados);
    const [atd, obitos, res, casos, unidades] = await Promise.all([
      this.porta.atendimentosComCid(s.porta, desde),
      this.porta.obitos(s.porta, desde),
      this.porta.resultados(s.porta, desde, padroesDeExame(gatilhosExame), TERMOS_RESULTADO_REAGENTE),
      this.porta.casosDesde(s.porta, `${somarDias(desde.slice(0, 10), -JANELA_MESMO_CASO_DIAS)}T00:00:00`),
      this.porta.unidades(s.porta),
    ]);
    const pacientes = await this.porta.pacientes(s.porta, [
      ...atd.itens.map((x) => x.paciente),
      ...obitos.map((x) => x.paciente),
      ...res.itens.map((x) => x.paciente),
    ]);
    const itens = filaDeGatilhos({
      cadastro: cadastroDe(cids),
      atendimentos: atd.itens,
      obitos,
      resultados: res.itens,
      pacientes,
      unidades,
      gatilhosExame,
      casos,
      agora,
    });
    return { itens, cortada: atd.cortado || res.cortado, desde, agora };
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────

  @Get('resumo')
  @Permissao(P.ler)
  async resumo(@Req() req: RequisicaoAutorizada): Promise<ResumoAgravos> {
    const s = sessaoDe(req);
    const [f, l] = await Promise.all([this.fila(s, 7), this.apoio.liberacao(s)]);
    const c = await this.porta.contagem(s.porta, f.agora, `${f.agora.slice(0, 7)}-01T00:00:00`);
    return {
      ...c,
      gatilhosSemCaso: f.itens.length,
      ligada: l.ligada,
      motivo: l.motivo,
      podeNotificar: l.ligada && s.pode(P.notificar),
      agora: f.agora,
    };
  }

  @Get('gatilhos')
  @Permissao(P.ler)
  @Auditar(E.qualidadeAgravoLido.codigo)
  async gatilhos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroGatilhosAgravo, q);
    const r = await this.fila(s, f.dias);
    return {
      itens: f.origem ? r.itens.filter((x) => x.origem === f.origem) : r.itens,
      cortada: r.cortada,
      desde: r.desde,
    };
  }

  /** O nome do CID pelo cadastro (o notificável primeiro; o outro só quando preciso). */
  private async nomesDosCids(s: SessaoCadastro, cids: readonly string[]): Promise<Map<string, string>> {
    const cadastro = cadastroDe(await this.porta.cidsNotificaveis(s.porta));
    const m = new Map<string, string>();
    for (const cid of new Set(cids)) {
      const n = cidNotificavel(cid, cadastro)?.nome ?? (await this.porta.cidDoCadastro(s.porta, cid))?.nome;
      m.set(cid, n ?? cid);
    }
    return m;
  }

  @Get('casos')
  @Permissao(P.ler)
  @Auditar(E.qualidadeAgravoLido.codigo)
  async casos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const f = corpo(esquemaFiltroCasosAgravo, q);
    const [agora, pg] = await Promise.all([
      this.agora(s),
      this.porta.casos(s.porta, {
        situacao: f.situacao,
        periodicidade: f.periodicidade,
        desde: f.desde ? `${f.desde}T00:00:00` : undefined,
        ate: f.ate ? `${somarDias(f.ate, 1)}T00:00:00` : undefined,
        pagina: f.pagina,
        porPagina: f.porPagina,
      }),
    ]);
    const [pacientes, nomes] = await Promise.all([
      this.porta.pacientes(
        s.porta,
        pg.itens.map((x) => x.paciente),
      ),
      this.nomesDosCids(
        s,
        pg.itens.map((x) => x.cid),
      ),
    ]);
    return {
      itens: pg.itens.map((x) =>
        casoLido(x, pacienteAgravo(x.paciente, pacientes.get(x.paciente)), nomes.get(x.cid) ?? x.cid, agora),
      ),
      total: pg.total,
      pagina: f.pagina,
      porPagina: f.porPagina,
    };
  }

  private async casoOu404(s: SessaoCadastro, id: number) {
    const x = await this.porta.caso(s.porta, id);
    if (!x) throw naoEncontrado();
    return x;
  }

  @Get('casos/:id')
  @Permissao(P.ler)
  @Auditar(E.qualidadeAgravoLido.codigo)
  async caso(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<CasoAgravoLido> {
    const s = sessaoDe(req);
    const x = await this.casoOu404(s, idDaRota(id));
    const [agora, pacientes, nomes] = await Promise.all([
      this.agora(s),
      this.porta.pacientes(s.porta, [x.paciente]),
      this.nomesDosCids(s, [x.cid]),
    ]);
    return casoLido(
      x,
      pacienteAgravo(x.paciente, pacientes.get(x.paciente)),
      nomes.get(x.cid) ?? x.cid,
      agora,
    );
  }

  @Get('casos/:id/ficha')
  @Permissao(P.ler)
  @Auditar(E.qualidadeAgravoLido.codigo)
  async ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<FichaAgravo> {
    const s = sessaoDe(req);
    const x = await this.casoOu404(s, idDaRota(id));
    const [agora, pacientes, nomes, modelos, unidades, atd] = await Promise.all([
      this.agora(s),
      this.porta.pacientes(s.porta, [x.paciente]),
      this.nomesDosCids(s, [x.cid]),
      this.porta.modelosFicha(s.porta),
      this.porta.unidades(s.porta),
      x.atendimento === null ? Promise.resolve(null) : this.porta.atendimento(s.porta, x.atendimento),
    ]);
    const p = pacientes.get(x.paciente);
    const dataNotificacao = (x.notificadoEm ?? agora).slice(0, 10);
    const idade = idadeEmAnos(p?.nascimento ?? null, x.gatilhoEm);
    const escolhido =
      x.fichaModelo !== null
        ? { modelo: modelos.find((m) => m.id === x.fichaModelo) ?? null, generica: false }
        : modeloDaFicha(x.cid, modelos, idade);
    const generica = escolhido.modelo !== null && escolhido.modelo.nome.toUpperCase().startsWith('PADR');
    const perguntas = escolhido.modelo ? await this.porta.perguntasFicha(s.porta, escolhido.modelo.id) : [];
    const unidade =
      (atd?.unidade !== null && atd?.unidade !== undefined ? unidades.get(atd.unidade) : undefined) ??
      [...unidades.values()][0];
    const r = preencherFicha(perguntas, {
      dataNotificacao,
      cid: x.cid,
      nomeCid: nomes.get(x.cid) ?? x.cid,
      unidadeNotificadora: unidade?.nome ?? null,
      uf: unidade?.uf ?? null,
      municipio: unidade?.cidade ?? null,
      paciente: {
        nome: p?.nome ?? '',
        nascimento: p?.nascimento ?? null,
        sexo: p?.sexo ?? null,
        idadeAnos: idade,
        nomeMae: p?.mae ?? null,
        cns: p?.cns ?? null,
      },
      dataPrimeirosSintomas: null,
    });
    return {
      caso: x.id,
      modelo: escolhido.modelo,
      perguntas: r.perguntas,
      preenchidas: r.preenchidas,
      generica: escolhido.generica || generica,
    };
  }

  @Get('cids')
  @Permissao(P.ler)
  async cids(@Query('busca') busca: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const b = (busca ?? '').trim().toUpperCase().replace('.', '');
    const lista: CidNotificavel[] = [...cadastroDe(await this.porta.cidsNotificaveis(s.porta)).values()]
      .filter((c) => !b || c.cid.startsWith(b) || c.nome.toUpperCase().includes(b))
      .map((c) => ({ cid: c.cid, nome: c.nome, periodicidade: c.periodicidade }));
    return { itens: lista.slice(0, TETO_CIDS), total: lista.length };
  }

  @Get('gatilhos-exame')
  @Permissao(P.ler)
  async gatilhosExame(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return { itens: gatilhosExameVigentesDe(await this.porta.gatilhosExame(s.porta)) };
  }

  // ── Gravações ────────────────────────────────────────────────────────────────────────────────────

  /** Confere que o gatilho existe no outro sistema e é do paciente informado. */
  private async conferirGatilho(
    s: SessaoCadastro,
    e: { origem: string; atendimento: number | null; exame: number | null; paciente: number; cid: string },
  ): Promise<void> {
    if (e.atendimento !== null) {
      const a = await this.porta.atendimento(s.porta, e.atendimento);
      if (!a) throw recusaAgravo('gatilho-nao-confirmado', 422);
      if (a.paciente !== e.paciente) throw recusaAgravo('atendimento-de-outro-paciente', 422);
      if (e.origem === 'cid' && !a.cids.includes(e.cid)) throw recusaAgravo('gatilho-nao-confirmado', 422);
      if (e.origem === 'obito') {
        const obito = a.obitoEm ?? (await this.porta.declaracaoObito(s.porta, a.atendimento));
        if (!obito || !a.cids.includes(e.cid)) throw recusaAgravo('gatilho-nao-confirmado', 422);
      }
    }
    if (e.origem === 'exame' && e.exame !== null) {
      const x = await this.porta.exame(s.porta, e.exame);
      if (!x || x.paciente !== e.paciente || (e.atendimento !== null && x.atendimento !== e.atendimento))
        throw recusaAgravo('exame-de-outro-paciente', 422);
      if (!x.liberado || !x.resultados.some(ehResultadoReagente))
        throw recusaAgravo('exame-de-outro-paciente', 422);
    }
  }

  @Post('casos')
  @HttpCode(201)
  @Permissao(P.notificar)
  @AuditadoNoHandler(
    'qualidade.abrirCasoAgravo: notificacao_agravo com a trilha_auditoria na mesma transação',
  )
  async abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAbrirCasoAgravo, b);
    await this.apoio.exigirLiberacao(s);
    const [agora, cids, cadastroCid, pacientes, modelos] = await Promise.all([
      this.agora(s),
      this.porta.cidsNotificaveis(s.porta),
      this.porta.cidDoCadastro(s.porta, e.cid),
      this.porta.pacientes(s.porta, [e.paciente]),
      this.porta.modelosFicha(s.porta),
    ]);
    const cadastro = cadastroDe(cids);
    const notificavel = cidNotificavel(e.cid, cadastro);
    if (!notificavel && !cadastroCid) throw recusaAgravo('cid-inexistente', 422);
    const paciente = pacientes.get(e.paciente);
    if (!paciente) throw recusaAgravo('paciente-inexistente', 422);
    const problema = recusaAbertura(e, notificavel !== null, agora);
    if (problema) throw recusaAgravo(problema, 422);
    await this.conferirGatilho(s, e);
    // O mesmo agravo do mesmo paciente em até 30 dias é o mesmo caso (D-DEDUP-48.4; o descartado não segura).
    const vizinhos = await this.porta.casosDesde(
      s.porta,
      `${somarDias(e.gatilhoEm.slice(0, 10), -JANELA_MESMO_CASO_DIAS)}T00:00:00`,
    );
    const limite = `${somarDias(e.gatilhoEm.slice(0, 10), JANELA_MESMO_CASO_DIAS + 1)}T00:00:00`;
    if (
      vizinhos.some(
        (c) =>
          c.paciente === e.paciente &&
          c.situacao !== 'descartado' &&
          c.cid.slice(0, 3) === e.cid.slice(0, 3) &&
          c.gatilhoEm < limite,
      )
    )
      throw recusaAgravo('caso-ja-aberto');
    const periodicidade: PeriodicidadeAgravo =
      e.origem === 'obito' ? 'imediata' : (notificavel?.periodicidade ?? 'semanal');
    const referencia = e.origem === 'exame' ? e.exame : e.atendimento;
    const ficha = modeloDaFicha(e.cid, modelos, idadeEmAnos(paciente.nascimento, e.gatilhoEm));
    const r = await this.apoio.sgh(
      s,
      E.qualidadeAgravoCasoAberto.codigo,
      P.notificar,
      (x: { id: number }) => ({ tabela: 'notificacao_agravo', id: String(x.id), paciente: e.paciente }),
      (g) =>
        g.abrirCaso({
          origem: e.origem,
          chaveGatilho:
            e.origem === 'manual' || referencia === null ? null : chaveGatilho(e.origem, referencia, e.cid),
          atendimento: e.atendimento,
          exame: e.exame,
          paciente: e.paciente,
          cid: e.cid,
          periodicidade,
          gatilhoEm: semSegundos(e.gatilhoEm),
          prazoEm: prazoDoAgravo(periodicidade, e.gatilhoEm),
          fichaModelo: ficha.modelo?.id ?? null,
          observacao: e.observacao,
          agora,
          usuario: s.login,
        }),
    );
    return { id: r.id, periodicidade, prazoEm: prazoDoAgravo(periodicidade, e.gatilhoEm) };
  }

  @Post('casos/:id/notificacao')
  @Permissao(P.notificar)
  @AuditadoNoHandler(
    'qualidade.registrarNotificacaoAgravo: notificacao_agravo com a versão conferida e a trilha_auditoria',
  )
  async notificar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarNotificacaoAgravo, { ...(b as object), caso: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const x = await this.casoOu404(s, e.caso);
    const agora = await this.agora(s);
    const problema = recusaNotificacao(
      { versao: x.versao, situacao: x.situacao as SituacaoCasoAgravo, gatilhoEm: x.gatilhoEm },
      e,
      agora,
    );
    if (problema)
      throw recusaAgravo(
        problema,
        problema === 'versao-desatualizada' || problema === 'caso-encerrado' ? 409 : 422,
      );
    const r = await this.apoio.sgh(
      s,
      E.qualidadeAgravoNotificado.codigo,
      P.notificar,
      { tabela: 'notificacao_agravo', id: String(x.id), paciente: x.paciente },
      (g) =>
        g.registrarNotificacao({
          id: x.id,
          versao: e.versao,
          autoridade: e.autoridade,
          canal: e.canal,
          numero: e.numero,
          notificadoEm: e.notificadoEm,
          recebidoPor: e.recebidoPor,
          observacao: e.observacao,
          agora,
          usuario: s.login,
        }),
    );
    return { versao: r.versao, comAtraso: notificadoComAtraso(x.prazoEm, e.notificadoEm) };
  }

  @Post('casos/:id/descarte')
  @Permissao(P.notificar)
  @AuditadoNoHandler(
    'qualidade.descartarCasoAgravo: notificacao_agravo com a versão conferida e a trilha_auditoria',
  )
  async descartar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDescartarCasoAgravo, { ...(b as object), caso: idDaRota(id) });
    await this.apoio.exigirLiberacao(s);
    const x = await this.casoOu404(s, e.caso);
    const problema = recusaDescarte(
      { versao: x.versao, situacao: x.situacao as SituacaoCasoAgravo, gatilhoEm: x.gatilhoEm },
      e,
    );
    if (problema) throw recusaAgravo(problema);
    const agora = await this.agora(s);
    return this.apoio.sgh(
      s,
      E.qualidadeAgravoDescartado.codigo,
      P.notificar,
      { tabela: 'notificacao_agravo', id: String(x.id), paciente: x.paciente },
      (g) =>
        g.descartarCaso({
          id: x.id,
          versao: e.versao,
          motivo: e.motivo,
          justificativa: e.justificativa,
          agora,
          usuario: s.login,
        }),
    );
  }

  @Post('gatilhos-exame')
  @Permissao(P.notificar)
  @AuditadoNoHandler('qualidade.configurarGatilhoExame: agravo_notificavel_cid com a trilha_auditoria')
  async configurarGatilho(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaConfigurarGatilhoExame, b);
    await this.apoio.exigirLiberacao(s);
    if (!(await this.porta.cidDoCadastro(s.porta, e.cid))) throw recusaAgravo('cid-inexistente', 422);
    if ((e.gatilho === null) !== (e.versao === null))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Notificação compulsória',
        'Informe a versão do gatilho alterado.',
        {
          codigo: 'versao-ausente',
          campos: ['versao'],
        },
      );
    // O nome do exame casa sem acento e em maiúsculas: a consulta do outro sistema leva o padrão em ASCII.
    if (!/^[\x20-\x7e]+$/.test(normalizarTexto(e.padrao)))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Notificação compulsória',
        'Padrão de exame inválido.',
        {
          codigo: 'padrao-invalido',
          campos: ['padrao'],
        },
      );
    return this.apoio.sgh(
      s,
      E.qualidadeAgravoGatilhoConfigurado.codigo,
      P.notificar,
      (x: { id: number }) => ({ tabela: 'agravo_notificavel_cid', id: String(x.id) }),
      (g) =>
        g.configurarGatilhoExame({
          id: e.gatilho,
          versao: e.versao,
          padrao: e.padrao.trim(),
          exceto: e.exceto?.trim() || null,
          cid: e.cid,
          ativo: e.ativo,
          usuario: s.login,
        }),
    );
  }
}
