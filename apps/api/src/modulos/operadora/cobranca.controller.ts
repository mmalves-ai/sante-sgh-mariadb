// Rotas da cobrança e das mensalidades da operadora própria (M56, etapa 3, F2; ficha, seções 4, 6, 7 e 8):
//   GET  /api/operadora/cobranca/tela                      liberação, ações, operadoras, hoje, parâmetros e a situação
//                                                          das mensagens ao beneficiário (vale também desligada)
//   GET  /api/operadora/cobrancas?…                        cobranças (competência, situação, tipo, contrato, vencidas,
//                                                          número do contrato; da mais nova à mais antiga) e as
//                                                          contagens; documento do pagador mascarado (leitura auditada)
//   GET  /api/operadora/cobrancas/:id                      a ficha com os itens e as renegociadas (leitura auditada)
//   POST /api/operadora/cobrancas/mensalidades/previa      prévia das mensalidades da competência (nada é gravado)
//   POST /api/operadora/cobrancas/mensalidades             operadora.gerarMensalidades
//   POST /api/operadora/cobrancas/coparticipacao           operadora.lancarCoparticipacao
//   POST /api/operadora/cobrancas/avulsa                   operadora.lancarCobrancaAvulsa
//   POST /api/operadora/cobrancas/:id/baixa                operadora.baixarCobranca
//   POST /api/operadora/cobrancas/:id/cancelamento         operadora.cancelarCobranca
//   POST /api/operadora/cobrancas/:id/estorno              operadora.estornarBaixaCobranca
//   POST /api/operadora/cobrancas/acordo/previa            prévia do acordo (nada é gravado)
//   POST /api/operadora/cobrancas/acordo                   operadora.fazerAcordo
//   GET  /api/operadora/cobranca/inadimplencia             contratos com cobrança vencida e a situação (auditada)
//   POST /api/operadora/cobranca/inadimplencia/notificacao operadora.notificarInadimplencia
//   GET  /api/operadora/reajustes?operadora&contrato&apos   reajustes
//   POST /api/operadora/reajustes                          operadora.reajustarContrato
//   POST /api/operadora/reajustes/:id/cancelamento         operadora.cancelarReajuste
// Tudo exige a chave `operadora.cobranca`, que só vale com a do módulo (regra 1), menos a tela. Cada gravação vai numa
// transação só SGH_ com a SGH_TRILHA junto; nenhuma tabela do sistema anterior é escrita.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CobrancaDetalhe,
  type Cobrancas,
  esquemaAcordo,
  esquemaBaixarCobranca,
  esquemaCancelarReajuste,
  esquemaFiltroCobrancas,
  esquemaFiltroInadimplencia,
  esquemaFiltroReajustes,
  esquemaGerarMensalidades,
  esquemaLancarAvulsa,
  esquemaLancarCoparticipacao,
  esquemaMotivoCobranca,
  esquemaNotificacao,
  esquemaReajuste,
  EVENTOS_AUDITAVEIS,
  type InadimplenciaOperadora,
  type PreviaAcordo,
  type PreviaMensalidades,
  type ReajustesOperadora,
  type ResultadoAcordo,
  type ResultadoCobranca,
  type ResultadoGeracao,
  ROTAS_OPERADORA_F2 as R,
  type TelaCobranca,
} from '@sgh/contratos';
import type { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ServicoSituacaoOperadora } from './aplicacao/situacao.js';
import { PORTA_COBRANCA_OPERADORA, type PortaCobrancaOperadora } from './cobranca-porta.js';
import { ServicoCobrancaOperadora } from './cobranca-servico.js';

const E = EVENTOS_AUDITAVEIS;

function filtro<T extends z.ZodType>(esquema: T, q: unknown): z.infer<T> {
  const r = esquema.safeParse(q ?? {});
  if (!r.success)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Parâmetros inválidos',
      r.error.issues[0]?.message ?? 'Filtro inválido.',
    );
  return r.data;
}

@Controller()
export class CobrancaOperadoraController {
  readonly servico: ServicoCobrancaOperadora;

  constructor(
    @Inject(PORTA_COBRANCA_OPERADORA) porta: PortaCobrancaOperadora,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(CONFIGURACAO) cfg: Configuracao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoCobrancaOperadora(
      porta,
      new ServicoSituacaoOperadora(fonte, cache),
      trilha,
      cfg?.ambiente ?? 'dev',
    );
  }

  @Get(R.tela.caminho)
  @Permissao(R.tela.permissao)
  tela(@Req() req: RequisicaoAutorizada): Promise<TelaCobranca> {
    return this.servico.tela(sessaoDe(req));
  }

