// F8, 07-FIN linha 65: rotas do fluxo de aprovação configurável (título a pagar, pedido de compra e contrato).
//   GET  /api/financeiro/fluxo-aprovacao/configuracao              fluxos com etapas e aprovadores, agrupadores, respostas
//   POST /api/financeiro/fluxo-aprovacao/fluxos                    criar fluxo inteiro (etapas e aprovadores)
//   POST /api/financeiro/fluxo-aprovacao/fluxos/encerrar           { fluxo }
//   POST /api/financeiro/fluxo-aprovacao/agrupadores               agrupador com os membros
//   POST /api/financeiro/fluxo-aprovacao/respostas                 resposta padrão
//   POST /api/financeiro/fluxo-aprovacao/submeter                  { tipo, documento }
//   GET  /api/financeiro/fluxo-aprovacao/pendencias                a fila do aprovador (também a tela do celular)
//   POST /api/financeiro/fluxo-aprovacao/decidir                   { pedido, resposta, justificativa, canal }
//   GET  /api/financeiro/fluxo-aprovacao/pedidos/:id               histórico das decisões do pedido
// Permissões próprias (recurso novo, concedidas ao administrador do sistema e dadas pelo cargo):
// financeiro.fluxoAprovacao.configurar, .submeter e .decidir. Quem decide é conferido no domínio contra o aprovador da
// etapa (nominal, substituto ou papel), além da permissão.
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao, PermissaoOu } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  configuracaoAprovacao,
  historicoDoPedido,
  OPERACOES_FLUXO_APROVACAO,
  pendenciasDoAprovador,
} from './fluxo-aprovacao-propria.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import { resultadoFin } from './servico.js';

const PERM = {
  configurar: 'financeiro.fluxoAprovacao.configurar',
  submeter: 'financeiro.fluxoAprovacao.submeter',
  decidir: 'financeiro.fluxoAprovacao.decidir',
} as const;
const SITUACAO: Record<string, string> = {
  em_aprovacao: 'segue para a próxima aprovação',
  aprovado: 'aprovado',
  reprovado: 'reprovado',
  devolvido: 'devolvido para ajuste',
};

@Controller('financeiro/fluxo-aprovacao')
export class FluxoAprovacaoController {
  private readonly executor: Executor | null;

  constructor(
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  private ler<T>(
    req: RequisicaoAutorizada,
    fn: (l: Leitor, est: number, usuario: number) => Promise<T>,
  ): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    const usuario = s.porta.usuario;
    if (usuario === null) throw new ErroProblema('nao-autenticado', 401, 'Sessão necessária');
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) },
      (l) => fn(l, est, usuario),
    );
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_FLUXO_APROVACAO,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const nome = OPERACOES_FLUXO_APROVACAO[op].nome;
    const r = await this.executor
      .executar(OPERACOES_FLUXO_APROVACAO[op] as never, s.porta.cliente, entrada, contextoOperacao(s, nome))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return resultadoFin(mensagem(res), r.repetida, res);
  }

  @Get('configuracao')
  @Permissao(PERM.configurar)
  @PermissaoOu(PERM.submeter)
  configuracao(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => configuracaoAprovacao(l, est));
  }

  @Post('fluxos')
  @HttpCode(200)
  @Permissao(PERM.configurar)
  @AuditadoNoHandler('fluxo de aprovação criado pelo executor, com a trilha na mesma transação')
  criarFluxo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'criarFluxo',
      b,
      (r) => `Fluxo ${String(r['codigo'])} criado com ${String(r['etapas'])} etapa(s).`,
    );
  }

  @Post('fluxos/encerrar')
  @HttpCode(200)
  @Permissao(PERM.configurar)
  @AuditadoNoHandler('encerramento do fluxo de aprovação pelo executor, com a trilha na mesma transação')
  encerrarFluxo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'encerrarFluxo',
      b,
      () => 'Fluxo encerrado. Os pedidos em andamento seguem nele até o fim.',
    );
  }

  @Post('agrupadores')
  @HttpCode(200)
  @Permissao(PERM.configurar)
  @AuditadoNoHandler('agrupador de aprovação gravado pelo executor, com a trilha na mesma transação')
  salvarAgrupador(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'salvarAgrupador',
      b,
      (r) => `Agrupador gravado com ${String(r['membros'])} valor(es).`,
    );
  }

  @Post('respostas')
  @HttpCode(200)
  @Permissao(PERM.configurar)
  @AuditadoNoHandler('resposta padrão de aprovação gravada pelo executor, com a trilha na mesma transação')
  salvarResposta(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'salvarResposta', b, () => 'Resposta padrão gravada.');
  }

  @Post('submeter')
  @HttpCode(200)
  @Permissao(PERM.submeter)
  @AuditadoNoHandler('documento enviado ao fluxo de aprovação pelo executor, com a trilha na mesma transação')
  submeter(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'submeter',
      b,
      (r) =>
        `Enviado para aprovação: ${String(r['etapas'])} etapa(s), começando por "${String(r['etapa'])}".`,
    );
  }

  @Get('pendencias')
  @Permissao(PERM.decidir)
  pendencias(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est, usuario) => pendenciasDoAprovador(l, est, usuario));
  }

  @Post('decidir')
  @HttpCode(200)
  @Permissao(PERM.decidir)
  @AuditadoNoHandler('decisão de aprovação gravada pelo executor, com a trilha na mesma transação')
  decidir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(req, 'decidir', b, (r) => {
      const s = String(r['situacao']);
      return s === 'em_aprovacao' && Number(r['faltam']) > 0
        ? `Decisão registrada; faltam ${String(r['faltam'])} aprovação(ões) nesta etapa.`
        : `Decisão registrada: ${SITUACAO[s] ?? s}.`;
    });
  }

  @Get('pedidos/:id')
  @Permissao(PERM.decidir)
  @PermissaoOu(PERM.submeter)
  async pedido(@Param('id', ParseIntPipe) id: number, @Req() req: RequisicaoAutorizada) {
    const h = await this.ler(req, (l, est) => historicoDoPedido(l, est, id));
    if (!h) throw new ErroProblema('nao-encontrado', 404, 'Pedido de aprovação não encontrado');
    return h;
  }
}
