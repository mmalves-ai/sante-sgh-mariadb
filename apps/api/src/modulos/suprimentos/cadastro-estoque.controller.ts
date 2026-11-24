// Cadastro do estoque (F3.6, 05-SUP linhas 1, 3 e 6). Tudo ligado para todos: só a permissão do cargo controla.
//   GET  /api/suprimentos/cadastro/apoio                              grupos, subgrupos, unidades, vias, setores, centros e locais
//   GET  /api/suprimentos/cadastro/buscar/:tipo?termo=                princípios ativos, fabricantes ou usuários
//   GET  /api/suprimentos/cadastro/itens/:id                          a ficha do item para edição (com o saldo total)
//   POST /api/suprimentos/cadastro/itens                              incluir o item inteiro (identificação, unidades, filhos)
//   PUT  /api/suprimentos/cadastro/itens/:id                          alterar pela versão lida
//   POST /api/suprimentos/cadastro/itens/:id/situacao                 inativar (sem saldo) ou reativar, com motivo
//   GET  /api/suprimentos/cadastro/locais(/:id)                       os locais do estabelecimento e a ficha do local
//   POST /api/suprimentos/cadastro/locais · PUT locais/:id · POST locais/:id/situacao
//   GET  /api/suprimentos/cadastro/usuarios/:usuario                  o escopo do usuário (locais, classificações, centros)
//   PUT  /api/suprimentos/cadastro/usuarios/:usuario/locais/:local    conceder ou alterar as ações no local
//   POST /api/suprimentos/cadastro/usuarios/:usuario/locais/:local/retirar
//   POST /api/suprimentos/cadastro/usuarios/:usuario/classificacoes · centros-custo  conceder com vigência
//   POST /api/suprimentos/cadastro/concessoes/:tipo/:id/retirar       com motivo: encerra a que já valia, cancela a que começa hoje ou depois
//   GET  /api/suprimentos/cadastro/requisicoes/:id/separacao          a lista de separação da requisição a atender
// Cada gravação é uma operação do executor com a trilha na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  CONDICOES_ESTABILIDADE,
  PADROES_CODIGO_BARRAS,
  PERMISSOES_LOCAL_USUARIO,
  SITUACOES_REGISTRO_SANITARIO,
  TIPOS_ITEM_ESTOQUE,
  TIPOS_LOCAL_ESTOQUE,
} from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_CADASTRO_ESTOQUE, type PortaCadastroEstoque } from './cadastro-estoque-porta.js';

