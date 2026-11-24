// FGTS Digital e obrigações legais, parte F7 (M53.8; ficha do M53, seção 7; `Gestão de pessoas > Obrigações legais`):
//   GET  /api/pessoas/obrigacoes/apoio                          tipos, regimes sugeridos com as fontes, empresas
//   GET  /api/pessoas/obrigacoes/catalogo                       catálogo oficial: vigente, encerrada e o ato da substituição
//   GET  /api/pessoas/obrigacoes/parametros?empresa             vigências dos parâmetros das obrigações
//   POST /api/pessoas/obrigacoes/parametros                     nova vigência (regimes, leiautes, responsável)
//   GET  /api/pessoas/obrigacoes/fgts-digital?empresa&competencia  apuração do FGTS Digital (conferência com o eSocial)
//   GET  /api/pessoas/obrigacoes?empresa&tipo&ano&situacao      obrigações geradas (sem o arquivo)
//   POST /api/pessoas/obrigacoes                                prévia (`simular`) ou geração do período
//   GET  /api/pessoas/obrigacoes/:id                            uma obrigação
//   GET  /api/pessoas/obrigacoes/:id/arquivo                    o arquivo para o programa oficial (leitura auditada)
//   POST /api/pessoas/obrigacoes/:id/entrega                    registra a entrega (protocolo; no FGTS, a guia)
//   POST /api/pessoas/obrigacoes/:id/cancelamento               cancela a gerada, com motivo
// Consultar pede `pessoas.obrigacao.ler`; o resto, `pessoas.obrigacao.gerar`. Toda gravação leva a Idempotency-Key
// (guarda) e a trilha; o estabelecimento vem da sessão. Nenhuma resposta JSON traz CPF, NIS ou nome.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type ApoioObrigacoes,
  type ApuracaoFgtsDigital,
  esquemaCancelarObrigacao,
  esquemaFiltroApuracaoFgts,
  esquemaFiltroObrigacoes,
  esquemaFiltroParametrosObrigacoes,
  esquemaGerarObrigacao,
  esquemaParametrosObrigacoes,
  esquemaRegistrarEntregaObrigacao,
  EVENTOS_AUDITAVEIS,
  type ListaObrigacoes,
  type ListaParametrosObrigacoes,
  type ObrigacaoLegal,
  type ResultadoGeracaoObrigacao,
} from '@sgh/contratos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../../autorizacao/decoradores.js';
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
import type { CifraCpf } from '../cifra-cpf.js';
import { PORTA_ESOCIAL, type PortaEsocial } from '../esocial/porta-esocial.js';
import { ServicoEsocial } from '../esocial/servico-esocial.js';
import type { CatalogoObrigacoesOficiais } from '../folha/catalogo-obrigacoes-oficiais.js';
import { PORTA_CALCULO_FOLHA, type PortaCalculoFolha } from '../folha/porta-calculo.js';
import { PORTA_FOLHA, type PortaFolha } from '../folha/porta-folha.js';
import { CIFRA_CPF_PESSOAS } from '../pessoas.controller.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_RUBRICAS, type PortaRubricas } from '../rubricas/porta-rubricas.js';
import { PERMISSOES_OBRIGACOES as P, ServicoObrigacoes } from './servico-obrigacoes.js';

const E = EVENTOS_AUDITAVEIS;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;

interface RespostaArquivo {
  header(nome: string, valor: string): unknown;
}

@Controller('pessoas/obrigacoes')
export class ObrigacoesController {
  readonly servico: ServicoObrigacoes;

  constructor(
    @Inject(PORTA_ESOCIAL) esocial: PortaEsocial,
    @Inject(PORTA_FOLHA) folha: PortaFolha,
    @Inject(PORTA_CALCULO_FOLHA) calculo: PortaCalculoFolha,
    @Inject(PORTA_RUBRICAS) rubricas: PortaRubricas,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(CIFRA_CPF_PESSOAS) cifra: CifraCpf | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    const base = new ServicoEsocial(
      esocial,
      folha,
      calculo,
      rubricas,
      pessoas,
      cifra,
      trilha,
      configuracao,
      cache,
    );
    this.servico = new ServicoObrigacoes(base, trilha, configuracao, cache);
  }

  @Get('apoio')
  @Permissao(P.ler)
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioObrigacoes> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('catalogo')
  @Permissao(P.ler)
  catalogo(@Req() req: RequisicaoAutorizada): Promise<CatalogoObrigacoesOficiais> {
    return this.servico.catalogo(sessaoDe(req));
  }

  @Get('parametros')
  @Permissao(P.ler)
  parametros(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaParametrosObrigacoes> {
    return this.servico.parametros(sessaoDe(req), corpo(esquemaFiltroParametrosObrigacoes, q).empresa);
  }

  @Post('parametros')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_OBRIGACAO_PARAM'))
  registrarParametros(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaParametrosObrigacoes> {
    return this.servico.registrarParametros(sessaoDe(req), corpo(esquemaParametrosObrigacoes, b));
  }

  @Get('fgts-digital')
  @Permissao(P.ler)
  fgtsDigital(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ApuracaoFgtsDigital> {
    return this.servico.apuracaoFgts(sessaoDe(req), corpo(esquemaFiltroApuracaoFgts, q));
  }

  @Get()
  @Permissao(P.ler)
  listar(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaObrigacoes> {
    return this.servico.listar(sessaoDe(req), corpo(esquemaFiltroObrigacoes, q));
  }

  @Post()
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_OBRIGACAO'))
  gerar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoGeracaoObrigacao> {
    return this.servico.gerar(sessaoDe(req), corpo(esquemaGerarObrigacao, b));
  }

  @Get(':id')
  @Permissao(P.ler)
  detalhe(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ObrigacaoLegal> {
    return this.servico.detalhe(sessaoDe(req), idDaRota(id));
  }

  /** O arquivo para o programa oficial: leva CPF, NIS, nome e remuneração (leitura auditada, nunca em cache). */
  @Get(':id/arquivo')
  @Permissao(P.gerar)
  @Auditar(E.pessoasObrigacaoArquivoLido.codigo)
  @Header('content-type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async arquivo(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: RespostaArquivo,
  ): Promise<string> {
    const r = idDaRota(id);
    req.sghAlvo = { tabelaAlvo: 'SGH_PES_OBRIGACAO', idAlvo: String(r), chaveNaturalAlvo: 'arquivo' };
    const a = await this.servico.arquivo(sessaoDe(req), r);
    res.header('content-disposition', `attachment; filename="${a.nome}"`);
    return a.conteudo;
  }

  @Post(':id/entrega')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_OBRIGACAO'))
  entrega(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ObrigacaoLegal> {
    return this.servico.registrarEntrega(
      sessaoDe(req),
      idDaRota(id),
      corpo(esquemaRegistrarEntregaObrigacao, b),
    );
  }

  @Post(':id/cancelamento')
  @HttpCode(200)
  @Permissao(P.gerar)
  @AuditadoNoHandler(NA_TABELA('SGH_PES_OBRIGACAO'))
  cancelamento(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ObrigacaoLegal> {
    return this.servico.cancelar(sessaoDe(req), idDaRota(id), corpo(esquemaCancelarObrigacao, b));
  }
}
