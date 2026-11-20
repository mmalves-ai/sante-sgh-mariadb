// Solicitações do autoatendimento e a fila do gestor (W0-06, parte 6b-3; M3 de mercado; `Meu espaço > Minhas
// solicitações` e `Gestão de pessoas > Solicitações dos colaboradores`):
//   GET  /api/pessoas/meu/solicitacoes[?vinculo=&situacao=]    as próprias (todos os vínculos do login)
//   POST /api/pessoas/meu/solicitacoes                         pedir (férias, abono, ajuste, cadastro, atestado)
//   POST /api/pessoas/meu/solicitacoes/:id/desistencia         desistir da pendente, com motivo (só quem pediu)
//   POST /api/pessoas/meu/solicitacoes/:id/atestado            ler o próprio atestado (com a finalidade na trilha)
//   GET  /api/pessoas/solicitacoes[?situacao=&tipo=&unidade=]  a fila do gestor (nunca as do próprio vínculo)
//   POST /api/pessoas/solicitacoes/:id/decisao                 aprovar ou recusar (com o efeito na mesma transação)
//   POST /api/pessoas/solicitacoes/:id/atestado                ler o atestado com a finalidade; o CID só com verCid
// A leitura do atestado é POST porque grava o acesso (LGPD arts. 11 e 46). Toda gravação leva a Idempotency-Key
// (guarda) e a trilha na mesma transação; o vínculo do pedido sai do login, nunca do corpo de outra pessoa.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AtestadoPessoaResposta,
  esquemaDecidirSolicitacao,
  esquemaDesistirSolicitacao,
  esquemaFiltroFilaSolicitacoes,
  esquemaFiltroMinhasSolicitacoes,
  esquemaIncluirSolicitacao,
  esquemaLerAtestado,
  EVENTOS_AUDITAVEIS,
  type ListaSolicitacoesPessoa,
  type ResultadoSolicitacaoPessoa,
} from '@sgh/contratos';
import { Auditar, AuditadoNoHandler, Permissao } from '../../../autorizacao/decoradores.js';
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
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from '../folha/porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from '../folha/porta-folha.js';
import { ServicoFeriasFolha } from '../folha/servico-ferias.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_PONTO, type PortaPonto } from '../ponto/porta-ponto.js';
import { PORTA_RUBRICAS, type PortaRubricas } from '../rubricas/porta-rubricas.js';
import { PORTA_AUTOATENDIMENTO, type PortaAutoatendimento } from './porta-autoatendimento.js';
import { PERMISSOES_AUTOATENDIMENTO, ServicoAutoatendimento } from './servico-autoatendimento.js';

const P = PERMISSOES_AUTOATENDIMENTO;
const E = EVENTOS_AUDITAVEIS;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;
const com = (b: unknown, x: Record<string, number>) => ({ ...(b as object), ...x });

/** O serviço das duas rotas (o pedido do colaborador e a fila do gestor), sobre as mesmas portas. */
class BaseSolicitacoes {
  readonly servico: ServicoAutoatendimento;

  constructor(
    porta: PortaAutoatendimento,
    pessoas: PortaPessoas,
    ponto: PortaPonto,
    calculo: PortaCalculoFolha,
    folha: PortaFolha,
    rubricas: PortaRubricas,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    const ferias = new ServicoFeriasFolha(calculo, folha, rubricas, pessoas, trilha, configuracao, cache);
    this.servico = new ServicoAutoatendimento(porta, pessoas, ponto, ferias, trilha, configuracao, cache);
  }
}

@Controller('pessoas/meu/solicitacoes')
export class MinhasSolicitacoesController extends BaseSolicitacoes {
  constructor(
    @Inject(PORTA_AUTOATENDIMENTO) porta: PortaAutoatendimento,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(PORTA_PONTO) ponto: PortaPonto,
    @Inject(PORTA_CALCULO_FOLHA) calculo: PortaCalculoFolha,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    super(porta, pessoas, ponto, calculo, folha, rubricas, trilha, configuracao, cache);
  }

  @Get()
  @Permissao(P.solicitar)
  @Auditar(E.pessoasSolicitacoesLidas.codigo)
  minhas(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaSolicitacoesPessoa> {
    return this.servico.minhas(sessaoDe(req), corpo(esquemaFiltroMinhasSolicitacoes, q));
  }

  @Post()
  @HttpCode(200)
  @Permissao(P.solicitar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_SOLICITACAO (e o ajuste pendente ou o atestado)'))
  incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoSolicitacaoPessoa> {
    return this.servico.incluir(sessaoDe(req), corpo(esquemaIncluirSolicitacao, b));
  }

  @Post(':id/desistencia')
  @HttpCode(200)
  @Permissao(P.solicitar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_SOLICITACAO (e o ajuste pendente ligado)'))
  desistir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSolicitacaoPessoa> {
    return this.servico.desistir(
      sessaoDe(req),
      corpo(esquemaDesistirSolicitacao, com(b, { solicitacao: idDaRota(id) })),
    );
  }

  @Post(':id/atestado')
  @HttpCode(200)
  @Permissao(P.solicitar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ATESTADO_ACESSO'))
  atestado(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AtestadoPessoaResposta> {
    return this.servico.atestado(sessaoDe(req), idDaRota(id), corpo(esquemaLerAtestado, b));
  }
}

@Controller('pessoas/solicitacoes')
export class FilaSolicitacoesController extends BaseSolicitacoes {
  constructor(
    @Inject(PORTA_AUTOATENDIMENTO) porta: PortaAutoatendimento,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(PORTA_PONTO) ponto: PortaPonto,
    @Inject(PORTA_CALCULO_FOLHA) calculo: PortaCalculoFolha,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    super(porta, pessoas, ponto, calculo, folha, rubricas, trilha, configuracao, cache);
  }

  @Get()
  @Permissao(P.aprovar)
  @Auditar(E.pessoasSolicitacoesLidas.codigo)
  fila(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaSolicitacoesPessoa> {
    return this.servico.fila(sessaoDe(req), corpo(esquemaFiltroFilaSolicitacoes, q));
  }

  @Post(':id/decisao')
  @HttpCode(200)
  @Permissao(P.aprovar)
  @AuditadoNoHandler(
    NA_TABELA('SGH_PES_SOLICITACAO e o efeito (SGH_PES_FERIAS, ajustes do ponto ou SGH_PES_CORRECAO)'),
  )
  decidir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoSolicitacaoPessoa> {
    return this.servico.decidir(
      sessaoDe(req),
      corpo(esquemaDecidirSolicitacao, com(b, { solicitacao: idDaRota(id) })),
    );
  }

  @Post(':id/atestado')
  @HttpCode(200)
  @Permissao(P.aprovar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_ATESTADO_ACESSO'))
  atestado(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AtestadoPessoaResposta> {
    return this.servico.atestado(sessaoDe(req), idDaRota(id), corpo(esquemaLerAtestado, b));
  }
}
