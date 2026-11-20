// Correção do M14 (POL-3): a inativação e a reativação SÓ NO NOVO seguem a liberação do domínio e falham FECHADO
// fora de desenvolvimento — erro ao consultar a liberação (leitura das liberações, conexão) ou método ausente não
// grava. Controlador montado à mão sobre uma fonte falsa (nada conecta a banco).
import { DECLARACOES } from '@sgh/legado';
import { afterEach, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { DominiosController } from './dominios.controller.js';
import type { FonteDominios } from './dominios-fonte.js';

const d = DECLARACOES.find((x) => x.situacaoSoNoNovo && x.publico.acoes.includes('criar'))!;
const ctx = { rede: 'r', hospital: 'pc', traceId: 't', usuarioLegado: 'SINT', idempotencyKey: 'k' };
const ambiente = process.env['AMBIENTE'];
afterEach(() => {
  if (ambiente === undefined) delete process.env['AMBIENTE'];
  else process.env['AMBIENTE'] = ambiente;
});

function controlador(
  liberacao: (() => Promise<{ pode: boolean; codigo: string | null; motivo: string | null }>) | null,
) {
  const fonte = {
    destino: 'legado',
    executor: liberacao ? { liberacao } : {},
  } as unknown as FonteDominios;
  const c = new DominiosController(fonte, new RegistradorTrilhaMemoria());
  return (
    c as unknown as {
      exigirLiberacaoSoNoNovo(d: unknown, ctx: unknown, titulo: string): Promise<void>;
    }
  ).exigirLiberacaoSoNoNovo.bind(c);
}

const status = async (p: Promise<void>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof ErroProblema ? e.getStatus() : -1;
  }
};

describe('liberação da gravação só no novo (falha fechado)', () => {
  it('em produção: a consulta da liberação falha → 403; método ausente → 403; liberada → passa', async () => {
    process.env['AMBIENTE'] = 'producao';
    expect(
      await status(controlador(async () => Promise.reject(new Error('conexão caiu')))(d, ctx, 'x')),
    ).toBe(403);
    expect(await status(controlador(null)(d, ctx, 'x'))).toBe(403);
    expect(
      await status(
        controlador(async () => ({ pode: false, codigo: 'operacao-nao-liberada', motivo: 'Falta provar' }))(
          d,
          ctx,
          'x',
        ),
      ),
    ).toBe(403);
    expect(
      await status(controlador(async () => ({ pode: true, codigo: null, motivo: null }))(d, ctx, 'x')),
    ).toBe(200);
  });
  it('em desenvolvimento: sem resposta da liberação, segue (a cópia é desfeita pelos testes)', async () => {
    process.env['AMBIENTE'] = 'dev';
    expect(await status(controlador(async () => Promise.reject(new Error('x')))(d, ctx, 'x'))).toBe(200);
  });
});
