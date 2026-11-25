// SLA do contrato com fornecedor (09-AREA linha 88), a aba SLA da tela do contrato:
//   GET  /api/suprimentos/contratos/:id/sla                          os SLAs com faixas, medições e apurações; os serviços
//   GET  /api/suprimentos/contratos/:id/sla/:sla/previa?inicio=&fim=&valorFatura=   a apuração do período sem gravar
//   POST /api/suprimentos/contratos/:id/sla                          o SLA novo (fecha o do mesmo modelo na véspera)
//   POST /api/suprimentos/contratos/:id/sla/:sla/encerramento        fecha a vigência (nada apagado)
//   POST /api/suprimentos/contratos/:id/sla/:sla/medicoes            o chamado, a parada ou o realizado
//   POST /api/suprimentos/contratos/:id/sla/:sla/apuracoes           a apuração do período (glosa e multa da faixa)
// Ler pede suprimentos.contrato.ler; o SLA e a medição, suprimentos.contrato.editar; a apuração,
// suprimentos.contrato.avaliar. Sem chave de liberação: vale a permissão do cargo. A gravação exige a Idempotency-Key.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { PERMISSOES_CONTRATO_CODIGOS as P } from '@sgh/contratos';
import { PENALIDADES_SLA, TIPOS_REGRA_SLA, UNIDADES_SLA } from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_SLA_CONTRATO, type PortaSlaContrato } from './sla-contrato.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const decimal = z.number().min(0).max(99_999_999_999);

export const esquemaSlaContrato = z
  .object({
    servico: z.number().int().positive().nullable().default(null),
    descricao: z.string().trim().min(1).max(150),
    tipoRegra: z.enum(TIPOS_REGRA_SLA),
    unidade: z.enum(UNIDADES_SLA),
    meta: decimal,
    horarioInicio: z.string().regex(HORA).nullable().default(null),
    horarioFim: z.string().regex(HORA).nullable().default(null),
    somenteDiasUteis: z.boolean().default(false),
    vigenciaInicio: z.string().regex(DATA),
    vigenciaFim: z.string().regex(DATA).nullable().default(null),
    faixas: z
      .array(
        z
          .object({
            codigo: z.string().trim().min(1).max(5),
            descricao: z.string().trim().min(1).max(60),
            desempenhoInicio: decimal,
            desempenhoFim: decimal.nullable(),
            penalidade: z.enum(PENALIDADES_SLA),
            percentualGlosa: z.number().min(0).max(100).nullable().default(null),
            valorMulta: decimal.nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

export const esquemaMedicaoSla = z
  .object({
    inicio: z.string().regex(INSTANTE),
    fim: z.string().regex(INSTANTE).nullable().default(null),
    quantidade: decimal.nullable().default(null),
    descricao: z.string().trim().min(1).max(2000),
  })
  .strict();

export const esquemaApuracaoSla = z
  .object({
    inicio: z.string().regex(DATA),
    fim: z.string().regex(DATA),
    valorFatura: decimal.nullable().default(null),
  })
  .strict();

export const esquemaEncerramentoSla = z
  .object({ fim: z.string().regex(DATA), versao: z.number().int().positive() })
  .strict();

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
    throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'O contrato ou o SLA não existe.');
  return n;
}

@Controller('suprimentos/contratos/:id/sla')
export class SlaContratoController {
  constructor(@Inject(PORTA_SLA_CONTRATO) private readonly porta: PortaSlaContrato) {}

  @Get()
  @Permissao(P.ler)
  painel(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.porta.painel(sessaoDe(req).porta, idDe(id));
  }

  @Get(':sla/previa')
  @Permissao(P.ler)
  previa(
    @Param('id') id: string,
    @Param('sla') sla: string,
    @Query('inicio') inicio: string | undefined,
    @Query('fim') fim: string | undefined,
    @Query('valorFatura') valorFatura: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const v = valorFatura === undefined || valorFatura === '' ? null : Number(valorFatura.replace(',', '.'));
    const e = corpo(esquemaApuracaoSla, { inicio, fim, valorFatura: v });
    return this.porta.previa(sessaoDe(req).porta, idDe(id), idDe(sla), e);
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.contrato.gravar-sla pelo executor (trilha na mesma transação)')
  async gravar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSlaContrato, b);
    const r = await this.porta.gravar(sessaoDe(req).porta, idDe(id), e, chaveDe(req));
    return {
      ok: true,
      ...r,
      mensagem: r.fechados.length
        ? 'SLA gravado; o anterior do mesmo modelo fecha na véspera do início do novo.'
        : 'SLA gravado.',
    };
  }

  @Post(':sla/encerramento')
  @HttpCode(200)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.contrato.encerrar-sla pelo executor (trilha na mesma transação)')
  async encerrar(
    @Param('id') id: string,
    @Param('sla') sla: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const e = corpo(esquemaEncerramentoSla, b);
    const r = await this.porta.encerrar(
      sessaoDe(req).porta,
      idDe(id),
      idDe(sla),
      e.fim,
      e.versao,
      chaveDe(req),
    );
    return { ok: true, ...r, mensagem: 'Vigência do SLA encerrada: o histórico continua.' };
  }

  @Post(':sla/medicoes')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('suprimentos.contrato.medir-sla pelo executor (trilha na mesma transação)')
  async medir(
    @Param('id') id: string,
    @Param('sla') sla: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const e = corpo(esquemaMedicaoSla, b);
    const r = await this.porta.medir(sessaoDe(req).porta, idDe(id), idDe(sla), e, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Medição registrada.' };
  }

  @Post(':sla/apuracoes')
  @HttpCode(201)
  @Permissao(P.avaliar)
  @AuditadoNoHandler('suprimentos.contrato.apurar-sla pelo executor (trilha na mesma transação)')
  async apurar(
    @Param('id') id: string,
    @Param('sla') sla: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ) {
    const e = corpo(esquemaApuracaoSla, b);
    const r = await this.porta.apurar(sessaoDe(req).porta, idDe(id), idDe(sla), e, chaveDe(req));
    return { ok: true, ...r, mensagem: `Apuração registrada: desempenho ${r.desempenho}%.` };
  }
}
