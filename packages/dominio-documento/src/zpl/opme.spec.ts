// Ficha do M46, etapa 3 (regra 6; seção 10, "ZPL das etiquetas em snapshot"): a etiqueta do consumo de OPME em três
// vias, comparada como texto com a referência versionada (referencias/etiqueta-opme.zpl). Dados sintéticos.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ErroZpl } from './modelos.js';
import { zplEtiquetaOpme } from './opme.js';

const DADOS_ETIQUETA_OPME = {
  consumo: 4631,
  lancamento: 9876543,
  atendimento: 123456,
  conta: 765432,
  iniciais: 'P.S.T.',
  data: '26/10/2026',
  item: 'Placa sintética de titânio 6 furos',
  tuss: '70000014',
  quantidade: 1,
  fabricante: 'Fabricante Sintético Ltda',
  modelo: 'PX-6',
  lote: 'L-77',
  serie: 'SN^123',
  registroAnvisa: '80123450001',
  validade: '31/01/2028',
};

describe('etiqueta do consumo de OPME (três vias, ZPL)', () => {
  it('igual à referência versionada', () => {
    const ref = readFileSync(new URL('./referencias/etiqueta-opme.zpl', import.meta.url), 'utf8');
    expect(zplEtiquetaOpme(DADOS_ETIQUETA_OPME)).toBe(ref);
  });
  it('três vias na ordem; o TUSS e a conta só na do faturamento; o ^ do texto escapado', () => {
    const z = zplEtiquetaOpme(DADOS_ETIQUETA_OPME);
    expect(z.match(/\^XA/g)).toHaveLength(3);
    expect(z.indexOf('VIA PRONTUARIO')).toBeLessThan(z.indexOf('VIA PACIENTE'));
    expect(z.indexOf('VIA PACIENTE')).toBeLessThan(z.indexOf('VIA FATURAMENTO'));
    expect(z.match(/TUSS 70000014/g)).toHaveLength(1);
    expect(z).toContain('SN_5E123');
    expect(z).toContain('^FDOPME-4631-9876543^FS');
    expect(z).not.toMatch(/SINTETICO DA SILVA/);
  });
  it('quantidade fracionada, sem modelo e sem validade', () => {
    const z = zplEtiquetaOpme({
      ...DADOS_ETIQUETA_OPME,
      quantidade: 1.5,
      modelo: null,
      validade: null,
      tuss: null,
    });
    expect(z).toContain('QTDE 1.500');
    expect(z).toContain('MODELO -');
    expect(z).toContain('VAL -');
    expect(z).toContain('TUSS -');
  });
  it('recusa sem lote nem série, Anvisa inválido, quantidade e IDs inválidos', () => {
    expect(() => zplEtiquetaOpme({ ...DADOS_ETIQUETA_OPME, lote: null, serie: ' ' })).toThrow(ErroZpl);
    expect(() => zplEtiquetaOpme({ ...DADOS_ETIQUETA_OPME, registroAnvisa: '12' })).toThrow(/Anvisa/);
    expect(() => zplEtiquetaOpme({ ...DADOS_ETIQUETA_OPME, quantidade: 0 })).toThrow(/Quantidade/);
    expect(() => zplEtiquetaOpme({ ...DADOS_ETIQUETA_OPME, consumo: 0 })).toThrow(/consumo/);
    expect(() => zplEtiquetaOpme({ ...DADOS_ETIQUETA_OPME, atendimento: -1 })).toThrow(/atendimento/);
  });
});
