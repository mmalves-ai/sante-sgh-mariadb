// F3.8, 07-FIN linha 66: rotas do pagamento eletrônico a credores.
//   GET  /api/financeiro/pagamento-eletronico/remessas                    remessas do escopo, com o que aguarda retorno
//   GET  /api/financeiro/pagamento-eletronico/retornos?remessa=           retornos lidos da remessa, linha a linha
//   POST /api/financeiro/pagamento-eletronico/retornos                    { remessa, nomeArquivo, conteudo }
//   GET  /api/financeiro/pagamento-eletronico/retorno-simulado?remessa=   o retorno do simulador (fora de produção)
//   GET  /api/financeiro/pagamento-eletronico/credores?busca=&tipo=       credores (fornecedor; tipo=prestador: prestador terceiro)
//   GET  /api/financeiro/pagamento-eletronico/credores/contas?tipo=&credor= contas e chaves do credor (mascaradas);
//                                                                         ?fornecedor= é a forma curta do fornecedor
//   POST /api/financeiro/pagamento-eletronico/credores/contas             incluir, alterar ou desativar a conta (C1-026:
//                                                                         permissão própria, separada de quem gera a remessa)
//   GET  /api/financeiro/pagamento-eletronico/bancos                      bancos da lista oficial
//   GET  /api/financeiro/pagamento-eletronico/pix/parcelas                parcelas em aberto para a remessa por Pix
//   POST /api/financeiro/pagamento-eletronico/pix/remessas                { conta, parcelas, dataPagamento }
// A gravação vai pelo executor do @sgh/nucleo (trilha, outbox e idempotência na mesma transação; a permissão é a da
// rota); a leitura, direto no banco do cliente (sem núcleo: 503, falha fechada).
import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import {
  credorDaConta,
  credorRecusado,
  TIPOS_CREDOR_CONTA,
  type TipoCredorConta,
} from '@sgh/dominio-financeiro';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo, inteiroOuNulo } from '../exames/public-api.js';
import { type ArmazemFinanceiro, ErroSobrescritaArquivo } from './armazem.js';
import { contasDoEscopo } from './operacoes.js';
import {
  bancosParaConta,
  contasDoCredor,
  credoresParaPagamento,
  esquemaContaCredor,
  esquemaGerarRemessaPix,
  esquemaProcessarRetorno,
  montarRemessaPix,
  OPERACOES_PAGAMENTO_ELETRONICO,
  parcelasParaPix,
  prestadoresParaPagamento,
  remessasComPendencia,
  retornoSimulado,
  retornosDaRemessa,
} from './pagamento-eletronico-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';
import { ARMAZEM_FINANCEIRO } from './simbolos.js';

@Controller('financeiro/pagamento-eletronico')
export class PagamentoEletronicoController {
  private readonly executor: Executor | null;
  private readonly ambiente: string;

