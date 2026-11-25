// F3.8, 07-FIN linha 89: rotas do cartão de débito e crédito.
//   GET  /api/financeiro/cartao/administradoras          administradoras (todas) e bandeiras, para o cadastro
//   POST /api/financeiro/cartao/administradoras          { id?, versao?, nome, diasParaPagamento, contaBancaria, ... }
//   GET  /api/financeiro/cartao/taxas?administradora=    taxas com vigência (as que valem hoje primeiro)
//   POST /api/financeiro/cartao/taxas                    taxa nova: encerra na véspera a que valia
//   POST /api/financeiro/cartao/taxas/:id/encerrar       { vigenciaFim }
//   GET  /api/financeiro/cartao/opcoes                   administradoras ativas e bandeiras (combos do recebimento)
//   GET  /api/financeiro/cartao/previa?...               taxa vigente e parcelas a receber da venda (sem gravar)
//   POST /api/financeiro/cartao/recebimentos             venda em cartão registrada pela tesouraria
//   GET  /api/financeiro/cartao/recebiveis?de=&ate=      parcelas a receber das administradoras, pela data prevista
//   POST /api/financeiro/cartao/recebiveis/baixa         { parcelas, conta, dataCredito, valorCreditado? }
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
// Na sessão sintética (sem banco do cliente) só as opções e a prévia do recebimento respondem, pela regra do domínio
// (cartao-memoria.ts); o cadastro, a venda e a baixa seguem só no banco.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaAdministradoraCartao,
  esquemaBaixarRecebiveisCartao,
  esquemaEncerrarTaxaCartao,
  esquemaRecebimentoCartao,
  esquemaTaxaCartao,
  OPERACOES_CARTAO,
  opcoesCartao,
  planoDoCartao,
  recebiveisCartao,
  taxasDaAdministradora,
} from './cartao-propria.js';
import { opcoesCartaoMemoria, planoDoCartaoMemoria } from './cartao-memoria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { PORTA_FINANCEIRO, type PortaFinanceiro } from './porta.js';
import { resultadoFin } from './servico.js';

