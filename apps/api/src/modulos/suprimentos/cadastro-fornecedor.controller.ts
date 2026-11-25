// Cadastro do fornecedor, avaliação periódica e ocorrências (05-SUP linha 23):
//   GET  /api/suprimentos/cadastro-fornecedor                       categorias e bancos para a tela
//   GET  /api/suprimentos/cadastro-fornecedor/busca?termo=          fornecedores pelo nome, fantasia ou documento
//   GET  /api/suprimentos/cadastro-fornecedor/:id                   a ficha: dados, contatos, categorias, autorizações,
//        contas (mascaradas), avaliações, ocorrências e avisos do dia
//   POST /api/suprimentos/cadastro-fornecedor                       inclui o fornecedor
//   POST /api/suprimentos/cadastro-fornecedor/:id/alteracao         altera (versão conferida)
//   POST /api/suprimentos/cadastro-fornecedor/:id/contas            inclui conta bancária ou chave Pix
//   POST /api/suprimentos/cadastro-fornecedor/:id/contas/:conta/inativacao   inativa a conta (nada apagado)
//   POST /api/suprimentos/cadastro-fornecedor/:id/avaliacoes        avaliação periódica (regra do contrato)
//   POST /api/suprimentos/cadastro-fornecedor/:id/ocorrencias       registra a ocorrência
//   POST /api/suprimentos/cadastro-fornecedor/ocorrencias/:oc/andamento   notifica, trata, resolve ou cancela
// Ler pede suprimentos.fornecedor.ler; cadastrar, contas e ocorrências, suprimentos.fornecedor.editar; avaliar,
// suprimentos.contrato.avaliar (avaliar e qualificar o fornecedor). A gravação exige a Idempotency-Key.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { PERMISSOES_CONTRATO_CODIGOS as PC } from '@sgh/contratos';
import {
  DISPONIBILIDADES_FORNECEDOR,
  FINALIDADES_CONTATO_FORNECEDOR,
  GRAVIDADES_OCORRENCIA,
  SITUACOES_AUTORIZACAO_FORNECEDOR,
  SITUACOES_FORNECEDOR,
  SITUACOES_OCORRENCIA_FORNECEDOR,
  TIPOS_AUTORIZACAO_FORNECEDOR,
  TIPOS_CHAVE_PIX,
  TIPOS_CONTA_CREDOR,
  TIPOS_OCORRENCIA_FORNECEDOR,
} from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_CADASTRO_FORNECEDOR, type PortaCadastroFornecedor } from './cadastro-fornecedor.js';

const P = { ler: 'suprimentos.fornecedor.ler', editar: 'suprimentos.fornecedor.editar' } as const;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DATA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const id_ = z.number().int().positive();
const texto = (max: number) => z.string().trim().max(max).nullable().default(null);

