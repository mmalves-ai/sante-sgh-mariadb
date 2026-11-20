// Rotas das contas médicas recebidas pela operadora própria (M56, etapa 6, F5; ficha, seções 4, 6 e 7):
//   GET  /api/operadora/contas/apoio                   operadoras, prestadores, motivos de glosa (tabela 38), a designação
//                                                      de quem está na tela e a situação da fatia (vale também desligada)
//   GET  /api/operadora/contas                         os lotes (busca, prestador, competência, situação, vencidas,
//                                                      recursos, apos), com as contagens
//   GET  /api/operadora/contas/:id                     a ficha com as guias, os itens, as glosas e o histórico (leitura
//                                                      na trilha: conteúdo clínico)
//   GET  /api/operadora/contas/:id/demonstrativo       o demonstrativo de análise da conta em XML TISS (conferido no XSD)
//   GET  /api/operadora/contas/:id/demonstrativo-pagamento  W0-10 (M8): o demonstrativo de pagamento do lote quitado
//   POST /api/operadora/contas/xml                     operadora.receberConta (XSD, hash, protocolo e glosa automática)
//   POST /api/operadora/contas/:id/glosas              operadora.glosarConta (auditor designado)
//   POST /api/operadora/contas/:id/analise             operadora.concluirAnaliseConta (libera para pagamento)
//   POST /api/operadora/contas/:id/devolver            operadora.devolverConta (sem pagamento, com o motivo)
//   POST /api/operadora/contas/:id/recurso             operadora.registrarRecursoConta (o recurso do prestador)
//   POST /api/operadora/contas/:id/recurso/decisao     operadora.decidirRecursoConta (auditor designado)
//   POST /api/operadora/contas/:id/guias/:guia/recurso-itens/decisao  W0-10 (M8): o recurso por item, item a item
//   GET  /api/operadora/pagamentos-prestadores         o que pagar aos prestadores (só valores)
//   POST /api/operadora/contas/:id/pagamento           operadora.pagarConta (o valor, a data e o documento)
// Tudo exige a chave da fatia `operadora.contas`, que só vale com a do módulo (regra 1), menos o apoio. Cada gravação
// muda as SGH_OPE_CONTA_* com a SGH_TRILHA na mesma transação; nenhuma tabela legada é escrita.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioContas,
  CHAVE_OPERADORA_CONTAS,
  type ContaMedicaDetalhe,
  type Contas,
  type DemonstrativoConta,
  esquemaConcluirAnalise,
  esquemaDecidirRecurso,
  esquemaDecidirRecursoItens,
  esquemaDevolverConta,
  esquemaFiltroContas,
  esquemaFiltroPagamentos,
  esquemaGlosarConta,
  esquemaReceberConta,
  esquemaRegistrarPagamento,
  esquemaRegistrarRecursoConta,
  EVENTOS_AUDITAVEIS,
  type PagamentosPrestadores,
  type ResultadoConta,
  ROTAS_OPERADORA_F5 as R,
  SITUACOES_RECURSO_CONTA,
} from '@sgh/contratos';
import { protocoloConta } from '@sgh/dominio-operadora';
import type { LinhaTrilha } from '@sgh/legado';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ServicoSituacaoOperadora, type SujeitoOperadora } from './aplicacao/situacao.js';
import { type GravadorContas, PORTA_CONTAS_OPERADORA, type PortaContasOperadora } from './contas-porta.js';
import { pagamentoDe, resumoDaConta, ServicoContasOperadora } from './contas-servico.js';

const E = EVENTOS_AUDITAVEIS;
const RECURSO = 'operadora.contas';
const TABELA = 'SGH_OPE_CONTA';

function filtro<T extends { safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown } }>(
  esquema: T,
  q: unknown,
) {
  const r = esquema.safeParse(q ?? {});
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Parâmetros inválidos', 'Filtro inválido.');
  return r.data as T extends { safeParse(v: unknown): { data?: infer D } } ? Exclude<D, undefined> : never;
}

const brl = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

