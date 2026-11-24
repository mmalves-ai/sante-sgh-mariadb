// Rotas do ciclo do resultado no banco do cliente (F3.5, 05-SADT linha 10): o exame pedido pelo id do exame_item;
// digitar, liberar (o profissional habilitado da sessão assina o ato) e retificar o liberado com motivo. Sem o banco do
// cliente, 503.
import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  esquemaLiberarResultadoBanco,
  esquemaRegistrarResultadoBanco,
  esquemaRetificarResultadoBanco,
  type ResultadoGravado,
  type ServicoResultadoSadt,
} from './aplicacao/resultado-propria.js';

export const SERVICO_RESULTADO_SADT = Symbol('SERVICO_RESULTADO_SADT');

const idExame = z.coerce.number().int().positive();

@Controller('sadt/exames-pedidos/:exame/resultado')
export class ResultadoBancoController {
  constructor(@Inject(SERVICO_RESULTADO_SADT) private readonly servico: ServicoResultadoSadt | null) {}

  private get s(): ServicoResultadoSadt {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'O resultado precisa do banco do cliente.');
    return this.servico;
  }

  @Post()
  @HttpCode(200)
  @Permissao('sadt.resultado.digitar')
  @AuditadoNoHandler(
    'o resultado e os analitos com a faixa congelada e a trilha_auditoria na mesma transação',
  )
  registrar(
    @Param('exame') exame: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravado> {
    return this.s.registrar(
      sessaoDe(req).porta,
      corpo(idExame, exame),
      corpo(esquemaRegistrarResultadoBanco, b),
    );
  }

  @Post('liberar')
  @HttpCode(200)
  @Permissao('sadt.resultado.liberar')
  @AuditadoNoHandler('a liberação com o profissional habilitado e a trilha_auditoria na mesma transação')
  liberar(
    @Param('exame') exame: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravado> {
    return this.s.liberar(
      sessaoDe(req).porta,
      corpo(idExame, exame),
      corpo(esquemaLiberarResultadoBanco, b ?? {}),
    );
  }

  @Post('retificar')
  @HttpCode(200)
  @Permissao('sadt.resultado.retificar')
  @AuditadoNoHandler(
    'a versão anterior em resultado_exame_versao com o motivo e a trilha_auditoria na mesma transação',
  )
  retificar(
    @Param('exame') exame: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoGravado> {
    return this.s.retificar(
      sessaoDe(req).porta,
      corpo(idExame, exame),
      corpo(esquemaRetificarResultadoBanco, b),
    );
  }
}