  @Get(R.cobrancas.caminho)
  @Permissao(R.cobrancas.permissao)
  @Auditar(E.operadoraCobrancaLida.codigo)
  cobrancas(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Cobrancas> {
    return this.servico.cobrancas(sessaoDe(req), filtro(esquemaFiltroCobrancas, q));
  }

  @Get(R.cobranca.caminho)
  @Permissao(R.cobranca.permissao)
  @Auditar(E.operadoraCobrancaLida.codigo)
  cobranca(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<CobrancaDetalhe> {
    const n = idDaRota(id);
    return this.servico.detalhe(sessaoDe(req), n);
  }

  @Post(R.previaMensalidades.caminho)
  @HttpCode(200)
  @Permissao(R.previaMensalidades.permissao)
  @AuditadoNoHandler('prévia das mensalidades: só leitura, nada é gravado')
  previaMensalidades(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaMensalidades> {
    return this.servico.mensalidades(
      sessaoDe(req),
      corpo(esquemaGerarMensalidades, b),
      false,
    ) as Promise<PreviaMensalidades>;
  }

  @Post(R.gerarMensalidades.caminho)
  @HttpCode(201)
  @Permissao(R.gerarMensalidades.permissao)
  @AuditadoNoHandler('operadora.cobranca.gerada (SGH_OPE_COBRANCA e itens) com a SGH_TRILHA em cada página')
  gerarMensalidades(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoGeracao> {
    return this.servico.mensalidades(
      sessaoDe(req),
      corpo(esquemaGerarMensalidades, b),
      true,
    ) as Promise<ResultadoGeracao>;
  }

  @Post(R.coparticipacao.caminho)
  @HttpCode(201)
  @Permissao(R.coparticipacao.permissao)
  @AuditadoNoHandler('operadora.cobranca.gerada (coparticipação) com a SGH_TRILHA na mesma transação')
  coparticipacao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCobranca> {
    return this.servico.coparticipacao(sessaoDe(req), corpo(esquemaLancarCoparticipacao, b));
  }

  @Post(R.avulsa.caminho)
  @HttpCode(201)
  @Permissao(R.avulsa.permissao)
  @AuditadoNoHandler('operadora.cobranca.gerada (cobrança avulsa) com a SGH_TRILHA na mesma transação')
  avulsa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCobranca> {
    return this.servico.avulsa(sessaoDe(req), corpo(esquemaLancarAvulsa, b));
  }

  @Post(R.previaAcordo.caminho)
  @HttpCode(200)
  @Permissao(R.previaAcordo.permissao)
  @AuditadoNoHandler('prévia do acordo: só leitura, nada é gravado')
  previaAcordo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<PreviaAcordo> {
    return this.servico.previaAcordo(sessaoDe(req), corpo(esquemaAcordo, b));
  }

  @Post(R.acordo.caminho)
  @HttpCode(201)
  @Permissao(R.acordo.permissao)
  @AuditadoNoHandler(
    'operadora.cobranca.acordo (renegociadas e parcelas) com a SGH_TRILHA na mesma transação',
  )
  acordo(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoAcordo> {
    return this.servico.acordo(sessaoDe(req), corpo(esquemaAcordo, b));
  }

  @Post(R.baixar.caminho)
  @Permissao(R.baixar.permissao)
  @AuditadoNoHandler('operadora.cobranca.baixada com a SGH_TRILHA na mesma transação')
  @HttpCode(200)
  baixar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCobranca> {
    const n = idDaRota(id);
    return this.servico.baixar(sessaoDe(req), n, corpo(esquemaBaixarCobranca, b));
  }

  @Post(R.cancelar.caminho)
  @Permissao(R.cancelar.permissao)
  @AuditadoNoHandler('operadora.cobranca.cancelada com a SGH_TRILHA na mesma transação')
  @HttpCode(200)
  cancelar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCobranca> {
    const n = idDaRota(id);
    return this.servico.cancelar(sessaoDe(req), n, corpo(esquemaMotivoCobranca, b));
  }

  @Post(R.estornar.caminho)
  @Permissao(R.estornar.permissao)
  @AuditadoNoHandler('operadora.cobranca.estornada com a SGH_TRILHA na mesma transação')
  @HttpCode(200)
  estornar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCobranca> {
    const n = idDaRota(id);
    return this.servico.estornar(sessaoDe(req), n, corpo(esquemaMotivoCobranca, b));
  }

  @Get(R.inadimplencia.caminho)
  @Permissao(R.inadimplencia.permissao)
  @Auditar(E.operadoraCobrancaLida.codigo)
  inadimplencia(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<InadimplenciaOperadora> {
    return this.servico.inadimplencia(sessaoDe(req), filtro(esquemaFiltroInadimplencia, q));
  }

  @Post(R.notificar.caminho)
  @HttpCode(201)
  @Permissao(R.notificar.permissao)
  @AuditadoNoHandler('operadora.cobranca.notificada com a SGH_TRILHA na mesma transação')
  notificar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCobranca> {
    return this.servico.notificar(sessaoDe(req), corpo(esquemaNotificacao, b));
  }

  @Get(R.reajustes.caminho)
  @Permissao(R.reajustes.permissao)
  reajustes(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ReajustesOperadora> {
    return this.servico.reajustes(sessaoDe(req), filtro(esquemaFiltroReajustes, q));
  }

  @Post(R.reajustar.caminho)
  @HttpCode(201)
  @Permissao(R.reajustar.permissao)
  @AuditadoNoHandler('operadora.reajuste.registrado com a SGH_TRILHA na mesma transação')
  reajustar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCobranca> {
    return this.servico.reajustar(sessaoDe(req), corpo(esquemaReajuste, b));
  }

  @Post(R.cancelarReajuste.caminho)
  @Permissao(R.cancelarReajuste.permissao)
  @AuditadoNoHandler('operadora.reajuste.cancelado com a SGH_TRILHA na mesma transação')
  @HttpCode(200)
  cancelarReajuste(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCobranca> {
    const n = idDaRota(id);
    return this.servico.cancelarReajuste(sessaoDe(req), n, corpo(esquemaCancelarReajuste, b).motivo);
  }
}
