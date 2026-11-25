// Rotas do reembolso ao beneficiário (08-SGO linha 106, C2-047; F7): o pedido com os comprovantes, a tabela de
// referência por município, a regra do plano, a análise com glosa por item e o pagamento (crédito na conta corrente do
// beneficiário). Ler com operadora.reembolso.ler; o pedido e os comprovantes com operadora.reembolso.registrar; tabela,
// regra e análise com operadora.reembolso.analisar; pagar e cancelar com operadora.reembolso.pagar:
//   GET  operadora/reembolsos/apoio                         operadoras, modalidades e motivos de glosa
//   GET  operadora/reembolsos/busca/:alvo?termo=            beneficiários, procedimentos ou municípios
//   GET  operadora/reembolsos?situacao=                     a fila do estabelecimento (prazo e atraso)
//   GET  operadora/reembolsos/beneficiario/:id              visão por beneficiário (pedidos e total no ano)
//   GET  operadora/reembolsos/:id                           o pedido com itens, glosas e comprovantes
//   GET  operadora/reembolsos/:id/comprovantes/:arquivo     o conteúdo do comprovante
//   POST operadora/reembolsos                               inclui o pedido com os comprovantes
//   POST operadora/reembolsos/:id/comprovantes              anexa um comprovante
//   POST operadora/reembolsos/:id/analise                   pendência de documento ou conclusão com glosas
//   POST operadora/reembolsos/:id/pagamento                 paga o aprovado
//   POST operadora/reembolsos/:id/cancelamento              cancela o não pago, com motivo
//   GET/POST operadora/reembolsos-tabelas/:op               tabelas de referência da operadora
//   GET/POST operadora/reembolsos-regras/:op                regras de reembolso dos planos
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { CANAIS_REEMBOLSO, SITUACOES_REEMBOLSO } from '@sgh/dominio-operadora';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import {
  idDaRota,
  linhaTrilha,
  problemaDoCadastro,
  type SessaoCadastro,
  sessaoDe,
} from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { type Gravado, PORTA_REEMBOLSO, type PortaReembolsoPropria } from './reembolso-propria.js';

