// Exceção da regra de lançamento automático (C1-090, 06-FAT linha 16): validação do cadastro e encerramento sem apagar.
import { describe, expect, it } from 'vitest';
import {
  type CadastroExcecaoRegra,
  cancelamentoExcecaoRegra,
  diaAnterior,
  encerramentoExcecaoRegra,
  situacaoExcecaoRegra,
  validarExcecaoRegraLancamento,
} from './excecao-regra-lancamento.js';

const todas = { internacao: true, ambulatorial: true, externo: true, urgencia: true, domiciliar: true };
const base: CadastroExcecaoRegra = {
  regraLancamento: 1,
  estabelecimento: null,
  fontePagadora: 10,
  plano: null,
  setor: null,
  especialidade: null,
  item: null,
  grupo: null,
  efeito: 'nao_aplicar',
  aplica: todas,
  vigenciaInicio: '2026-11-01',
  vigenciaFim: null,
  motivo: 'Contrato novo sem a taxa',
};

describe('validarExcecaoRegraLancamento', () => {
  it('aceita a exceção completa', () => {
    expect(validarExcecaoRegraLancamento(base)).toEqual({});
  });
  it('exige a regra, o efeito, um recorte, uma natureza, o início e o motivo', () => {
    const e = validarExcecaoRegraLancamento({
      ...base,
      regraLancamento: null,
      efeito: 'outro',
      fontePagadora: null,
      aplica: {
        ...todas,
        internacao: false,
        ambulatorial: false,
        externo: false,
        urgencia: false,
        domiciliar: false,
      },
      vigenciaInicio: null,
      motivo: ' abc ',
    });
    expect(Object.keys(e).sort()).toEqual(
      ['aplica', 'efeito', 'motivo', 'recorte', 'regraLancamento', 'vigenciaInicio'].sort(),
    );
  });
  it('o estabelecimento sozinho já é recorte', () => {
    expect(validarExcecaoRegraLancamento({ ...base, fontePagadora: null, estabelecimento: 3 })).toEqual({});
  });
  it('plano sem fonte, item com grupo e fim antes do início são recusados', () => {
    const e = validarExcecaoRegraLancamento({
      ...base,
      fontePagadora: null,
      plano: 5,
      item: 7,
      grupo: 8,
      vigenciaFim: '2026-10-31',
    });
    expect(e['plano']).toBeDefined();
    expect(e['grupo']).toBeDefined();
    expect(e['vigenciaFim']).toBeDefined();
    expect(validarExcecaoRegraLancamento({ ...base, vigenciaFim: '2026-11-01' })).toEqual({});
  });
  it('motivo acima de 500 caracteres é recusado', () => {
    expect(validarExcecaoRegraLancamento({ ...base, motivo: 'x'.repeat(501) })['motivo']).toBeDefined();
  });
});

describe('encerramento e situação da exceção', () => {
  it('dia anterior atravessa mês e ano', () => {
    expect(diaAnterior('2026-03-01')).toBe('2026-02-28');
    expect(diaAnterior('2027-01-01')).toBe('2026-12-31');
  });
  it('a vigente passa a valer até ontem', () => {
    expect(encerramentoExcecaoRegra('2026-11-01', null, '2026-11-25')).toEqual({
      ok: true,
      vigenciaFim: '2026-11-24',
    });
    expect(encerramentoExcecaoRegra('2026-11-24', '2026-12-31', '2026-11-25')).toEqual({
      ok: true,
      vigenciaFim: '2026-11-24',
    });
  });
  it('a já encerrada e a que começa hoje ou depois são recusadas', () => {
    const r1 = encerramentoExcecaoRegra('2026-01-01', '2026-11-24', '2026-11-25');
    expect(r1.ok ? '' : r1.codigo).toBe('excecao-encerrada');
    const r2 = encerramentoExcecaoRegra('2026-11-25', null, '2026-11-25');
    expect(r2.ok ? '' : r2.codigo).toBe('excecao-futura');
  });
  it('situação pelo dia', () => {
    expect(situacaoExcecaoRegra('2026-12-01', null, '2026-11-25')).toBe('futura');
    expect(situacaoExcecaoRegra('2026-11-01', '2026-11-25', '2026-11-25')).toBe('vigente');
    expect(situacaoExcecaoRegra('2026-11-01', '2026-11-24', '2026-11-25')).toBe('encerrada');
    expect(situacaoExcecaoRegra('2026-12-01', null, '2026-11-25', true)).toBe('cancelada');
  });
  it('a cancelada não se encerra', () => {
    const r = encerramentoExcecaoRegra('2026-01-01', null, '2026-11-25', true);
    expect(r.ok ? '' : r.codigo).toBe('excecao-cancelada');
  });
});

describe('cancelamento da exceção antes de valer', () => {
  it('a que começa hoje ou depois se cancela, com o motivo aparado', () => {
    expect(cancelamentoExcecaoRegra('2026-11-25', false, '2026-11-25', '  Fonte errada  ')).toEqual({
      ok: true,
      motivo: 'Fonte errada',
    });
    expect(cancelamentoExcecaoRegra('2026-12-01', false, '2026-11-25', 'Recorte errado').ok).toBe(true);
  });
  it('a que já valeu antes de hoje se encerra, não se cancela; a cancelada não se cancela de novo', () => {
    const r1 = cancelamentoExcecaoRegra('2026-11-24', false, '2026-11-25', 'Recorte errado');
    expect(r1.ok ? '' : r1.codigo).toBe('excecao-em-vigor');
    const r2 = cancelamentoExcecaoRegra(null, false, '2026-11-25', 'Recorte errado');
    expect(r2.ok ? '' : r2.codigo).toBe('excecao-em-vigor');
    const r3 = cancelamentoExcecaoRegra('2026-12-01', true, '2026-11-25', 'Recorte errado');
    expect(r3.ok ? '' : r3.codigo).toBe('excecao-cancelada');
  });
  it('motivo de 5 a 500 caracteres', () => {
    const r1 = cancelamentoExcecaoRegra('2026-12-01', false, '2026-11-25', ' abc ');
    expect(r1.ok ? '' : r1.codigo).toBe('entrada-invalida');
    const r2 = cancelamentoExcecaoRegra('2026-12-01', false, '2026-11-25', 'x'.repeat(501));
    expect(r2.ok ? '' : r2.codigo).toBe('entrada-invalida');
  });
});
