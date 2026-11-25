// Rotas do comercial da operadora (08-SGO L100, C2-095; F8): força de venda, regra de comissão, proposta de adesão,
// metas, campanhas de desconto e lote de comissão com estorno. Ler com operadora.comercial.ler; cadastrar, propor e
// mudar a proposta com operadora.comercial.registrar; apurar, fechar, pagar e cancelar o lote com
// operadora.comissao.apurar:
//   GET  operadora/comercial/:op                          painel (força de venda, regras, propostas, metas, campanhas, lotes)
//   POST operadora/comercial/:op/corretoras               inclui corretora, administradora ou unidade de venda
//   POST operadora/comercial/:op/vendedores               inclui vendedor
//   POST operadora/comercial/:op/equipes                  inclui equipe com os membros
//   POST operadora/comercial/:op/regras                   inclui regra de comissão com as faixas de parcelas
//   POST operadora/comercial/:op/propostas                inclui proposta de adesão (rascunho) com os proponentes
//   GET  operadora/comercial/propostas/:id                proposta com os proponentes
//   POST operadora/comercial/propostas/:id/situacao       envia, analisa, pede documento, aprova, recusa, cancela, efetiva
//   POST operadora/comercial/:op/metas                    inclui meta com as faixas de prêmio
//   GET  operadora/comercial/metas/:id/apuracao           realizado, atingido e faixa de prêmio
//   POST operadora/comercial/:op/campanhas                inclui campanha com descontos e participantes
//   POST operadora/comercial/campanhas/:id/situacao       ativa, encerra ou cancela
//   POST operadora/comercial/:op/comissoes                apura o lote (parcelas pagas, pendências e estornos)
//   GET  operadora/comercial/comissoes/:id/itens          itens do lote
//   POST operadora/comercial/comissoes/:id/situacao       fecha, reabre, paga ou cancela
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import {
  MEDIDAS_META,
  SITUACOES_CAMPANHA,
  SITUACOES_COMISSAO,
  SITUACOES_PROPOSTA,
  TIPOS_PROPONENTE,
} from '@sgh/dominio-operadora';
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
import { type Gravado, PORTA_COMERCIAL, type PortaComercialPropria } from './comercial-propria.js';

const LER = 'operadora.comercial.ler';
const REGISTRAR = 'operadora.comercial.registrar';
const APURAR = 'operadora.comissao.apurar';
const AUD = 'operadora.comercial.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();
const idN = id.nullable();
const versao = z.number().int().positive();
const txt = (max: number) => z.string().max(max).nullable();
const esquemaCorretora = z.object({
  codigo: z.string().min(1).max(30),
  nome: z.string().min(1).max(150),
  tipo: z.enum(['corretora', 'unidade_venda', 'administradora', 'venda_propria']),
  cnpj: z
    .string()
    .regex(/^\d{14}$/)
    .nullable(),
  corretoraPai: idN,
  registroSusep: txt(30),
  email: z.string().email().max(254).nullable(),
});
const esquemaVendedor = z.object({
  codigo: z.string().min(1).max(30),
  nome: z.string().min(1).max(150),
  cpf: z.string().regex(/^\d{11}$/),
  corretora: idN,
  email: z.string().email().max(254).nullable(),
});
const esquemaEquipe = z.object({
  codigo: z.string().min(1).max(30),
  nome: z.string().min(1).max(150),
  corretora: idN,
  chefe: idN,
  membros: z.array(z.object({ vendedor: id, inicio: data })).max(200),
});
const esquemaParcela = z.object({
  parcelaInicial: z.number().int().min(1).max(999),
  parcelaFinal: z.number().int().min(1).max(999).nullable(),
  tipo: z.enum(['percentual', 'valor']),
  percentual: z.number().min(0).max(100).nullable(),
  valor: z.number().min(0).nullable(),
  desconto: z.number().min(0).nullable(),
  vigenciaInicio: data,
});
const esquemaRegra = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(150),
  incidencia: id,
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  corretora: idN,
  equipe: idN,
  vendedor: idN,
  plano: idN,
  parcelas: z.array(esquemaParcela).max(50),
});
const esquemaProponente = z.object({
  sequencia: z.number().int().min(1).max(999),
  tipo: z.enum(TIPOS_PROPONENTE),
  titularSequencia: z.number().int().min(1).nullable(),
  parentesco: idN,
  nome: z.string().max(150),
  nascimento: data,
  sexo: z.string().length(1),
  cpf: z
    .string()
    .regex(/^\d{11}$/)
    .nullable(),
  cns: z
    .string()
    .regex(/^\d{15}$/)
    .nullable(),
  nomeMae: txt(150),
});
const esquemaProposta = z.object({
  propostaEm: data,
  plano: id,
  contrato: idN,
  contratante: idN,
  vendedor: idN,
  corretora: idN,
  equipe: idN,
  diaVencimento: z.number().int().min(1).max(31).nullable(),
  observacao: txt(2000),
  proponentes: z.array(esquemaProponente).max(200),
});
const esquemaMudancaProposta = z.object({
  versao,
  para: z.enum(SITUACOES_PROPOSTA),
  motivo: txt(500),
  contrato: idN,
});
const esquemaMeta = z.object({
  descricao: z.string().max(150),
  medida: z.enum(MEDIDAS_META),
  inicio: data,
  fim: data,
  equipe: idN,
  vendedor: idN,
  corretora: idN,
  valorMeta: z.number().nullable(),
  faixas: z
    .array(
      z.object({
        de: z.number(),
        ate: z.number().nullable(),
        percentualPremio: z.number().nullable(),
        valorPremio: z.number().min(0).nullable(),
      }),
    )
    .max(50),
});
const esquemaCampanha = z.object({
  codigo: z.string().max(30),
  descricao: z.string().max(250),
  inicio: data,
  fim: data.nullable(),
  regra: idN,
  condicoes: txt(4000),
  descontos: z
    .array(
      z.object({
        parcela: z.number().int(),
        percentual: z.number().nullable(),
        valor: z.number().nullable(),
      }),
    )
    .max(60),
  participantes: z.array(z.object({ corretora: idN, equipe: idN, vendedor: idN })).max(200),
});
const esquemaMudancaCampanha = z.object({ versao, para: z.enum(SITUACOES_CAMPANHA) });
const esquemaApuracao = z.object({
  descricao: txt(150),
  regra: id,
  corretora: idN,
  equipe: idN,
  vendedor: idN,
  pagamentoInicio: data,
  pagamentoFim: data,
  prazoEstornoDias: z.number().int().min(0).max(1095),
  aliquotaIrrf: z.number().min(0).max(30),
  aliquotaIss: z.number().min(0).max(5),
});
const esquemaMudancaComissao = z.object({ versao, para: z.enum(SITUACOES_COMISSAO), motivo: txt(150) });

