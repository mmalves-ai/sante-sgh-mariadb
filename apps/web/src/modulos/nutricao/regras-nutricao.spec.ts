import { describe, expect, it } from 'vitest';
import {
  combinaBusca,
  corDaSituacao,
  dataLonga,
  instanteCurto,
  leitoTexto,
  percentual,
  precisaTriagemFinal,
  previaNrs,
} from './regras-nutricao.js';

const nao = {
  imcAbaixoDe20e5: false,
  perdaDePeso3Meses: false,
  ingestaoReduzidaSemana: false,
  gravementeDoente: false,
};

describe('regras de tela da nutrição', () => {
  it('textos do leito, do instante, da data e do percentual', () => {
    expect(leitoTexto({ bloco: '2A', acomodacao: '201', leito: 'B' })).toBe('2A 201 B');
    expect(instanteCurto('2026-10-25T09:45')).toBe('25/10 09:45');
    expect(instanteCurto(null)).toBe('');
    expect(dataLonga('2026-10-25')).toBe('25/10/2026');
    expect(dataLonga('x')).toBe('');
    expect(percentual(85.7)).toBe('85,7%');
    expect(percentual(null)).toBe('');
  });
  it('a cor da situação: vencida em vermelho, atenção e reavaliar em amarelo, triado em verde', () => {
    expect(corDaSituacao('vencida')).toBe('vermelho');
    expect(corDaSituacao('atencao')).toBe('amarelo');
    expect(corDaSituacao('reavaliar')).toBe('amarelo');
    expect(corDaSituacao('triado')).toBe('verde');
    expect(corDaSituacao('a-triar')).toBe('neutro');
  });
  it('a prévia do NRS-2002: sem "sim", 0; com "sim", a soma com a idade; faltando resposta, nada', () => {
    expect(precisaTriagemFinal(nao)).toBe(false);
    expect(previaNrs(nao, null, null, 80)).toBe(0);
    const sim = { ...nao, perdaDePeso3Meses: true };
    expect(previaNrs(sim, 2, 1, 69)).toBe(3);
    expect(previaNrs(sim, 2, 1, 70)).toBe(4);
    expect(previaNrs(sim, null, 1, 70)).toBeNull();
    expect(previaNrs(sim, 1, 1, null)).toBeNull();
  });
  it('a busca das filas e do mapa: cada palavra em algum campo, sem acento; vazia aceita tudo', () => {
    const campos = ['MARIA SINTÉTICA DA SILVA', '70001', '2A 201 B'];
    expect(combinaBusca('', campos)).toBe(true);
    expect(combinaBusca('  maria  ', campos)).toBe(true);
    expect(combinaBusca('sintetica 201', campos)).toBe(true);
    expect(combinaBusca('70001', campos)).toBe(true);
    expect(combinaBusca('joao', campos)).toBe(false);
    expect(combinaBusca('maria 305', campos)).toBe(false);
    expect(combinaBusca('x', [null, undefined])).toBe(false);
  });
});
