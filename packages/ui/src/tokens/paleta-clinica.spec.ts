import { describe, expect, it } from 'vitest';
import { mensagensUi } from '../i18n/pt-BR.js';
import { CAMINHOS_ICONES } from '../icones/caminhos.js';
import { tokensDoTema } from './cores.js';
import { entradaClinica, PALETA_CLINICA } from './clinica.js';
import { CORES_REDE_SANTE } from './marcas.js';

describe('paleta clínica (regra 3)', () => {
  it('13 entradas: 5 cores de risco e 8 estados de leito', () => {
    expect(PALETA_CLINICA).toHaveLength(13);
    expect(PALETA_CLINICA.filter((e) => e.grupo === 'risco')).toHaveLength(5);
    expect(PALETA_CLINICA.filter((e) => e.grupo === 'leito')).toHaveLength(8);
  });

  it('toda entrada tem rótulo pt-BR e ícone, nos dois temas', () => {
    const rotulos = mensagensUi.ui.clinica as Record<string, string>;
    for (const e of PALETA_CLINICA) {
      expect(e.rotulo).toBe(`ui.clinica.${e.id}`);
      expect(rotulos[e.id], e.id).toMatch(/\S/);
      expect(Object.keys(CAMINHOS_ICONES)).toContain(e.icone);
      expect(e.claro.fundo).toMatch(/^#[0-9a-f]{6}$/);
      expect(e.escuro.fundo).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('cores com significado oficial não seguem a marca (nenhuma é a primária nem a secundária)', () => {
    const t = tokensDoTema(CORES_REDE_SANTE);
    const marca = [t.claro.primaria, t.escuro.primaria, CORES_REDE_SANTE.corSecundaria];
    for (const e of PALETA_CLINICA) {
      expect(marca).not.toContain(e.claro.fundo);
      expect(marca).not.toContain(e.escuro.fundo);
    }
  });

  it('as 5 de risco seguem a ordem do protocolo e são distintas', () => {
    const risco = PALETA_CLINICA.filter((e) => e.grupo === 'risco');
    expect(risco.map((e) => e.id)).toEqual([
      'risco-vermelho',
      'risco-laranja',
      'risco-amarelo',
      'risco-verde',
      'risco-azul',
    ]);
    expect(new Set(risco.map((e) => e.claro.fundo)).size).toBe(5);
  });

  it('estado desconhecido é recusado', () => {
    expect(() => entradaClinica('leito-inventado')).toThrow(/desconhecido/);
  });
});
