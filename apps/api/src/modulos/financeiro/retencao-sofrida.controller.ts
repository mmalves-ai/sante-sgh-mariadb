// F3.8, 07-FIN linha 109: a retenção SOFRIDA no recebimento (o tributo que o tomador reteve ao pagar a fatura do
// hospital) e o saldo a compensar:
//   GET  /api/financeiro/retencao-sofrida/titulo/:id?data=AAAA-MM-DD   retido, saldo da parcela e sugestão da regra
//   POST /api/financeiro/retencao-sofrida/registrar   { titulo, versao?, data, itens[{ tributo, base, aliquota, valor }] }
//   POST /api/financeiro/retencao-sofrida/estornar    { titulo, retencao, motivo }
//   GET  /api/financeiro/retencao-sofrida/municipios?termo=        município do serviço, para a regra do ISS
//   GET  /api/financeiro/retencao-sofrida/saldo       o saldo a compensar por tributo
//   POST /api/financeiro/retencao-sofrida/compensar   { competencia: AAAA-MM, tributo }
// A gravação vai pelo executor do núcleo (trilha, outbox e idempotência na mesma transação); sem núcleo: 503.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import type { ResultadoFinanceiro } from '@sgh/contratos';
import type { Executor, Leitor, NucleoProprio } from '@sgh/nucleo';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { contextoOperacao, problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { NUCLEO_PERIODO_FINANCEIRO } from './periodo.controller.js';
import {
  buscarMunicipiosRetencao,
  esquemaCompensacaoSofrida,
  esquemaRetencaoSofrida,
  OPERACOES_RETENCAO_SOFRIDA,
  retencaoSofridaDoTitulo,
  saldoRetencaoSofrida,
} from './retencao-sofrida-propria.js';
import { resultadoFin } from './servico.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const id = z.number().int().positive();
const esquemaRegistrar = z
  .object({
    titulo: id,
    versao: z.string().max(20).nullable().optional(),
    data: z.string().regex(DATA),
    itens: z
      .array(
        z
          .object({
            tributo: id,
            base: z.number().min(0),
            aliquota: z.number().min(0).max(100),
            valor: z.number().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
const esquemaEstornar = z.object({ titulo: id, retencao: id, motivo: z.string().trim().max(300) }).strict();

@Controller('financeiro/retencao-sofrida')
export class RetencaoSofridaController {
  private readonly executor: Executor | null;

  constructor(
    @Optional() @Inject(NUCLEO_PERIODO_FINANCEIRO) private readonly nucleo: NucleoProprio | null = null,
  ) {
    this.executor = nucleo ? nucleo.criarExecutor() : null;
  }

  private ler<T>(req: RequisicaoAutorizada, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const s = sessaoDe(req);
    const est = s.porta.estabelecimento;
    if (!this.nucleo) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    if (est === null) throw new ErroProblema('entrada-invalida', 409, 'Escolha o estabelecimento da sessão');
    return this.nucleo.lerSomente(
      { ...s.porta, correlacao: (s.porta.correlacao || 'financeiro').slice(0, 64) },
      (l) => fn(l, est),
    );
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: keyof typeof OPERACOES_RETENCAO_SOFRIDA,
    entrada: unknown,
    mensagem: string,
  ): Promise<ResultadoFinanceiro> {
    if (!this.executor) throw new ErroProblema('indisponivel', 503, 'Banco do cliente indisponível');
    const s = sessaoDe(req);
    const r = await this.executor
      .executar(OPERACOES_RETENCAO_SOFRIDA[op] as never, s.porta.cliente, entrada, contextoOperacao(s, op))
      .catch((e: unknown) => {
        throw problemaDoCadastro(e);
      });
    return resultadoFin(mensagem, r.repetida, r.resultado as Record<string, unknown>);
  }

  @Get('titulo/:id')
  @Permissao('financeiro.tituloReceber.ler')
  async doTitulo(
    @Param('id') idTitulo: string,
    @Query('data') data: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const titulo = Number(idTitulo);
    if (!Number.isInteger(titulo) || titulo <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Título inválido', 'Informe o número do título.');
    const dia = data && DATA.test(data) ? data : new Date().toISOString().slice(0, 10);
    const r = await this.ler(req, (l, est) => retencaoSofridaDoTitulo(l, est, titulo, dia));
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Título não encontrado');
    return r;
  }

  @Post('registrar')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixarManual')
  @AuditadoNoHandler('financeiro.manterRetencaoSofrida pelo executor (trilha na mesma transação)')
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.manterRetencaoSofrida',
      corpo(esquemaRetencaoSofrida, { acao: 'registrar', ...corpo(esquemaRegistrar, b) }),
      'Retenção do tomador registrada; o saldo da parcela foi abatido e o crédito fica a compensar.',
    );
  }

  @Post('estornar')
  @HttpCode(200)
  @Permissao('financeiro.tituloReceber.baixarManual')
  @AuditadoNoHandler('financeiro.manterRetencaoSofrida pelo executor (trilha na mesma transação)')
  estornar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.manterRetencaoSofrida',
      corpo(esquemaRetencaoSofrida, { acao: 'estornar', ...corpo(esquemaEstornar, b) }),
      'Retenção estornada; o valor voltou ao saldo da parcela.',
    );
  }

  @Get('municipios')
  @Permissao('financeiro.parametro.ler')
  municipios(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l) => buscarMunicipiosRetencao(l, String(termo ?? '')));
  }

  @Get('saldo')
  @Permissao('financeiro.reinf.ler')
  saldo(@Req() req: RequisicaoAutorizada) {
    return this.ler(req, (l, est) => saldoRetencaoSofrida(l, est));
  }

  @Post('compensar')
  @HttpCode(200)
  @Permissao('financeiro.reinf.gerar')
  @AuditadoNoHandler('financeiro.compensarRetencaoSofrida pelo executor (trilha na mesma transação)')
  compensar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFinanceiro> {
    return this.gravar(
      req,
      'financeiro.compensarRetencaoSofrida',
      corpo(esquemaCompensacaoSofrida, b),
      'Compensação registrada; o crédito usado saiu do saldo a compensar.',
    );
  }
}
