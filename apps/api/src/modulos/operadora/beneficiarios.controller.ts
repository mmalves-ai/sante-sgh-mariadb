// Rotas da fatia F1 da operadora própria (M56.2; ficha, seções 4, 7 e 8). Todas exigem a chave `operadora.beneficiarios`
// (só vale com a do módulo; regra 1), menos a tela, que diz o que falta quando está desligada:
//   GET  /api/operadora/beneficiarios/tela          liberação, ações, operadoras, produtos e domínios
//   GET  /api/operadora/empresas                     as operadoras do estabelecimento
//   POST /api/operadora/empresas | PUT …/:id         operadora (registro na ANS, CNPJ, modalidade): operadora.empresa.editar
//   GET  /api/operadora/produtos?operadora=          produtos e planos
//   POST /api/operadora/produtos | PUT …/:id         produto (natureza, registro, segmentação, RN 63, carências)
//   GET  /api/operadora/contratos?operadora=&produto=&busca=&apos=  contratos (documento mascarado)
//   GET  /api/operadora/contratos/:id                o contrato com o documento do contratante (leitura auditada)
//   POST /api/operadora/contratos | PUT …/:id        contrato PF ou PJ
//   GET  /api/operadora/beneficiarios?…              beneficiários (CPF mascarado; lista com nomes: auditada)
//   GET  /api/operadora/beneficiarios/:id            ficha (dependentes, vias; leitura auditada)
//   POST /api/operadora/beneficiarios | PUT …/:id    titular ou dependente (a inclusão gera a carteirinha e a 1ª via)
//   POST /api/operadora/beneficiarios/:id/baixa      exclusão com o motivo (o titular leva os dependentes)
//   POST /api/operadora/beneficiarios/:id/reativacao reativação do excluído
//   POST /api/operadora/beneficiarios/:id/carteirinha segunda via (e seguintes) com o motivo
//   GET  /api/operadora/elegibilidade?carteirinha=&data=  elegibilidade pela carteirinha (auditada)
// Toda gravação vai numa transação só SGH_ com a SGH_TRILHA junto; nenhuma tabela do outro sistema é gravada.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  type BeneficiarioFicha,
  type BeneficiariosOperadora,
  type ContratoOperadora,
  type ContratosOperadora,
  type Elegibilidade,
  esquemaBaixaBeneficiario,
  esquemaBeneficiarioEntrada,
  esquemaContratoEntrada,
  esquemaFiltroBeneficiarios,
  esquemaFiltroContratos,
  esquemaFiltroElegibilidade,
  esquemaOperadoraEntrada,
  esquemaPedidoCarteirinha,
  esquemaProdutoEntrada,
  esquemaReativacaoBeneficiario,
  EVENTOS_AUDITAVEIS,
  type OperadoraEmpresa,
  type ProdutoOperadora,
  type ResultadoOperadora,
  ROTAS_OPERADORA_F1 as R,
  type TelaBeneficiarios,
} from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ServicoBeneficiariosOperadora } from './aplicacao/beneficiarios.js';
import { ServicoSituacaoOperadora } from './aplicacao/situacao.js';
import { PORTA_OPERADORA, type PortaOperadora } from './porta.js';

const ID = z.coerce.number().int().positive().max(9_007_199_254_740_991);
const idDe = (v: string): number => {
  const r = ID.safeParse(v);
  if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Identificador inválido', 'Use um número.');
  return r.data;
};
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
const operadoraDaConsulta = z.object({ operadora: ID.optional() });

const MENSAGEM = {
  operadora: 'Operadora gravada.',
  produto: 'Produto gravado.',
  contrato: 'Contrato gravado.',
  beneficiario: 'Beneficiário gravado.',
} as const;

@Controller()
export class BeneficiariosOperadoraController {
  readonly servico: ServicoBeneficiariosOperadora;

  constructor(
    @Inject(PORTA_OPERADORA) porta: PortaOperadora,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.servico = new ServicoBeneficiariosOperadora(porta, new ServicoSituacaoOperadora(fonte, cache));
  }

  @Get(R.tela.caminho)
  @Permissao(R.tela.permissao)
  tela(@Req() req: RequisicaoAutorizada): Promise<TelaBeneficiarios> {
    return this.servico.tela(sessaoDe(req));
  }

  // ── Operadora (empresa) ───────────────────────────────────────────────────────────────────────────────────────

  @Get(R.operadoras.caminho)
  @Permissao(R.operadoras.permissao)
  operadoras(@Req() req: RequisicaoAutorizada): Promise<OperadoraEmpresa[]> {
    return this.servico.operadoras(sessaoDe(req));
  }

