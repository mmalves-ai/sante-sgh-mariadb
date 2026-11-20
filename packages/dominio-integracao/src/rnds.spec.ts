// Regra 14: CPF principal, CNS opcional, ambiente da RNDS (produção só em produção; homologação até o deploy; o
// simulador local em dev e ci) e o prazo de 24 h do registro de vacina. CPF e CNS sintéticos.
import { describe, expect, it } from 'vitest';
import {
  ambienteRnds,
  cnsValido,
  cpfValido,
  enderecosRnds,
  identificacaoRnds,
  prazoEnvioVacina,
} from './rnds.js';

/** CNS provisório sintético (começa com 7) com a soma ponderada fechando no múltiplo de 11. */
function cnsSintetico(): string {
  for (let n = 0; n < 100_000; n++) {
    const base = `7${String(n).padStart(13, '0')}`;
    for (let d = 0; d <= 9; d++) if (cnsValido(`${base}${d}`)) return `${base}${d}`;
  }
  throw new Error('sem CNS sintético');
}

describe('identificação para a RNDS (regra 14)', () => {
  it('CPF com dígitos verificadores', () => {
    expect(cpfValido('111.444.777-35')).toBe(true);
    expect(cpfValido('111.444.777-36')).toBe(false);
    expect(cpfValido('000.000.000-00')).toBe(false);
    expect(cpfValido('123')).toBe(false);
  });
  it('CNS definitivo ou provisório pela soma ponderada', () => {
    const cns = cnsSintetico();
    expect(cnsValido(cns)).toBe(true);
    expect(cnsValido(`${cns.slice(0, 14)}${(Number(cns[14]) + 1) % 10}`)).toBe(false);
    expect(cnsValido('300000000000000')).toBe(false);
  });
  it('CPF é o principal; sem CPF válido, o CNS; sem os dois, não envia', () => {
    const cns = cnsSintetico();
    expect(identificacaoRnds({ cpf: '111.444.777-35', cns })).toEqual({
      tipo: 'cpf',
      valor: '11144477735',
      cns,
    });
    expect(identificacaoRnds({ cpf: '1', cns })).toEqual({ tipo: 'cns', valor: cns, cns });
    expect(identificacaoRnds({ cpf: null, cns: null }).tipo).toBe('nenhuma');
  });
  it('ambiente: produção só em produção; homologação até o deploy; o simulador local em dev e ci', () => {
    expect(ambienteRnds('producao', false)).toBe('producao');
    expect(ambienteRnds('homolog', true)).toBe('homologacao');
    expect(ambienteRnds('homolog', false)).toBe('simulador');
    expect(ambienteRnds('dev', true)).toBe('simulador');
    expect(enderecosRnds('producao', null).ehr).toBe('https://rj-ehr-services.saude.gov.br/api');
    expect(enderecosRnds('homologacao', null).autenticacao).toMatch(/ehr-auth-hmg/);
    expect(enderecosRnds('simulador', 'http://127.0.0.1:3871')).toEqual({
      autenticacao: 'http://127.0.0.1:3871/api/token',
      ehr: 'http://127.0.0.1:3871/api',
    });
    expect(() => enderecosRnds('simulador', 'https://rnds.exemplo.com')).toThrow(/local/);
    expect(() => enderecosRnds('simulador', null)).toThrow(/não configurado/);
  });
  it('prazo de 24 h do registro de vacina aplicada', () => {
    expect(prazoEnvioVacina(new Date('2026-10-22T10:00:00Z'))).toEqual(new Date('2026-10-23T10:00:00Z'));
  });
});
