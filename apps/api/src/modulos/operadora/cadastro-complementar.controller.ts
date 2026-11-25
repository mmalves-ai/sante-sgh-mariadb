// Rotas do cadastro complementar da operadora (F7, 08-SGO linhas 93 a 95; F78.08-1). Tudo ligado, controlado só pelo
// cargo (permissões já concedidas por perfil em permissoes/operadora.ts):
//   GET  operadora/complementar/pessoas?documento=               operadora.empresa.editar (CPF/CNPJ exato, auditada)
//   GET  operadora/complementar/empresas/:op/responsaveis         operadora.beneficiario.ler
//   POST operadora/complementar/empresas/:op/responsaveis         operadora.empresa.editar
//   GET  operadora/complementar/empresas/:op/departamentos        operadora.beneficiario.ler
//   POST operadora/complementar/empresas/:op/departamentos        operadora.empresa.editar (id e versão no corpo: altera)
//   GET  operadora/complementar/empresas/:op/parametros           operadora.beneficiario.ler
//   POST operadora/complementar/empresas/:op/parametros           operadora.empresa.editar
//   GET  operadora/complementar/contratos?numero=                operadora.beneficiario.ler
//   GET  operadora/complementar/contratos/:id/painel              operadora.beneficiario.ler
//   GET  operadora/complementar/contratos/:id/aditivos            operadora.beneficiario.ler
//   POST operadora/complementar/contratos/:id/aditivos            operadora.beneficiario.editar
//   GET  operadora/complementar/contratos/:id/cancelamentos       operadora.beneficiario.ler
//   POST operadora/complementar/contratos/:id/cancelamentos       operadora.beneficiario.editar
//   POST operadora/complementar/aditivos/:id/assinar               operadora.beneficiario.editar
//   POST operadora/complementar/cancelamentos/:id/efetivar        operadora.beneficiario.editar
//   POST operadora/complementar/cancelamentos/:id/desistir        operadora.beneficiario.editar
//   POST operadora/complementar/cancelamentos/efetivar-vencidos   operadora.beneficiario.editar
//   GET  operadora/complementar/produtos/:id/abrangencia          operadora.beneficiario.ler
//   POST operadora/complementar/produtos/:id/abrangencia          operadora.beneficiario.editar
//   GET  operadora/complementar/beneficiarios/:id/carencias       operadora.beneficiario.ler
//   POST operadora/complementar/beneficiarios/:id/carencias       operadora.beneficiario.editar
//   GET  operadora/complementar/beneficiarios/:id/cartoes         operadora.beneficiario.ler
//   POST operadora/complementar/beneficiarios/:id/cartoes         operadora.beneficiario.editar
//   POST operadora/complementar/cartoes/:id/situacao              operadora.beneficiario.editar
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { Auditar, AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import {
  type Gravado,
  PORTA_CADASTRO_COMPLEMENTAR,
  type PortaCadastroComplementarPropria,
} from './cadastro-complementar-porta-propria.js';

const LER = 'operadora.beneficiario.ler';
const EMPRESA = 'operadora.empresa.editar';
const EDITAR = 'operadora.beneficiario.editar';
const AUD = 'operadora.complementar.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const esquemaResponsavel = z.object({
  tipo: z.string().min(1).max(30),
  natureza: z.enum(['fisica', 'juridica']),
  pessoa: id,
  numeroRegistro: z.string().max(30).nullable(),
  inicio: data,
  fim: data.nullable(),
});
const esquemaDepartamento = z.object({
  id: id.nullable(),
  versao: z.number().int().positive().nullable(),
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(150),
  tipo: z.string().min(1).max(30),
  email: z.string().max(254).nullable(),
  emailsCopia: z.array(z.string().max(254)).max(20),
  superior: id.nullable(),
  visivelPortal: z.boolean(),
  ativo: z.boolean(),
});
const esquemaParametro = z.object({
  chave: z.string().min(1).max(60),
  valor: z.union([z.number(), z.boolean(), z.string().max(40)]),
  inicio: data.nullable(),
  justificativa: z.string().max(500).nullable(),
});
const esquemaAditivo = z.object({
  tipo: z.string().min(1).max(30),
  assinatura: data.nullable(),
  efeito: data,
  planoAnterior: id.nullable(),
  planoNovo: id.nullable(),
  valorAnterior: z.number().nonnegative().nullable(),
  valorNovo: z.number().nonnegative().nullable(),
  novaVigenciaFim: data.nullable(),
  descricao: z.string().min(1).max(4000),
  tabelaPreco: id.nullable().default(null),
});
const esquemaCancelamento = z.object({
  motivo: id,
  solicitante: z.string().min(1).max(30),
  dataEfeito: data.nullable(),
  diasAtraso: z.number().int().nonnegative().max(9999).nullable(),
  avisoRecebimento: z.string().max(40).nullable(),
  avisoEntregueEm: data.nullable(),
  observacao: z.string().max(4000).nullable(),
  valorCredito: z.number().nonnegative().max(9_999_999_999).nullable().default(null),
});
const esquemaAbrangencia = z.object({
  areas: z
    .array(z.object({ tipo: z.enum(['municipio', 'estado']), codigoIbge: z.string().max(7) }))
    .max(6000),
});
const esquemaCarencias = z.object({ aproveitamentoDias: z.number().int().min(0).max(730) });
const esquemaCartao = z.object({
  primeiraVia: z.boolean(),
  motivo: id.nullable(),
  canal: z.enum(['balcao', 'portal', 'contratante']),
  observacao: z.string().max(1000).nullable(),
});
const esquemaAssinatura = z.object({ assinatura: data });
const esquemaDesistencia = z.object({ motivo: z.string().min(1).max(500) });
const esquemaPassoCartao = z.object({ para: z.enum(['emitido', 'entregue', 'cancelado']) });

