// F7, 07-FIN linha 115 (C3-023): rotas do LALUR/LACS e da apuração e provisão do IRPJ e da CSLL do lucro real.
//   GET  /api/contabil/lalur/apoio?estabelecimento=          estabelecimentos, configuração, contas da parte B e apurações
//   GET  /api/contabil/lalur/apuracoes/:id                   ajustes, parte B, memória do cálculo e bloco M da ECF
//   GET  /api/contabil/lalur/apuracoes/:id/ecf               o bloco M da ECF em texto (e-LALUR e e-LACS)
//   POST /api/contabil/lalur/configuracao                    contas e alíquotas da provisão
//   POST /api/contabil/lalur/contas-parte-b                  conta da parte B com o saldo de abertura
//   POST /api/contabil/lalur/apuracoes                       { estabelecimento, forma, inicio, fim } abre o período
//   POST /api/contabil/lalur/apuracoes/:id/ajustes           adição ou exclusão da parte A (com a parte B, se houver)
//   POST /api/contabil/lalur/apuracoes/:id/ajustes/:a/excluir
//   POST /api/contabil/lalur/apuracoes/:id/apurar            cálculo com a compensação de 30%
//   POST /api/contabil/lalur/apuracoes/:id/provisionar       lançamento contábil da provisão
//   POST /api/contabil/lalur/apuracoes/:id/fechar            prejuízo e base negativa do período na parte B
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { NUCLEO_CONSOLIDACAO } from './consolidacao.controller.js';
import { apoioLalur, detalheApuracaoLalur, OPERACOES_LALUR } from './lalur-propria.js';

const positivo = (v: unknown, campo: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, `${campo} inválido`);
  return n;
};
const corpo = (b: unknown): Record<string, unknown> =>
  b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

@Controller('contabil/lalur')
export class LalurController {
  private readonly executor: Executor | null;

  constructor(@Optional() @Inject(NUCLEO_CONSOLIDACAO) private readonly nucleo: NucleoProprio | null = null) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  private ler<T>(req: RequisicaoAutorizada, fn: (l: Leitor) => Promise<T>): Promise<T> {
    const s = sessaoDe(req);
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    return this.nucleo
      .lerSomente({ ...s.porta, correlacao: (s.porta.correlacao || 'contabil').slice(0, 64) }, fn)
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_LALUR,
    entrada: unknown,
    mensagem: (r: Record<string, unknown>) => string,
  ) {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES_LALUR[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    const res = r.resultado as Record<string, unknown>;
    return { mensagem: mensagem(res), repetida: r.repetida, resultado: res };
  }

  private async detalhe(req: RequisicaoAutorizada, id: string) {
    const d = await this.ler(req, (l) => detalheApuracaoLalur(l, positivo(id, 'Apuração')));
    if (!d) throw new ErroProblema('nao-encontrado', 404, 'Apuração não encontrada');
    return d;
  }

  @Get('apoio')
  @Permissao('contabil.lalur.ler')
  apoio(@Query('estabelecimento') est: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l) => apoioLalur(l, est ? positivo(est, 'Estabelecimento') : null));
  }

  @Get('apuracoes/:id')
  @Permissao('contabil.lalur.ler')
  apuracao(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.detalhe(req, id);
  }

  @Get('apuracoes/:id/ecf')
  @Permissao('contabil.lalur.ler')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async ecf(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    const d = await this.detalhe(req, id);
    return `${d.ecf.linhas.join('\r\n')}\r\n`;
  }

  @Post('configuracao')
  @HttpCode(200)
  @Permissao('contabil.lalur.editar')
  @AuditadoNoHandler('contabil.lalur_configuracao_salvar pelo executor (trilha na mesma transação)')
  configuracao(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(req, 'salvarConfiguracao', b, () => 'Contas e alíquotas da provisão salvas.');
  }

  @Post('contas-parte-b')
  @HttpCode(200)
  @Permissao('contabil.lalur.editar')
  @AuditadoNoHandler('contabil.lalur_conta_parte_b_incluir pelo executor (trilha na mesma transação)')
  contaParteB(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(req, 'incluirContaParteB', b, () => 'Conta da parte B incluída.');
  }

  @Post('apuracoes')
  @HttpCode(200)
  @Permissao('contabil.lalur.editar')
  @AuditadoNoHandler('contabil.lalur_apuracao_abrir pelo executor (trilha na mesma transação)')
  abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(req, 'abrirApuracao', b, () => 'Apuração do período aberta.');
  }

  @Post('apuracoes/:id/ajustes')
  @HttpCode(200)
  @Permissao('contabil.lalur.editar')
  @AuditadoNoHandler('contabil.lalur_ajuste_incluir pelo executor (trilha na mesma transação)')
  ajuste(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(req, 'incluirAjuste', { ...corpo(b), apuracao: positivo(id, 'Apuração') }, (r) =>
      r['movimento'] ? 'Ajuste incluído, com o lançamento na parte B.' : 'Ajuste incluído na parte A.',
    );
  }

  @Post('apuracoes/:id/ajustes/:ajuste/excluir')
  @HttpCode(200)
  @Permissao('contabil.lalur.editar')
  @AuditadoNoHandler('contabil.lalur_ajuste_excluir pelo executor (trilha na mesma transação)')
  excluirAjuste(
    @Param('id') id: string,
    @Param('ajuste') ajuste: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.gravar(
      req,
      'excluirAjuste',
      { apuracao: positivo(id, 'Apuração'), ajuste: positivo(ajuste, 'Ajuste'), versao: corpo(b)['versao'] },
      () => 'Ajuste excluído.',
    );
  }

  @Post('apuracoes/:id/apurar')
  @HttpCode(200)
  @Permissao('contabil.lalur.apurar')
  @AuditadoNoHandler('contabil.lalur_apurar pelo executor (trilha na mesma transação)')
  apurar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(
      req,
      'apurar',
      { ...corpo(b), apuracao: positivo(id, 'Apuração') },
      (r) =>
        `Apurado: IRPJ a recolher ${reais(Number(r['irpjRecolher']))} e CSLL ${reais(Number(r['csllRecolher']))}.`,
    );
  }

  @Post('apuracoes/:id/provisionar')
  @HttpCode(200)
  @Permissao('contabil.lalur.apurar')
  @AuditadoNoHandler('contabil.lalur_provisionar pelo executor (trilha na mesma transação)')
  provisionar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(
      req,
      'provisionar',
      { apuracao: positivo(id, 'Apuração'), versao: corpo(b)['versao'] },
      (r) =>
        r['lancamento'] ? 'Provisão lançada na contabilidade.' : 'Sem tributo a recolher: nada a lançar.',
    );
  }

  @Post('apuracoes/:id/fechar')
  @HttpCode(200)
  @Permissao('contabil.lalur.apurar')
  @AuditadoNoHandler('contabil.lalur_fechar pelo executor (trilha na mesma transação)')
  fechar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.gravar(
      req,
      'fechar',
      { ...corpo(b), apuracao: positivo(id, 'Apuração') },
      () => 'Apuração fechada; a parte B leva o prejuízo e a base negativa do período.',
    );
  }
}
