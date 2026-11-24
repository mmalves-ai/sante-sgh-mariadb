// F3.8, 07-FIN linha 85: a permissão de cada rota do período financeiro, lida do próprio controlador (o guarda global
// recusa com 403 quem não tem o código declarado). Fechar e pedir a reabertura ficam com quem lança o movimento;
// decidir a reabertura (autorizar ou recusar) só com quem edita os parâmetros do financeiro. As leituras pedem a leitura
// do movimento, e as gravações declaram a trilha no próprio handler.
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { PeriodoFinanceiroController } from './periodo.controller.js';

const proto = PeriodoFinanceiroController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};

describe('período financeiro: permissão de cada rota (07-FIN linha 85)', () => {
  it('fechar e pedir a reabertura com financeiro.movimento.criar; decidir só com financeiro.parametro.editar', () => {
    expect(meta(CHAVE_PERMISSAO, 'fechar')).toBe('financeiro.movimento.criar');
    expect(meta(CHAVE_PERMISSAO, 'pedirReabertura')).toBe('financeiro.movimento.criar');
    expect(meta(CHAVE_PERMISSAO, 'reabrir')).toBe('financeiro.parametro.editar');
  });

  it('leituras com financeiro.movimento.ler; gravações com a trilha declarada', () => {
    for (const m of ['periodos', 'eventos', 'saldoDiario'])
      expect(meta(CHAVE_PERMISSAO, m)).toBe('financeiro.movimento.ler');
    for (const m of ['fechar', 'pedirReabertura', 'reabrir'])
      expect(String(meta(CHAVE_AUDITADO_NO_HANDLER, m) ?? '')).toMatch(/^financeiro\.[a-zA-Z]+Periodo /);
  });
});
