// Farmácia hospitalar, dispensação e farmácia clínica (M29; ficha, seções 4, 5 e 7). Telas de trabalho sobre a porta
// da farmácia (banco do cliente pelo @sgh/nucleo, ou a memória de dev/ci); as regras ficam no domínio:
//   GET  /api/farmacia/gravacao | unidades | eventos (tempo real: SSE, a fila e a worklist releem)
//   GET  /api/farmacia/fila?unidade                          fila por paciente e horário (leitura auditada)
//   POST /api/farmacia/dispensar                             doses da fila (executor) + etiquetas ZPL
//   GET  /api/farmacia/atendimentos/:reg/doses               doses do paciente e a sugestão de devolução (auditada)
//   POST /api/farmacia/devolucoes | doses/:dose/cancelar
//   GET  /api/farmacia/entregas?situacao&centro (auditada); POST entregas/:controle/aceite
//   GET  /api/farmacia/avaliacao?unidade (auditada); POST avaliacao/triagem | avaliacao/:item/decisao | avaliacao/:item/intervencoes
//   GET  /api/farmacia/avaliacao/:item/historico; GET intervencoes/minhas; POST intervencoes/:id/resposta; GET worklist
//   GET  /api/farmacia/controlados?inicio&fim; GET controlados/:item/movimentos (auditada); POST controlados/conferencia | perda
//   GET  /api/farmacia/livro?livro&inicio&fim; GET livro/pdf; POST livro/fechar
//   GET  /api/farmacia/parametros | avaliacao/tipos; GET/POST ambulatorial | ambulatorial/sngpc
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
  type ApoioFarmacia,
  esquemaConferirControlado,
  esquemaConfirmarEntrega,
  esquemaDecidirAvaliacao,
  esquemaDevolverDose,
  esquemaDispensarAmbulatorial,
  esquemaDispensarHorario,
  esquemaEscriturarSngpc,
  esquemaFecharLivro,
  esquemaRegistrarIntervencao,
  esquemaRegistrarPerdaControlado,
  esquemaResponderIntervencao,
  EVENTOS_AUDITAVEIS,
  type FilaDispensacao,
  type GravacaoFarmacia,
  type IntervencaoLida,
  type JanelaEntregas,
  type LoteFarmacia,
  type ParametrosIntegracaoFarmacia,
  type ResultadoFarmacia,
  type TipoEnvioAvaliacao,
  type UnidadeFarmacia,
} from '@sgh/contratos';
import { conferirChaveSngpc } from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import type {
  AvisosAtendimento,
  RequisicaoBrutaAtendimento,
  RespostaEventosAtendimento,
} from '../atendimento/public-api.js';
import { exigir, idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ApoiosFarmacia } from './apoios.js';
import { PORTA_FARMACIA, type PortaFarmacia } from './porta.js';
import { ServicoFarmacia } from './servico.js';

export const AVISOS_FARMACIA = Symbol('AVISOS_FARMACIA');
export const GERADOR_PDF_FARMACIA = Symbol('GERADOR_PDF_FARMACIA');
type GeradorPdf = (html: string, titulo: string) => Promise<Buffer>;

const dataOu = (v: string | undefined, padrao: string): string => {
  if (v === undefined || v === '') return padrao;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return v;
};
const unidadeDe = (v: string | undefined): string => {
  const u = (v ?? '').trim();
  if (!/^[A-Za-z0-9 ._-]{1,20}$/.test(u))
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Escolha a unidade.');
  return u;
};
const esquemaComSenha = <T extends z.ZodTypeAny>(e: T) =>
  z.object({ senha: z.string().max(200).optional(), dados: e });
const esquemaPerda = esquemaRegistrarPerdaControlado;

@Controller('farmacia')
export class FarmaciaController {
  readonly apoios: ApoiosFarmacia;
  readonly servico: ServicoFarmacia;
  constructor(
    @Inject(PORTA_FARMACIA) private readonly porta: PortaFarmacia,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(FONTE_DOCUMENTO) documento: FonteDocumento | null = null,
    @Optional() @Inject(AVISOS_FARMACIA) private readonly avisos: AvisosAtendimento | null = null,
    @Optional() @Inject(GERADOR_PDF_FARMACIA) private readonly pdf: GeradorPdf | null = null,
  ) {
    this.apoios = new ApoiosFarmacia(porta, trilha, fonteConfiguracao, cache);
    this.servico = new ServicoFarmacia(porta, this.apoios, documento);
  }

