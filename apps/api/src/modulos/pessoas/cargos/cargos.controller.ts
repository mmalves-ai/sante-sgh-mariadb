// Tela "Cargos e salários" (W0-06, parte 4; M1 de mercado; `Gestão de pessoas > Cargos e salários`):
//   GET  /api/pessoas/cargos/apoio                centros de custo, conselhos, liberação e o que a sessão pode fazer
//   GET  /api/pessoas/cargos                      lista (vagas aprovadas em vigor, ocupação e faixas em vigor)
//   GET  /api/pessoas/cargos/cbo?termo=           busca no cadastro oficial de ocupações (combo com busca)
//   GET  /api/pessoas/cargos/:cargo               ficha: faixas e vagas (todas as versões) e o histórico
//   POST /api/pessoas/cargos                      inclusão do cargo
//   POST /api/pessoas/cargos/:cargo/alteracao     alteração com motivo (o valor anterior fica no histórico)
//   POST /api/pessoas/cargos/situacao             inativar ou reativar o cargo, a faixa ou a vaga, com motivo
//   POST /api/pessoas/cargos/exclusao             excluir o lançado por engano (com vínculo: 409 e a inativação)
//   POST /api/pessoas/cargos/faixas               inclusão da faixa salarial (faixa e nível)
//   POST /api/pessoas/cargos/faixas/:faixa/versao alteração do valor a partir de uma data (versão nova)
//   POST /api/pessoas/cargos/vagas                inclusão da vaga no quadro aprovado por centro de custo
//   POST /api/pessoas/cargos/vagas/:vaga/versao   alteração da quantidade a partir de uma data (versão nova)
// Toda gravação leva a Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ApoioCargos,
  esquemaAlterarCargo,
  esquemaBuscaCbo,
  esquemaExcluirCargos,
  esquemaIncluirCargo,
  esquemaIncluirFaixaSalarial,
  esquemaIncluirVaga,
  esquemaSituacaoCargos,
  esquemaVersaoFaixaSalarial,
  esquemaVersaoVaga,
  type FichaCargo,
  type ListaCargos,
  type ResultadoCargos,
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
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_CARGOS, type PortaCargos } from './porta-cargos.js';
import { PERMISSOES_CARGOS, ServicoCargos } from './servico-cargos.js';

const P = PERMISSOES_CARGOS;
const NA_TABELA = (t: string) => `${t} com a trilha de auditoria na mesma transação`;

@Controller('pessoas/cargos')
export class CargosController {
  readonly servico: ServicoCargos;

  constructor(
    @Inject(PORTA_CARGOS) porta: PortaCargos,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoCargos(porta, pessoas, trilha, configuracao, cache);
  }

  @Get('apoio')
  @Permissao(P.ler)
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioCargos> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get()
  @Permissao(P.ler)
  lista(@Req() req: RequisicaoAutorizada): Promise<ListaCargos> {
    return this.servico.lista(sessaoDe(req));
  }

  @Get('cbo')
  @Permissao(P.ler)
  cbo(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada) {
    return this.servico.buscarCbo(sessaoDe(req), corpo(esquemaBuscaCbo, q).termo);
  }

  @Get(':cargo')
  @Permissao(P.ler)
  ficha(@Param('cargo') cargo: string, @Req() req: RequisicaoAutorizada): Promise<FichaCargo> {
    return this.servico.ficha(sessaoDe(req), idDaRota(cargo));
  }

  @Post()
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('cargo'))
  incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCargos> {
    return this.servico.incluirCargo(sessaoDe(req), corpo(esquemaIncluirCargo, b));
  }

  @Post('situacao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('cargo, faixa_salarial ou quadro_vaga, com o motivo e o valor anterior'))
  situacao(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCargos> {
    return this.servico.situacao(sessaoDe(req), corpo(esquemaSituacaoCargos, b));
  }

  @Post('exclusao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('exclusão do lançado por engano, com o retrato'))
  excluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCargos> {
    return this.servico.excluir(sessaoDe(req), corpo(esquemaExcluirCargos, b));
  }

  @Post('faixas')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('faixa_salarial'))
  incluirFaixa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCargos> {
    return this.servico.incluirFaixa(sessaoDe(req), corpo(esquemaIncluirFaixaSalarial, b));
  }

  @Post('faixas/:faixa/versao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('faixa_salarial (versão nova e o fim da anterior)'))
  versaoFaixa(
    @Param('faixa') faixa: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCargos> {
    return this.servico.versaoFaixa(
      sessaoDe(req),
      corpo(esquemaVersaoFaixaSalarial, { ...(b as object), faixa: idDaRota(faixa) }),
    );
  }

  @Post('vagas')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('quadro_vaga'))
  incluirVaga(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoCargos> {
    return this.servico.incluirVaga(sessaoDe(req), corpo(esquemaIncluirVaga, b));
  }

  @Post('vagas/:vaga/versao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('quadro_vaga (versão nova e o fim da anterior)'))
  versaoVaga(
    @Param('vaga') vaga: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCargos> {
    return this.servico.versaoVaga(
      sessaoDe(req),
      corpo(esquemaVersaoVaga, { ...(b as object), vaga: idDaRota(vaga) }),
    );
  }

  @Post(':cargo/alteracao')
  @HttpCode(200)
  @Permissao(P.gerir)
  @AuditadoNoHandler(NA_TABELA('cargo, com o motivo e o valor anterior'))
  alterar(
    @Param('cargo') cargo: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoCargos> {
    return this.servico.alterarCargo(
      sessaoDe(req),
      corpo(esquemaAlterarCargo, { ...(b as object), cargo: idDaRota(cargo) }),
    );
  }
}
