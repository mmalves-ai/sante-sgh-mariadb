// Contexto clínico da tela (M48, etapa 1): a tela dona define e limpa; uma tela nova não é apagada pela anterior.
import { afterEach, describe, expect, it } from 'vitest';
import {
  contextoClinico,
  definirContextoClinico,
  limparContextoClinico,
  rotuloDoPaciente,
} from './contexto-clinico.js';

afterEach(() => limparContextoClinico());

describe('contexto clínico da tela aberta', () => {
  it('a tela define e, ao sair, limpa', () => {
    const soltar = definirContextoClinico({ atendimento: 48001, rotulo: 'Paciente Fictício' });
    expect(contextoClinico.value).toEqual({ atendimento: 48001, rotulo: 'Paciente Fictício' });
    soltar();
    expect(contextoClinico.value).toBeNull();
  });

  it('a tela anterior não apaga o contexto da nova', () => {
    const soltarA = definirContextoClinico({ atendimento: 1, rotulo: 'A' });
    definirContextoClinico({ atendimento: 2, rotulo: 'B' });
    soltarA();
    expect(contextoClinico.value?.atendimento).toBe(2);
  });

  it('o rótulo corta em 160 caracteres e prefere o nome social', () => {
    definirContextoClinico({ atendimento: 3, rotulo: 'x'.repeat(300) });
    expect(contextoClinico.value?.rotulo).toHaveLength(160);
    expect(
      rotuloDoPaciente({ nomeSocial: 'Social Fictício', nomeCivil: 'Civil', atendimento: 'Internação 1' }),
    ).toBe('Social Fictício · Internação 1');
    expect(rotuloDoPaciente({ nomeSocial: null, nomeCivil: 'Civil Fictício', atendimento: '' })).toBe(
      'Civil Fictício',
    );
  });
});
