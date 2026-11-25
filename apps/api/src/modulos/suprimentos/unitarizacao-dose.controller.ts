// Fracionamento e unitarização de dose (C2-092, 05-SUP linha 11):
//   GET  /api/farmacia/unitarizacao                       as regras de fracionamento, os lotes de origem com saldo por
//                                                         local, os locais, as capelas, as unidades e as últimas ordens
//   POST /api/farmacia/unitarizacao/regras                a regra do insumo (cria ou altera pela origem e dose)
//   POST /api/farmacia/unitarizacao/regras/:id/ativacao   ativa ou inativa a regra (nunca apaga)
//   POST /api/farmacia/unitarizacao/ordens                a ordem executada: baixa do lote de origem, entrada das doses
//                                                         e uma etiqueta por dose com o lote de origem
//   GET  /api/farmacia/unitarizacao/doses/:identificador  o rastreio dose → ordem → lote de origem, com as irmãs
// Ler pede suprimentos.manipulacao.ler; gravar, suprimentos.manipulacao.abrir. Sem chave de liberação: vale a
// permissão do cargo. A gravação exige a Idempotency-Key.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { PERMISSOES_MANIPULACAO_CODIGOS as P } from '@sgh/contratos';
import {
  MAXIMO_DOSES_POR_ORDEM,
  TETO_VALIDADE_HORAS,
  TIPOS_ORDEM_UNITARIZACAO,
} from '@sgh/contratos/regras-suprimentos';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { PORTA_UNITARIZACAO_DOSE, type PortaUnitarizacaoDose } from './unitarizacao-dose.js';

const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const id = z.number().int().positive();
const quantidade = z.number().positive().max(99_999_999);

export const esquemaRegraFracionamento = z
  .object({
    origem: id,
    resultante: id,
    quantidadeOrigem: quantidade,
    rendimento: quantidade,
    unidade: id,
    validadeHoras: z.number().int().min(1).max(TETO_VALIDADE_HORAS).nullable().default(null),
    exigeCapela: z.boolean().default(false),
    reaproveitaSobra: z.boolean().default(true),
  })
  .strict();

export const esquemaAtivacaoRegra = z.object({ ativa: z.boolean(), versaoVista: id }).strict();

export const esquemaOrdemUnitarizacao = z
  .object({
    regra: id,
    tipo: z.enum(TIPOS_ORDEM_UNITARIZACAO).default('fracionamento'),
    local: id,
    lote: id,
    capela: id.nullable().default(null),
    quantidadeOrigem: quantidade,
    doses: z.number().int().min(1).max(MAXIMO_DOSES_POR_ORDEM),
    perda: z.number().min(0).max(99_999_999).default(0),
    rupturaLacre: z.boolean().default(true),
    percentualEstabilidade: z.number().positive().max(100).nullable().default(null),
    observacao: z.string().trim().max(2000).nullable().default(null),
  })
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
    throw new ErroProblema('nao-encontrado', 404, 'Não encontrado', 'A regra de fracionamento não existe.');
  return n;
}

@Controller('farmacia/unitarizacao')
export class UnitarizacaoDoseController {
  constructor(@Inject(PORTA_UNITARIZACAO_DOSE) private readonly porta: PortaUnitarizacaoDose) {}

  @Get()
  @Permissao(P.ler)
  painel(@Req() req: RequisicaoAutorizada) {
    return this.porta.painel(sessaoDe(req).porta);
  }

  @Get('doses/:identificador')
  @Permissao(P.ler)
  rastrear(@Param('identificador') identificador: string, @Req() req: RequisicaoAutorizada) {
    if (!/^[A-Za-z0-9]{2,100}$/.test(identificador))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Código inválido',
        'Leia o código da etiqueta da dose.',
      );
    return this.porta.rastrear(sessaoDe(req).porta, identificador);
  }

  @Post('regras')
  @HttpCode(201)
  @Permissao(P.abrir)
  @AuditadoNoHandler('suprimentos.unitarizacao.salvar-regra pelo executor (trilha na mesma transação)')
  async salvarRegra(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaRegraFracionamento, b);
    const r = await this.porta.salvarRegra(sessaoDe(req).porta, e, chaveDe(req));
    return { ok: true, ...r, mensagem: 'Regra de fracionamento gravada.' };
  }

  @Post('regras/:id/ativacao')
  @HttpCode(200)
  @Permissao(P.abrir)
  @AuditadoNoHandler('suprimentos.unitarizacao.ativar-regra pelo executor (trilha na mesma transação)')
  async ativarRegra(@Param('id') regra: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaAtivacaoRegra, b);
    const r = await this.porta.ativarRegra(sessaoDe(req).porta, idDe(regra), e, chaveDe(req));
    return { ok: true, ...r, mensagem: e.ativa ? 'Regra ativada.' : 'Regra inativada.' };
  }

  @Post('ordens')
  @HttpCode(201)
  @Permissao(P.abrir)
  @AuditadoNoHandler('suprimentos.unitarizacao.executar-ordem pelo executor (trilha na mesma transação)')
  async executar(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaOrdemUnitarizacao, b);
    const r = await this.porta.executarOrdem(sessaoDe(req).porta, e, chaveDe(req));
    return {
      ok: true,
      ...r,
      mensagem: `Ordem ${r.numero}: ${r.doses.length} dose(s) etiquetada(s), validade até ${r.validadeDose}.`,
    };
  }
}
