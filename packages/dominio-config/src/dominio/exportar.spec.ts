// Regra 6 do M08: exportação exige `exportar` e trilha; com dado pessoal, a justificativa do legado.
import { describe, expect, it } from 'vitest';
import { conferirExportacao, gerarCsv } from './exportar.js';

const validas = new Set([1, 2, 3, 4]);

describe('exportação (regra 6)', () => {
  it('sem permissão, recusa', () => {
    expect(
      conferirExportacao({
        podeExportar: false,
        temDadoPessoal: false,
        justificativa: undefined,
        justificativasValidas: validas,
      }),
    ).toBe('sem-permissao');
  });
  it('sem dado pessoal, dispensa a justificativa', () => {
    expect(
      conferirExportacao({
        podeExportar: true,
        temDadoPessoal: false,
        justificativa: undefined,
        justificativasValidas: validas,
      }),
    ).toBeNull();
  });
  it('com dado pessoal: exige justificativa existente', () => {
    const b = { podeExportar: true, temDadoPessoal: true, justificativasValidas: validas };
    expect(conferirExportacao({ ...b, justificativa: undefined })).toBe('justificativa-obrigatoria');
    expect(conferirExportacao({ ...b, justificativa: 9 })).toBe('justificativa-inexistente');
    expect(conferirExportacao({ ...b, justificativa: 2 })).toBeNull();
  });
  it('CSV com ; aspas, fórmula neutralizada e situação', () => {
    const csv = gerarCsv(
      [
        { campo: 'nome', rotulo: 'Descrição' },
        { campo: 'cor', rotulo: 'Cor' },
      ],
      [
        { codigo: '1', ativo: true, valores: { nome: 'Com; ponto e "aspas"', cor: '=1+1' }, versao: '' },
        { codigo: '2', ativo: false, valores: { nome: null }, versao: '' },
      ],
    );
    expect(csv.split('\r\n')).toEqual([
      'Código;Descrição;Cor;Situação',
      '1;"Com; ponto e ""aspas""";\'=1+1;Ativo',
      '2;;;Inativo',
      '',
    ]);
  });
});
