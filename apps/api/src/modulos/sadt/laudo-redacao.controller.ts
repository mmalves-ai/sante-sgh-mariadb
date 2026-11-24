// Redação do laudo de imagem e de métodos gráficos e o laudo estruturado (F3.5, 05-SADT linhas 16 e 17):
//   GET  /api/sadt/laudos/redacao/:item              o exame, o laudo, as versões, as medidas e os modelos sugeridos
//   POST /api/sadt/laudos/redacao/:item              salva o rascunho (revisao: true envia para revisão)
//   POST /api/sadt/laudos/redacao/:item/assinar      salva e assina num clique (médico com registro ativo)
//   POST /api/sadt/laudos/redacao/:item/retificar    retifica o laudo assinado com motivo (versão nova)
//   POST /api/sadt/laudos/redacao/:item/previa       o texto do modelo com as medidas (nada gravado)
//   GET  /api/sadt/laudos/motivos-retificacao        motivos ativos
//   POST /api/sadt/laudos/modelos                    inclui ou altera o modelo de laudo
// Tudo ligado para todos: o que cada cargo faz vem só da permissão de cada rota.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import type { ServicoLaudoRedacao } from './aplicacao/laudo-redacao.js';

export const SERVICO_LAUDO_REDACAO = Symbol('SERVICO_LAUDO_REDACAO');

const esquemaPrevia = z.object({
  modelo: z.number().int().positive(),
  pesoKg: z.number().positive().max(500).nullable().default(null),
  alturaCm: z.number().positive().max(260).nullable().default(null),
  valores: z
    .array(
      z.object({
        grandeza: z.number().int().positive(),
        numero: z.number().finite().nullable().default(null),
        texto: z.string().trim().max(500).nullable().default(null),
      }),
    )
    .max(500)
    .default([]),
});

@Controller('sadt/laudos')
export class LaudoRedacaoController {
  constructor(@Inject(SERVICO_LAUDO_REDACAO) private readonly servico: ServicoLaudoRedacao | null) {}

  private get s(): ServicoLaudoRedacao {
    if (!this.servico)
      throw new ErroProblema('indisponivel', 503, 'A redação do laudo precisa do banco do cliente.');
    return this.servico;
  }

  @Get('motivos-retificacao')
  @Permissao('sadt.laudo.ler')
  async motivos(@Req() req: RequisicaoAutorizada) {
    return { itens: await this.s.motivosRetificacao(sessaoDe(req).porta) };
  }

  @Get('redacao/:item')
  @Permissao('sadt.laudo.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  abrir(@Param('item') item: string, @Req() req: RequisicaoAutorizada) {
    return this.s.abrir(sessaoDe(req).porta, idDaRota(item));
  }

  @Post('redacao/:item')
  @HttpCode(200)
  @Permissao('sadt.laudo.criar')
  @AuditadoNoHandler('o laudo e as medidas com a trilha_auditoria na mesma transação')
  salvar(@Param('item') item: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.salvar(sessaoDe(req).porta, idDaRota(item), b);
  }

  @Post('redacao/:item/assinar')
  @HttpCode(200)
  @Permissao('sadt.laudo.assinar')
  @AuditadoNoHandler('o laudo assinado, a versão e as medidas com a trilha_auditoria na mesma transação')
  assinar(@Param('item') item: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.assinar(sessaoDe(req).porta, idDaRota(item), b);
  }

  @Post('redacao/:item/retificar')
  @HttpCode(200)
  @Permissao('sadt.laudo.assinar')
  @AuditadoNoHandler(
    'a retificação com motivo, a versão nova e as medidas com a trilha_auditoria na mesma transação',
  )
  retificar(@Param('item') item: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.retificar(sessaoDe(req).porta, idDaRota(item), b);
  }

  @Post('redacao/:item/previa')
  @HttpCode(200)
  @Permissao('sadt.laudo.ler')
  @Auditar(EVENTOS_AUDITAVEIS.sadtExamesLidos.codigo)
  previa(@Param('item') item: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const p = corpo(esquemaPrevia, b);
    return this.s.previaModelo(sessaoDe(req).porta, idDaRota(item), p.modelo, p);
  }

  @Post('modelos')
  @Permissao('sadt.laudo.criar')
  @AuditadoNoHandler('o modelo de laudo com a trilha_auditoria na mesma transação')
  salvarModelo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.s.salvarModelo(sessaoDe(req).porta, b);
  }
}
