// Fechamento do período da folha, parte F6 (M53.7; ficha do M53, seção 7; `Gestão de pessoas > Folha de pagamento`):
//   GET  /api/pessoas/folha/fechamentos?empresa&apuracao&ano   fechamentos (processamentos fixados, totais)
//   GET  /api/pessoas/folha/fechamentos/:id                   um fechamento
//   POST /api/pessoas/folha/fechamentos                       prévia (`simular`) ou fechamento do período
//   POST /api/pessoas/folha/fechamentos/:id/reabertura        reabre o período, com motivo
// Fechar e reabrir pedem `pessoas.folha.fechar`; toda gravação leva a Idempotency-Key (guarda) e a trilha; o
// estabelecimento vem da sessão. Nenhum CPF nem nome.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  esquemaFecharFolha,
  esquemaFiltroFechamentosFolha,
  esquemaReabrirFolha,
  type FechamentoFolha,
  type ListaFechamentosFolha,
  type ResultadoFechamentoFolha,
} from '@sgh/contratos';
import { AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { idDaRota, sessaoDe } from '../../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../../config/public-api.js';
import { corpo } from '../../exames/public-api.js';
import { PORTA_ESOCIAL, type PortaEsocial } from '../esocial/porta-esocial.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from './porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from './porta-folha.js';
import { PERMISSOES_FECHAMENTO_FOLHA as P, ServicoFechamentoFolha } from './servico-fechamento.js';

const NA_TABELA = 'SGH_PES_FOLHA_FECHAMENTO com a SGH_TRILHA na mesma transação';

@Controller('pessoas/folha/fechamentos')
export class FechamentoFolhaController {
  readonly servico: ServicoFechamentoFolha;

  constructor(
    @Inject(PORTA_CALCULO_FOLHA) porta: PortaCalculoFolha,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(PORTA_ESOCIAL) esocial: PortaEsocial | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoFechamentoFolha(porta, folha, esocial, trilha, configuracao, cache);
  }

  @Get()
  @Permissao(P.ler)
  listar(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaFechamentosFolha> {
    return this.servico.listar(sessaoDe(req), corpo(esquemaFiltroFechamentosFolha, q));
  }

  @Get(':id')
  @Permissao(P.ler)
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<FechamentoFolha> {
    return this.servico.detalhe(sessaoDe(req), idDaRota(id));
  }

  @Post()
  @HttpCode(200)
  @Permissao(P.fechar)
  @AuditadoNoHandler(NA_TABELA)
  fechar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFechamentoFolha> {
    return this.servico.fechar(sessaoDe(req), corpo(esquemaFecharFolha, b));
  }

  @Post(':id/reabertura')
  @HttpCode(200)
  @Permissao(P.fechar)
  @AuditadoNoHandler(NA_TABELA)
  reabrir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FechamentoFolha> {
    return this.servico.reabrir(sessaoDe(req), idDaRota(id), corpo(esquemaReabrirFolha, b));
  }
}