  constructor(
    @Inject(ARMAZEM_FINANCEIRO) private readonly armazem: ArmazemFinanceiro,
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.ambiente = (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev';
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  private ler<T>(
    req: RequisicaoAutorizada,
    fn: (l: Leitor, est: number, usuario: number | null) => Promise<T>,
  ): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) },
      (l) => fn(l, est, s.porta.usuario ?? null),
    );
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_PAGAMENTO_ELETRONICO,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(
        OPERACOES_PAGAMENTO_ELETRONICO[op] as never,
        s.porta.cliente,
        entrada,
        contextoOperacao(s, op),
      )
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(res), r.repetida, res);
  }

  private exigirRemessa(v: string | undefined): number {
    const n = inteiroOuNulo(v);
    if (!n) throw new ErroProblema('entrada-invalida', 400, 'Remessa inválida', 'Escolha a remessa.');
    return n;
  }

  /** A remessa tem de ser de uma conta do escopo de consulta de quem lê (regra 15). */
  private async exigirRemessaDoEscopo(l: Leitor, est: number, usuario: number | null, remessa: number) {
    const contas = await contasDoEscopo(l, est, usuario, 'consultar');
    const r = await l.uma(
      'SELECT conta_bancaria_id FROM remessa_bancaria WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [remessa, est],
    );
    if (!r || !contas.includes(Number(r['conta_bancaria_id'])))
      throw new ErroProblema('nao-encontrado', 404, 'Remessa não encontrada');
  }

  // ── Retorno do banco ──

  @Get('remessas')
  @Permissao('financeiro.remessa.ler')
  remessas(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, async (l, est, usuario) =>
      remessasComPendencia(l, est, await contasDoEscopo(l, est, usuario, 'consultar')),
    );
  }

  @Get('retornos')
  @Permissao('financeiro.remessa.ler')
  retornos(@Query('remessa') remessa: string | undefined, @Req() req: RequisicaoAutorizada) {
    const n = this.exigirRemessa(remessa);
    return this.ler(req, async (l, est, usuario) => {
      await this.exigirRemessaDoEscopo(l, est, usuario, n);
      return retornosDaRemessa(l, est, n);
    });
  }

  @Post('retornos')
  @HttpCode(200)
  @Permissao('financeiro.tituloPagar.baixar')
  @AuditadoNoHandler('financeiro.processarRetornoPagamento pelo executor (trilha na mesma transação)')
  processarRetorno(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.processarRetornoPagamento',
      corpo(esquemaProcessarRetorno, b),
      (r) =>
        `Retorno processado: ${Number(r['baixados'])} título(s) baixado(s), ${Number(r['rejeitados'])} rejeitado(s), ` +
        `${Number(r['agendados'])} agendado(s) e ${Number(r['naoLocalizados'])} fora da remessa. ` +
        `${Number(r['pendentes'])} parcela(s) ainda aguardam o banco.`,
    );
  }

  @Get('retorno-simulado')
  @Permissao('financeiro.remessa.ler')
  async simulado(@Query('remessa') remessa: string | undefined, @Req() req: RequisicaoAutorizada) {
    // Em produção o retorno vem do banco: o simulador não existe.
    if (this.ambiente === 'producao') throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    const n = this.exigirRemessa(remessa);
    const conteudo = await this.ler(req, async (l, est, usuario) => {
      await this.exigirRemessaDoEscopo(l, est, usuario, n);
      return retornoSimulado(l, est, n);
    });
    if (conteudo === null) throw new ErroProblema('nao-encontrado', 404, 'Remessa não encontrada');
    return { nomeArquivo: `retorno-simulado-${n}.ret`, conteudo };
  }

  // ── Dados bancários e chave Pix do credor ──

  @Get('credores')
  @Permissao('financeiro.tituloPagar.ler')
  credores(
    @Query('busca') busca: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const termo = (busca ?? '').trim().slice(0, 80);
    if (termo.length < 2 && !/^\d$/.test(termo)) return [];
    if (tipo === 'prestador') return this.ler(req, (l, est) => prestadoresParaPagamento(l, est, termo));
    return this.ler(req, (l) => credoresParaPagamento(l, termo));
  }

  @Get('credores/contas')
  @Permissao('financeiro.tituloPagar.ler')
  contas(
    @Query('fornecedor') fornecedor: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Query('credor') credor: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const tipoCredor = TIPOS_CREDOR_CONTA.includes(tipo as TipoCredorConta)
      ? (tipo as TipoCredorConta)
      : undefined;
    const r = credorDaConta({
      fornecedor: fornecedor === undefined ? undefined : (inteiroOuNulo(fornecedor) ?? 0),
      tipoCredor: tipo === undefined ? undefined : (tipoCredor ?? ('?' as TipoCredorConta)),
      credor: credor === undefined ? undefined : (inteiroOuNulo(credor) ?? 0),
    });
    if (credorRecusado(r)) throw new ErroProblema('entrada-invalida', 400, 'Credor inválido', r.mensagem);
    return this.ler(req, (l) => contasDoCredor(l, r));
  }

  @Get('bancos')
  @Permissao('financeiro.tituloPagar.ler')
  bancos(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l) => bancosParaConta(l));
  }

  @Post('credores/contas')
  @HttpCode(200)
  @Permissao('financeiro.contaCredor.manter')
  @AuditadoNoHandler('financeiro.manterContaCredor pelo executor (trilha na mesma transação)')
  manterConta(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'financeiro.manterContaCredor', corpo(esquemaContaCredor, b), (r) =>
      r['acao'] === 'desativar'
        ? 'Conta do credor desativada; a linha fica no histórico.'
        : 'Dados bancários do credor gravados.',
    );
  }

  // ── Remessa por Pix ──

  @Get('pix/parcelas')
  @Permissao('financeiro.remessa.ler')
  parcelasPix(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => parcelasParaPix(l, est));
  }

  @Post('pix/remessas')
  @HttpCode(200)
  @Permissao('financeiro.remessa.gerar')
  @AuditadoNoHandler('financeiro.registrarRemessaPix pelo executor (trilha na mesma transação)')
  async gerarPix(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    const e = corpo(esquemaGerarRemessaPix, b);
    // O arquivo é montado e guardado antes; a gravação remonta sob a trava e só registra se for o mesmo arquivo.
    const montada = await this.ler(req, (l, est) =>
      montarRemessaPix(l, est, e.conta, e.parcelas, e.dataPagamento).catch((x: unknown) => {
        throw problemaDoCadastro(x);
      }),
    );
    const hash = createHash('sha256').update(montada.conteudo, 'utf8').digest('hex');
    const bytes = new TextEncoder().encode(montada.conteudo);
    const chave = `remessa/${e.conta}/pix-${e.dataPagamento}-${hash.slice(0, 16)}.rem`;
    try {
      await this.armazem.guardar(chave, bytes, 'text/plain');
    } catch (x) {
      // O mesmo arquivo (mesma impressão digital) já guardado: segue para o registro, que é idempotente pelo pedido.
      if (!(x instanceof ErroSobrescritaArquivo)) throw x;
    }
    return this.gravar(
      req,
      'financeiro.registrarRemessaPix',
      {
        ...e,
        hashArquivo: hash,
        arquivo: { chave, tamanhoBytes: bytes.length, tipoMime: 'text/plain' },
        destino: this.ambiente === 'producao' ? 'banco' : 'simulador',
      },
      (r) =>
        `Remessa por Pix ${String(r['numero'])} gerada com ${Number(r['titulos'])} título(s); as parcelas aguardam o retorno do banco.`,
    );
  }
}
