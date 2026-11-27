import { describe, expect, it } from 'vitest';
import { decidirExtracao, type ParametroParaExtracao, recusaDoDestino } from './extracao-destino.js';

const temperatura: ParametroParaExtracao = {
  tipoResposta: 'numero',
  unidade: '°C',
  casasDecimais: 1,
  valorMinimo: 25,
  valorMaximo: 45,
  alertaMinimo: 35,
  alertaMaximo: 37.8,
};
const confirmado = { ativo: true, entidadeDestino: 'afericao', parametroVitalId: 7, modeloCampoId: 9 };

describe('destino confirmado -> aferição (decisão 62)', () => {
  it('só o destino confirmado pelo hospital alimenta aferição', () => {
    expect(recusaDoDestino(confirmado, temperatura)).toBeNull();
    expect(recusaDoDestino({ ...confirmado, ativo: false }, temperatura)).toBe('destino-inativo');
    expect(recusaDoDestino({ ...confirmado, entidadeDestino: 'a_configurar' }, temperatura)).toBe(
      'destino-nao-afericao',
    );
    expect(recusaDoDestino({ ...confirmado, parametroVitalId: null }, null)).toBe('sem-parametro-vital');
    expect(recusaDoDestino({ ...confirmado, modeloCampoId: null }, temperatura)).toBe('sem-pergunta');
    expect(recusaDoDestino(confirmado, { ...temperatura, tipoResposta: 'opcao' })).toBe(
      'parametro-nao-numerico',
    );
  });

  it('número ou texto legível vira aferição arredondada às casas do parâmetro, com o nível pela faixa de alerta', () => {
    expect(decidirExtracao({ valorNumero: 36.54, valorTexto: null, unidade: null }, temperatura)).toEqual({
      tipo: 'afericao',
      valor: 36.5,
      nivel: 'normal',
    });
    expect(decidirExtracao({ valorNumero: null, valorTexto: ' 38,2 ', unidade: 'ºc' }, temperatura)).toEqual({
      tipo: 'afericao',
      valor: 38.2,
      nivel: 'atencao',
    });
  });

  it('o que não é conferível vira pendência com o motivo, nunca aferição', () => {
    const p = (valorNumero: number | null, valorTexto: string | null, unidade: string | null) =>
      decidirExtracao({ valorNumero, valorTexto, unidade }, temperatura);
    expect(p(null, null, null)).toEqual({ tipo: 'pendencia', motivo: 'sem_valor' });
    expect(p(null, 'febril', null)).toEqual({ tipo: 'pendencia', motivo: 'valor_nao_numerico' });
    expect(p(98.6, null, '°F')).toEqual({ tipo: 'pendencia', motivo: 'unidade_divergente' });
    expect(p(365, null, null)).toEqual({ tipo: 'pendencia', motivo: 'fora_da_faixa' });
    expect(p(null, '12', null)).toEqual({ tipo: 'pendencia', motivo: 'fora_da_faixa' });
  });
});
