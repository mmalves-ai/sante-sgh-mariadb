// Snapshot da etiqueta ZPL da amostra (ficha do M26, regra 3): o código único no Code 128 e os dois identificadores
// do paciente, com dados sintéticos (nenhum nome real). Mudar a etiqueta exige rever o snapshot.
import type { ExameSadt } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { codigoDaAmostra, codigoValido } from '@sgh/dominio-sadt';
import { etiquetaDaAmostra } from './etiqueta-amostra.js';

const exame = (codigo: string): ExameSadt => ({
  id: 1,
  chave: { data: '2026-10-22', reg: 31337, conta: 1, atend: 'I', ato: 15, exame: codigo, sequencia: 0 },
  versao: null,
  paciente: {
    id: 1001,
    prontuario: 501001,
    nome: 'JOSÉ DA SILVA SINTETICO',
    sexo: 'M',
    idadeAnos: 68,
    nascimento: '1958-03-12',
  },
  atendimento: { cabecalho: '10011', reg: 31337, tipo: 'I', unidade: 1, leito: '101A' },
  setor: 'laboratorio',
  ato: 15,
  atoRotulo: 'Patologia clínica',
  exame: { id: 502, codigo, nome: `EXAME ${codigo}` },
  estado: 'solicitado',
  estadoRotulo: 'Solicitado',
  urgente: false,
  origem: 'pedidoProntuario',
  solicitante: '',
  pedidoEm: null,
  previsaoColeta: null,
  material: 'SANGUE',
  recipiente: { codigo: 2, nome: 'TUBO AMARELO (SORO)' },
  especialidade: null,
  amostra: null,
  critico: false,
});

describe('etiqueta da amostra (ZPL)', () => {
  it('o código único da amostra no Code 128 e os dois identificadores do paciente', () => {
    const codigo = codigoDaAmostra('PC', 1234);
    expect(codigoValido(codigo)).toBe(true);
    const zpl = etiquetaDaAmostra(codigo, exame('K'), [exame('K'), exame('NA')]);
    expect(zpl).toMatchSnapshot();
    expect(zpl).toContain(`^FD${codigo}^FS`);
    expect(zpl).toContain('NASC. 12/03/1958');
    expect(zpl).toContain('PRONT. 501001');
  });

  it('sem a data de nascimento a etiqueta não sai (o segundo identificador é obrigatório)', () => {
    const sem = { ...exame('K'), paciente: { ...exame('K').paciente, nascimento: null } };
    expect(() => etiquetaDaAmostra(codigoDaAmostra('PC', 1), sem, [sem])).toThrow(/nascimento/i);
  });
});
