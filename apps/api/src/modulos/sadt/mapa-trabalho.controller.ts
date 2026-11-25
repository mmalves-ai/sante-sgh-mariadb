// Retenção do exame na bancada (F3.5, 05-SADT linha 8). A leitura do mapa é GET /api/sadt/mapa-trabalho (SadtController):
//   POST /api/sadt/mapa-trabalho/reter    { exame, motivo }  retém o exame no lote aberto do dia da bancada
//   POST /api/sadt/mapa-trabalho/soltar   { exame }          devolve o exame retido à fila da bancada
// Tudo ligado para todos: quem pode vem só da permissão de digitar o resultado.
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ContextoSadt } from './porta.js';
import { semBancoDoCliente } from './sem-banco-cliente.js';
import { contextoOperacao, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaReterExame,
  esquemaSoltarExame,
  type RetencaoGravada,
  type ServicoMapaTrabalho,
} from './aplicacao/mapa-trabalho-propria.js';

/**
 * O contexto da gravação: o da sessão com a Idempotency-Key do pedido (obrigatória; sem ela, 400). O reenvio pela mesma
 * chave devolve o mesmo resultado sem gravar de novo.
 */
const gravacao = (req: RequisicaoAutorizada): ContextoSadt => {
  const s = sessaoDe(req);
  return { ...s.porta, chaveIdempotencia: contextoOperacao(s, 'sadt.mapa').chaveIdempotencia };
};

export const SERVICO_MAPA_TRABALHO = Symbol('SERVICO_MAPA_TRABALHO');

@Controller('sadt/mapa-trabalho')
export class MapaTrabalhoController {
  constructor(@Inject(SERVICO_MAPA_TRABALHO) private readonly servico: ServicoMapaTrabalho | null) {}

  private get s(): ServicoMapaTrabalho {
    if (!this.servico) throw semBancoDoCliente('A retenção na bancada precisa do banco do cliente.');
    return this.servico;
  }

  @Post('reter')
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler('o item do lote retido com a trilha_auditoria na mesma transação')
  reter(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<RetencaoGravada> {
    return this.s.reter(gravacao(req), corpo(esquemaReterExame, b));
  }

  @Post('soltar')
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler('o item do lote devolvido à fila com a trilha_auditoria na mesma transação')
  soltar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<RetencaoGravada> {
    return this.s.soltar(gravacao(req), corpo(esquemaSoltarExame, b));
  }
}
