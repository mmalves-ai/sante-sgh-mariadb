// Rouparia e lavanderia (M55, fatia F2; ficha, seções 4, 7 e 8; regra 4; manual m18 "Rouparia e lavanderia"):
//   GET  /api/hotelaria/rouparia                          o painel: o enxoval, os setores, as cotas, os envios aguardando
//                                                         o retorno (com o atraso), os movimentos de hoje, os parâmetros
//                                                         e o estado da gravação
//   GET  /api/hotelaria/rouparia/movimentos?de=&ate=&tipo=&centroCusto=&antesDe=
//                                                         os movimentos do período (paginados pela chave, teto 200)
//   GET  /api/hotelaria/rouparia/movimentos/:id           um movimento (o retorno com o envio e a conferência)
//   POST /api/hotelaria/rouparia/movimentos               internacao.registrarMovimentoRoupa (coleta, envio, retorno
//                                                         conferido com o envio, entrega, perda, inventário)
//   POST /api/hotelaria/rouparia/movimentos/:id/cancelamento
//                                                         internacao.cancelarMovimentoRoupa (no prazo, com o motivo)
//   POST /api/hotelaria/rouparia/pecas, PUT .../pecas/:id internacao.gravarPecaRoupa (peça ou kit do enxoval)
//   GET  /api/hotelaria/rouparia/cotas/:centroCusto       a cota do setor com o estimado e a reposição (com a conta)
//   PUT  /api/hotelaria/rouparia/cotas                    internacao.gravarCotasRoupa
//   GET  /api/hotelaria/rouparia/estatistica?de=&ate=     regra 4: os kg coletados por setor e por dia e o total do setor
//                                                         no período com as parcelas (a estatística do custeio)
//   GET  /api/hotelaria/rouparia/indicadores?de=&ate=     kg por paciente-dia, índice de perda e custo por paciente-dia,
//                                                         com as contas impressas
//   GET  /api/hotelaria/rouparia/fornecedores?termo=      a lavanderia terceirizada (busca no cadastro de fornecedores)
// Tudo só do novo (SGH_HOT_ROUPA_*), com a SGH_TRILHA na mesma transação. Nasce desligado (chave `rouparia`, POL-3).
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
  CHAVE_LIBERACAO_ROUPARIA,
  type ConferenciaRetornoRoupa,
  type CotaRoupa,
  type EnvioAberto,
  esquemaCancelarMovimentoRoupa,
  esquemaCotasSetor,
  esquemaFiltroMovimentosRoupa,
  esquemaPecaRoupa,
  esquemaPeriodoRouparia,
  esquemaRegistrarMovimentoRoupa,
  EVENTOS_AUDITAVEIS,
  type GravacaoAgenda,
  type IndicadoresRouparia,
  type KgSetorDia,
  type KgSetorPeriodo,
  MENSAGENS_ROUPARIA,
  type MovimentoRoupa,
  type PecaRoupa,
  PERMISSOES_ROUPARIA_CODIGOS as P,
  type SituacaoCotaSetor,
  TETO_ROUPARIA,
} from '@sgh/contratos';
import {
  conferirCancelamentoRoupa,
  conferirMovimentoRoupa,
  conferirPecaRoupa,
  conferirRetornoRoupa,
  envioAberto,
  indicadoresRouparia,
  kgPorSetorNoPeriodo,
  normalizarMovimentoRoupa,
  pecasEmCirculacao,
  type RecusaRouparia,
  situacaoCotaSetor,
} from '@sgh/dominio-hotelaria';
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
import { type GravadorRouparia, PORTA_ROUPARIA, type PortaRouparia, type SetorRouparia } from './porta.js';

const E = EVENTOS_AUDITAVEIS;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
/** A situação da cota olha os movimentos do setor destes últimos dias (o último inventário e o que veio depois). */
export const DIAS_SITUACAO_COTA = 90;

const menosDias = (iso: string, dias: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

function recusaRouparia(r: Pick<RecusaRouparia, 'codigo' | 'mensagem' | 'campos'>): ErroProblema {
  return new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', r.mensagem, {
    codigo: r.codigo,
    ...(r.campos ? { campos: [...r.campos] } : {}),
  });
}

