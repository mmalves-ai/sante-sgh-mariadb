// Regra 4 (ficha do M30): fechar exige conta consistente (vetos na ordem da sante-api); reabrir só de S para N.
import { describe, expect, it } from 'vitest';
import { type ContaParaFechar, conferirFechamento, conferirReabertura } from '../index.js';

const ok: ContaParaFechar = {
  fechada: 'N',
  remessa: 77,
  dataEmissao: '2026-10-01',
  indEmi: 'T',
  pacote: 'N',
  itens: 3,
  somaItens: 100,
  totalConta: 100.004,
  preVoo: {
    medicoSolicitanteValido: true,
    medicoContaValido: true,
    procedimentoNaTabela: true,
    tituloReceberExiste: true,
  },
  pendenciasBloqueantes: 0,
};
const cod = (x: Partial<ContaParaFechar>) => conferirFechamento({ ...ok, ...x })?.codigo ?? null;

describe('fechar (regra 4)', () => {
  it('a conta consistente passa (tolerância de meio centavo)', () => {
    expect(conferirFechamento(ok)).toBeNull();
  });
  it('cada veto, na ordem', () => {
    expect(cod({ fechada: 'S' })).toBe('conta-ja-fechada');
    expect(cod({ fechada: 'A' })).toBe('conta-apresentada');
    expect(cod({ fechada: 'F' })).toBe('situacao-invalida');
    expect(cod({ remessa: 0 })).toBe('sem-remessa');
    expect(cod({ dataEmissao: '1899-12-30' })).toBe('nao-emitida');
    expect(cod({ dataEmissao: null })).toBe('nao-emitida');
    expect(cod({ indEmi: 'F' })).toBe('nao-emitida');
    expect(cod({ pacote: 'Z' })).toBe('pacote-desconhecido');
    expect(cod({ itens: 0 })).toBe('conta-sem-itens');
    expect(cod({ totalConta: 100.01 })).toBe('total-diverge');
    expect(cod({ preVoo: { ...ok.preVoo, medicoSolicitanteValido: false } })).toBe('solicitante-invalido');
    expect(cod({ preVoo: { ...ok.preVoo, medicoContaValido: false } })).toBe('medico-conta-invalido');
    expect(cod({ preVoo: { ...ok.preVoo, procedimentoNaTabela: false } })).toBe(
      'procedimento-fora-da-tabela',
    );
    expect(cod({ preVoo: { ...ok.preVoo, tituloReceberExiste: false } })).toBe('titulo-inexistente');
    expect(cod({ pendenciasBloqueantes: 2 })).toBe('com-pendencia-bloqueante');
  });
  it('a conta por pacote (C) fecha com total menor que a soma', () => {
    expect(cod({ pacote: 'C', totalConta: 60 })).toBeNull();
    expect(cod({ pacote: null, totalConta: null, somaItens: 0 })).toBeNull();
  });
  it('a mensagem do total cita os dois valores em reais', () => {
    expect(conferirFechamento({ ...ok, totalConta: 90 })?.mensagem).toContain('R$ 90,00');
  });
});

describe('reabrir (regra 4)', () => {
  const r = { fechada: 'S', lotesTiss: 0, supervisor: true, motivo: 'item lançado depois' };
  it('só de S para N, fora de lote, supervisor e motivo', () => {
    expect(conferirReabertura(r)).toBeNull();
    expect(conferirReabertura({ ...r, fechada: 'N' })?.codigo).toBe('conta-ja-aberta');
    expect(conferirReabertura({ ...r, fechada: 'A' })?.codigo).toBe('conta-apresentada');
    expect(conferirReabertura({ ...r, fechada: 'F' })?.codigo).toBe('situacao-invalida');
    expect(conferirReabertura({ ...r, lotesTiss: 1 })?.codigo).toBe('em-lote');
    expect(conferirReabertura({ ...r, supervisor: false })?.codigo).toBe('sem-supervisor');
    expect(conferirReabertura({ ...r, motivo: ' ab ' })?.codigo).toBe('motivo-obrigatorio');
  });
});
