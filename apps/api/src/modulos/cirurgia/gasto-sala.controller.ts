// Gasto de sala do ato cirúrgico (F3.4, 04-CC linha 100). Rotas (porta própria; sem banco do cliente, 503):
//   GET  /api/cirurgia/gasto-sala/lista?procedimento=          lista padrão de material (com as linhas fora de uso)
//   POST /api/cirurgia/gasto-sala/lista                        inclui a linha (produto ou kit)
//   POST /api/cirurgia/gasto-sala/lista/:id                    { versao, ativo?, quantidade?, obrigatorio? } (nada apagado)
//   GET  /api/cirurgia/gasto-sala/atos/:ato?cirurgiao=         gasto, sugestão, diferença e pendências (cirurgião da
//                                                              equipe; com gasto, vale o cirurgião gravado nele)
//   POST /api/cirurgia/gasto-sala/atos/:ato                    grava o gasto aberto (itens e justificativas)
//   POST /api/cirurgia/gasto-sala/atos/:ato/conferir           { versao } conferência antes do débito
//   POST /api/cirurgia/gasto-sala/atos/:ato/reabrir            { versao, motivo }
//   POST /api/cirurgia/gasto-sala/atos/:ato/cancelar           { versao, motivo } (o conferido: só quem confere)
//   POST /api/cirurgia/gasto-sala/atos/:ato/debitar            { versao } saída do estoque e item na conta
// Os níveis de acesso separam quem mantém a lista padrão (cadastro do bloco cirúrgico, o mesmo das salas), quem lança
// (registro da cirurgia), quem confere (conferência de itens da conta; só ele cancela o gasto já conferido) e quem
// debita (lançamento de item na conta); nada depende de chave de liberação.
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
  Query,
  Req,
} from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_GASTO_SALA, type PortaGastoSalaPropria } from './gasto-sala-propria.js';

export const PERMISSOES_GASTO_SALA = {
  ler: 'cirurgia.registro.ler',
  /** Manter a lista padrão (incluir, alterar, obrigatoriedade, tirar de uso): cadastro do bloco cirúrgico. */
  manterLista: 'cirurgia.sala.editar',
  lancar: 'cirurgia.registro.criar',
  conferir: 'faturamento.item.conferir',
  debitar: 'faturamento.item.lancar',
} as const;

const idOuNulo = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErroProblema('entrada-invalida', 400, 'Parâmetro inválido');
  return n;
};

@Controller('cirurgia/gasto-sala')
export class GastoSalaController {
  constructor(
    @Optional()
    @Inject(PORTA_GASTO_SALA)
    private readonly porta: PortaGastoSalaPropria | null = null,
  ) {}

  private async com<T>(
    req: RequisicaoAutorizada,
    fn: (p: PortaGastoSalaPropria, c: ReturnType<typeof sessaoDe>['porta']) => Promise<T>,
  ) {
    if (!this.porta) throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    return fn(this.porta, s.porta).catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('lista')
  @Permissao(PERMISSOES_GASTO_SALA.ler)
  lista(@Req() req: RequisicaoAutorizada, @Query('procedimento') procedimento?: string) {
    return this.com(req, async (p, c) => ({ itens: await p.listarLista(c, idOuNulo(procedimento)) }));
  }

  @Post('lista')
  @HttpCode(201)
  @Permissao(PERMISSOES_GASTO_SALA.manterLista)
  @AuditadoNoHandler('lista padrão e gasto de sala pelo executor (trilha na mesma transação)')
  incluirLinha(@Req() req: RequisicaoAutorizada, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.incluirLinhaLista(c, corpo));
  }

  @Post('lista/:id')
  @HttpCode(200)
  @Permissao(PERMISSOES_GASTO_SALA.manterLista)
  @AuditadoNoHandler('lista padrão e gasto de sala pelo executor (trilha na mesma transação)')
  alterarLinha(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.alterarLinhaLista(c, id, corpo));
  }

  @Get('atos/:ato')
  @Permissao(PERMISSOES_GASTO_SALA.ler)
  doAto(
    @Req() req: RequisicaoAutorizada,
    @Param('ato', ParseIntPipe) ato: number,
    @Query('cirurgiao') cirurgiao?: string,
  ) {
    return this.com(req, (p, c) => p.lerDoAto(c, ato, idOuNulo(cirurgiao)));
  }

  @Post('atos/:ato')
  @HttpCode(200)
  @Permissao(PERMISSOES_GASTO_SALA.lancar)
  @AuditadoNoHandler('lista padrão e gasto de sala pelo executor (trilha na mesma transação)')
  gravar(@Req() req: RequisicaoAutorizada, @Param('ato', ParseIntPipe) ato: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.gravarDoAto(c, ato, corpo));
  }

  @Post('atos/:ato/conferir')
  @HttpCode(200)
  @Permissao(PERMISSOES_GASTO_SALA.conferir)
  @AuditadoNoHandler('lista padrão e gasto de sala pelo executor (trilha na mesma transação)')
  conferir(
    @Req() req: RequisicaoAutorizada,
    @Param('ato', ParseIntPipe) ato: number,
    @Body() corpo: unknown,
  ) {
    return this.com(req, (p, c) => p.conferir(c, ato, corpo));
  }

  @Post('atos/:ato/reabrir')
  @HttpCode(200)
  @Permissao(PERMISSOES_GASTO_SALA.conferir)
  @AuditadoNoHandler('lista padrão e gasto de sala pelo executor (trilha na mesma transação)')
  reabrir(@Req() req: RequisicaoAutorizada, @Param('ato', ParseIntPipe) ato: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.mudarComMotivo(c, ato, 'reabrir', corpo, true));
  }

  @Post('atos/:ato/cancelar')
  @HttpCode(200)
  @Permissao(PERMISSOES_GASTO_SALA.lancar)
  @AuditadoNoHandler('lista padrão e gasto de sala pelo executor (trilha na mesma transação)')
  cancelar(
    @Req() req: RequisicaoAutorizada,
    @Param('ato', ParseIntPipe) ato: number,
    @Body() corpo: unknown,
  ) {
    const podeConferir = sessaoDe(req).pode(PERMISSOES_GASTO_SALA.conferir);
    return this.com(req, (p, c) => p.mudarComMotivo(c, ato, 'cancelar', corpo, podeConferir));
  }

  @Post('atos/:ato/debitar')
  @HttpCode(200)
  @Permissao(PERMISSOES_GASTO_SALA.debitar)
  @AuditadoNoHandler('lista padrão e gasto de sala pelo executor (trilha na mesma transação)')
  debitar(@Req() req: RequisicaoAutorizada, @Param('ato', ParseIntPipe) ato: number, @Body() corpo: unknown) {
    return this.com(req, (p, c) => p.debitar(c, ato, corpo));
  }
}
