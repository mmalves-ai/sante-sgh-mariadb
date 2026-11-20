import { describe, expect, it } from 'vitest';
import { camposFaltando, obrigatoriedadesDaRecepcao, OBRIGATORIEDADES } from './obrigatorios.js';

// Cenário por hospital (regra 8). pc: os valores de configuração lidos da cópia (parâmetro da recepção, uma linha);
// hs: sintético até a cópia do Serrano (HS-1), com a senha obrigatória e o painel antigo por endereço de rede.
const PC = {
  DIG_TRAT: 'F',
  DIG_SEG: 'T',
  DIG_NAT: 'F',
  DIG_ENC: 'F',
  DIG_NOME: 'F',
  DIG_ESP: 'F',
  DIG_CRM: 'T',
  DIG_CDC: 'T',
  DIG_PROCED: 'F',
  DIG_GRUPO: 'F',
  DIG_ATE: 'T',
  DIG_MEDENC: 'F',
  DIG_TPAG: 'T',
  DIG_ACP: 'F',
  DIG_IDT: 'F',
  DIG_OBS_AGE: 'T',
  DIG_OBS_ATE: 'F',
  DIG_PLA: 'F',
  DIG_TIPO2: 'T',
  DIG_TPAGEN: 'T',
  DIG_GUIA: 'T',
  DIG_TERM: 'F',
  DIG_DOCTO: 'F',
  ['DIG_SENHA']: 'F',
  PAINEL: 'F',
  PAINELTCPIP: '                                        ',
};
const HS_SINTETICO = {
  ...PC,
  DIG_GUIA: 'F',
  DIG_IDT: 'T',
  ['DIG_SENHA']: 'T',
  PAINEL: 'T',
  PAINELTCPIP: '10.0.0.10:9000',
};

describe('obrigatoriedades da recepção pelo parâmetro do hospital (regra 8)', () => {
  it('pc', () => {
    const o = obrigatoriedadesDaRecepcao(PC);
    expect(o.campos).toEqual([
      'segurado',
      'profissional',
      'centroCusto',
      'tipoAtendimento',
      'tipoPagamento',
      'observacaoAgenda',
      'tipoPaciente',
      'tipoAgendamento',
      'guia',
    ]);
    expect(o.exigeSenha).toBe(false);
    expect(o.painelAntigo).toBe(false);
  });

  it('hs (sintético até a cópia, HS-1)', () => {
    const o = obrigatoriedadesDaRecepcao(HS_SINTETICO);
    expect(o.campos).toContain('identidade');
    expect(o.campos).not.toContain('guia');
    expect(o.exigeSenha).toBe(true);
    expect(o.painelAntigo).toBe(true);
  });

  it('S/N e nulos', () => {
    expect(obrigatoriedadesDaRecepcao({ DIG_SEG: 'S', DIG_SENHA: null }).campos).toEqual(['segurado']);
    expect(obrigatoriedadesDaRecepcao({}).campos).toEqual([]);
    expect(OBRIGATORIEDADES.every((o) => /^DIG_/.test(o.coluna))).toBe(true);
  });

  it('campos que faltam', () => {
    const o = obrigatoriedadesDaRecepcao(PC);
    expect(camposFaltando(o, { segurado: 'x', profissional: 0, centroCusto: 12 })).toEqual([
      'profissional',
      'tipoAtendimento',
      'tipoPagamento',
      'observacaoAgenda',
      'tipoPaciente',
      'tipoAgendamento',
      'guia',
    ]);
  });
});