  private async reautenticado(req: RequisicaoAutorizada, senha: string | undefined): Promise<number> {
    return this.porta.destino === 'memoria' && !req.sgh?.real
      ? Date.now()
      : reautenticar(this.sessoes, this.resolvedor, req, senha);
  }
  private avisar(s: SessaoCadastro) {
    this.avisos?.avisar(s.hospital);
  }

  // ── Situação, unidades e tempo real ──────────────────────────────────────────────────────────────

  @Get('gravacao')
  @Permissao('suprimentos.dispensacao.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoFarmacia> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  /** O estado de gravação para quem não é da farmácia (a enfermagem no aceite, o médico na resposta). */
  @Get('gravacao/entrega')
  @Permissao('suprimentos.entrega.ler')
  gravacaoEntrega(@Req() req: RequisicaoAutorizada): Promise<GravacaoFarmacia> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('unidades')
  @Permissao('suprimentos.dispensacao.ler')
  async unidades(@Req() req: RequisicaoAutorizada): Promise<UnidadeFarmacia[]> {
    const s = sessaoDe(req);
    const horas =
      (await this.apoios.apoios.dispensacao.parametro(s, 'suprimentos.farmaciaJanelaHoras')) || 12;
    return (await this.porta.unidades(s.porta)).map((u) => ({ ...u, janelaHoras: horas }));
  }

  /** O apoio da dispensação: os locais de estoque e os centros de custo com integração (a seleção da tela). */
  @Get('apoio')
  @Permissao('suprimentos.dispensacao.ler')
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioFarmacia> {
    const s = sessaoDe(req);
    const [locais, p] = await Promise.all([
      this.porta.locais(s.porta),
      this.porta.parametrosIntegracao(s.porta),
    ]);
    return { locais, centros: p.centros.map((c) => ({ codigo: c.centroCusto, nome: c.nome })) };
  }

  /** Os lotes com saldo do item no local (validade primeiro), para a dose rastreável. */
  @Get('lotes')
  @Permissao('suprimentos.dispensacao.ler')
  async lotes(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<LoteFarmacia[]> {
    const item = Number(q['item'] ?? 0);
    const local = Number(q['local'] ?? 0);
    if (!Number.isInteger(item) || item <= 0 || !Number.isInteger(local) || local <= 0 || local > 99)
      throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Informe o item e o local.');
    return this.porta.lotes(sessaoDe(req).porta, item, local);
  }

  @Get('unidades/avaliacao')
  @Permissao('suprimentos.avaliacao.ler')
  async unidadesAvaliacao(@Req() req: RequisicaoAutorizada): Promise<UnidadeFarmacia[]> {
    return (await this.porta.unidades(sessaoDe(req).porta)).map((u) => ({ ...u, janelaHoras: 24 }));
  }

  @Get('eventos')
  @Permissao('suprimentos.dispensacao.ler')
  eventos(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(
      req,
      res,
      sessaoDe(req).hospital,
      'suprimentos.dispensacao.ler',
      this.resolvedor,
      15_000,
    );
  }

  @Get('eventos/avaliacao')
  @Permissao('suprimentos.avaliacao.ler')
  eventosAvaliacao(
    @Req() req: RequisicaoAutorizada & RequisicaoBrutaAtendimento,
    @Res() res: RespostaEventosAtendimento,
  ): void {
    if (!this.avisos) throw new ErroProblema('indisponivel', 503, 'Avisos de mudança indisponíveis');
    this.avisos.abrirCanal(
      req,
      res,
      sessaoDe(req).hospital,
      'suprimentos.avaliacao.ler',
      this.resolvedor,
      15_000,
    );
  }

  // ── Fila e dispensação ───────────────────────────────────────────────────────────────────────────

  @Get('fila')
  @Permissao('suprimentos.dispensacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosFilaDispensacaoLida.codigo)
  fila(@Query('unidade') u: string | undefined, @Req() req: RequisicaoAutorizada): Promise<FilaDispensacao> {
    const unidade = unidadeDe(u);
    req.sghAlvo = { tabelaAlvo: 'PRCHKGERAL', idAlvo: `unidade ${unidade}` };
    return this.servico.fila(sessaoDe(req), unidade);
  }

  @Post('dispensar')
  @HttpCode(200)
  @Permissao('suprimentos.dispensacao.dispensar')
  @AuditadoNoHandler('suprimentos.dispensarHorario pelo executor (trilha na mesma transação)')
  async dispensar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFarmacia> {
    const e = corpo(esquemaDispensarHorario, b);
    const s = sessaoDe(req);
    const r = await this.servico.dispensar(s, e);
    this.avisar(s);
    return r;
  }

  @Get('atendimentos/:reg/doses')
  @Permissao('suprimentos.dispensacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosFilaDispensacaoLida.codigo)
  doses(@Param('reg') reg: string, @Req() req: RequisicaoAutorizada) {
    const r = idDaRota(reg);
    req.sghAlvo = { tabelaAlvo: 'GEDISPHOR', idAlvo: `atendimento ${r}` };
    return this.servico.dosesDoAtendimento(sessaoDe(req), r);
  }

  @Post('devolucoes')
  @HttpCode(200)
  @Permissao('suprimentos.devolucao.registrar')
  @AuditadoNoHandler('suprimentos.devolverDose pelo executor (trilha na mesma transação)')
  async devolver(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFarmacia> {
    const s = sessaoDe(req);
    const r = await this.servico.executar(s, 'suprimentos.devolverDose', corpo(esquemaDevolverDose, b));
    this.avisar(s);
    return r;
  }

  @Post('doses/:dose/cancelar')
  @HttpCode(200)
  @Permissao('suprimentos.dispensacao.cancelar')
  @AuditadoNoHandler('suprimentos.cancelarDispensacao pelo executor (trilha na mesma transação)')
  async cancelar(@Param('dose') dose: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const motivo = z
      .object({ motivo: z.string() })
      .strict()
      .parse(b ?? {}).motivo;
    const r = await this.servico.executar(s, 'suprimentos.cancelarDispensacao', {
      dose: idDaRota(dose),
      motivo,
    });
    this.avisar(s);
    return r;
  }

  // ── Entrega ao setor ─────────────────────────────────────────────────────────────────────────────

  @Get('entregas')
  @Permissao('suprimentos.entrega.ler')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosEntregasLidas.codigo)
  entregas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const situacao = q['situacao'] === '8' ? 8 : q['situacao'] === '9' ? 9 : 7;
    const centro = Number(q['centro'] ?? 0);
    req.sghAlvo = { tabelaAlvo: 'GECTRLENTREGADOCSAIDA', idAlvo: `situação ${situacao}` };
    return this.servico.entregas(sessaoDe(req), situacao, centro > 0 ? centro : undefined);
  }

  /** O recorte da fila de entregas (desde quando ela olha) e os setores (centros com integração) para o filtro. */
  @Get('entregas/janela')
  @Permissao('suprimentos.entrega.ler')
  async janelaEntregas(@Req() req: RequisicaoAutorizada): Promise<JanelaEntregas> {
    const s = sessaoDe(req);
    const [j, p] = await Promise.all([
      this.porta.janelaEntregas(s.porta),
      this.porta.parametrosIntegracao(s.porta),
    ]);
    return { desde: j.desde, setores: p.centros.map((c) => ({ codigo: c.centroCusto, nome: c.nome })) };
  }

  @Post('entregas/:controle/aceite')
  @HttpCode(200)
  @Permissao('suprimentos.entrega.aceitar')
  @AuditadoNoHandler('suprimentos.confirmarEntrega pelo executor (trilha na mesma transação)')
  async aceite(@Param('controle') c: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaConfirmarEntrega, { ...((b ?? {}) as object), controle: idDaRota(c) });
    const r = await this.servico.executar(s, 'suprimentos.confirmarEntrega', e);
    this.avisar(s);
    return r;
  }

  // ── Avaliação farmacêutica ───────────────────────────────────────────────────────────────────────

  @Get('avaliacao')
  @Permissao('suprimentos.avaliacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosAvaliacaoLida.codigo)
  async avaliacao(@Query('unidade') u: string | undefined, @Req() req: RequisicaoAutorizada) {
    const unidade = unidadeDe(u);
    req.sghAlvo = { tabelaAlvo: 'PREXTRATOITEM_TBSITFARM', idAlvo: `unidade ${unidade}` };
    const { triagens, ...f } = await this.servico.filaAvaliacao(sessaoDe(req), unidade);
    return { ...f, novos: triagens.length };
  }

  /** Grava a triagem dos itens novos da unidade (regras automáticas: o baixo risco aprovado; o resto à fila humana). */
  @Post('avaliacao/triagem')
  @HttpCode(200)
  @Permissao('suprimentos.avaliacao.decidir')
  @AuditadoNoHandler('triagem em avaliacao_farmaceutica (trilha na mesma transação)')
  async triagem(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFarmacia> {
    const s = sessaoDe(req);
    const unidade = unidadeDe(
      z
        .object({ unidade: z.string() })
        .strict()
        .parse(b ?? {}).unidade,
    );
    const { triagens } = await this.servico.filaAvaliacao(s, unidade);
    const automaticas =
      (await this.apoios.apoios.avaliacao.parametroValor(s, 'suprimentos.farmaciaRegrasAutomaticas')) !==
      false;
    const itens = automaticas ? triagens : triagens.map((t) => ({ ...t, destino: 'humana' as const }));
    if (itens.length === 0)
      return { mensagem: 'Nenhum item novo para triar.', repetida: false, ids: {}, avisos: [] };
    const r = await this.apoios.apoios.avaliacao.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosPrescricaoAvaliada.codigo,
      'suprimentos.avaliacao',
      { tabela: 'avaliacao_farmaceutica', id: `triagem ${unidade}` },
      (g) => g.triar({ itens }),
    );
    this.avisar(s);
    return { mensagem: `${r.novos} item(ns) triados.`, repetida: false, ids: { novos: r.novos }, avisos: [] };
  }

  @Post('avaliacao/:item/decisao')
  @HttpCode(200)
  @Permissao('suprimentos.avaliacao.decidir')
  @AuditadoNoHandler('decisão em avaliacao_farmaceutica (trilha na mesma transação)')
  async decidir(
    @Param('item') i: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFarmacia> {
    const s = sessaoDe(req);
    const { unidade, ...resto } = (b ?? {}) as { unidade?: string };
    const e = corpo(esquemaDecidirAvaliacao, { ...resto, item: idDaRota(i) });
    const u = { unidade: typeof unidade === 'string' ? unidade : undefined };
    const triagem = u.unidade
      ? (await this.servico.filaAvaliacao(s, unidadeDe(u.unidade))).triagens.find((t) => t.item === e.item)
      : undefined;
    const r = await this.apoios.apoios.avaliacao.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosPrescricaoAvaliada.codigo,
      'suprimentos.avaliacao',
      (x: { id: number }) => ({ tabela: 'avaliacao_farmaceutica', id: String(x.id) }),
      (g) =>
        g.decidir({
          item: e.item,
          decisao: e.decisao,
          justificativa: e.justificativa,
          farmaceutico: s.login,
          triagem: triagem ?? {
            item: e.item,
            horario: null,
            classe: 'comum',
            destino: 'humana',
            prioridade: 0,
            achados: [],
            regra: 'decisao-direta',
          },
        }),
    );
    this.avisar(s);
    return {
      mensagem: 'Avaliação registrada.',
      repetida: false,
      ids: { avaliacao: r.id },
      avisos: [],
    };
  }

  @Post('avaliacao/:item/intervencoes')
  @HttpCode(200)
  @Permissao('suprimentos.avaliacao.intervir')
  @AuditadoNoHandler('intervenção em intervencao_farmaceutica (trilha na mesma transação)')
  async intervir(
    @Param('item') i: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFarmacia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarIntervencao, { ...((b ?? {}) as object), item: idDaRota(i) });
    const r = await this.apoios.apoios.avaliacao.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosIntervencaoRegistrada.codigo,
      'suprimentos.avaliacao',
      (x: { id: number }) => ({ tabela: 'intervencao_farmaceutica', id: String(x.id) }),
      (g) => g.intervir({ item: e.item, tipo: e.tipo, texto: e.texto, autor: s.login }),
    );
    this.avisar(s);
    return {
      mensagem: 'Intervenção registrada; o prescritor vê o aviso na fila de trabalho dele.',
      repetida: false,
      ids: { intervencao: r.id },
      avisos: r.prescritor ? [] : ['O prescritor do item não tem usuário: avise-o pelo contato da unidade.'],
    };
  }

  @Get('avaliacao/:item/historico')
  @Permissao('suprimentos.avaliacao.ler')
  async historico(
    @Param('item') i: string,
    @Query('horarios') h: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const item = idDaRota(i);
    const horarios = (h ?? '')
      .split(',')
      .map(Number)
      .filter((x) => Number.isSafeInteger(x) && x > 0)
      .slice(0, 50);
    const [subs, intervs] = await Promise.all([
      this.porta.substituicoes(s.porta, horarios),
      this.porta.intervencoesDosItens(s.porta, [item]),
    ]);
    return { substituicoes: subs, intervencoes: intervs.map(lida) };
  }

  @Get('intervencoes/minhas')
  @Permissao('suprimentos.intervencao.responder')
  async minhas(@Req() req: RequisicaoAutorizada): Promise<IntervencaoLida[]> {
    const s = sessaoDe(req);
    return (await this.porta.intervencoesDoPrescritor(s.porta, s.login)).map(lida);
  }

  @Post('intervencoes/:id/resposta')
  @HttpCode(200)
  @Permissao('suprimentos.intervencao.responder')
  @AuditadoNoHandler('resposta em intervencao_farmaceutica (trilha na mesma transação)')
  async responder(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFarmacia> {
    const s = sessaoDe(req);
    const e = corpo(esquemaResponderIntervencao, b);
    const i = await this.porta.intervencao(s.porta, idDaRota(id));
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Intervenção não encontrada');
    // Sem prescritor com usuário, ninguém responde por ele (segregação de funções: o aceite é do médico, não de outro
    // farmacêutico que também tem a opção); a resposta vai pelo contato da unidade.
    if (!i.prescritor)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'A intervenção não tem prescritor com usuário: responda pelo contato da unidade.',
        { codigo: 'sem-prescritor' },
      );
    if (i.prescritor.toUpperCase() !== s.login.toUpperCase())
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Só o prescritor do item responde à intervenção.',
        {
          codigo: 'nao-e-o-prescritor',
        },
      );
    await this.apoios.apoios.avaliacao.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosIntervencaoRespondida.codigo,
      'suprimentos.avaliacao',
      { tabela: 'intervencao_farmaceutica', id: String(i.id) },
      (g) =>
        g.responder({ id: i.id, resposta: e.resposta, justificativa: e.justificativa, respondente: s.login }),
    );
    this.avisar(s);
    return {
      mensagem: `Intervenção ${e.resposta}.`,
      repetida: false,
      ids: { intervencao: i.id },
      avisos: [],
    };
  }

  @Get('worklist')
  @Permissao('suprimentos.avaliacao.ler')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosAvaliacaoLida.codigo)
  async worklist(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'avaliacao_farmaceutica', idAlvo: 'worklist' };
    const us = await this.porta.unidades(s.porta);
    return this.servico.worklist(
      s,
      us.filter((u) => u.internados > 0).map((u) => u.unidade),
    );
  }

  // ── Controlados e livro ──────────────────────────────────────────────────────────────────────────

  private async periodo(s: SessaoCadastro, q: Record<string, string>) {
    const hoje = (await this.servico.datas(s)).hoje;
    const fim = dataOu(q['fim'], hoje);
    const d = new Date(`${fim}T00:00:00`);
    d.setDate(d.getDate() - 6);
    const inicio = dataOu(
      q['inicio'],
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    );
    if (inicio > fim)
      throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O início é depois do fim.');
    return { inicio, fim };
  }

  @Get('controlados')
  @Permissao('suprimentos.controlado.ler')
  async controlados(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const p = await this.periodo(s, q);
    return { ...p, itens: await this.servico.controlados(s, p.inicio, p.fim) };
  }

  @Get('controlados/:item/movimentos')
  @Permissao('suprimentos.controlado.ler')
  @Auditar(EVENTOS_AUDITAVEIS.suprimentosControladosLidos.codigo)
  async movimentos(
    @Param('item') i: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const item = idDaRota(i);
    const p = await this.periodo(s, q);
    req.sghAlvo = { tabelaAlvo: 'GELANSAI', idAlvo: `controlado ${item} ${p.inicio}..${p.fim}` };
    return { ...p, movimentos: await this.servico.movimentosDoControlado(s, item, p.inicio, p.fim) };
  }

  @Post('controlados/conferencia')
  @HttpCode(200)
  @Permissao('suprimentos.controlado.conferir')
  @AuditadoNoHandler('dupla conferência em SGH_SUP_CONTROLADO_CONF (trilha na mesma transação)')
  async conferir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFarmacia> {
    const s = sessaoDe(req);
    const x = corpo(esquemaComSenha(esquemaConferirControlado), b);
    const reautenticadoEm = await this.reautenticado(req, x.senha);
    const e = x.dados;
    const r = await this.apoios.apoios.controlados.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosControladoConferido.codigo,
      'suprimentos.controlados',
      (y: { id: number }) => ({ tabela: 'SGH_SUP_CONTROLADO_CONF', id: String(y.id) }),
      (g) =>
        g.conferirControlado({
          item: e.item,
          documento: e.documento,
          lote: e.lote ?? null,
          quantidadeDocumento: e.quantidadeDocumento,
          quantidadeContada: e.quantidadeContada,
          justificativa: e.justificativa,
          conferente: s.login,
          reautenticadoEm,
          agora: Date.now(),
        }),
    );
    return {
      mensagem: 'Segunda conferência registrada.',
      repetida: false,
      ids: { conferencia: r.id },
      avisos: [],
    };
  }

  @Post('controlados/perda')
  @HttpCode(200)
  @Permissao('suprimentos.controlado.registrarPerda')
  @AuditadoNoHandler('suprimentos.registrarPerdaControlado pelo executor (trilha na mesma transação)')
  async perda(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFarmacia> {
    const s = sessaoDe(req);
    const x = corpo(esquemaComSenha(esquemaPerda), b);
    const reautenticadoEm = await this.reautenticado(req, x.senha);
    return this.servico.executar(s, 'suprimentos.registrarPerdaControlado', x.dados, { reautenticadoEm });
  }

  @Get('livro')
  @Permissao('suprimentos.livro.ler')
  async livro(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const p = await this.periodo(s, q);
    const l = semMontado(await this.servico.livro(s, Number(q['livro'] ?? 1), p.inicio, p.fim));
    return l;
  }

  @Get('livro/pdf')
  @Permissao('suprimentos.livro.ler')
  async livroPdf(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
    @Res() res: { header(n: string, v: string): unknown; send(b: unknown): unknown },
  ) {
    const s = sessaoDe(req);
    const p = await this.periodo(s, q);
    const l = semMontado(await this.servico.livro(s, Number(q['livro'] ?? 1), p.inicio, p.fim));
    const html = this.servico.htmlDoLivro(l);
    if (!this.pdf) {
      res.header('content-type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    const pdf = await this.pdf(html, l.titulo).catch(() => null);
    if (!pdf)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Gerador de PDF indisponível',
        'O conversor de PDF/A não respondeu.',
      );
    res.header('content-type', 'application/pdf');
    res.header('content-disposition', `attachment; filename="livro-${l.livro}-${p.inicio}.pdf"`);
    return res.send(pdf);
  }

  @Post('livro/fechar')
  @HttpCode(200)
  @Permissao('suprimentos.livro.fechar')
  @AuditadoNoHandler('fechamento em SGH_SUP_LIVRO_CONTROLADO (trilha na mesma transação)')
  fecharLivro(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFarmacia> {
    const e = corpo(esquemaFecharLivro, b);
    return this.servico.fecharLivro(sessaoDe(req), e.livro, e.inicio, e.fim, e.oficial);
  }

  // ── Parâmetros e tipos de envio (consulta) ───────────────────────────────────────────────────────

  @Get('parametros')
  @Permissao('config.parametro.ler')
  async parametros(@Req() req: RequisicaoAutorizada): Promise<ParametrosIntegracaoFarmacia> {
    const p = await this.porta.parametrosIntegracao(sessaoDe(req).porta);
    const nome = (id: number) => p.tipos.find((t) => t.id === id)?.nome ?? `Tipo ${id}`;
    return {
      centros: p.centros.map((c) => ({
        ...c,
        tipoEnvioAvaliacao: c.tipoEnvio,
        tipoEnvioAvaliacaoNome: nome(c.tipoEnvio),
      })),
      horarios: p.horarios,
      validacaoFarmaceuticaLigada: p.validacaoFarmaceutica,
    };
  }

  @Get('avaliacao/tipos')
  @Permissao('config.parametro.ler')
  async tipos(@Req() req: RequisicaoAutorizada): Promise<TipoEnvioAvaliacao[]> {
    const p = await this.porta.parametrosIntegracao(sessaoDe(req).porta);
    return p.tipos.map((t) => ({ ...t, centros: p.centros.filter((c) => c.tipoEnvio === t.id).length }));
  }

  // ── Farmácia ambulatorial (regra 10: desligada) ─────────────────────────────────────────────────

  @Get('ambulatorial')
  @Permissao('suprimentos.ambulatorial.ler')
  async ambulatorial(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const l = await this.apoios.apoios.ambulatorial.liberacao(s);
    return {
      ligada: l.ligada,
      // Regra 10: o motivo diz o que falta para ligar (CNAE de farmácia e credenciamento no SNGPC).
      motivo: l.ligada ? null : (conferirChaveSngpc(false)?.mensagem ?? l.motivo),
      dispensacoes: l.ligada
        ? await this.porta.ambulatoriais(s.porta, new Date(Date.now() - 30 * 86_400_000))
        : [],
    };
  }

  @Post('ambulatorial/dispensar')
  @HttpCode(200)
  @Permissao('suprimentos.ambulatorial.dispensar')
  @AuditadoNoHandler('dispensação ambulatorial em SGH_SUP_FARM_AMB_DISPENSACAO (trilha na mesma transação)')
  async dispensarAmbulatorial(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFarmacia> {
    const s = sessaoDe(req);
    await this.servico.exigirAmbulatorial(s);
    const e = corpo(esquemaDispensarAmbulatorial, b);
    const hoje = (await this.servico.datas(s)).hoje;
    const r = await this.apoios.apoios.ambulatorial.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosAmbulatorialDispensado.codigo,
      'suprimentos.ambulatorial',
      (x: { id: number }) => ({
        tabela: 'SGH_SUP_FARM_AMB_DISPENSACAO',
        id: String(x.id),
        paciente: e.paciente,
      }),
      (g) =>
        g.dispensarAmbulatorial({
          paciente: e.paciente,
          item: e.item,
          lote: e.lote,
          validade: e.validade,
          quantidade: e.quantidade,
          receitaNumero: e.receitaNumero ?? null,
          receitaData: e.receitaData ?? null,
          prescritor: e.prescritor ?? null,
          autor: s.login,
          hoje,
        }),
    );
    return {
      mensagem: 'Dispensação ambulatorial registrada.',
      repetida: false,
      ids: { dispensacao: r.id },
      avisos: [],
    };
  }

  @Post('ambulatorial/sngpc')
  @HttpCode(200)
  @Permissao('suprimentos.ambulatorial.escriturar')
  @AuditadoNoHandler('escrituração em SGH_SUP_SNGPC_ESCRITURACAO (trilha na mesma transação)')
  async escriturar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFarmacia> {
    const s = sessaoDe(req);
    await this.servico.exigirAmbulatorial(s);
    const e = corpo(esquemaEscriturarSngpc, b);
    const r = await this.apoios.apoios.ambulatorial.sgh(
      s,
      EVENTOS_AUDITAVEIS.suprimentosSngpcEscriturado.codigo,
      'suprimentos.ambulatorial',
      (x: { lote: number }) => ({ tabela: 'SGH_SUP_SNGPC_ESCRITURACAO', id: String(x.lote) }),
      (g) => g.escriturarSngpc({ inicio: e.inicio, fim: e.fim, autor: s.login }),
    );
    return {
      mensagem: `Lote de envio ${r.lote}: ${r.dispensacoes} dispensação(ões).`,
      repetida: false,
      ids: { lote: r.lote },
      avisos: [],
    };
  }

  /** Testes: a permissão de agir conferida na rota e a da funcionalidade. */
  async exigirPermissao(s: SessaoCadastro, codigo: string): Promise<void> {
    await exigir(s, codigo, this.trilha);
  }
}

/** O livro para a tela (sem o objeto montado de uso interno). */
function semMontado<T extends { montado: unknown }>(x: T): Omit<T, 'montado'> {
  const r: Partial<T> = { ...x };
  delete r.montado;
  return r as Omit<T, 'montado'>;
}

const lida = (i: {
  id: number;
  avaliacao: number | null;
  item: number;
  tipo: string;
  texto: string;
  autor: string;
  criadaEm: string;
  estado: 'aberta' | 'respondida';
  resposta: 'aceita' | 'recusada' | null;
  justificativa: string | null;
  respondente: string | null;
  respondidaEm: string | null;
}): IntervencaoLida => ({
  id: i.id,
  avaliacao: i.avaliacao,
  item: i.item,
  tipo: i.tipo,
  texto: i.texto,
  autor: i.autor,
  criadaEm: i.criadaEm,
  estado: i.estado,
  resposta: i.resposta,
  justificativa: i.justificativa,
  respondente: i.respondente,
  respondidaEm: i.respondidaEm,
});