@Controller()
export class ComercialOperadoraController {
  constructor(@Inject(PORTA_COMERCIAL) private readonly porta: PortaComercialPropria) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.comercial', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/comercial/:op')
  @Permissao(LER)
  painel(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.painel(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/comercial/:op/corretoras')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  corretora(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarCorretora(
        s.porta,
        idDaRota(op),
        corpo(esquemaCorretora, b),
        this.trilha(s, 'operadora.comercial.corretora-incluida', 'corretora_venda'),
      ),
    );
  }

  @Post('operadora/comercial/:op/vendedores')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  vendedor(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarVendedor(
        s.porta,
        idDaRota(op),
        corpo(esquemaVendedor, b),
        this.trilha(s, 'operadora.comercial.vendedor-incluido', 'vendedor_plano'),
      ),
    );
  }

  @Post('operadora/comercial/:op/equipes')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  equipe(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarEquipe(
        s.porta,
        idDaRota(op),
        corpo(esquemaEquipe, b),
        this.trilha(s, 'operadora.comercial.equipe-incluida', 'equipe_venda'),
      ),
    );
  }

  @Post('operadora/comercial/:op/regras')
  @HttpCode(201)
  @Permissao(APURAR)
  @AuditadoNoHandler(AUD)
  regra(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarRegra(
        s.porta,
        idDaRota(op),
        corpo(esquemaRegra, b),
        this.trilha(s, 'operadora.comercial.regra-incluida', 'regra_comissao_venda'),
      ),
    );
  }

  @Post('operadora/comercial/:op/propostas')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  incluirProposta(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.incluirProposta(
        s.porta,
        idDaRota(op),
        corpo(esquemaProposta, b),
        this.trilha(s, 'operadora.comercial.proposta-incluida', 'proposta_adesao'),
      ),
    );
  }

  @Get('operadora/comercial/propostas/:id')
  @Permissao(LER)
  proposta(@Param('id') i: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.proposta(sessaoDe(req).porta, idDaRota(i)));
  }

  @Post('operadora/comercial/propostas/:id/situacao')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  mudarProposta(@Param('id') i: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.mudarProposta(
        s.porta,
        idDaRota(i),
        corpo(esquemaMudancaProposta, b),
        this.trilha(s, 'operadora.comercial.proposta-situacao', 'proposta_adesao'),
      ),
    );
  }

  @Post('operadora/comercial/:op/metas')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  meta(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarMeta(
        s.porta,
        idDaRota(op),
        corpo(esquemaMeta, b),
        this.trilha(s, 'operadora.comercial.meta-incluida', 'meta_venda'),
      ),
    );
  }

  @Get('operadora/comercial/metas/:id/apuracao')
  @Permissao(LER)
  apurarMeta(@Param('id') i: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.apurarMeta(sessaoDe(req).porta, idDaRota(i)));
  }

  @Post('operadora/comercial/:op/campanhas')
  @HttpCode(201)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  campanha(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarCampanha(
        s.porta,
        idDaRota(op),
        corpo(esquemaCampanha, b),
        this.trilha(s, 'operadora.comercial.campanha-incluida', 'campanha_comercial_plano'),
      ),
    );
  }

  @Post('operadora/comercial/campanhas/:id/situacao')
  @HttpCode(200)
  @Permissao(REGISTRAR)
  @AuditadoNoHandler(AUD)
  mudarCampanha(@Param('id') i: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.mudarCampanha(
        s.porta,
        idDaRota(i),
        corpo(esquemaMudancaCampanha, b),
        this.trilha(s, 'operadora.comercial.campanha-situacao', 'campanha_comercial_plano'),
      ),
    );
  }

  @Post('operadora/comercial/:op/comissoes')
  @HttpCode(201)
  @Permissao(APURAR)
  @AuditadoNoHandler(AUD)
  apurarComissao(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.apurarComissao(
        s.porta,
        idDaRota(op),
        corpo(esquemaApuracao, b),
        this.trilha(s, 'operadora.comercial.comissao-apurada', 'comissao_venda'),
      ),
    );
  }

  @Get('operadora/comercial/comissoes/:id/itens')
  @Permissao(LER)
  itensComissao(@Param('id') i: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.itensComissao(sessaoDe(req).porta, idDaRota(i)));
  }

  @Post('operadora/comercial/comissoes/:id/situacao')
  @HttpCode(200)
  @Permissao(APURAR)
  @AuditadoNoHandler(AUD)
  mudarComissao(@Param('id') i: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.mudarComissao(
        s.porta,
        idDaRota(i),
        corpo(esquemaMudancaComissao, b),
        this.trilha(s, 'operadora.comercial.comissao-situacao', 'comissao_venda'),
      ),
    );
  }
}
