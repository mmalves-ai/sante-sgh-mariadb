// Regra 17 do M32: NFS-e com ISS, IBS e CBS; fora de produção (ou sem a DP-38), o simulador.
import { describe, expect, it } from 'vitest';
import { calcularNfse, conferirNfse, destinoNfse, simularPrefeitura, xmlNfse } from './index.js';

const p = {
  valorServicos: 10_000,
  aliquotaIss: 5,
  issRetido: true,
  retencoes: { ir: 150, pis: 65, cofins: 300, csll: 100, inss: 0 },
  momento: 'apresentacao' as const,
  classificacao: '040101',
};

describe('NFS-e (regra 17)', () => {
  it('10.000 de serviços: ISS 500 (retido), CBS 90, IBS 10, retenções 615; líquido 10.000 − 500 − 615 = 8.885', () => {
    expect(calcularNfse(p)).toEqual({
      baseCalculo: 10_000,
      valorIss: 500,
      issRetido: true,
      valorCbs: 90,
      valorIbs: 10,
      retencoesFederais: 615,
      valorLiquido: 8_885,
    });
    expect(calcularNfse({ ...p, issRetido: false }).valorLiquido).toBe(9_385);
  });
  it('recusas: valor, alíquota fora de 2% a 5%, sem classificação, retenções acima', () => {
    expect(conferirNfse(p)).toBeNull();
    expect(conferirNfse({ ...p, aliquotaIss: 0 })).toBeNull();
    expect(conferirNfse({ ...p, valorServicos: 0 })?.codigo).toBe('valor-obrigatorio');
    expect(conferirNfse({ ...p, aliquotaIss: 1 })?.codigo).toBe('aliquota-iss');
    expect(conferirNfse({ ...p, classificacao: ' ' })?.codigo).toBe('classificacao-obrigatoria');
    expect(conferirNfse({ ...p, retencoes: { ...p.retencoes, ir: 10_000 } })?.codigo).toBe('retencoes-acima');
  });
  it('nada sai para a prefeitura fora de produção ou sem a DP-38; o simulador numera', () => {
    expect(destinoNfse('dev', true)).toBe('simulador');
    expect(destinoNfse('producao', false)).toBe('simulador');
    expect(destinoNfse('producao', true)).toBe('prefeitura');
    const xml = xmlNfse({
      ...calcularNfse(p),
      numeroRps: '1',
      tomador: 'Operadora <X>',
      itemServico: '04.01',
    });
    expect(xml).toContain('<vLiq>8885.00</vLiq>');
    expect(xml).toContain('Operadora &lt;X&gt;');
    expect(simularPrefeitura(xml, 12)).toEqual({ situacao: 'simulada', numero: 'SIM000000012' });
    expect(() => simularPrefeitura('<x/>', 1)).toThrow();
  });
});
