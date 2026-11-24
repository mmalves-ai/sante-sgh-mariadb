// Impressora por estação e reimpressão controlada (01-ADM L79). Rotas:
// - POST /api/administracao/impressao/estacoes/vinculos (documento.cadastro.editar): a estação passa a usar a
//   impressora na finalidade (preferência opcional por usuário); o vínculo anterior deixa de ser o padrão;
// - POST /api/documento/reimpressoes (documento.etiqueta.imprimir): registra a reimpressão com motivo, via, destino e
//   a impressora resolvida pela estação. A gravação e a trilha são do Executor (operacoes-impressao-propria.ts).
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { contextoOperacao, problema } from './comum.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';

@Controller()
export class ImpressaoController {
  constructor(@Inject(FONTE_ADMINISTRACAO) private readonly fonte: FonteAdministracao) {}

  @Post('administracao/impressao/estacoes/vinculos')
  @HttpCode(200)
  @Permissao('documento.cadastro.editar')
  @AuditadoNoHandler('executor: a trilha na mesma transação da operação')
  async vincular(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.fonte
      .executar('impressao.vincularEstacao', corpo, contextoOperacao(req, 'impressao-estacao'))
      .catch((x: unknown) => problema(x));
    return { id: r['id'] };
  }

  @Post('documento/reimpressoes')
  @HttpCode(200)
  @Permissao('documento.etiqueta.imprimir')
  @AuditadoNoHandler('executor: a trilha na mesma transação da operação')
  async reimprimir(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const r = await this.fonte
      .executar('impressao.registrarReimpressao', corpo, contextoOperacao(req, 'impressao-reimpressao'))
      .catch((x: unknown) => problema(x));
    return { id: r['id'], via: r['via'], impressora: r['impressora'] ?? null };
  }
}