const reais = (v: unknown) =>
  `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hojeIso = () => new Date().toISOString().slice(0, 10);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const MODALIDADES = ['debito', 'credito', 'pre_pago', 'voucher'] as const;
const SITUACOES = ['prevista', 'antecipada', 'recebida', 'conciliada', 'cancelada', 'contestada'];

function inteiro(v: string | undefined, campo: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, `Informe ${campo}.`);
  return n;
}
function data(v: string | undefined, padrao: string): string {
  return v && DATA.test(v) ? v : padrao;
}
function somarDias(d: string, dias: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

@Controller('financeiro/cartao')
export class CartaoController {
  private readonly executor: Executor | null;
  /** Sessão sintética (E2E, sem banco do cliente): só as opções e a prévia respondem; com banco, nunca. */
  private readonly sintetica: boolean;

  constructor(
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
    @Optional() @Inject(PORTA_FINANCEIRO) porta: PortaFinanceiro | null = null,
  ) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
    this.sintetica = !nucleo && porta?.destino === 'memoria';
  }

  private ler<T>(req: RequisicaoAutorizada, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    return this.nucleo
      .lerSomente({ ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) }, (l) =>
        fn(l, est),
      )
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_CARTAO,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES_CARTAO[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(res), r.repetida, res);
  }

  // ── Cadastro ──

  @Get('administradoras')
  @Permissao('financeiro.cadastro.ler')
  administradoras(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => opcoesCartao(l, est));
  }

  @Post('administradoras')
  @HttpCode(200)
  @Permissao('financeiro.cadastro.editar')
  @AuditadoNoHandler('financeiro.gravar_administradora_cartao pelo executor (trilha na mesma transação)')
  gravarAdministradora(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.gravarAdministradoraCartao',
      corpo(esquemaAdministradoraCartao, b),
      (r) => `Administradora ${String(r['nome'])} gravada.`,
    );
  }

  @Get('taxas')
  @Permissao('financeiro.cadastro.ler')
  taxas(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const adm = inteiro(q['administradora'], 'a administradora');
    return this.ler(req, (l, est) => taxasDaAdministradora(l, est, adm, hojeIso()));
  }

  @Post('taxas')
  @HttpCode(200)
  @Permissao('financeiro.cadastro.editar')
  @AuditadoNoHandler('financeiro.gravar_taxa_administradora pelo executor (trilha na mesma transação)')
  gravarTaxa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'financeiro.gravarTaxaAdministradora', corpo(esquemaTaxaCartao, b), (r) =>
      Number(r['encerradas']) > 0
        ? `Taxa gravada. A taxa que valia foi encerrada na véspera e fica no histórico (${String(r['encerradas'])}).`
        : 'Taxa gravada.',
    );
  }

  @Post('taxas/:id/encerrar')
  @HttpCode(200)
  @Permissao('financeiro.cadastro.editar')
  @AuditadoNoHandler('financeiro.encerrar_taxa_administradora pelo executor (trilha na mesma transação)')
  encerrarTaxa(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.encerrarTaxaAdministradora',
      corpo(esquemaEncerrarTaxaCartao, { ...((b ?? {}) as object), taxa: inteiro(id, 'a taxa') }),
      (r) => `Taxa encerrada em ${String(r['vigenciaFim'])}. Ela continua no histórico.`,
    );
  }

  // ── Recebimento ──

  @Get('opcoes')
  @Permissao('faturamento.recibo.emitir')
  opcoes(@Req() req: RequisicaoAutorizada) {
    if (this.sintetica) {
      sessaoDe(req);
      return opcoesCartaoMemoria();
    }
    return this.ler(req, (l, est) => opcoesCartao(l, est, true));
  }

  @Get('previa')
  @Permissao('faturamento.recibo.emitir')
  previa(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const modalidade = MODALIDADES.find((m) => m === q['modalidade']);
    const valor = Number(q['valor']);
    if (!modalidade || !(valor > 0))
      throw new ErroProblema('entrada-invalida', 400, 'Informe a modalidade e o valor.');
    const pedido = {
      administradora: inteiro(q['administradora'], 'a administradora'),
      bandeira: inteiro(q['bandeira'], 'a bandeira'),
      modalidade,
      parcelas: inteiro(q['parcelas'] ?? '1', 'as parcelas'),
      valor,
      dataVenda: data(q['data'], hojeIso()),
    };
    if (this.sintetica) {
      sessaoDe(req);
      try {
        return planoDoCartaoMemoria(pedido);
      } catch (e) {
        throw problemaDoCadastro(e);
      }
    }
    return this.ler(req, (l, est) => planoDoCartao(l, est, pedido));
  }

  @Post('recebimentos')
  @HttpCode(200)
  @Permissao('financeiro.movimento.criar')
  @AuditadoNoHandler('financeiro.registrar_recebimento_cartao pelo executor (trilha na mesma transação)')
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.registrarRecebimentoCartao',
      corpo(esquemaRecebimentoCartao, b),
      (r) =>
        `Venda em cartão registrada: ${reais(r['bruto'])} menos ${reais(r['taxa'])} de taxa = ${reais(r['liquido'])} a receber em ${String(r['parcelas'])} parcela(s), a primeira em ${String(r['primeiroCredito'])}.`,
    );
  }

  @Get('recebiveis')
  @Permissao('financeiro.movimento.ler')
  recebiveis(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    const hoje = hojeIso();
    const filtro = {
      de: data(q['de'], somarDias(hoje, -30)),
      ate: data(q['ate'], somarDias(hoje, 60)),
      situacao: SITUACOES.includes(q['situacao'] ?? '') ? (q['situacao'] as string) : null,
      administradora: q['administradora'] ? inteiro(q['administradora'], 'a administradora') : null,
    };
    return this.ler(req, (l, est) => recebiveisCartao(l, est, filtro));
  }

  @Post('recebiveis/baixa')
  @HttpCode(200)
  @Permissao('financeiro.conciliacao.conciliar')
  @AuditadoNoHandler('financeiro.baixar_recebiveis_cartao pelo executor (trilha na mesma transação)')
  baixar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.baixarRecebiveisCartao',
      corpo(esquemaBaixarRecebiveisCartao, b),
      (r) =>
        `Crédito de ${reais(r['creditado'])} lançado na conta e ${String(r['parcelas'])} parcela(s) baixada(s)` +
        (Number(r['diferenca']) !== 0
          ? `; diferença de ${reais(r['diferenca'])} para o previsto, registrada na primeira parcela.`
          : '.'),
    );
  }
}