const LER = 'operadora.reembolso.ler';
const REGISTRAR = 'operadora.reembolso.registrar';
const ANALISAR = 'operadora.reembolso.analisar';
const PAGAR = 'operadora.reembolso.pagar';
const AUD = 'operadora.reembolso gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const valor = z.number().min(0).max(99_999_999);
const anexo = z.object({
  nome: z.string().min(1).max(255),
  tipoMime: z.string().max(127),
  base64: z.string().min(4).max(7_000_000),
});
const esquemaPedido = z.object({
  beneficiario: id,
  canal: z.enum(CANAIS_REEMBOLSO),
  modalidade: id.nullable(),
  municipio: id.nullable(),
  prestadorNome: z.string().max(150),
  prestadorDocumento: z.string().max(18),
  dataAtendimento: data,
  dataAlta: data.nullable(),
  numeroDocumentoFiscal: z.string().max(100).nullable(),
  observacao: z.string().max(2000).nullable(),
  itens: z
    .array(
      z.object({
        procedimento: id,
        quantidade: z.number().positive().max(9999),
        valorApresentado: valor,
        dataRealizacao: data.nullable(),
      }),
    )
    .max(100),
  anexos: z.array(anexo).max(10),
});
const esquemaTabela = z.object({
  codigo: z.string().min(1).max(30),
  nome: z.string().min(1).max(150),
  produto: id.nullable(),
  municipio: id.nullable(),
  modalidade: id.nullable(),
  fator: z.number().positive().nullable(),
  padrao: z.boolean(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  itens: z
    .array(z.object({ procedimento: id, valor, quantidadeMaxima: z.number().int().positive().nullable() }))
    .min(1)
    .max(2000),
});
const esquemaRegra = z.object({
  plano: id,
  modalidade: id.nullable(),
  tabela: id.nullable(),
  multiplicador: z.number(),
  percentual: z.number().nullable(),
  livreEscolha: z.boolean(),
  limitePorEvento: z.number().nullable(),
  limiteAnual: z.number().nullable(),
  prazoPagamentoDias: z.number().int(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
});
const esquemaAnalise = z.object({
  versao: id,
  decisao: z.enum(['concluir', 'pendente_documento']),
  observacao: z.string().max(2000).nullable(),
  itens: z
    .array(
      z.object({
        item: id,
        coparticipacao: valor,
        glosas: z
          .array(z.object({ motivo: id, valor, justificativa: z.string().max(1000).nullable() }))
          .max(20),
      }),
    )
    .max(100),
});
const esquemaAnexo = z.object({ versao: id, anexo });
const esquemaPagamento = z.object({ versao: id, pagoEm: data });
const esquemaCancelamento = z.object({ versao: id, motivo: z.string().min(1).max(500) });
const alvos = z.enum(['beneficiarios', 'procedimentos', 'municipios']);

@Controller()
export class ReembolsoOperadoraController {
  constructor(@Inject(PORTA_REEMBOLSO) private readonly porta: PortaReembolsoPropria) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.reembolso', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/reembolsos/apoio')
  @Permissao(LER)
  apoio(@Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.apoio(sessaoDe(req).porta));
  }

  @Get('operadora/reembolsos/busca/:alvo')
  @Permissao(LER)
  buscar(
    @Param('alvo') alvo: string,
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    return this.ok(this.porta.buscar(sessaoDe(req).porta, corpo(alvos, alvo), String(termo ?? '')));
  }

  @Get('operadora/reembolsos')
  @Permissao(LER)
  fila(@Query('situacao') situacao: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = situacao ? corpo(z.enum(SITUACOES_REEMBOLSO), situacao) : null;
    return this.ok(this.porta.fila(sessaoDe(req).porta, s));
  }

  @Get('operadora/reembolsos/beneficiario/:id')
  @Permissao(LER)
  doBeneficiario(@Param('id') n: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.doBeneficiario(sessaoDe(req).porta, idDaRota(n)));
  }

  @Get('operadora/reembolsos/:id')
  @Permissao(LER)
  pedido(@Param('id') n: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.pedido(sessaoDe(req).porta, idDaRota(n)));
  }

  @Get('operadora/reembolsos/:id/comprovantes/:arquivo')
  @Permissao(LER)
  comprovante(@Param('id') n: string, @Param('arquivo') a: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.comprovante(sessaoDe(req).porta, idDaRota(n), idDaRota(a)));
  }

  @Post('operadora/reembolsos')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirPedido(
        s.porta,
        corpo(esquemaPedido, b),
        this.trilha(s, 'operadora.reembolso.pedido-incluido', 'pedido_reembolso'),
      ),
    );
  }

  @Post('operadora/reembolsos/:id/comprovantes')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  anexar(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaAnexo, b);
    return this.ok(
      this.porta.anexar(
        s.porta,
        idDaRota(n),
        e.versao,
        e.anexo,
        this.trilha(s, 'operadora.reembolso.comprovante-anexado', 'pedido_reembolso'),
      ),
    );
  }

  @Post('operadora/reembolsos/:id/analise')
  @HttpCode(200)
  @Permissao(ANALISAR)
  @AuditadoNoHandler(AUD)
  analisar(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.analisar(
        s.porta,
        idDaRota(n),
        corpo(esquemaAnalise, b),
        this.trilha(s, 'operadora.reembolso.pedido-analisado', 'pedido_reembolso'),
      ),
    );
  }

  @Post('operadora/reembolsos/:id/pagamento')
  @HttpCode(200)
  @Permissao(PAGAR)
  @AuditadoNoHandler(AUD)
  pagar(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.pagar(
        s.porta,
        idDaRota(n),
        corpo(esquemaPagamento, b),
        this.trilha(s, 'operadora.reembolso.pedido-pago', 'pedido_reembolso'),
      ),
    );
  }

  @Post('operadora/reembolsos/:id/cancelamento')
  @HttpCode(200)
  @Permissao(PAGAR)
  @AuditadoNoHandler(AUD)
  cancelar(@Param('id') n: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.cancelar(
        s.porta,
        idDaRota(n),
        corpo(esquemaCancelamento, b),
        this.trilha(s, 'operadora.reembolso.pedido-cancelado', 'pedido_reembolso'),
      ),
    );
  }

  @Get('operadora/reembolsos-tabelas/:op')
  @Permissao(LER)
  tabelas(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.tabelas(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/reembolsos-tabelas/:op')
  @HttpCode(201)
  @Permissao(ANALISAR)
  @AuditadoNoHandler(AUD)
  incluirTabela(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirTabela(
        s.porta,
        idDaRota(op),
        corpo(esquemaTabela, b),
        this.trilha(s, 'operadora.reembolso.tabela-incluida', 'tabela_reembolso_referencia'),
      ),
    );
  }

  @Get('operadora/reembolsos-regras/:op')
  @Permissao(LER)
  regras(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.regras(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/reembolsos-regras/:op')
  @HttpCode(201)
  @Permissao(ANALISAR)
  @AuditadoNoHandler(AUD)
  incluirRegra(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirRegra(
        s.porta,
        idDaRota(op),
        corpo(esquemaRegra, b),
        this.trilha(s, 'operadora.reembolso.regra-incluida', 'regra_reembolso_plano'),
      ),
    );
  }
}
