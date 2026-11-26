// Conta do paciente, lançamentos e auditoria de contas (M30; ficha, seções 4, 5 e 7). Telas de trabalho sobre a conta do
// banco do cliente (conta_hospitalar e itens); a situação, o total e o preço vêm da porta, calculados na aplicação:
//   GET  /api/faturamento/gravacao | apoio | worklist
//   GET  /api/faturamento/contas?situacao&convenio&competencia&tipo&termo&pagina&sus   (leitura auditada)
//   GET  /api/faturamento/contas/:id (auditada); GET contas/:id/itens; GET contas/:id/sigtap; GET contas/:id/auditoria
//   POST /api/faturamento/contas/:id/fechar | reabrir | conferencia | itens | pendencias | etapas | auditoria/versoes
//   POST /api/faturamento/pendencias/:id/resolver; GET pendencias-tipos
//   GET  /api/faturamento/itens/:id/explicacao; GET simulador
//   GET  /api/faturamento/lancamentos/painel | tardios; POST lancamentos/tardios/:registro/decisao
//   GET/POST /api/faturamento/regras | pacotes
//   GET  /api/faturamento/notas-sala(/:id)
//   GET/POST /api/faturamento/particular/orcamentos | caixas (POST caixas/:id/fechar) | recebimentos | recibos; GET pagamentos
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AuditoriaConta,
  type CaixaLido,
  type ContaDetalhe,
  esquemaAbrirCaixa,
  esquemaConferirItem,
  esquemaDecidirLancamentoTardio,
  esquemaEditarPacote,
  esquemaEditarRegraFaturabilidade,
  esquemaEmitirRecibo,
  esquemaEtapaConta,
  esquemaFecharCaixa,
  esquemaFecharConta,
  esquemaLancarItem,
  esquemaReabrirConta,
  esquemaReceberParticular,
  esquemaRegistrarOrcamento,
  esquemaRegistrarPendencia,
  esquemaRegistrarVersaoAuditoria,
  esquemaResolverPendencia,
  EVENTOS_AUDITAVEIS,
  type ExplicacaoLida,
  type GravacaoFaturamento,
  type ItemSigtap,
  type ListaContas,
  type ListaItens,
  type NotaSala,
  type OrcamentoParticular,
  type PacoteLido,
  type PagamentoLido,
  type PainelLancamentos,
  type ReciboLido,
  type RegraLida,
  type ResultadoFaturamento,
  type WorklistFaturamento,
} from '@sgh/contratos';
import {
  FORMAS_PAGAMENTO,
  lerCompetencia,
  SITUACOES_FILTRAVEIS,
  type SituacaoDerivada,
} from '@sgh/dominio-faturamento';
import { type ReajusteSimulado, validarReajusteSimulado } from '@sgh/dominio-preco';
import { z } from 'zod';
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
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { ApoiosFaturamento } from './apoios.js';
import { type ContextoFaturamento, PORTA_FATURAMENTO, type PortaFaturamento } from './porta.js';
import { resultadoFat, ServicoFaturamento } from './servico.js';

const ctx = (s: SessaoCadastro): ContextoFaturamento => s.porta;
const pagina = (v: string | undefined) => Math.min(10_000, Math.max(0, inteiroOuNulo(v) ?? 0));
const E = EVENTOS_AUDITAVEIS;
const dataOu = (v: string | undefined, padrao: string): string => {
  if (v === undefined || v === '') return padrao;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Data inválida', 'Use AAAA-MM-DD.');
  return v;
};
const menosDias = (hoje: string, dias: number) => {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
};

const esquemaSimular = z
  .object({
    convenio: z.coerce.number().int().min(0),
    tipoConta: z.enum(['E', 'I']).default('E'),
    tipo: z.coerce.number().int().min(1).max(4),
    codigo: z.coerce.number().int().positive(),
    quantidade: z.coerce.number().positive().max(99_999).default(1),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    setor: z.coerce.number().int().positive().optional(),
    horarioEspecial: z.enum(['true', 'false']).optional(),
    // Reajuste a medir, em % por alvo (06-FAT linha 11).
    reajusteIndice: z.coerce.number().optional(),
    reajustePorte: z.coerce.number().optional(),
    reajustePorteAnestesico: z.coerce.number().optional(),
    reajusteTabela: z.coerce.number().optional(),
  })
  .strict();

