// Rotas do reajuste da operadora além do anual digitado (08-SGO L96, C1-086; F7): índice com vigência (o teto da ANS que
// a conferência do reajuste anual usa), regra por sinistralidade com faixas, agrupamento do coletivo pequeno (RN ANS
// 565/2022) e reajuste do coletivo grande pela sinistralidade. Ler com operadora.cobranca.ler, gravar com
// operadora.cobranca.gerar (as mesmas do reajuste anual):
//   GET  operadora/reajustes-coletivos/indices                          índices com vigência
//   POST operadora/reajustes-coletivos/indices                          inclui um índice
//   GET  operadora/reajustes-coletivos/:op/regras                       regras por sinistralidade
//   POST operadora/reajustes-coletivos/:op/regras                       inclui uma regra com as faixas
//   GET  operadora/reajustes-coletivos/:op/contratos                    contratos coletivos com as vidas
//   GET  operadora/reajustes-coletivos/:op/agrupamentos                 agrupamentos do período
//   POST operadora/reajustes-coletivos/:op/agrupamentos                 cria e inclui os contratos elegíveis
//   GET  operadora/reajustes-coletivos/agrupamentos/:id/contratos       contratos do agrupamento
//   POST operadora/reajustes-coletivos/agrupamentos/:id/calculo         percentual único (regra ou informado)
//   POST operadora/reajustes-coletivos/agrupamentos/:id/aplicacao       aplica aos aniversariantes da competência
//   POST operadora/reajustes-coletivos/agrupamentos/:id/cancelamento    cancela com motivo
//   GET  operadora/reajustes-coletivos/contratos/:id/previa             sinistralidade apurada e percentual da regra
//   POST operadora/reajustes-coletivos/contratos/:id/sinistralidade     registra o reajuste pela regra
// Cada gravação vai pela porta própria (Executor do núcleo), com a trilha_auditoria na mesma transação.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { TIPOS_INDICE_REAJUSTE } from '@sgh/dominio-operadora';
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
import {
  type Gravado,
  PORTA_REAJUSTE_COLETIVO,
  type PortaReajusteColetivoPropria,
} from './reajuste-coletivo-propria.js';

const LER = 'operadora.cobranca.ler';
const GERAR = 'operadora.cobranca.gerar';
const AUD = 'operadora.reajuste-coletivo.gravado com a trilha_auditoria na mesma transação (porta própria)';

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const comp = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const versao = z.number().int().positive();
const pct = z.number().min(-100).max(999);
const esquemaIndice = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(150),
  tipo: z.enum(TIPOS_INDICE_REAJUSTE),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  percentual: z.number().min(-100).max(100),
  protocolo: z.string().max(30).nullable(),
});
const esquemaRegra = z.object({
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(150),
  base: z.enum(['sinistralidade', 'mensalidade']),
  meses: z.number().int().min(1).max(36),
  meta: z.number().nullable(),
  vigenciaInicio: data,
  vigenciaFim: data.nullable(),
  faixas: z
    .array(z.object({ de: z.number().min(0), ate: z.number().nullable(), percentual: pct }))
    .min(1)
    .max(50),
});
const esquemaAgrupamento = z.object({
  descricao: z.string().min(1).max(200),
  vigencia: data,
  limiteVidas: z.number().int().min(1).max(9999),
});
const esquemaCalculo = z.object({
  versao,
  regra: z.number().int().positive().nullable(),
  percentual: pct.nullable(),
  justificativa: z.string().max(2000).nullable(),
});
const esquemaAplicacao = z.object({ versao, competencia: comp });
const esquemaCancelamento = z.object({ versao, motivo: z.string().min(1).max(500) });
const esquemaSinistralidade = z.object({ competencia: comp, regra: z.number().int().positive() });
const esquemaPrevia = z.object({ competencia: comp, regra: z.coerce.number().int().positive() });

@Controller()
export class ReajusteColetivoOperadoraController {
  constructor(@Inject(PORTA_REAJUSTE_COLETIVO) private readonly porta: PortaReajusteColetivoPropria) {}

