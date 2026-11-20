// Regra 1 (ficha do M26): o estado do exame pelas marcas do legado e pelo rastreio do novo; as ações por estado.
import { describe, expect, it } from 'vitest';
import { estadoDoExame, fatura, ordemDoEstado, podeNoEstado } from './estados.js';

const base = { pendSadt: 'T', digitado: false, liberado: false, emitido: false } as const;

describe('estado do exame (regra 1)', () => {
  it('solicitado, coletado, recebido, em análise, digitado, liberado, emitido e visualizado', () => {
    expect(estadoDoExame(base)).toBe('solicitado');
    expect(estadoDoExame({ ...base, amostra: 'coletada' })).toBe('coletado');
    expect(estadoDoExame({ ...base, amostra: 'emTransporte' })).toBe('coletado');
    expect(estadoDoExame({ ...base, amostra: 'aguardandoColeta' })).toBe('solicitado');
    expect(estadoDoExame({ ...base, pendSadt: 'F' })).toBe('recebido');
    expect(estadoDoExame({ ...base, pendSadt: 'F', amostra: 'emAnalise' })).toBe('emAnalise');
    expect(estadoDoExame({ ...base, pendSadt: 'F', digitado: true })).toBe('digitado');
    expect(estadoDoExame({ ...base, pendSadt: 'F', digitado: true, liberado: true })).toBe('liberado');
    expect(estadoDoExame({ ...base, pendSadt: 'F', digitado: true, liberado: true, emitido: true })).toBe(
      'emitido',
    );
    expect(estadoDoExame({ ...base, pendSadt: 'F', digitado: true, liberado: true, visualizado: true })).toBe(
      'visualizado',
    );
  });

  it('suspenso no prontuário (PEND_SADT S) e as letras com espaço ou minúscula', () => {
    expect(estadoDoExame({ ...base, pendSadt: 'S' })).toBe('suspenso');
    expect(estadoDoExame({ ...base, pendSadt: ' s ' })).toBe('suspenso');
    expect(estadoDoExame({ ...base, pendSadt: 'f' })).toBe('recebido');
  });

  it('a sequência dos estados', () => {
    expect(ordemDoEstado('solicitado')).toBeLessThan(ordemDoEstado('recebido'));
    expect(ordemDoEstado('digitado')).toBeLessThan(ordemDoEstado('liberado'));
    expect(ordemDoEstado('suspenso')).toBe(-1);
  });

  it('ações por estado: resultado liberado só pela retificação (regra 4)', () => {
    expect(podeNoEstado('receber', 'solicitado').pode).toBe(true);
    expect(podeNoEstado('receber', 'coletado').pode).toBe(true);
    expect(podeNoEstado('receber', 'recebido').motivo).toMatch(/já foi recebido/);
    expect(podeNoEstado('coletar', 'solicitado').pode).toBe(true);
    expect(podeNoEstado('coletar', 'recebido').pode).toBe(true);
    expect(podeNoEstado('coletar', 'coletado').motivo).toMatch(/já foi coletada/);
    expect(podeNoEstado('digitar', 'solicitado').motivo).toMatch(/Receba o pedido/);
    expect(podeNoEstado('digitar', 'recebido').pode).toBe(true);
    expect(podeNoEstado('digitar', 'digitado').pode).toBe(true);
    expect(podeNoEstado('digitar', 'liberado').motivo).toMatch(/retificação/);
    expect(podeNoEstado('laudar', 'emAnalise').pode).toBe(true);
    expect(podeNoEstado('liberar', 'digitado').pode).toBe(true);
    expect(podeNoEstado('liberar', 'recebido').motivo).toMatch(/Digite/);
    expect(podeNoEstado('liberar', 'emitido').motivo).toMatch(/já foi liberado/);
    expect(podeNoEstado('retificar', 'liberado').pode).toBe(true);
    expect(podeNoEstado('retificar', 'visualizado').pode).toBe(true);
    expect(podeNoEstado('retificar', 'digitado').motivo).toMatch(/Só o resultado liberado/);
    expect(podeNoEstado('emitir', 'liberado').pode).toBe(true);
    expect(podeNoEstado('emitir', 'digitado').motivo).toMatch(/depois da liberação/);
    expect(podeNoEstado('suspender', 'solicitado').pode).toBe(true);
    expect(podeNoEstado('suspender', 'recebido').motivo).toMatch(/não recebido/);
    expect(podeNoEstado('digitar', 'suspenso').motivo).toMatch(/suspenso/);
  });

  it('exame pendente ou suspenso não fatura (regra 2)', () => {
    expect(fatura('F')).toBe(true);
    expect(fatura('T')).toBe(false);
    expect(fatura('S')).toBe(false);
  });
});