@Controller('faturamento')
export class FaturamentoController {
  readonly apoios: ApoiosFaturamento;
  readonly servico: ServicoFaturamento;
  constructor(
    @Inject(PORTA_FATURAMENTO) private readonly porta: PortaFaturamento,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonteConfiguracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) sessoes: ServicoSessao | null = null,
  ) {
    this.apoios = new ApoiosFaturamento(porta, trilha, fonteConfiguracao, cache);
    // A alçada do aprovador do preço manual: as permissões efetivas do outro usuário (mesmo cálculo da sessão).
    const autorizacao = sessoes?.servicoAutorizacao ?? null;
    this.servico = new ServicoFaturamento(
      porta,
      this.apoios,
      (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev',
      autorizacao
        ? async (s, login, permissao) =>
            (await autorizacao.obter(s.rede, s.hospital, login)).permissoes.includes(permissao)
        : null,
    );
  }

  private parametro(s: SessaoCadastro, chave: string, padrao: number): Promise<number> {
    return this.apoios.apoios.contas.parametro(s, chave).then((v) => v || padrao);
  }

  // ── Situação, apoio e fila de trabalho ───────────────────────────────────────────────────────────────

  @Get('gravacao')
  @Permissao('faturamento.conta.ler')
  gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoFaturamento> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  /** O particular tem perfis próprios (o caixa não lê contas): a mesma situação, pela permissão do orçamento. */
  @Get('particular/gravacao')
  @Permissao('faturamento.orcamento.ler')
  gravacaoParticular(@Req() req: RequisicaoAutorizada): Promise<GravacaoFaturamento> {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('particular/apoio')
  @Permissao('faturamento.orcamento.ler')
  async apoioParticular(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ hoje: string; escopo: string[]; situacoes: string[]; convenios: [] }> {
    return { hoje: await this.porta.hoje(ctx(sessaoDe(req))), escopo: [], situacoes: [], convenios: [] };
  }

  @Get('apoio')
  @Permissao('faturamento.conta.ler')
  async apoio(@Req() req: RequisicaoAutorizada): Promise<{
    hoje: string;
    escopo: string[];
    situacoes: string[];
    convenios: { codigo: number; nome: string }[];
  }> {
    const s = sessaoDe(req);
    const escopo = this.servico.convenios(s);
    const todos = await this.porta.convenios(ctx(s));
    return {
      hoje: await this.porta.hoje(ctx(s)),
      escopo: [...(escopo ?? []).map(String)],
      situacoes: [...SITUACOES_FILTRAVEIS],
      // Só os convênios do escopo (regra 13): o filtro nunca oferece um convênio que o usuário não pode ler.
      convenios: escopo === null ? todos : todos.filter((c) => escopo.includes(c.codigo)),
    };
  }

  @Get('worklist')
  @Permissao('faturamento.conta.ler')
  async worklist(@Req() req: RequisicaoAutorizada): Promise<WorklistFaturamento> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    return this.porta.worklist(ctx(s), {
      convenios: this.servico.convenios(s),
      hoje,
      prazoDias: await this.parametro(s, 'faturamento.contaPrazoAltaDias', 10),
      desde: menosDias(hoje, await this.parametro(s, 'faturamento.tardioJanelaDias', 180)),
    });
  }

  // ── Contas ───────────────────────────────────────────────────────────────────────────────────────────

  @Get('contas')
  @Permissao('faturamento.conta.ler')
  @Auditar(E.faturamentoContasLidas.codigo)
  async contas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaContas> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    const pedida = (q['situacao'] ?? '').trim();
    if (pedida && !(SITUACOES_FILTRAVEIS as readonly string[]).includes(pedida))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Situação não filtrável',
        'A lista ainda não filtra por esta situação.',
        { codigo: 'situacao-nao-filtravel' },
      );
    const sit = pedida ? (pedida as SituacaoDerivada) : null;
    // Idade desde a alta: "há pelo menos N dias" (a data-limite pelo dia do banco).
    const altaDias = inteiroOuNulo(q['altaDias']);
    const altaAte =
      altaDias !== null && altaDias >= 0 && altaDias <= 3_650 ? menosDias(hoje, altaDias) : null;
    const comp = lerCompetencia(q['competencia']);
    const tipo = q['tipo'] === 'E' || q['tipo'] === 'I' ? q['tipo'] : null;
    const p = pagina(q['pagina']);
    req.sghAlvo = {
      tabelaAlvo: 'conta_hospitalar',
      idAlvo: `lista ${sit ?? 'todas'} ${q['competencia'] ?? ''} p${p}`,
    };
    return this.porta.contas(
      ctx(s),
      {
        situacao: sit,
        convenios: this.servico.convenios(s, inteiroOuNulo(q['convenio'])),
        ano: comp?.ano ?? null,
        mes: comp?.mes ?? null,
        tipoConta: tipo,
        termo: (q['termo'] ?? '').slice(0, 60),
        sus: q['sus'] === 'sim',
        altaAte,
        pagina: p,
        porPagina: 200,
      },
      hoje,
    );
  }

  @Get('contas/:id')
  @Permissao('faturamento.conta.ler')
  @Auditar(E.faturamentoContasLidas.codigo)
  async conta(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ContaDetalhe> {
    const s = sessaoDe(req);
    const conta = idDaRota(id);
    await this.servico.exigirEscopoConta(s, conta);
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar', idAlvo: String(conta) };
    const c = await this.porta.conta(ctx(s), conta, await this.porta.hoje(ctx(s)));
    if (!c) throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
    return c;
  }

  @Get('contas/:id/itens')
  @Permissao('faturamento.item.ler')
  async itens(
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaItens> {
    const s = sessaoDe(req);
    const conta = idDaRota(id);
    await this.servico.exigirEscopoConta(s, conta);
    const tipo = inteiroOuNulo(q['tipo']);
    return this.porta.itens(ctx(s), conta, {
      pagina: pagina(q['pagina']),
      porPagina: Math.min(500, Math.max(10, inteiroOuNulo(q['porPagina']) ?? 500)),
      tipo: tipo && tipo >= 1 && tipo <= 4 ? tipo : null,
      naoConferidos: q['naoConferidos'] === 'sim',
      regua: q['regua'] === 'data-item' ? 'data-item' : 'competencia',
      mes: q['mes'] ?? null,
    });
  }

  @Get('contas/:id/sigtap')
  @Permissao('faturamento.item.ler')
  async sigtap(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ItemSigtap[]> {
    const s = sessaoDe(req);
    const conta = idDaRota(id);
    await this.servico.exigirEscopoConta(s, conta);
    return this.porta.sigtap(ctx(s), conta);
  }

  @Get('contas/:id/auditoria')
  @Permissao('faturamento.auditoria.ler')
  @Auditar(E.faturamentoContasLidas.codigo)
  async auditoria(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<AuditoriaConta> {
    const s = sessaoDe(req);
    const conta = idDaRota(id);
    await this.servico.exigirEscopoConta(s, conta);
    req.sghAlvo = { tabelaAlvo: 'auditoria_conta', idAlvo: String(conta) };
    return this.porta.auditoria(ctx(s), conta);
  }

  @Post('contas/:id/fechar')
  @HttpCode(200)
  @Permissao('faturamento.conta.fechar')
  @AuditadoNoHandler('faturamento.fecharConta pelo executor (trilha na mesma transação)')
  fechar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    return this.servico.fechar(
      sessaoDe(req),
      corpo(esquemaFecharConta, { ...((b ?? {}) as object), conta: idDaRota(id) }),
    );
  }

  @Post('contas/:id/reabrir')
  @HttpCode(200)
  @Permissao('faturamento.conta.reabrir')
  @AuditadoNoHandler('faturamento.reabrirConta pelo executor (trilha na mesma transação)')
  reabrir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    return this.servico.reabrir(
      sessaoDe(req),
      corpo(esquemaReabrirConta, { ...((b ?? {}) as object), conta: idDaRota(id) }),
    );
  }

  @Post('contas/:id/conferencia')
  @HttpCode(200)
  @Permissao('faturamento.item.conferir')
  @AuditadoNoHandler('faturamento.conferirItem pelo executor (trilha na mesma transação)')
  conferir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    return this.servico.conferir(
      sessaoDe(req),
      corpo(esquemaConferirItem, { ...((b ?? {}) as object), conta: idDaRota(id) }),
    );
  }

  @Post('contas/:id/itens')
  @HttpCode(200)
  @Permissao('faturamento.item.lancar')
  @AuditadoNoHandler('faturamento.lancarItem pelo executor (trilha na mesma transação)')
  lancar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    return this.servico.lancar(
      sessaoDe(req),
      corpo(esquemaLancarItem, { ...((b ?? {}) as object), conta: idDaRota(id) }),
    );
  }

  @Post('contas/:id/pendencias')
  @HttpCode(200)
  @Permissao('faturamento.pendencia.editar')
  @AuditadoNoHandler('pendência em pendencia_conta com a trilha_auditoria na mesma transação')
  async pendencia(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarPendencia, { ...((b ?? {}) as object), conta: idDaRota(id) });
    await this.servico.exigirEscopoConta(s, e.conta);
    const x = await this.servico.sgh(
      s,
      'contas',
      E.faturamentoPendenciaRegistrada.codigo,
      (r: number) => ({ tabela: 'pendencia_conta', id: String(r), chave: `conta ${e.conta}` }),
      (g) => g.registrarPendencia({ ...e, usuario: s.login }),
    );
    return resultadoFat('Pendência registrada.', false, { id: x });
  }

  @Post('pendencias/:id/resolver')
  @HttpCode(200)
  @Permissao('faturamento.pendencia.editar')
  @AuditadoNoHandler('pendência resolvida em pendencia_conta com a trilha_auditoria na mesma transação')
  async resolver(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaResolverPendencia, { ...((b ?? {}) as object), id: idDaRota(id) });
    // Regra 13: a pendência é de uma conta; o escopo por convênio é o dessa conta (403 antes de gravar).
    const conta = await this.porta.contaDaPendencia(ctx(s), e.id);
    if (conta === null) throw new ErroProblema('nao-encontrado', 404, 'Pendência não encontrada');
    await this.servico.exigirEscopoConta(s, conta);
    const x = await this.servico.sgh(
      s,
      'contas',
      E.faturamentoPendenciaRegistrada.codigo,
      () => ({ tabela: 'pendencia_conta', id: String(e.id) }),
      (g) => g.resolverPendencia({ ...e, usuario: s.login }),
    );
    return resultadoFat('Pendência resolvida.', false, { conta: x.conta });
  }

  @Post('contas/:id/etapas')
  @HttpCode(200)
  @Permissao('faturamento.conta.ler')
  @AuditadoNoHandler('etapa em conta_hospitalar_etapa com a trilha_auditoria na mesma transação')
  async etapa(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEtapaConta, { ...((b ?? {}) as object), conta: idDaRota(id) });
    await exigir(
      s,
      e.etapa === 'auditoria' ? 'faturamento.auditoria.ajustar' : 'faturamento.item.conferir',
      this.trilha,
    );
    await this.servico.exigirEscopoConta(s, e.conta);
    const x = await this.servico.sgh(
      s,
      e.etapa === 'auditoria' ? 'auditoria' : 'contas',
      E.faturamentoEtapaRegistrada.codigo,
      (r: number) => ({ tabela: 'conta_hospitalar_etapa', id: String(r), chave: `conta ${e.conta}` }),
      (g) => g.registrarEtapa({ ...e, usuario: s.login }),
    );
    const nome = e.etapa === 'auditoria' ? 'Auditoria' : 'Conferência';
    return resultadoFat(e.acao === 'iniciar' ? `${nome} iniciada.` : `${nome} concluída.`, false, { id: x });
  }

  @Post('contas/:id/auditoria/versoes')
  @HttpCode(200)
  @Permissao('faturamento.auditoria.ajustar')
  @AuditadoNoHandler(
    'versão da auditoria em auditoria_conta_versao com a trilha_auditoria na mesma transação',
  )
  async versao(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarVersaoAuditoria, { ...((b ?? {}) as object), conta: idDaRota(id) });
    await this.servico.exigirEscopoConta(s, e.conta);
    const x = await this.servico.sgh(
      s,
      'auditoria',
      E.faturamentoAuditoriaRegistrada.codigo,
      (r: number) => ({ tabela: 'auditoria_conta_versao', id: String(r), chave: `conta ${e.conta}` }),
      (g) => g.registrarVersaoAuditoria({ ...e, usuario: s.login }),
    );
    return resultadoFat('Parecer e versão da conta registrados.', false, { id: x });
  }

  @Get('pendencias-tipos')
  @Permissao('faturamento.pendencia.ler')
  async tipos(@Req() req: RequisicaoAutorizada): Promise<{
    tipos: { id: number; nome: string; modulos: number[] }[];
    controles: { id: number; nome: string }[];
  }> {
    const s = sessaoDe(req);
    const a = await this.porta.apoioPacotes(ctx(s));
    return { tipos: await this.porta.tiposPendencia(ctx(s)), controles: a.controles };
  }

  // ── Preço ────────────────────────────────────────────────────────────────────────────────────────────

  @Get('itens/:id/explicacao')
  @Permissao('faturamento.item.ler')
  @Auditar(E.faturamentoPrecoExplicado.codigo)
  async explicar(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ExplicacaoLida> {
    const s = sessaoDe(req);
    const item = idDaRota(id);
    await this.servico.exigirEscopoItem(s, item);
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar_item', idAlvo: String(item) };
    const x = await this.porta.explicar(ctx(s), item);
    if (!x) throw new ErroProblema('nao-encontrado', 404, 'Item não encontrado');
    return x;
  }

  /** Os setores do estabelecimento para a escolha no simulador (06-FAT linha 11). */
  @Get('simulador/opcoes')
  @Permissao('faturamento.preco.simular')
  async opcoesSimulador(
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ setores: { id: number; nome: string }[] }> {
    return { setores: await this.porta.setoresDoSimulador(ctx(sessaoDe(req))) };
  }

  @Get('simulador')
  @Permissao('faturamento.preco.simular')
  simular(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const r = esquemaSimular.safeParse(q);
    if (!r.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe convênio, grupo, código e data.',
      );
    const d = r.data;
    const reajuste: ReajusteSimulado = {
      indice: d.reajusteIndice ?? null,
      porte: d.reajustePorte ?? null,
      porteAnestesico: d.reajustePorteAnestesico ?? null,
      tabela: d.reajusteTabela ?? null,
    };
    const pedido = Object.values(reajuste).some((p) => p !== null);
    if (pedido) {
      const erros = validarReajusteSimulado(reajuste);
      if (Object.keys(erros).length > 0)
        throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', Object.values(erros).join(' '));
    }
    const s = sessaoDe(req);
    return this.porta.simular(ctx(s), {
      convenio: d.convenio,
      tipoConta: d.tipoConta,
      tipo: d.tipo as 1 | 2 | 3 | 4,
      codigo: d.codigo,
      quantidade: d.quantidade,
      data: d.data,
      setor: d.setor ?? null,
      horarioEspecial: d.horarioEspecial === 'true',
      reajuste: pedido ? reajuste : null,
    });
  }

  // ── Lançamentos (o que os gatilhos lançaram e a fila tardia) ─────────────────────────────────────────

  @Get('lancamentos/painel')
  @Permissao('faturamento.lancamento.ler')
  @Auditar(E.faturamentoContasLidas.codigo)
  async painel(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelLancamentos> {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    const comp = lerCompetencia(q['competencia']) ?? {
      ano: Number(hoje.slice(0, 4)),
      mes: Number(hoje.slice(5, 7)),
    };
    req.sghAlvo = { tabelaAlvo: 'conta_hospitalar_item', idAlvo: `fila tardia ${comp.ano}-${comp.mes}` };
    return this.porta.painelLancamentos(ctx(s), {
      ...comp,
      desde: menosDias(hoje, await this.parametro(s, 'faturamento.tardioJanelaDias', 180)),
      convenios: this.servico.convenios(s),
    });
  }

  @Post('lancamentos/tardios/:registro/decisao')
  @HttpCode(200)
  @Permissao('faturamento.lancamentoTardio.decidir')
  @AuditadoNoHandler('decisão em decisao_lancamento_tardio (e a reabertura pelo executor) com a trilha')
  async decidir(
    @Param('registro') reg: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDecidirLancamentoTardio, {
      ...((b ?? {}) as Record<string, unknown>),
      registro: idDaRota(reg),
    });
    const hoje = await this.porta.hoje(ctx(s));
    const t = await this.porta.tardios(ctx(s), {
      desde: '1900-01-01',
      convenios: this.servico.convenios(s),
      pagina: 0,
      porPagina: 500,
    });
    const f = t.itens.find((x) => x.registro === e.registro);
    if (!f) throw new ErroProblema('nao-encontrado', 404, 'Ficha não encontrada na fila');
    const c = f.conta ? await this.porta.conta(ctx(s), f.conta, hoje) : null;
    return this.servico.decidirTardio(s, e, c ? { conta: c.id, versao: c.versao } : null, f.decisao);
  }

  // ── Regras e pacotes ─────────────────────────────────────────────────────────────────────────────────

  @Get('regras')
  @Permissao('faturamento.regra.ler')
  regras(@Req() req: RequisicaoAutorizada): Promise<RegraLida[]> {
    return this.porta.regras(ctx(sessaoDe(req)));
  }

  @Post('regras')
  @HttpCode(200)
  @Permissao('faturamento.regra.editar')
  @AuditadoNoHandler('regra em regra_faturabilidade com a trilha_auditoria na mesma transação')
  async editarRegra(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEditarRegraFaturabilidade, b);
    const id = await this.servico.sgh(
      s,
      'regras',
      E.faturamentoRegraEditada.codigo,
      (r: number) => ({ tabela: 'regra_faturabilidade', id: String(r), chave: e.regra.nome }),
      (g) => g.editarRegra({ ...e, usuario: s.login }),
    );
    return resultadoFat(e.id ? 'Regra alterada.' : 'Regra incluída.', false, { id });
  }

  @Get('pacotes')
  @Permissao('faturamento.pacote.ler')
  async pacotes(@Req() req: RequisicaoAutorizada): Promise<{
    pacotes: PacoteLido[];
    orcamentosPadrao: {
      convenio: number;
      procedimento: number;
      tipo: number;
      nome: string;
      valor: number;
      quantidade: number;
    }[];
    orcamentoAntigo: number;
  }> {
    const s = sessaoDe(req);
    const a = await this.porta.apoioPacotes(ctx(s));
    return {
      pacotes: await this.porta.pacotes(ctx(s)),
      orcamentosPadrao: a.orcamentosPadrao,
      orcamentoAntigo: a.orcamentoAntigo,
    };
  }

  @Post('pacotes')
  @HttpCode(200)
  @Permissao('faturamento.pacote.editar')
  @AuditadoNoHandler('pacote em pacote_contrato com a trilha_auditoria na mesma transação')
  async editarPacote(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEditarPacote, b);
    const id = await this.servico.sgh(
      s,
      'regras',
      E.faturamentoPacoteEditado.codigo,
      (r: number) => ({ tabela: 'pacote_contrato', id: String(r), chave: `${e.convenio}/${e.codigo}` }),
      (g) => g.editarPacote({ ...e, usuario: s.login }),
    );
    return resultadoFat(e.id ? 'Pacote alterado.' : 'Pacote incluído.', false, { id });
  }

  // ── Nota de sala ─────────────────────────────────────────────────────────────────────────────────────

  @Get('notas-sala')
  @Permissao('cirurgia.nota.ler')
  async cirurgias(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const hoje = await this.porta.hoje(ctx(s));
    return this.porta.cirurgias(ctx(s), dataOu(q['desde'], menosDias(hoje, 30)));
  }

  @Get('notas-sala/:id')
  @Permissao('cirurgia.nota.ler')
  @Auditar(E.faturamentoContasLidas.codigo)
  async nota(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<NotaSala> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'ato_cirurgico', idAlvo: id };
    const n = await this.porta.notaSala(ctx(s), idDaRota(id));
    if (!n) throw new ErroProblema('nao-encontrado', 404, 'Cirurgia não encontrada');
    return n;
  }

  // ── Particular ───────────────────────────────────────────────────────────────────────────────────────

  @Get('particular/orcamentos')
  @Permissao('faturamento.orcamento.ler')
  @Auditar(E.faturamentoContasLidas.codigo)
  async orcamentos(@Req() req: RequisicaoAutorizada): Promise<OrcamentoParticular[]> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'orcamento_particular', idAlvo: 'lista' };
    return this.porta.orcamentos(ctx(s), await this.porta.hoje(ctx(s)));
  }

  @Post('particular/orcamentos')
  @HttpCode(200)
  @Permissao('faturamento.orcamento.criar')
  @AuditadoNoHandler('orçamento em orcamento_particular com a trilha_auditoria na mesma transação')
  async orcamento(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarOrcamento, b);
    const r = await this.servico.sgh(
      s,
      'particular',
      E.faturamentoOrcamentoRegistrado.codigo,
      (x: { id: number }) => ({ tabela: 'orcamento_particular', id: String(x.id) }),
      (g) => g.registrarOrcamento({ ...e, usuario: s.login }),
    );
    return resultadoFat(`Orçamento ${r.id} registrado: R$ ${r.total.toFixed(2).replace('.', ',')}.`, false, {
      id: r.id,
      total: r.total,
    });
  }

  @Get('particular/caixas')
  @Permissao('faturamento.recibo.ler')
  caixas(@Query('meus') meus: string | undefined, @Req() req: RequisicaoAutorizada): Promise<CaixaLido[]> {
    const s = sessaoDe(req);
    return this.porta.caixas(ctx(s), meus === 'nao' ? null : s.login);
  }

  @Post('particular/caixas')
  @HttpCode(200)
  @Permissao('faturamento.recibo.emitir')
  @AuditadoNoHandler('caixa em sessao_caixa com a trilha_auditoria na mesma transação')
  async abrirCaixa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAbrirCaixa, b);
    const id = await this.servico.sgh(
      s,
      'particular',
      E.faturamentoCaixaMovimentado.codigo,
      (r: number) => ({ tabela: 'sessao_caixa', id: String(r) }),
      (g) => g.abrirCaixa({ ...e, usuario: s.login }),
    );
    return resultadoFat('Caixa aberto.', false, { id });
  }

  @Post('particular/caixas/:id/fechar')
  @HttpCode(200)
  @Permissao('faturamento.recibo.emitir')
  @AuditadoNoHandler('fechamento do caixa em sessao_caixa com a trilha_auditoria na mesma transação')
  async fecharCaixa(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaFecharCaixa, { ...((b ?? {}) as object), id: idDaRota(id) });
    const r = await this.servico.sgh(
      s,
      'particular',
      E.faturamentoCaixaMovimentado.codigo,
      () => ({ tabela: 'sessao_caixa', id: String(e.id) }),
      (g) => g.fecharCaixa({ ...e, usuario: s.login }),
    );
    const dif = Math.round((e.contado - r.esperado) * 100) / 100;
    return resultadoFat(
      dif === 0
        ? 'Caixa fechado sem diferença.'
        : `Caixa fechado com diferença de R$ ${dif.toFixed(2).replace('.', ',')}.`,
      false,
      { id: e.id },
    );
  }

  @Post('particular/recebimentos')
  @HttpCode(200)
  @Permissao('faturamento.recibo.emitir')
  @AuditadoNoHandler('pagamento em movimento_caixa com a trilha_auditoria na mesma transação')
  receber(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFaturamento> {
    return this.servico.receber(sessaoDe(req), corpo(esquemaReceberParticular, b));
  }

  @Get('particular/pagamentos')
  @Permissao('faturamento.pagamento.ler')
  pagamentos(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<PagamentoLido[]> {
    const dataOuNulo = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const forma = (FORMAS_PAGAMENTO as readonly string[]).includes(q['forma'] ?? '') ? q['forma']! : null;
    const situacao = ['aprovado', 'pendente', 'recusado', 'estornado'].includes(q['situacao'] ?? '')
      ? q['situacao']!
      : null;
    return this.porta.pagamentos(ctx(sessaoDe(req)), {
      caixa: inteiroOuNulo(q['caixa']),
      forma,
      situacao,
      desde: dataOuNulo(q['desde']),
      ate: dataOuNulo(q['ate']),
      pagina: pagina(q['pagina']),
      porPagina: 100,
    });
  }

  @Get('particular/recibos')
  @Permissao('faturamento.recibo.ler')
  recibos(
    @Query('antigos') antigos: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ReciboLido[]> {
    return this.porta.recibos(ctx(sessaoDe(req)), antigos === 'sim');
  }

  @Post('particular/recibos')
  @HttpCode(200)
  @Permissao('faturamento.recibo.emitir')
  @AuditadoNoHandler('recibo em recibo com a trilha_auditoria na mesma transação')
  async emitirRecibo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFaturamento> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEmitirRecibo, b);
    const r = await this.servico.sgh(
      s,
      'particular',
      E.faturamentoReciboEmitido.codigo,
      (x: { id: number }) => ({ tabela: 'recibo', id: String(x.id) }),
      (g) => g.emitirRecibo({ ...e, usuario: s.login }),
    );
    return resultadoFat(`Recibo nº ${r.numero} emitido.`, false, { id: r.id, numero: r.numero });
  }
}