export const esquemaFornecedor = z
  .object({
    tipoPessoa: z.enum(['juridica', 'fisica']),
    documento: z.string().trim().min(11).max(20),
    razaoSocial: z.string().trim().min(1).max(250),
    nomeFantasia: texto(150),
    inscricaoEstadual: texto(20),
    inscricaoMunicipal: texto(20),
    optanteSimples: z.boolean().default(false),
    contribuinteIcms: z.boolean().default(false),
    cep: texto(9),
    logradouro: texto(150),
    numeroEndereco: texto(20),
    complemento: texto(60),
    bairro: texto(100),
    email: texto(254),
    site: texto(200),
    numeroCnes: texto(7),
    prazoEntregaDias: z.number().int().min(0).max(3650).nullable().default(null),
    diasValidadeAvaliacao: z.number().int().min(1).max(3650).nullable().default(null),
    forneceOpme: z.boolean().default(false),
    transportadora: z.boolean().default(false),
    prestadorServico: z.boolean().default(false),
    disponibilidade: z.enum(DISPONIBILIDADES_FORNECEDOR).default('comercial'),
    situacao: z.enum(SITUACOES_FORNECEDOR).default('ativo'),
    motivoSituacao: texto(500),
    observacao: texto(4000),
    categorias: z.array(id_).max(30).default([]),
    categoriaPrincipal: id_.nullable().default(null),
    contatos: z
      .array(
        z
          .object({
            id: id_.nullable().default(null),
            finalidade: z.enum(FINALIDADES_CONTATO_FORNECEDOR),
            nome: texto(150),
            cargo: texto(60),
            telefone: texto(20),
            ramal: texto(10),
            email: texto(254),
            principal: z.boolean().default(false),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    autorizacoes: z
      .array(
        z
          .object({
            id: id_.nullable().default(null),
            tipo: z.enum(TIPOS_AUTORIZACAO_FORNECEDOR),
            numero: z.string().trim().max(50),
            orgaoEmissor: texto(100),
            emitidoEm: z.string().regex(DATA).nullable().default(null),
            validoAte: z.string().regex(DATA).nullable().default(null),
            diasAviso: z.number().int().min(0).max(365).default(30),
            bloqueiaCompraVencido: z.boolean().default(true),
            situacao: z.enum(SITUACOES_AUTORIZACAO_FORNECEDOR).default('valido'),
          })
          .strict(),
      )
      .max(30)
      .default([]),
  })
  .strict();

const esquemaAlteracao = z.object({ versao: id_, fornecedor: esquemaFornecedor }).strict();

export const esquemaConta = z
  .object({
    banco: id_.nullable().default(null),
    tipoConta: z.enum(TIPOS_CONTA_CREDOR).default('corrente'),
    agencia: texto(10),
    digitoAgencia: texto(2),
    conta: texto(20),
    digitoConta: texto(2),
    tipoChavePix: z.enum(TIPOS_CHAVE_PIX).nullable().default(null),
    chavePix: texto(77),
    titularNome: z.string().trim().min(1).max(150),
    titularDocumento: z.string().trim().min(11).max(20),
    preferencial: z.boolean().default(false),
  })
  .strict();

const nota = z.number().int().min(1).max(5);
export const esquemaAvaliacao = z
  .object({
    avaliadoEm: z.string().regex(DATA),
    periodoInicio: z.string().regex(DATA).nullable().default(null),
    periodoFim: z.string().regex(DATA).nullable().default(null),
    notas: z.object({ qualidade: nota, prazo: nota, atendimento: nota, documentacao: nota }).strict(),
    parecer: texto(4000),
  })
  .strict();

export const esquemaOcorrencia = z
  .object({
    tipo: z.enum(TIPOS_OCORRENCIA_FORNECEDOR),
    gravidade: z.enum(GRAVIDADES_OCORRENCIA).default('media'),
    ocorridoEm: z.string().regex(DATA_HORA),
    quantidadeAfetada: z.number().positive().max(1e9).nullable().default(null),
    valorAfetado: z.number().min(0).max(1e12).nullable().default(null),
    descricao: z.string().trim().min(1).max(2000),
  })
  .strict();

export const esquemaAndamento = z
  .object({
    situacao: z.enum(SITUACOES_OCORRENCIA_FORNECEDOR),
    tratativa: texto(2000),
    email: texto(254),
    versao: id_,
  })
  .strict();

const esquemaVersao = z.object({ versao: id_ }).strict();

function chaveDe(req: RequisicaoAutorizada): string {
  const bruto = req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'A Idempotency-Key do pedido falta ou é inválida.',
    );
  return k;
}

function idDe(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new ErroProblema(
      'nao-encontrado',
      404,
      'Não encontrado',
      'O fornecedor, a conta ou a ocorrência não existe.',
    );
  return n;
}

@Controller('suprimentos/cadastro-fornecedor')
export class CadastroFornecedorController {
  constructor(@Inject(PORTA_CADASTRO_FORNECEDOR) private readonly porta: PortaCadastroFornecedor) {}

  @Get()
  @Permissao(P.ler)
  async painel(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return {
      ...(await this.porta.painel(s.porta)),
      pode: { editar: s.pode(P.editar), avaliar: s.pode(PC.avaliar) },
    };
  }

  @Get('busca')
  @Permissao(P.ler)
  async busca(@Query('termo') termo: string | undefined, @Req() req: RequisicaoAutorizada) {
    return { itens: await this.porta.buscar(sessaoDe(req).porta, (termo ?? '').slice(0, 60)) };
  }

  @Get(':id')
  @Permissao(P.ler)
  ficha(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.ficha(sessaoDe(req).porta, idDe(id));
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.fornecedor.incluir pelo executor (trilha na mesma transação)')
  async incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaFornecedor, b);
    const r = await this.porta.incluir(sessaoDe(req).porta, e, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Fornecedor incluído.' };
  }

  @Post(':id/alteracao')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.fornecedor.alterar pelo executor (trilha na mesma transação)')
  async alterar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAlteracao, b);
    const r = await this.porta.alterar(sessaoDe(req).porta, idDe(id), e.versao, e.fornecedor, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Fornecedor alterado.' };
  }

  @Post(':id/contas')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.fornecedor.incluir-conta pelo executor (trilha na mesma transação)')
  async incluirConta(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaConta, b);
    const r = await this.porta.incluirConta(sessaoDe(req).porta, idDe(id), e, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Conta incluída: o financeiro já a usa no pagamento.' };
  }

  @Post(':id/contas/:conta/inativacao')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.fornecedor.inativar-conta pelo executor (trilha na mesma transação)')
  async inativarConta(
    @Param('id') id: string,
    @Param('conta') conta: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const e = corpo(esquemaVersao, b);
    const r = await this.porta.inativarConta(
      sessaoDe(req).porta,
      idDe(id),
      idDe(conta),
      e.versao,
      chaveDe(req),
    );
    return { ok: true, ...r, mensagem: 'Conta inativada: fica no histórico dos pagamentos.' };
  }

  @Post(':id/avaliacoes')
  @HttpCode(201)
  @Permissao(PC.avaliar)
  @AuditadoNoHandler('suprimentos.fornecedor.avaliar pelo executor (trilha na mesma transação)')
  async avaliar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAvaliacao, b);
    const r = await this.porta.avaliar(sessaoDe(req).porta, idDe(id), e, chaveDe(req));
    return { ok: true, ...r, mensagem: `Avaliação gravada: ${r.conta} (${r.resultado}).` };
  }

  @Post(':id/ocorrencias')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.fornecedor.registrar-ocorrencia pelo executor (trilha na mesma transação)')
  async ocorrencia(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaOcorrencia, b);
    const r = await this.porta.registrarOcorrencia(sessaoDe(req).porta, idDe(id), e, chaveDe(req));
    return { ok: true, ...r, mensagem: `Ocorrência ${r.numero} registrada.` };
  }

  @Post('ocorrencias/:oc/andamento')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.fornecedor.andamento-ocorrencia pelo executor (trilha na mesma transação)')
  async andamento(@Param('oc') oc: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAndamento, b);
    const r = await this.porta.andamentoOcorrencia(sessaoDe(req).porta, idDe(oc), e, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Andamento da ocorrência gravado.' };
  }
}
