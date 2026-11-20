// M59-F3 (regra 6): a lista das tabelas clínicas está em dia com a matriz, e o repositório não dá DELETE clínico.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAMINHO_TABELAS_CLINICAS,
  gerarTabelasClinicas,
  grantsDeleteClinicoSgh,
  operacoesComDeleteClinico,
  scriptsSghDoRepositorio,
  tabelasClinicasDaMatriz,
} from './imutabilidade.ts';
import { RAIZ } from './privilegios.ts';

describe('imutabilidade clínica (regra 6)', () => {
  it('a lista gerada das tabelas clínicas está em dia (rode pnpm imutabilidade:gerar)', () => {
    expect(readFileSync(resolve(RAIZ, CAMINHO_TABELAS_CLINICAS), 'utf8')).toBe(gerarTabelasClinicas());
  });

  it('a matriz: módulos clínicos, telas do registro e natureza de registro; cabeçalho exigido', () => {
    const tsv = [
      'tabela\tlinhas\tmodulo\ttela_funcao\tnatureza\tdestino\tdescricao',
      'PRB\t1\tPEP\tPEP > Prescrição\tmovimento\tx\tx',
      'PRA\t1\tPEP\tPEP > Registros clínicos\thistorico\tx\tx',
      'PRDOM\t1\tPEP\tPEP > x\tdominio\tx\tx',
      'PRCFG\t1\tPEP\tConfigurações > Prescrição\tvinculo\tx\tx',
      'PRCAD\t1\tPEP\tCadastros > Farmacologia\tvinculo\tx\tx',
      'SIRES\t1\tSADT\tLaboratório > Digitação de resultados\tmovimento\tx\tx',
      'SILAUDO\t1\tSADT\tLaudos > Emissão\thistorico\tx\tx',
      'SIORC\t1\tSADT\tSADT > Orçamento de exames\tmovimento\tx\tx',
      'CCCIR\t1\tCC\tCentro Cirúrgico > Registro de cirurgia\tmovimento\tx\tx',
      'CCAG\t1\tCC\tCentro Cirúrgico > Agenda cirúrgica\tmovimento\tx\tx',
      'FAT1\t1\tFAT\tx\tmovimento\tx\tx',
    ].join('\n');
    expect(tabelasClinicasDaMatriz(tsv)).toEqual(['CCCIR', 'PRA', 'PRB', 'SILAUDO', 'SIRES']);
    expect(() => tabelasClinicasDaMatriz('x\ty\n')).toThrow(/cabeçalho/);
  });

  it('nenhuma operação do catálogo apaga registro clínico fora das exceções', () => {
    expect(operacoesComDeleteClinico()).toEqual([]);
    const ruim = {
      x: { receita: { nome: 'pep.apagar', passos: [{ tabela: 'SGH_PEP_DOC', acao: 'DELETE' }] } },
      y: { receita: { nome: 'pep.caso', passos: [{ tabela: 'SGH_PEP_FORMNOVO_CASO', acao: 'DELETE' }] } },
    };
    expect(operacoesComDeleteClinico(ruim)).toEqual([
      { origem: 'operacao', onde: 'pep.apagar', tabela: 'SGH_PEP_DOC' },
    ]);
  });

  it('nenhum script SGH_ concede DELETE em tabela SGH_ clínica ao papel da aplicação', () => {
    expect(grantsDeleteClinicoSgh(scriptsSghDoRepositorio())).toEqual([]);
    expect(
      grantsDeleteClinicoSgh([
        { arquivo: 'a.sql', sql: 'GRANT SELECT, INSERT, DELETE ON SGH_PEP_DOC TO ROLE SGH_APLICACAO' },
        { arquivo: 'b.sql', sql: 'GRANT ALL ON SGH_DOC_ASSINATURA TO SGH_APLICACAO' },
        { arquivo: 'c.sql', sql: 'GRANT DELETE ON SGH_PEP_FORMNOVO_CASO TO ROLE SGH_APLICACAO' },
        { arquivo: 'd.sql', sql: 'GRANT UPDATE (X) ON SGH_PEP_DOC TO ROLE SGH_APLICACAO' },
      ]).map((a) => a.onde),
    ).toEqual(['a.sql', 'b.sql']);
  });
});
