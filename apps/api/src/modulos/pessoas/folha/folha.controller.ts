// Tela da folha da competência, parte F0 (M53.1; ficha do M53, seção 7; `Gestão de pessoas > Folha de pagamento`):
//   GET  /api/pessoas/folha/apoio                         empresas, domínios, remessas antigas, liberação e ações
//   GET  /api/pessoas/folha/lotes?empresa&competencia     lotes trocados com a folha externa (sem CPF, sem nome)
//   POST /api/pessoas/folha/lotes/exportacao              gera o lote da competência (ou devolve as pendências)
//   GET  /api/pessoas/folha/lotes/:id/arquivo             o arquivo do lote (com o CPF): permissão sensível e trilha
//   POST /api/pessoas/folha/lotes/:id/retorno             importa o retorno, confere e grava o resumo
//   GET  /api/pessoas/folha/afastamentos ; POST afastamentos ; POST afastamentos/:id   afastamento do colaborador
// Toda gravação leva a Idempotency-Key (guarda) e a trilha; o estabelecimento vem da sessão.
import {
  Body,
  Controller,
  Get,
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
  type ApoioFolhaInterface,
  esquemaAlterarAfastamento,
  esquemaFiltroAfastamentos,
  esquemaFiltroLotesFolha,
  esquemaGerarExportacaoFolha,
  esquemaRegistrarAfastamento,
  EVENTOS_AUDITAVEIS,
  type ListaAfastamentos,
  type ListaLotesFolha,
  type ResultadoExportacaoFolha,
  type ResultadoFolha,
  type ResultadoImportacaoFolha,
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
import { PORTA_REALIZADO, type PortaRealizado } from '../escala/porta-realizado.js';
import { CIFRA_CPF_PESSOAS } from '../pessoas.controller.js';
import { PORTA_PONTO, type PortaPonto } from '../ponto/porta-ponto.js';
import { PORTA_PESSOAS, type PortaPessoas } from '../porta.js';
import { PORTA_FOLHA, type PortaFolha } from './porta-folha.js';
import { ServicoFolha } from './servico-folha.js';

type Resposta = { header(n: string, v: string): unknown };

const E = EVENTOS_AUDITAVEIS;
const NA_TABELA = (t: string) => `${t} com a SGH_TRILHA na mesma transação`;

@Controller('pessoas')
export class FolhaController {
  readonly servico: ServicoFolha;

  constructor(
    @Inject(PORTA_FOLHA) porta: PortaFolha,
    @Inject(PORTA_PESSOAS) pessoas: PortaPessoas,
    @Inject(PORTA_PONTO) ponto: PortaPonto,
    @Inject(PORTA_REALIZADO) realizado: PortaRealizado,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(CIFRA_CPF_PESSOAS) cifra: CifraCpf | null = null,
  ) {
    this.servico = new ServicoFolha(porta, pessoas, ponto, realizado, trilha, configuracao, cache, cifra);
  }

  @Get('folha/apoio')
  @Permissao('pessoas.folha.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioFolhaInterface> {
    return this.servico.apoioTela(sessaoDe(req));
  }

  @Get('folha/lotes')
  @Permissao('pessoas.folha.ler')
  lotes(@Query() q: Record<string, string>, @Req() req: RequisicaoAutorizada): Promise<ListaLotesFolha> {
    return this.servico.listarLotes(sessaoDe(req), corpo(esquemaFiltroLotesFolha, q));
  }

  @Post('folha/lotes/exportacao')
  @HttpCode(200)
  @Permissao('pessoas.folha.exportar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FOLHA_INTERFACE'))
  exportar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoExportacaoFolha> {
    return this.servico.gerarExportacao(sessaoDe(req), corpo(esquemaGerarExportacaoFolha, b));
  }

  @Get('folha/lotes/:id/arquivo')
  @Permissao('pessoas.folha.exportar')
  @Auditar(E.pessoasFolhaLoteBaixado.codigo)
  async arquivo(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: Resposta,
  ): Promise<string> {
    const lote = idDaRota(id);
    const a = await this.servico.arquivoLote(sessaoDe(req), lote);
    // A trilha diz qual lote (e, pelo lote, a empresa e a competência) saiu com o CPF.
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PES_FOLHA_INTERFACE',
      idAlvo: String(lote),
      chaveNaturalAlvo: `empresa:${a.lote.empresa};competencia:${a.lote.competencia}`,
    };
    res.header('content-type', 'application/json; charset=utf-8');
    res.header('content-disposition', `attachment; filename="${a.nome}"`);
    res.header('cache-control', 'no-store');
    // passthrough: o interceptor grava a trilha ANTES de a resposta sair; sem trilha, o arquivo não sai (503).
    return a.conteudo;
  }

  @Post('folha/lotes/:id/retorno')
  @HttpCode(200)
  @Permissao('pessoas.folha.importar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_FOLHA_INTERFACE e SGH_PES_FOLHA_RESUMO'))
  retorno(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoImportacaoFolha> {
    return this.servico.importarRetorno(sessaoDe(req), idDaRota(id), b);
  }

  @Get('folha/afastamentos')
  @Permissao('pessoas.folha.ler')
  afastamentos(
    @Query() q: Record<string, string>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ListaAfastamentos> {
    return this.servico.listarAfastamentos(sessaoDe(req), corpo(esquemaFiltroAfastamentos, q));
  }

  @Post('folha/afastamentos')
  @HttpCode(200)
  @Permissao('pessoas.afastamento.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AFASTAMENTO'))
  registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoFolha> {
    return this.servico.registrarAfastamento(sessaoDe(req), corpo(esquemaRegistrarAfastamento, b));
  }

  @Post('folha/afastamentos/:id')
  @HttpCode(200)
  @Permissao('pessoas.afastamento.registrar')
  @AuditadoNoHandler(NA_TABELA('SGH_PES_AFASTAMENTO'))
  alterar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoFolha> {
    return this.servico.alterarAfastamento(sessaoDe(req), idDaRota(id), corpo(esquemaAlterarAfastamento, b));
  }
}