function periodo(q: Record<string, unknown>): { de: string; ate: string } {
  const r = esquemaPeriodoRouparia.safeParse({ de: q['de'], ate: q['ate'] });
  if (!r.success)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Período inválido',
      r.error.issues[0]?.message ?? 'Informe o início e o fim do período (AAAA-MM-DD).',
    );
  return r.data;
}

export interface ResultadoRouparia {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly repetida: boolean;
  readonly mensagem: string;
  readonly conferencia: ConferenciaRetornoRoupa | null;
}

export interface ParametrosRouparia {
  readonly toleranciaPct: number;
  readonly prazoRetornoHoras: number;
  readonly precoKgCentavos: number;
  readonly cancelamentoHoras: number;
}

@Controller('hotelaria/rouparia')
export class RoupariaController {
  private readonly apoio: ApoioGravacao<GravadorRouparia>;

  constructor(
    @Inject(PORTA_ROUPARIA) private readonly porta: PortaRouparia,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_ROUPARIA, nome: 'a rouparia', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private chave(s: SessaoCadastro, doCorpo: string): string {
    const bruto = s.req.headers['idempotency-key'];
    const k = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof k !== 'string' || !CHAVE.test(k) || k !== doCorpo)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'A Idempotency-Key do pedido falta ou difere da chave do corpo.',
      );
    return k;
  }

  private async parametros(s: SessaoCadastro): Promise<ParametrosRouparia> {
    const r = await this.apoio.resolvedorParametros(s);
    const n = (chave: string, padrao: number) => {
      const v = Number(r(chave) ?? padrao);
      return Number.isFinite(v) ? v : padrao;
    };
    return {
      toleranciaPct: n('rouparia.toleranciaDiferencaPct', 5),
      prazoRetornoHoras: n('rouparia.prazoRetornoHoras', 48),
      precoKgCentavos: n('rouparia.precoKgCentavos', 0),
      cancelamentoHoras: n('rouparia.cancelamentoHoras', 24),
    };
  }

  @Get()
  @Permissao(P.ler)
  @Auditar(E.roupariaLida.codigo)
  async painel(@Req() req: RequisicaoAutorizada): Promise<{
    hoje: string;
    agora: string;
    pecas: PecaRoupa[];
    setores: SetorRouparia[];
    cotas: CotaRoupa[];
    enviosAbertos: EnvioAberto[];
    movimentosDeHoje: MovimentoRoupa[];
    cortada: boolean;
    parametros: ParametrosRouparia;
    gravacao: GravacaoAgenda;
  }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'SGH_HOT_ROUPA_MOVIMENTO' };
    const { hoje, agora } = await this.porta.relogio(s.porta);
    const [pecas, setores, cotas, abertos, deHoje, parametros, gravacao] = await Promise.all([
      this.porta.pecas(s.porta),
      this.porta.setores(s.porta),
      this.porta.cotas(s.porta),
      this.porta.enviosAbertos(s.porta),
      this.porta.movimentos(s.porta, { de: hoje, ate: hoje }),
      this.parametros(s),
      this.apoio.gravacao(s, { registrar: P.registrar }),
    ]);
    return {
      hoje,
      agora,
      pecas,
      setores: setores.filter((x) => x.ativo),
      cotas,
      enviosAbertos: abertos.map((m) => envioAberto(m, agora, parametros.prazoRetornoHoras)),
      movimentosDeHoje: deHoje.itens,
      cortada: deHoje.cortada,
      parametros,
      gravacao,
    };
  }

  @Get('movimentos')
  @Permissao(P.ler)
  @Auditar(E.roupariaLida.codigo)
  async movimentos(
    @Query() q: Record<string, unknown>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: MovimentoRoupa[]; cortada: boolean; proximo: number | null }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'SGH_HOT_ROUPA_MOVIMENTO' };
    const vazio = (v: unknown) => (v === undefined || v === '' ? null : v);
    const f = esquemaFiltroMovimentosRoupa.safeParse({
      de: q['de'],
      ate: q['ate'],
      tipo: vazio(q['tipo']),
      centroCusto: vazio(q['centroCusto']),
      antesDe: vazio(q['antesDe']),
    });
    if (!f.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Filtro inválido',
        f.error.issues[0]?.message ?? 'Confira o período e os filtros.',
      );
    const r = await this.porta.movimentos(s.porta, { ...f.data, teto: TETO_ROUPARIA });
    return { ...r, proximo: r.cortada ? (r.itens.at(-1)?.id ?? null) : null };
  }

  @Get('movimentos/:id')
  @Permissao(P.ler)
  @Auditar(E.roupariaLida.codigo)
  async movimento(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ movimento: MovimentoRoupa; remessa: MovimentoRoupa | null }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'SGH_HOT_ROUPA_MOVIMENTO', idAlvo: id };
    const m = await this.porta.movimento(s.porta, idDaRota(id));
    if (!m)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Movimento não encontrado',
        MENSAGENS_ROUPARIA['movimento-inexistente'],
      );
    const remessa = m.remessa !== null ? await this.porta.movimento(s.porta, m.remessa) : null;
    return { movimento: m, remessa };
  }

  @Post('movimentos')
  @HttpCode(201)
  @Permissao(P.registrar)
  @AuditadoNoHandler(
    'internacao.registrarMovimentoRoupa: SGH_HOT_ROUPA_MOVIMENTO e SGH_HOT_ROUPA_MOV_ITEM com a SGH_TRILHA na mesma transação',
  )
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoRouparia> {
    const s = sessaoDe(req);
    const e = normalizarMovimentoRoupa(corpo(esquemaRegistrarMovimentoRoupa, b));
    const chave = this.chave(s, e.chave);
    const [setores, parametros, fornecedorExiste] = await Promise.all([
      this.porta.setores(s.porta),
      this.parametros(s),
      e.fornecedor !== null ? this.porta.fornecedorExiste(s.porta, e.fornecedor) : Promise.resolve(true),
    ]);
    const x = await this.apoio.sgh(
      s,
      E.movimentoRoupaRegistrado.codigo,
      P.registrar,
      (y: { id: number }) => ({
        tabela: 'SGH_HOT_ROUPA_MOVIMENTO',
        id: String(y.id),
        paciente: null,
        chave: `${e.tipo}:${e.centroCusto ?? 'central'}:${e.data}`,
      }),
      async (g) => {
        const ja = await g.movimentoPelaChave(chave);
        if (ja) {
          if (ja.tipo !== e.tipo || ja.data !== e.data || ja.centroCusto !== e.centroCusto)
            throw recusaRouparia({
              codigo: 'chave-de-outro-movimento',
              mensagem: MENSAGENS_ROUPARIA['chave-de-outro-movimento'],
            });
          return { id: ja.id, versao: ja.versao, repetida: true, conferencia: null };
        }
        const [relogio, pecas, remessa] = await Promise.all([
          g.relogio(),
          g.pecas(),
          e.remessa !== null ? g.movimento(e.remessa) : Promise.resolve(null),
        ]);
        const r = conferirMovimentoRoupa(e, {
          hoje: relogio.hoje,
          pecasAtivas: new Set(pecas.filter((p) => p.ativa).map((p) => p.id)),
          setoresAtivos: new Set(setores.filter((y) => y.ativo).map((y) => y.codigo)),
          remessa,
          fornecedorExiste,
        })[0];
        if (r) throw recusaRouparia(r);
        const conferencia =
          e.tipo === 'retorno' && remessa
            ? conferirRetornoRoupa(
                { pesoKg: remessa.pesoKg ?? 0, itens: remessa.itens },
                { pesoKg: e.pesoKg ?? 0, itens: e.itens },
                parametros.toleranciaPct,
              )
            : null;
        const y = await g.registrarMovimento({
          ...e,
          usuario: s.login,
          diferencaKg: conferencia?.diferencaKg ?? null,
          diferencaPct: conferencia?.diferencaPct ?? null,
          ocorrencia: conferencia?.ocorrencia ?? false,
        });
        return { ...y, repetida: false, conferencia };
      },
    );
    return {
      ok: true,
      id: x.id,
      versao: x.versao,
      repetida: x.repetida,
      conferencia: x.conferencia,
      mensagem: x.repetida
        ? 'Este movimento já estava registrado.'
        : x.conferencia?.ocorrencia
          ? `Retorno registrado com ocorrência para o fornecedor: ${x.conferencia.motivos.join(' ')}`
          : 'Movimento registrado.',
    };
  }

  @Post('movimentos/:id/cancelamento')
  @HttpCode(201)
  @Permissao(P.registrar)
  @AuditadoNoHandler(
    'internacao.cancelarMovimentoRoupa: SGH_HOT_ROUPA_MOVIMENTO com a SGH_TRILHA na mesma transação',
  )
  async cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Omit<ResultadoRouparia, 'conferencia'>> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCancelarMovimentoRoupa, b);
    const alvo = idDaRota(id);
    const parametros = await this.parametros(s);
    const x = await this.apoio.sgh(
      s,
      E.movimentoRoupaCancelado.codigo,
      P.registrar,
      { tabela: 'SGH_HOT_ROUPA_MOVIMENTO', id: String(alvo), paciente: null, chave: 'cancelamento' },
      async (g) => {
        const [m, relogio] = await Promise.all([g.movimento(alvo), g.relogio()]);
        const r = conferirCancelamentoRoupa(m, {
          agora: relogio.agora,
          prazoHoras: parametros.cancelamentoHoras,
          versaoVista: e.versaoVista,
        });
        if (r) throw recusaRouparia(r);
        return g.cancelarMovimento({
          id: alvo,
          versaoVista: e.versaoVista,
          motivo: e.motivo,
          usuario: s.login,
          remessa: m!.tipo === 'retorno' ? m!.remessa : null,
        });
      },
    );
    return { ok: true, id: x.id, versao: x.versao, repetida: false, mensagem: 'Movimento cancelado.' };
  }

  private async gravarPeca(s: SessaoCadastro, b: unknown, id: number | null) {
    const e = corpo(esquemaPecaRoupa, b);
    if (id !== null && e.versaoVista === null)
      throw new ErroProblema('entrada-invalida', 400, 'Pedido incompleto', 'Informe a versão vista da peça.');
    return this.apoio.sgh(
      s,
      E.pecaRoupaGravada.codigo,
      P.registrar,
      (y: { id: number }) => ({
        tabela: 'SGH_HOT_ROUPA_PECA',
        id: String(y.id),
        paciente: null,
        chave: e.categoria,
      }),
      async (g) => {
        const pecas = await g.pecas();
        if (id !== null && !pecas.some((p) => p.id === id))
          throw new ErroProblema(
            'nao-encontrado',
            404,
            'Peça não encontrada',
            'A peça não existe neste estabelecimento.',
          );
        const r = conferirPecaRoupa(e, { id, pecas })[0];
        if (r) throw recusaRouparia(r);
        const { versaoVista, ...p } = e;
        return id === null
          ? g.incluirPeca({ ...p, usuario: s.login })
          : g.alterarPeca({ ...p, usuario: s.login, id, versaoVista: versaoVista! });
      },
    );
  }

  @Post('pecas')
  @HttpCode(201)
  @Permissao(P.registrar)
  @AuditadoNoHandler('internacao.gravarPecaRoupa: SGH_HOT_ROUPA_PECA com a SGH_TRILHA na mesma transação')
  async incluirPeca(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const x = await this.gravarPeca(sessaoDe(req), b, null);
    return { ok: true as const, ...x, mensagem: 'Peça cadastrada no enxoval.' };
  }

  @Put('pecas/:id')
  @Permissao(P.registrar)
  @AuditadoNoHandler('internacao.gravarPecaRoupa: SGH_HOT_ROUPA_PECA com a SGH_TRILHA na mesma transação')
  async alterarPeca(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const x = await this.gravarPeca(sessaoDe(req), b, idDaRota(id));
    return { ok: true as const, ...x, mensagem: 'Peça alterada.' };
  }

  @Get('cotas/:centroCusto')
  @Permissao(P.ler)
  @Auditar(E.roupariaLida.codigo)
  async cotaDoSetor(
    @Param('centroCusto') centro: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<SituacaoCotaSetor> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'SGH_HOT_ROUPA_COTA', idAlvo: centro };
    const cc = idDaRota(centro);
    const { hoje } = await this.porta.relogio(s.porta);
    const [cotas, movs] = await Promise.all([
      this.porta.cotas(s.porta, cc),
      this.porta.movimentos(s.porta, {
        de: menosDias(hoje, DIAS_SITUACAO_COTA),
        ate: hoje,
        centroCusto: cc,
        teto: 2000,
      }),
    ]);
    return situacaoCotaSetor(cc, cotas, movs.itens);
  }

  @Put('cotas')
  @Permissao(P.registrar)
  @AuditadoNoHandler('internacao.gravarCotasRoupa: SGH_HOT_ROUPA_COTA com a SGH_TRILHA na mesma transação')
  async gravarCotas(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaCotasSetor, b);
    const setores = await this.porta.setores(s.porta);
    if (!setores.some((x) => x.ativo && x.codigo === e.centroCusto))
      throw recusaRouparia({
        codigo: 'setor-inativo',
        mensagem: MENSAGENS_ROUPARIA['setor-inativo'],
        campos: ['centroCusto'],
      });
    if (new Set(e.cotas.map((c) => c.peca)).size !== e.cotas.length)
      throw recusaRouparia({
        codigo: 'peca-repetida',
        mensagem: MENSAGENS_ROUPARIA['peca-repetida'],
        campos: ['cotas'],
      });
    const x = await this.apoio.sgh(
      s,
      E.cotaRoupaGravada.codigo,
      P.registrar,
      {
        tabela: 'SGH_HOT_ROUPA_COTA',
        id: String(e.centroCusto),
        paciente: null,
        chave: String(e.centroCusto),
      },
      async (g) => {
        const ativas = new Set((await g.pecas()).filter((p) => p.ativa).map((p) => p.id));
        if (e.cotas.some((c) => c.quantidade > 0 && !ativas.has(c.peca)))
          throw recusaRouparia({
            codigo: 'peca-inexistente',
            mensagem: MENSAGENS_ROUPARIA['peca-inexistente'],
            campos: ['cotas'],
          });
        return g.gravarCotas({ centroCusto: e.centroCusto, cotas: e.cotas, usuario: s.login });
      },
    );
    return {
      ok: true as const,
      ...x,
      mensagem: x.alteradas > 0 ? 'Cotas do setor gravadas.' : 'Nada mudou nas cotas.',
    };
  }

  @Get('estatistica')
  @Permissao(P.ler)
  @Auditar(E.roupariaLida.codigo)
  async estatistica(
    @Query() q: Record<string, unknown>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    de: string;
    ate: string;
    linhas: KgSetorDia[];
    porSetor: KgSetorPeriodo[];
    totalKg: number;
    conta: string;
  }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'SGH_HOT_ROUPA_MOVIMENTO' };
    const { de, ate } = periodo(q);
    const linhas = await this.porta.kgPorSetorDia(s.porta, de, ate);
    const porSetor = kgPorSetorNoPeriodo(linhas);
    const totalKg = Math.round(porSetor.reduce((t, x) => t + x.kg, 0) * 1000) / 1000;
    const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    return {
      de,
      ate,
      linhas,
      porSetor,
      totalKg,
      conta:
        porSetor.length === 0
          ? 'Nenhuma coleta pesada no período.'
          : `${porSetor.map((x) => `${fmt(x.kg)} kg (setor ${x.centroCusto})`).join(' + ')} = ${fmt(totalKg)} kg coletados.`,
    };
  }

  @Get('indicadores')
  @Permissao(P.ler)
  @Auditar(E.roupariaLida.codigo)
  async indicadores(
    @Query() q: Record<string, unknown>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IndicadoresRouparia> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'SGH_HOT_ROUPA_MOVIMENTO' };
    const { de, ate } = periodo(q);
    const [totais, pacientesDia, inventarios, parametros] = await Promise.all([
      this.porta.totais(s.porta, de, ate),
      this.porta.pacientesDia(s.porta, de, ate),
      this.porta.inventarios(s.porta, ate),
      this.parametros(s),
    ]);
    return indicadoresRouparia({
      de,
      ate,
      ...totais,
      pacientesDia,
      pecasEmCirculacao: pecasEmCirculacao(inventarios),
      precoKgCentavos: parametros.precoKgCentavos,
    });
  }

  @Get('fornecedores')
  @Permissao(P.registrar)
  async fornecedores(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: { codigo: number; nome: string }[] }> {
    const t = (termo ?? '').trim().slice(0, 60);
    if (t.length < 2 && !/^\d+$/.test(t)) return { itens: [] };
    return { itens: await this.porta.fornecedores(sessaoDe(req).porta, t) };
  }
}