@Controller()
export class ContasOperadoraController {
  readonly situacoes: ServicoSituacaoOperadora;
  readonly servico: ServicoContasOperadora;

  constructor(
    @Inject(PORTA_CONTAS_OPERADORA) private readonly porta: PortaContasOperadora,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.situacoes = new ServicoSituacaoOperadora(fonte, cache);
    this.servico = new ServicoContasOperadora(porta);
  }

  private sujeito(req: RequisicaoAutorizada, s: SessaoCadastro): SujeitoOperadora {
    return {
      rede: s.rede,
      hospital: s.hospital,
      login: s.login,
      setor: req.sgh?.sessao.unidadeAtiva ?? null,
    };
  }

  /** A fatia vale (módulo e contas ligados) ou 403 `recurso-desligado` com o motivo (nada é lido nem gravado). */
  private async exigirFatia(req: RequisicaoAutorizada): Promise<SessaoCadastro> {
    const s = sessaoDe(req);
    await this.situacoes.exigir(this.sujeito(req, s), CHAVE_OPERADORA_CONTAS);
    return s;
  }

  /** Gravação SGH_ com a trilha na mesma transação (na memória, a trilha pelo registrador da API). */
  private async gravar<T extends { id: number }>(
    s: SessaoCadastro,
    evento: string,
    operacao: string,
    fn: (g: GravadorContas) => Promise<T>,
  ): Promise<T> {
    const linha = (r: T): LinhaTrilha =>
      linhaTrilha(s, evento, RECURSO, operacao, { tabela: TABELA, id: String(r.id) });
    const r = await this.porta.gravarSgh(s.porta, linha, fn).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
    if (this.porta.destino === 'memoria')
      await this.trilha.registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso: RECURSO,
        resultado: 'sucesso',
        tabelaAlvo: 'MEMORIA',
        idAlvo: String(r.id),
      });
    return r;
  }

  private resultado(
    id: number,
    versao: number,
    situacao: ResultadoConta['situacao'],
    protocolo: string,
    mensagem: string,
    avisos: string[] = [],
  ): ResultadoConta {
    return { ok: true, id, versao, situacao, protocolo, mensagem, avisos };
  }

  @Get(R.apoio.caminho)
  @Permissao(R.apoio.permissao)
  async apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioContas> {
    const s = sessaoDe(req);
    const situacao = await this.situacoes.situacao(this.sujeito(req, s));
    const fatia = situacao.fatias.find((f) => f.chave === CHAVE_OPERADORA_CONTAS);
    const ligada = fatia?.situacao === 'ligada';
    return this.servico.apoio(s.porta, {
      ligada,
      motivo: ligada ? null : (fatia?.motivo ?? situacao.modulo.motivo),
      podeLer: s.pode(R.lista.permissao),
      podeReceber: s.pode(R.receber.permissao),
      podeAnalisar: s.pode(R.glosar.permissao),
      podePagar: s.pode(R.pagar.permissao),
      login: s.login,
    });
  }

  @Get(R.lista.caminho)
  @Permissao(R.lista.permissao)
  async lista(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Contas> {
    const f = filtro(esquemaFiltroContas, q);
    const s = await this.exigirFatia(req);
    const [r, totais, relogio] = await Promise.all([
      this.porta.contas(s.porta, {
        ...(f.busca ? { busca: f.busca.replace(/[\s.\-/]/g, '') } : {}),
        ...(f.prestador !== undefined ? { prestador: f.prestador } : {}),
        ...(f.competencia ? { competencia: f.competencia } : {}),
        ...(f.situacao ? { situacao: f.situacao } : {}),
        ...(f.vencidas ? { vencidas: true } : {}),
        ...(f.recursos ? { recursos: true } : {}),
        ...(f.apos !== undefined ? { apos: f.apos } : {}),
      }),
      this.porta.totais(s.porta),
      this.porta.relogio(s.porta),
    ]);
    return { itens: r.itens.map((c) => resumoDaConta(c, relogio.hoje)), proxima: r.proxima, totais };
  }

  @Get(R.pagamentos.caminho)
  @Permissao(R.pagamentos.permissao)
  async pagamentos(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PagamentosPrestadores> {
    const f = filtro(esquemaFiltroPagamentos, q);
    const s = await this.exigirFatia(req);
    const [r, totais, relogio] = await Promise.all([
      this.porta.pagamentos(s.porta, {
        estado: f.estado,
        ...(f.prestador !== undefined ? { prestador: f.prestador } : {}),
        ...(f.competencia ? { competencia: f.competencia } : {}),
        ...(f.apos !== undefined ? { apos: f.apos } : {}),
      }),
      this.porta.totais(s.porta),
      this.porta.relogio(s.porta),
    ]);
    const itens = r.itens.map((c) => pagamentoDe(c, relogio.hoje));
    return {
      itens,
      proxima: r.proxima,
      totais: { aPagar: totais.aPagar, valorAPagar: totais.valorAPagar, vencidas: totais.vencidas },
    };
  }

  @Get(R.ficha.caminho)
  @Permissao(R.ficha.permissao)
  @Auditar(E.operadoraContaLida.codigo)
  async ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ContaMedicaDetalhe> {
    const n = idDaRota(id);
    const s = await this.exigirFatia(req);
    req.sghAlvo = { tabelaAlvo: TABELA, idAlvo: String(n) };
    return this.servico.detalhe(s.porta, n, {
      login: s.login,
      podeAnalisar: s.pode(R.glosar.permissao),
      podeReceber: s.pode(R.receber.permissao),
      podePagar: s.pode(R.pagar.permissao),
    });
  }

  @Get(R.demonstrativo.caminho)
  @Permissao(R.demonstrativo.permissao)
  @Auditar(E.operadoraContaDemonstrativo.codigo)
  async demonstrativo(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DemonstrativoConta> {
    const n = idDaRota(id);
    const s = await this.exigirFatia(req);
    req.sghAlvo = { tabelaAlvo: TABELA, idAlvo: String(n) };
    return this.servico.demonstrativo(s.porta, n);
  }

  @Get(R.demonstrativoPagamento.caminho)
  @Permissao(R.demonstrativoPagamento.permissao)
  @Auditar(E.operadoraContaDemonstrativoPagamento.codigo)
  async demonstrativoPagamento(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DemonstrativoConta> {
    const n = idDaRota(id);
    const s = await this.exigirFatia(req);
    req.sghAlvo = { tabelaAlvo: TABELA, idAlvo: String(n) };
    return this.servico.demonstrativoPagamento(s.porta, n);
  }

  @Post(R.receber.caminho)
  @HttpCode(200)
  @Permissao(R.receber.permissao)
  @AuditadoNoHandler(
    'operadora.receberConta (SGH_OPE_CONTA, as guias, os itens e o evento) com a SGH_TRILHA na mesma transação',
  )
  async receber(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoConta> {
    const e = corpo(esquemaReceberConta, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirRecebimento(s.porta, e);
    const { hoje } = await this.porta.relogio(s.porta);
    let protocolo = '';
    const r = await this.gravar(s, E.operadoraContaRecebida.codigo, 'operadora.receberConta', async (g) => {
      protocolo = protocoloConta(hoje, await g.proximoProtocolo());
      return g.receber({
        ...x.recebimento,
        protocolo,
        texto: ServicoContasOperadora.textoDoRecebimento(protocolo, x),
        usuario: s.login,
      });
    });
    const avisos = x.itensGlosados
      ? [
          `Glosa automática de ${brl(x.glosadoAutomatico)} em ${x.itensGlosados} item(ns): o auditor revê cada uma na análise.`,
        ]
      : [];
    return this.resultado(
      r.id,
      r.versao,
      'recebida',
      protocolo,
      `Lote ${x.recebimento.numeroLote} recebido com o protocolo ${protocolo}: ${x.guias} guia(s), apresentado ${brl(x.recebimento.apresentado)}. Pagamento até ${x.recebimento.prazoPagamento.split('-').reverse().join('/')}.`,
      avisos,
    );
  }

  @Post(R.glosar.caminho)
  @HttpCode(200)
  @Permissao(R.glosar.permissao)
  @AuditadoNoHandler(
    'operadora.glosarConta (SGH_OPE_CONTA_ITEM, os valores e o evento) com a SGH_TRILHA na mesma transação',
  )
  async glosar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoConta> {
    const n = idDaRota(id);
    const e = corpo(esquemaGlosarConta, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirGlosa(s.porta, n, e, s.login);
    const r = await this.gravar(s, E.operadoraContaGlosada.codigo, 'operadora.glosarConta', (g) =>
      g.glosar({
        id: n,
        versao: e.versao,
        itens: e.itens.map((i) =>
          Math.round(i.valorGlosado * 100) > 0
            ? i
            : { item: i.item, valorGlosado: 0, motivo: null, justificativa: null },
        ),
        texto: x.texto,
        desfeita: x.desfeita,
        usuario: s.login,
      }),
    );
    return this.resultado(n, r.versao, 'recebida', x.conta.protocolo, x.texto);
  }

  @Post(R.concluir.caminho)
  @HttpCode(200)
  @Permissao(R.concluir.permissao)
  @AuditadoNoHandler(
    'operadora.concluirAnaliseConta (SGH_OPE_CONTA e o evento) com a SGH_TRILHA na mesma transação',
  )
  async concluir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoConta> {
    const n = idDaRota(id);
    const e = corpo(esquemaConcluirAnalise, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirConclusao(s.porta, n, s.login);
    const r = await this.gravar(s, E.operadoraContaAnalisada.codigo, 'operadora.concluirAnaliseConta', (g) =>
      g.concluir({
        id: n,
        versao: e.versao,
        auditor: x.auditor.id,
        situacao: x.situacao,
        observacao: e.observacao,
        texto: x.texto,
        usuario: s.login,
      }),
    );
    return this.resultado(
      n,
      r.versao,
      x.situacao,
      x.conta.protocolo,
      x.situacao === 'paga'
        ? `${x.texto} Nada a pagar ao prestador: o lote fica encerrado.`
        : `${x.texto} O lote está liberado para o pagamento ao prestador.`,
    );
  }

  @Post(R.devolver.caminho)
  @HttpCode(200)
  @Permissao(R.devolver.permissao)
  @AuditadoNoHandler('operadora.devolverConta (SGH_OPE_CONTA e o evento) com a SGH_TRILHA na mesma transação')
  async devolver(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoConta> {
    const n = idDaRota(id);
    const e = corpo(esquemaDevolverConta, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirDevolucao(s.porta, n, s.login);
    const r = await this.gravar(s, E.operadoraContaDevolvida.codigo, 'operadora.devolverConta', (g) =>
      g.devolver({ id: n, versao: e.versao, motivo: e.motivo, usuario: s.login }),
    );
    return this.resultado(
      n,
      r.versao,
      'devolvida',
      x.conta.protocolo,
      `Lote ${x.conta.numeroLote} devolvido ao prestador sem pagamento. O prestador pode mandar o lote corrigido com o mesmo número.`,
    );
  }

  @Post(R.recurso.caminho)
  @HttpCode(200)
  @Permissao(R.recurso.permissao)
  @AuditadoNoHandler(
    'operadora.registrarRecursoConta (SGH_OPE_CONTA_GUIA e o evento) com a SGH_TRILHA na mesma transação',
  )
  async recurso(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoConta> {
    const n = idDaRota(id);
    const e = corpo(esquemaRegistrarRecursoConta, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirRecurso(s.porta, n, e);
    const r = await this.gravar(
      s,
      E.operadoraContaRecursoRegistrado.codigo,
      'operadora.registrarRecursoConta',
      (g) =>
        g.registrarRecurso({
          id: n,
          versao: e.versao,
          guia: e.guia,
          valor: e.valor,
          justificativa: e.justificativa,
          situacao: x.situacao,
          usuario: s.login,
        }),
    );
    return this.resultado(
      n,
      r.versao,
      x.situacao,
      x.conta.protocolo,
      `Recurso de ${brl(e.valor)} registrado na guia ${x.guia.numeroGuiaPrestador}. O auditor decide.`,
    );
  }

  @Post(R.decidirRecurso.caminho)
  @HttpCode(200)
  @Permissao(R.decidirRecurso.permissao)
  @AuditadoNoHandler(
    'operadora.decidirRecursoConta (SGH_OPE_CONTA_GUIA, os valores e o evento) com a SGH_TRILHA na mesma transação',
  )
  async decidirRecurso(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoConta> {
    const n = idDaRota(id);
    const e = corpo(esquemaDecidirRecurso, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirDecisaoRecurso(s.porta, n, e, s.login);
    const r = await this.gravar(
      s,
      E.operadoraContaRecursoDecidido.codigo,
      'operadora.decidirRecursoConta',
      (g) =>
        g.decidirRecurso({
          id: n,
          versao: e.versao,
          guia: e.guia,
          valorAcatado: e.valorAcatado,
          situacaoRecurso: x.situacaoRecurso,
          parecer: e.parecer,
          situacao: x.situacao,
          usuario: s.login,
        }),
    );
    return this.resultado(
      n,
      r.versao,
      x.situacao,
      x.conta.protocolo,
      `${SITUACOES_RECURSO_CONTA[x.situacaoRecurso]} na guia ${x.guia.numeroGuiaPrestador}` +
        (e.valorAcatado > 0 ? `: ${brl(e.valorAcatado)} a mais liberados para pagamento.` : '.'),
    );
  }

  @Post(R.decidirRecursoItens.caminho)
  @HttpCode(200)
  @Permissao(R.decidirRecursoItens.permissao)
  @AuditadoNoHandler(
    'operadora.decidirRecursoItens (SGH_OPE_CONTA_RECURSO_ITEM, a guia pela soma e o evento) com a SGH_TRILHA na mesma transação',
  )
  async decidirRecursoItens(
    @Param('id') id: string,
    @Param('guia') guia: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoConta> {
    const n = idDaRota(id);
    const ng = idDaRota(guia);
    const e = corpo(esquemaDecidirRecursoItens, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirDecisaoRecursoItens(s.porta, n, ng, e, s.login);
    const r = await this.gravar(
      s,
      E.operadoraContaRecursoItensDecidido.codigo,
      'operadora.decidirRecursoItens',
      (g) =>
        g.decidirRecursoItens({
          id: n,
          versao: e.versao,
          guia: ng,
          decisoes: e.decisoes,
          parecer: e.parecer,
          situacao: x.situacao,
          usuario: s.login,
        }),
    );
    return this.resultado(
      n,
      r.versao,
      x.situacao,
      x.conta.protocolo,
      `${SITUACOES_RECURSO_CONTA[r.decisao]} na guia ${x.guia.numeroGuiaPrestador}, item a item` +
        (x.valorAcatado > 0 ? `: ${brl(x.valorAcatado)} a mais liberados para pagamento.` : '.'),
    );
  }

  @Post(R.pagar.caminho)
  @HttpCode(200)
  @Permissao(R.pagar.permissao)
  @AuditadoNoHandler('operadora.pagarConta (SGH_OPE_CONTA e o evento) com a SGH_TRILHA na mesma transação')
  async pagar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoConta> {
    const n = idDaRota(id);
    const e = corpo(esquemaRegistrarPagamento, b);
    const s = await this.exigirFatia(req);
    const x = await this.servico.conferirPagamento(s.porta, n, e);
    const r = await this.gravar(s, E.operadoraContaPaga.codigo, 'operadora.pagarConta', (g) =>
      g.pagar({
        id: n,
        versao: e.versao,
        valor: e.valor,
        data: e.data,
        documento: e.documento,
        situacao: x.situacao,
        usuario: s.login,
      }),
    );
    return this.resultado(
      n,
      r.versao,
      x.situacao,
      x.conta.protocolo,
      x.situacao === 'paga'
        ? `Pagamento de ${brl(e.valor)} registrado: o lote está pago.`
        : `Pagamento de ${brl(e.valor)} registrado; faltam ${brl(x.saldoDepois)}.`,
    );
  }
}