const id = z.number().int().positive();
const idOpc = id.nullable().optional();
const texto = (max: number) => z.string().max(max);
const qtd = z.number().min(0).max(999_999_999);
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const esquemaItem = z
  .object({
    codigo: texto(30),
    nome: texto(150),
    nomeResumido: texto(60).nullable().optional(),
    tipo: z.enum(TIPOS_ITEM_ESTOQUE),
    grupo: id,
    subgrupo: idOpc,
    unidadeEstoque: id,
    unidadeCompra: idOpc,
    fatorCompraEstoque: qtd,
    unidadeConsumo: idOpc,
    fatorEstoqueConsumo: qtd,
    unidadePrescricao: idOpc,
    fatorConsumoPrescricao: qtd,
    fabricante: idOpc,
    gtin: texto(14).nullable().optional(),
    ncm: texto(8).nullable().optional(),
    cest: texto(7).nullable().optional(),
    classeRisco: z.enum(['I', 'II', 'III', 'IV']).nullable().optional(),
    controlaLote: z.boolean(),
    controlaValidade: z.boolean(),
    controlado: z.boolean(),
    antimicrobiano: z.boolean(),
    altaVigilancia: z.boolean(),
    fracionavel: z.boolean(),
    prescritivel: z.boolean(),
    estoqueMinimo: qtd.nullable().optional(),
    estoqueMaximo: qtd.nullable().optional(),
    principiosAtivos: z
      .array(
        z
          .object({
            principio: id,
            concentracao: qtd.nullable().optional(),
            unidade: idOpc,
            principal: z.boolean().optional(),
          })
          .strict(),
      )
      .max(20),
    vias: z.array(z.object({ via: id, padrao: z.boolean().optional() }).strict()).max(20),
    codigosBarras: z
      .array(
        z
          .object({
            codigo: texto(60),
            padrao: z.enum(PADROES_CODIGO_BARRAS),
            quantidade: qtd,
            unidade: id,
            principal: z.boolean().optional(),
          })
          .strict(),
      )
      .max(30),
    apresentacoes: z
      .array(
        z
          .object({
            nomeComercial: texto(150),
            apresentacao: texto(150).nullable().optional(),
            fabricante: idOpc,
            quantidadeEmbalagem: qtd,
            registro: z
              .object({
                numero: texto(13),
                validade: data.nullable().optional(),
                situacao: z.enum(SITUACOES_REGISTRO_SANITARIO).optional(),
              })
              .strict()
              .nullable()
              .optional(),
          })
          .strict(),
      )
      .max(30),
    estabilidades: z
      .array(
        z
          .object({
            condicao: z.enum(CONDICOES_ESTABILIDADE),
            horas: qtd,
            horasInfusaoMaxima: qtd.nullable().optional(),
            condicaoArmazenamento: id.nullable().optional(),
            diluente: id.nullable().optional(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

const esquemaLocal = z
  .object({
    codigo: texto(30),
    nome: texto(150),
    tipo: z.enum(TIPOS_LOCAL_ESTOQUE),
    setor: idOpc,
    centroCusto: idOpc,
    localOrigem: idOpc,
    localDevolucao: idOpc,
    atendeSetor: z.boolean(),
    atendePaciente: z.boolean(),
    atendeTransferencia: z.boolean(),
    atendimentoParcial: z.boolean(),
    verificaSaldo: z.boolean(),
    usaCodigoBarras: z.boolean(),
    apenasUrgente: z.boolean(),
    tipoReposicao: z.enum(['manual', 'ponto_pedido', 'cota']).nullable().optional(),
    horasAntecedencia: z.number().int().min(0).max(65_535).nullable().optional(),
    setores: z
      .array(
        z
          .object({
            setor: id,
            tipo: z.enum(['requisicao', 'dispensacao', 'ambos']),
            padrao: z.boolean().optional(),
          })
          .strict(),
      )
      .max(100),
    classificacoes: z.array(z.object({ grupo: idOpc, subgrupo: idOpc, item: idOpc }).strict()).max(200),
  })
  .strict();

const comVersao = <T extends z.ZodRawShape>(o: z.ZodObject<T>) =>
  o.extend({ versao: z.number().int().positive() });
const esquemaSituacao = z
  .object({ versao: z.number().int().positive(), ativo: z.boolean(), motivo: texto(500) })
  .strict();
const esquemaEscopoLocal = z
  .object({
    permissoes: z.array(z.enum(PERMISSOES_LOCAL_USUARIO)).max(PERMISSOES_LOCAL_USUARIO.length),
    variacaoValorPct: z.number().min(0).max(100).nullable().optional(),
    padrao: z.boolean().optional(),
  })
  .strict();
const concessao = {
  inicio: data,
  fim: data.nullable().optional(),
  requisitar: z.boolean(),
  movimentar: z.boolean(),
};
const esquemaClassificacao = z
  .object({ ...concessao, comprar: z.boolean().optional(), grupo: id, subgrupo: idOpc })
  .strict();
const esquemaCentro = z.object({ ...concessao, centroCusto: id }).strict();

function idDaRota(v: string, campo = 'id'): number {
  const x = Number(v);
  if (!Number.isInteger(x) || x <= 0)
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Identificador inválido.', {
      campos: [campo],
    });
  return x;
}
const naoEncontrado = (o: string) => new ErroProblema('nao-encontrado', 404, `${o} não encontrado`);

@Controller('suprimentos/cadastro')
export class CadastroEstoqueController {
  constructor(@Inject(PORTA_CADASTRO_ESTOQUE) private readonly porta: PortaCadastroEstoque) {}

  @Get('apoio')
  @Permissao('suprimentos.item.ler')
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.porta.apoio(sessaoDe(req).porta);
  }

  @Get('buscar/:tipo')
  @Permissao('suprimentos.item.ler')
  buscar(
    @Param('tipo') tipo: string,
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    if (tipo !== 'principios' && tipo !== 'fabricantes' && tipo !== 'usuarios')
      throw naoEncontrado('Tipo de busca');
    if (tipo === 'usuarios' && !sessaoDe(req).pode('acesso.escopo.ler'))
      throw new ErroProblema('proibido', 403, 'Sem permissão', 'Consultar usuários exige acesso.escopo.ler.');
    return this.porta.buscar(sessaoDe(req).porta, tipo, (termo ?? '').trim().slice(0, 60));
  }

  @Get('itens/:id')
  @Permissao('suprimentos.item.ler')
  async item(@Param('id') v: string, @Req() req: RequisicaoAutorizada) {
    const f = await this.porta.fichaItem(sessaoDe(req).porta, idDaRota(v));
    if (!f) throw naoEncontrado('Item');
    return f;
  }

  @Post('itens')
  @HttpCode(201)
  @Permissao('suprimentos.item.editar')
  @AuditadoNoHandler('suprimentos.cadastro.incluirItem pelo executor (trilha na mesma transação)')
  incluirItem(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.incluirItem(sessaoDe(req).porta, corpo(esquemaItem, b));
  }

  @Put('itens/:id')
  @Permissao('suprimentos.item.editar')
  @AuditadoNoHandler('suprimentos.cadastro.alterarItem pelo executor (trilha na mesma transação)')
  alterarItem(@Param('id') v: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { versao, ...e } = corpo(comVersao(esquemaItem), b);
    return this.porta.alterarItem(sessaoDe(req).porta, idDaRota(v), versao, e);
  }

  @Post('itens/:id/situacao')
  @HttpCode(200)
  @Permissao('suprimentos.item.editar')
  @AuditadoNoHandler('suprimentos.cadastro.inativarItem/reativarItem pelo executor')
  situacaoItem(@Param('id') v: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSituacao, b);
    return this.porta.situacaoItem(sessaoDe(req).porta, idDaRota(v), e.versao, e.ativo, e.motivo);
  }

  @Get('locais')
  @Permissao('suprimentos.local.ler')
  locais(@Req() req: RequisicaoAutorizada) {
    return this.porta.locais(sessaoDe(req).porta);
  }

  @Get('locais/:id')
  @Permissao('suprimentos.local.ler')
  async local(@Param('id') v: string, @Req() req: RequisicaoAutorizada) {
    const f = await this.porta.fichaLocal(sessaoDe(req).porta, idDaRota(v));
    if (!f) throw naoEncontrado('Local');
    return f;
  }

  @Post('locais')
  @HttpCode(201)
  @Permissao('suprimentos.local.editar')
  @AuditadoNoHandler('suprimentos.cadastro.incluirLocal pelo executor')
  incluirLocal(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.incluirLocal(sessaoDe(req).porta, corpo(esquemaLocal, b));
  }

  @Put('locais/:id')
  @Permissao('suprimentos.local.editar')
  @AuditadoNoHandler('suprimentos.cadastro.alterarLocal pelo executor')
  alterarLocal(@Param('id') v: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const { versao, ...e } = corpo(comVersao(esquemaLocal), b);
    return this.porta.alterarLocal(sessaoDe(req).porta, idDaRota(v), versao, e);
  }

  @Post('locais/:id/situacao')
  @HttpCode(200)
  @Permissao('suprimentos.local.editar')
  @AuditadoNoHandler('suprimentos.cadastro.inativarLocal/reativarLocal pelo executor')
  situacaoLocal(@Param('id') v: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSituacao, b);
    return this.porta.situacaoLocal(sessaoDe(req).porta, idDaRota(v), e.versao, e.ativo, e.motivo);
  }

  @Get('usuarios/:usuario')
  @Permissao('acesso.escopo.ler')
  async escopo(@Param('usuario') v: string, @Req() req: RequisicaoAutorizada) {
    const e = await this.porta.escopoUsuario(sessaoDe(req).porta, idDaRota(v, 'usuario'));
    if (!e) throw naoEncontrado('Usuário');
    return e;
  }

  @Put('usuarios/:usuario/locais/:local')
  @Permissao('acesso.escopo.editar')
  @AuditadoNoHandler('suprimentos.cadastro.escopoLocal pelo executor')
  gravarEscopoLocal(
    @Param('usuario') u: string,
    @Param('local') l: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.porta.gravarEscopoLocal(
      sessaoDe(req).porta,
      idDaRota(u, 'usuario'),
      idDaRota(l, 'local'),
      corpo(esquemaEscopoLocal, b),
    );
  }

  @Post('usuarios/:usuario/locais/:local/retirar')
  @HttpCode(200)
  @Permissao('acesso.escopo.editar')
  @AuditadoNoHandler('suprimentos.cadastro.retirarEscopoLocal pelo executor')
  retirarEscopoLocal(
    @Param('usuario') u: string,
    @Param('local') l: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.porta.retirarEscopoLocal(sessaoDe(req).porta, idDaRota(u, 'usuario'), idDaRota(l, 'local'));
  }

  @Post('usuarios/:usuario/classificacoes')
  @HttpCode(201)
  @Permissao('acesso.escopo.editar')
  @AuditadoNoHandler('suprimentos.cadastro.concederClassificacao pelo executor')
  concederClassificacao(@Param('usuario') u: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.concederClassificacao(
      sessaoDe(req).porta,
      idDaRota(u, 'usuario'),
      corpo(esquemaClassificacao, b),
    );
  }

  @Post('usuarios/:usuario/centros-custo')
  @HttpCode(201)
  @Permissao('acesso.escopo.editar')
  @AuditadoNoHandler('suprimentos.cadastro.concederCentroCusto pelo executor')
  concederCentro(@Param('usuario') u: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.porta.concederCentroCusto(
      sessaoDe(req).porta,
      idDaRota(u, 'usuario'),
      corpo(esquemaCentro, b),
    );
  }

  @Post('concessoes/:tipo/:id/retirar')
  @HttpCode(200)
  @Permissao('acesso.escopo.editar')
  @AuditadoNoHandler('suprimentos.cadastro.retirarConcessao pelo executor')
  retirarConcessao(
    @Param('tipo') tipo: string,
    @Param('id') v: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    if (tipo !== 'classificacao' && tipo !== 'centro-custo') throw naoEncontrado('Tipo de concessão');
    const e = corpo(z.object({ motivo: texto(500) }).strict(), b ?? {});
    return this.porta.retirarConcessao(sessaoDe(req).porta, tipo, idDaRota(v), e.motivo);
  }

  @Get('requisicoes/:id/separacao')
  @Permissao('suprimentos.requisicao.ler')
  async separacao(@Param('id') v: string, @Req() req: RequisicaoAutorizada) {
    const s = await this.porta.separacao(sessaoDe(req).porta, idDaRota(v));
    if (!s) throw naoEncontrado('Requisição');
    return s;
  }
}