  @Post(R.gravarOperadora.caminho)
  @HttpCode(201)
  @Permissao(R.gravarOperadora.permissao)
  @AuditadoNoHandler('operadora.empresa.gravada (SGH_OPE_OPERADORA) com a SGH_TRILHA na mesma transação')
  async incluirOperadora(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoOperadora> {
    const r = await this.servico.gravarOperadora(sessaoDe(req), null, corpo(esquemaOperadoraEntrada, b));
    return { ok: true, id: r.id, mensagem: MENSAGEM.operadora };
  }

  @Put(`${R.gravarOperadora.caminho}/:id`)
  @Permissao(R.gravarOperadora.permissao)
  @AuditadoNoHandler('operadora.empresa.gravada (SGH_OPE_OPERADORA) com a SGH_TRILHA na mesma transação')
  async alterarOperadora(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOperadora> {
    const r = await this.servico.gravarOperadora(sessaoDe(req), idDe(id), corpo(esquemaOperadoraEntrada, b));
    return { ok: true, id: r.id, mensagem: MENSAGEM.operadora };
  }

  // ── Produto ─────────────────────────────────────────────────────────────────────────────────────────────────

  @Get(R.produtos.caminho)
  @Permissao(R.produtos.permissao)
  produtos(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ProdutoOperadora[]> {
    return this.servico.produtos(sessaoDe(req), filtro(operadoraDaConsulta, q).operadora);
  }

  @Post(R.gravarProduto.caminho)
  @HttpCode(201)
  @Permissao(R.gravarProduto.permissao)
  @AuditadoNoHandler('operadora.produto.gravado (SGH_OPE_PRODUTO) com a SGH_TRILHA na mesma transação')
  async incluirProduto(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoOperadora> {
    const r = await this.servico.gravarProduto(sessaoDe(req), null, corpo(esquemaProdutoEntrada, b));
    return { ok: true, id: r.id, mensagem: MENSAGEM.produto };
  }

  @Put(`${R.gravarProduto.caminho}/:id`)
  @Permissao(R.gravarProduto.permissao)
  @AuditadoNoHandler('operadora.produto.gravado (SGH_OPE_PRODUTO) com a SGH_TRILHA na mesma transação')
  async alterarProduto(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOperadora> {
    const r = await this.servico.gravarProduto(sessaoDe(req), idDe(id), corpo(esquemaProdutoEntrada, b));
    return { ok: true, id: r.id, mensagem: MENSAGEM.produto };
  }

  // ── Contrato ────────────────────────────────────────────────────────────────────────────────────────────────

  // Lista com o nome do contratante (de pessoa, no contrato de pessoa física): auditada, como a dos beneficiários.
  @Get(R.contratos.caminho)
  @Permissao(R.contratos.permissao)
  @Auditar(EVENTOS_AUDITAVEIS.operadoraContratoLido.codigo)
  async contratos(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContratosOperadora> {
    const f = filtro(esquemaFiltroContratos, q);
    const r = await this.servico.contratos(sessaoDe(req), f);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_OPE_CONTRATO',
      chaveNaturalAlvo: `parte:lista;n:${r.itens.length}`,
    };
    return r;
  }

  @Get(`${R.contratos.caminho}/:id`)
  @Permissao(R.contratos.permissao)
  @Auditar(EVENTOS_AUDITAVEIS.operadoraContratoLido.codigo)
  async contrato(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ContratoOperadora> {
    const c = await this.servico.contrato(sessaoDe(req), idDe(id));
    req.sghAlvo = {
      tabelaAlvo: 'SGH_OPE_CONTRATO',
      idAlvo: String(c.id),
      chaveNaturalAlvo: `contrato:${c.numero}`,
    };
    return c;
  }

  @Post(R.gravarContrato.caminho)
  @HttpCode(201)
  @Permissao(R.gravarContrato.permissao)
  @AuditadoNoHandler('operadora.contrato.gravado (SGH_OPE_CONTRATO) com a SGH_TRILHA na mesma transação')
  async incluirContrato(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoOperadora> {
    const r = await this.servico.gravarContrato(sessaoDe(req), null, corpo(esquemaContratoEntrada, b));
    return { ok: true, id: r.id, mensagem: MENSAGEM.contrato };
  }

  @Put(`${R.gravarContrato.caminho}/:id`)
  @Permissao(R.gravarContrato.permissao)
  @AuditadoNoHandler('operadora.contrato.gravado (SGH_OPE_CONTRATO) com a SGH_TRILHA na mesma transação')
  async alterarContrato(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOperadora> {
    const r = await this.servico.gravarContrato(sessaoDe(req), idDe(id), corpo(esquemaContratoEntrada, b));
    return { ok: true, id: r.id, mensagem: MENSAGEM.contrato };
  }

  // ── Beneficiário ────────────────────────────────────────────────────────────────────────────────────────────

  @Get(R.beneficiarios.caminho)
  @Permissao(R.beneficiarios.permissao)
  @Auditar(EVENTOS_AUDITAVEIS.operadoraBeneficiarioLido.codigo)
  async beneficiarios(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<BeneficiariosOperadora> {
    const f = filtro(esquemaFiltroBeneficiarios, q);
    const r = await this.servico.beneficiarios(sessaoDe(req), f);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_OPE_BENEFICIARIO',
      chaveNaturalAlvo: `parte:lista;n:${r.itens.length}`,
    };
    return r;
  }

  @Get(`${R.beneficiarios.caminho}/:id`)
  @Permissao(R.beneficiarios.permissao)
  @Auditar(EVENTOS_AUDITAVEIS.operadoraBeneficiarioLido.codigo)
  async ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<BeneficiarioFicha> {
    const f = await this.servico.ficha(sessaoDe(req), idDe(id));
    req.sghAlvo = {
      tabelaAlvo: 'SGH_OPE_BENEFICIARIO',
      idAlvo: String(f.id),
      chaveNaturalAlvo: 'parte:ficha',
    };
    return f;
  }

  @Post(R.gravarBeneficiario.caminho)
  @HttpCode(201)
  @Permissao(R.gravarBeneficiario.permissao)
  @AuditadoNoHandler(
    'operadora.beneficiario.gravado (SGH_OPE_BENEFICIARIO e a 1ª via em SGH_OPE_CARTEIRINHA) com a SGH_TRILHA na mesma transação',
  )
  async incluirBeneficiario(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOperadora> {
    const r = await this.servico.gravarBeneficiario(
      sessaoDe(req),
      null,
      corpo(esquemaBeneficiarioEntrada, b),
    );
    return {
      ok: true,
      id: r.id,
      mensagem: 'Beneficiário incluído com a carteirinha (primeira via).',
      ...(r.carteirinha ? { carteirinha: r.carteirinha } : {}),
    };
  }

  @Put(`${R.gravarBeneficiario.caminho}/:id`)
  @Permissao(R.gravarBeneficiario.permissao)
  @AuditadoNoHandler(
    'operadora.beneficiario.gravado (SGH_OPE_BENEFICIARIO) com a SGH_TRILHA na mesma transação',
  )
  async alterarBeneficiario(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOperadora> {
    const r = await this.servico.gravarBeneficiario(
      sessaoDe(req),
      idDe(id),
      corpo(esquemaBeneficiarioEntrada, b),
    );
    return { ok: true, id: r.id, mensagem: MENSAGEM.beneficiario };
  }

  @Post(`${R.gravarBeneficiario.caminho}/:id/baixa`)
  @Permissao(R.gravarBeneficiario.permissao)
  @AuditadoNoHandler(
    'operadora.beneficiario.gravado (a exclusão em SGH_OPE_BENEFICIARIO, com os dependentes) com a SGH_TRILHA na mesma transação',
  )
  async baixar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOperadora> {
    const r = await this.servico.baixar(sessaoDe(req), idDe(id), corpo(esquemaBaixaBeneficiario, b));
    return {
      ok: true,
      id: r.id,
      mensagem:
        r.dependentes > 0
          ? `Beneficiário excluído, com ${r.dependentes} dependente(s).`
          : 'Beneficiário excluído.',
    };
  }

  @Post(`${R.gravarBeneficiario.caminho}/:id/reativacao`)
  @Permissao(R.gravarBeneficiario.permissao)
  @AuditadoNoHandler(
    'operadora.beneficiario.gravado (a reativação em SGH_OPE_BENEFICIARIO) com a SGH_TRILHA na mesma transação',
  )
  async reativar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOperadora> {
    const e = corpo(esquemaReativacaoBeneficiario, b);
    const r = await this.servico.reativar(sessaoDe(req), idDe(id), e.versao);
    return { ok: true, id: r.id, mensagem: 'Beneficiário reativado.' };
  }

  @Post(`${R.gravarBeneficiario.caminho}/:id/carteirinha`)
  @Permissao(R.gravarBeneficiario.permissao)
  @AuditadoNoHandler(
    'operadora.carteirinha.emitida (SGH_OPE_CARTEIRINHA e a via em SGH_OPE_BENEFICIARIO) com a SGH_TRILHA na mesma transação',
  )
  async emitirVia(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOperadora> {
    const r = await this.servico.emitirVia(sessaoDe(req), idDe(id), corpo(esquemaPedidoCarteirinha, b));
    return { ok: true, id: r.id, mensagem: `Via ${r.via} da carteirinha emitida.` };
  }

  // ── Elegibilidade ───────────────────────────────────────────────────────────────────────────────────────────

  @Get(R.elegibilidade.caminho)
  @Permissao(R.elegibilidade.permissao)
  @Auditar(EVENTOS_AUDITAVEIS.operadoraBeneficiarioLido.codigo)
  async elegibilidade(
    @Query() q: Record<string, string | undefined>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Elegibilidade> {
    const f = filtro(esquemaFiltroElegibilidade, q);
    const r = await this.servico.elegibilidade(sessaoDe(req), f.carteirinha, f.data);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_OPE_BENEFICIARIO',
      ...(r.beneficiario ? { idAlvo: String(r.beneficiario.id) } : {}),
      chaveNaturalAlvo: `parte:elegibilidade;elegivel:${r.elegivel ? 'sim' : 'nao'}`,
    };
    return r;
  }
}