  private trilha(s: SessaoCadastro, evento: string, tabela: string) {
    return (r: Gravado) =>
      linhaTrilha(s, evento, 'operadora.reajuste-coletivo', evento, { tabela, id: String(r.id) });
  }
  private async ok<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: unknown) => {
      throw problemaDoCadastro(e);
    });
  }

  @Get('operadora/reajustes-coletivos/indices')
  @Permissao(LER)
  indices(@Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.indices(sessaoDe(req).porta));
  }

  @Post('operadora/reajustes-coletivos/indices')
  @HttpCode(201)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  gravarIndice(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarIndice(
        s.porta,
        corpo(esquemaIndice, b),
        this.trilha(s, 'operadora.reajuste.indice-incluido', 'indice_reajuste_plano'),
      ),
    );
  }

  @Get('operadora/reajustes-coletivos/:op/regras')
  @Permissao(LER)
  regras(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.regras(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/reajustes-coletivos/:op/regras')
  @HttpCode(201)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  gravarRegra(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.gravarRegra(
        s.porta,
        idDaRota(op),
        corpo(esquemaRegra, b),
        this.trilha(s, 'operadora.reajuste.regra-incluida', 'regra_reajuste_sinistralidade'),
      ),
    );
  }

  @Get('operadora/reajustes-coletivos/:op/contratos')
  @Permissao(LER)
  contratos(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.contratosColetivos(sessaoDe(req).porta, idDaRota(op)));
  }

  @Get('operadora/reajustes-coletivos/:op/agrupamentos')
  @Permissao(LER)
  agrupamentos(@Param('op') op: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.agrupamentos(sessaoDe(req).porta, idDaRota(op)));
  }

  @Post('operadora/reajustes-coletivos/:op/agrupamentos')
  @HttpCode(201)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  criarAgrupamento(@Param('op') op: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    return this.ok(
      this.porta.criarAgrupamento(
        s.porta,
        idDaRota(op),
        corpo(esquemaAgrupamento, b),
        this.trilha(s, 'operadora.reajuste.agrupamento-criado', 'agrupamento_reajuste_coletivo'),
      ),
    );
  }

  @Get('operadora/reajustes-coletivos/agrupamentos/:id/contratos')
  @Permissao(LER)
  contratosDoAgrupamento(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.ok(this.porta.contratosDoAgrupamento(sessaoDe(req).porta, idDaRota(id)));
  }

  @Post('operadora/reajustes-coletivos/agrupamentos/:id/calculo')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  calcular(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const { versao: v, ...x } = corpo(esquemaCalculo, b);
    return this.ok(
      this.porta.calcularAgrupamento(
        s.porta,
        idDaRota(id),
        v,
        x,
        this.trilha(s, 'operadora.reajuste.agrupamento-calculado', 'agrupamento_reajuste_coletivo'),
      ),
    );
  }

  @Post('operadora/reajustes-coletivos/agrupamentos/:id/aplicacao')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  aplicar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const x = corpo(esquemaAplicacao, b);
    return this.ok(
      this.porta.aplicarAgrupamento(
        s.porta,
        idDaRota(id),
        x.versao,
        x.competencia,
        this.trilha(s, 'operadora.reajuste.agrupamento-aplicado', 'agrupamento_reajuste_coletivo'),
      ),
    );
  }

  @Post('operadora/reajustes-coletivos/agrupamentos/:id/cancelamento')
  @HttpCode(200)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  cancelar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const x = corpo(esquemaCancelamento, b);
    return this.ok(
      this.porta.cancelarAgrupamento(
        s.porta,
        idDaRota(id),
        x.versao,
        x.motivo,
        this.trilha(s, 'operadora.reajuste.agrupamento-cancelado', 'agrupamento_reajuste_coletivo'),
      ),
    );
  }

  @Get('operadora/reajustes-coletivos/contratos/:id/previa')
  @Permissao(LER)
  previa(@Param('id') id: string, @Query() q: unknown, @Req() req: RequisicaoAutorizada) {
    const x = corpo(esquemaPrevia, q);
    return this.ok(
      this.porta.previaSinistralidade(sessaoDe(req).porta, idDaRota(id), x.competencia, x.regra),
    );
  }

  @Post('operadora/reajustes-coletivos/contratos/:id/sinistralidade')
  @HttpCode(201)
  @Permissao(GERAR)
  @AuditadoNoHandler(AUD)
  reajustar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const x = corpo(esquemaSinistralidade, b);
    return this.ok(
      this.porta.reajustarPorSinistralidade(
        s.porta,
        idDaRota(id),
        x.competencia,
        x.regra,
        this.trilha(s, 'operadora.reajuste.sinistralidade-aplicado', 'reajuste_contrato_plano'),
      ),
    );
  }
}
