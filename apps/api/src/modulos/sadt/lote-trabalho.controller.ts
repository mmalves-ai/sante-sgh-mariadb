// Lote de trabalho da bancada (F3.5, 05-SADT linha 8):
//   GET  /api/sadt/lotes-trabalho?data            os lotes do dia, os que continuam em andamento e a fila fora de lote
//   POST /api/sadt/lotes-trabalho/abrir     { bancada, analista? }  abre o lote com os exames em análise fora de lote
//   POST /api/sadt/lotes-trabalho/fechar    { lote }                fecha o lote (o pendente volta à fila)
//   POST /api/sadt/lotes-trabalho/imprimir  { lote }                registra a impressão e devolve a folha do lote
// Tudo ligado para todos: quem pode vem só da permissão de digitar o resultado (a mesma da retenção na bancada).
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaAbrirLote,
  esquemaLoteAlvo,
  type FilaForaDeLote,
  type LoteDeTrabalho,
  type ServicoLoteTrabalho,
} from './aplicacao/lote-trabalho-propria.js';

export const SERVICO_LOTE_TRABALHO = Symbol('SERVICO_LOTE_TRABALHO');

@Controller('sadt/lotes-trabalho')
export class LoteTrabalhoController {
  constructor(@Inject(SERVICO_LOTE_TRABALHO) private readonly servico: ServicoLoteTrabalho | null) {}

  private get s(): ServicoLoteTrabalho {
    if (!this.servico) throw semBancoDoCliente('O lote de trabalho precisa do banco do cliente.');
    return this.servico;
  }

  @Get()
  @Permissao('sadt.resultado.digitar')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  async listar(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ lotes: LoteDeTrabalho[]; fila: FilaForaDeLote[] }> {
    const data = /^\d{4}-\d{2}-\d{2}$/.test(q['data'] ?? '')
      ? q['data']!
      : new Date().toISOString().slice(0, 10);
    req.sghAlvo = { tabelaAlvo: 'grupo_trabalho_bancada', idAlvo: `lotes ${data}` };
    const c = sessaoDe(req).porta;
    const [lotes, fila] = await Promise.all([this.s.listar(c, data), this.s.fila(c)]);
    return { lotes, fila };
  }

  @Post('abrir')
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler('o lote e os seus exames gravados com a trilha_auditoria na mesma transação')
  abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<LoteDeTrabalho> {
    return this.s.abrir(sessaoDe(req).porta, corpo(esquemaAbrirLote, b));
  }

  @Post('fechar')
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler('o lote fechado e os exames processados com a trilha_auditoria na mesma transação')
  fechar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<LoteDeTrabalho> {
    return this.s.fechar(sessaoDe(req).porta, corpo(esquemaLoteAlvo, b));
  }

  @Post('imprimir')
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler('a hora da impressão do lote com a trilha_auditoria na mesma transação')
  imprimir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<LoteDeTrabalho> {
    return this.s.imprimir(sessaoDe(req).porta, corpo(esquemaLoteAlvo, b));
  }
}