@Controller()
export class CadastroComplementarOperadoraController {
  constructor(
    @Inject(PORTA_CADASTRO_COMPLEMENTAR) private readonly porta: PortaCadastroComplementarPropria,
  ) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.complementar', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/complementar/pessoas')
  @Permissao(EMPRESA)
  @Auditar('operadora.responsavel.pessoa-buscada')
  async pessoaPorDocumento(
    @Query('documento') documento: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    return { pessoa: await this.ok(this.porta.pessoaPorDocumento(sessaoDe(req).porta, documento ?? '')) };
  }

  @Get('operadora/complementar/empresas/:op/responsaveis')
  @Permissao(LER)
  responsaveis(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.responsaveis(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/complementar/empresas/:op/responsaveis')
  @HttpCode(201)
  @Permissao(EMPRESA)
  @AuditadoNoHandler(AUD)
  incluirResponsavel(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirResponsavel(
        s.porta,
        idDaRota(op),
        corpo(esquemaResponsavel, b),
        this.trilha(s, 'operadora.responsavel.incluido', 'responsavel_operadora'),
      ),
    );
  }

  @Get('operadora/complementar/empresas/:op/departamentos')
  @Permissao(LER)
  departamentos(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.departamentos(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/complementar/empresas/:op/departamentos')
  @HttpCode(201)
  @Permissao(EMPRESA)
  @AuditadoNoHandler(AUD)
  gravarDepartamento(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { id: dep, versao, ...dados } = corpo(esquemaDepartamento, b);
    return this.ok(
      this.porta.gravarDepartamento(
        s.porta,
        idDaRota(op),
        dep,
        versao,
        dados,
        this.trilha(s, 'operadora.departamento.gravado', 'departamento_operadora'),
      ),
    );
  }

  @Get('operadora/complementar/empresas/:op/parametros')
  @Permissao(LER)
  parametros(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.parametros(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/complementar/empresas/:op/parametros')
  @HttpCode(201)
  @Permissao(EMPRESA)
  @AuditadoNoHandler(AUD)
  definirParametro(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.definirParametro(
        s.porta,
        idDaRota(op),
        corpo(esquemaParametro, b),
        this.trilha(s, 'operadora.parametro.definido', 'parametro_operadora'),
      ),
    );
  }

  @Get('operadora/complementar/contratos')
  @Permissao(LER)
  contratos(@Query('numero') numero: string | undefined, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.contratosPorNumero(sessaoDe(req).porta, String(numero ?? '').slice(0, 30)));
  }

  @Get('operadora/complementar/contratos/:id/painel')
  @Permissao(LER)
  painelContrato(@Param('id') ctr: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.painelContrato(sessaoDe(req).porta, idDaRota(ctr)));
  }

  @Get('operadora/complementar/contratos/:id/aditivos')
  @Permissao(LER)
  aditivos(@Param('id') ctr: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.aditivos(sessaoDe(req).porta, idDaRota(ctr)));
  }

  @Post('operadora/complementar/contratos/:id/aditivos')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  registrarAditivo(@Param('id') ctr: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.registrarAditivo(
        s.porta,
        idDaRota(ctr),
        corpo(esquemaAditivo, b),
        this.trilha(s, 'operadora.aditivo.registrado', 'aditivo_contrato_plano'),
      ),
    );
  }

  @Post('operadora/complementar/aditivos/:id/assinar')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  assinarAditivo(@Param('id') a: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.assinarAditivo(
        s.porta,
        idDaRota(a),
        corpo(esquemaAssinatura, b).assinatura,
        this.trilha(s, 'operadora.aditivo.assinado', 'aditivo_contrato_plano'),
      ),
    );
  }

  @Get('operadora/complementar/contratos/:id/cancelamentos')
  @Permissao(LER)
  cancelamentos(@Param('id') ctr: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.cancelamentos(sessaoDe(req).porta, idDaRota(ctr)));
  }

  @Post('operadora/complementar/contratos/:id/cancelamentos')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  solicitarCancelamento(@Param('id') ctr: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.solicitarCancelamento(
        s.porta,
        idDaRota(ctr),
        corpo(esquemaCancelamento, b),
        this.trilha(s, 'operadora.cancelamento.solicitado', 'cancelamento_contrato_plano'),
      ),
    );
  }

  @Post('operadora/complementar/cancelamentos/:id/efetivar')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  efetivarCancelamento(@Param('id') k: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.efetivarCancelamento(
        s.porta,
        idDaRota(k),
        this.trilha(s, 'operadora.cancelamento.efetivado', 'cancelamento_contrato_plano'),
      ),
    );
  }

  @Post('operadora/complementar/cancelamentos/:id/desistir')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  desistirCancelamento(@Param('id') k: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.desistirCancelamento(
        s.porta,
        idDaRota(k),
        corpo(esquemaDesistencia, b).motivo,
        this.trilha(s, 'operadora.cancelamento.desistido', 'cancelamento_contrato_plano'),
      ),
    );
  }

  @Post('operadora/complementar/cancelamentos/efetivar-vencidos')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  efetivarCancelamentosVencidos(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.efetivarCancelamentosVencidos(
        s.porta,
        this.trilha(s, 'operadora.cancelamento.efetivado', 'cancelamento_contrato_plano'),
      ),
    );
  }

  @Get('operadora/complementar/produtos/:id/abrangencia')
  @Permissao(LER)
  abrangencia(@Param('id') p: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.abrangencia(sessaoDe(req).porta, idDaRota(p)));
  }

  @Post('operadora/complementar/produtos/:id/abrangencia')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  definirAbrangencia(@Param('id') p: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.definirAbrangencia(
        s.porta,
        idDaRota(p),
        corpo(esquemaAbrangencia, b).areas,
        this.trilha(s, 'operadora.abrangencia.definida', 'produto_plano'),
      ),
    );
  }

  @Get('operadora/complementar/beneficiarios/:id/carencias')
  @Permissao(LER)
  carencias(@Param('id') ben: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.carencias(sessaoDe(req).porta, idDaRota(ben)));
  }

  @Post('operadora/complementar/beneficiarios/:id/carencias')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  gerarCarencias(@Param('id') ben: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gerarCarencias(
        s.porta,
        idDaRota(ben),
        corpo(esquemaCarencias, b).aproveitamentoDias,
        this.trilha(s, 'operadora.carencia.gerada', 'beneficiario_plano'),
      ),
    );
  }

  @Get('operadora/complementar/beneficiarios/:id/cartoes')
  @Permissao(LER)
  pedidosCartao(@Param('id') ben: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.pedidosCartao(sessaoDe(req).porta, idDaRota(ben)));
  }

  @Post('operadora/complementar/beneficiarios/:id/cartoes')
  @HttpCode(201)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  solicitarCartao(@Param('id') ben: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.solicitarCartao(
        s.porta,
        idDaRota(ben),
        corpo(esquemaCartao, b),
        this.trilha(s, 'operadora.cartao.solicitado', 'solicitacao_cartao_beneficiario'),
      ),
    );
  }

  @Post('operadora/complementar/cartoes/:id/situacao')
  @HttpCode(200)
  @Permissao(EDITAR)
  @AuditadoNoHandler(AUD)
  avancarPedidoCartao(@Param('id') ped: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.avancarPedidoCartao(
        s.porta,
        idDaRota(ped),
        corpo(esquemaPassoCartao, b).para,
        this.trilha(s, 'operadora.cartao.avancado', 'solicitacao_cartao_beneficiario'),
      ),
    );
  }
}
