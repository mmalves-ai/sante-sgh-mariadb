// Lote 05-10 (achado da revisão): a guarda da imutabilidade decide pela lista clínica do modelo próprio, derivada do
// DDL (db/migracoes), e nunca passa vazia. Operações sintéticas; nenhum banco.
import { describe, expect, it } from 'vitest';
import {
  ErroSemTabelasClinicas,
  decisorDeleteClinico,
  grantsDeleteClinicoSgh,
  operacoesComDeleteClinico,
  tabelasClinicasDoDdl,
  tabelasClinicasDoModelo,
} from './imutabilidade.ts';

const op = (nome: string, tabela: string) => ({
  [nome]: { receita: { nome, passos: [{ tabela, acao: 'DELETE' }] } },
});

describe('imutabilidade clínica sobre o modelo próprio', () => {
  const clinicas = tabelasClinicasDoModelo();

  it('reconhece as tabelas clínicas no DDL (prontuário, internação, cirurgia, SADT e trilha)', () => {
    expect(clinicas.length).toBeGreaterThan(50);
    for (const t of ['prescricao', 'internacao', 'trilha_auditoria']) expect(clinicas).toContain(t);
    // Cadastro e configuração não são registro do paciente.
    expect(clinicas).not.toContain('carater_admissao');
    expect(clinicas).not.toContain('motivo_saida_hospitalar');
  });

  it('aponta DELETE sintético em prescricao, internacao e trilha_auditoria; deixa passar cadastro', () => {
    const ops = {
      ...op('sintetica/a.ts', 'prescricao'),
      ...op('sintetica/b.ts', 'internacao'),
      ...op('sintetica/c.ts', 'trilha_auditoria'),
      ...op('sintetica/d.ts', 'carater_admissao'),
    };
    expect(operacoesComDeleteClinico(ops, decisorDeleteClinico(clinicas)).map((a) => a.tabela)).toEqual([
      'prescricao',
      'internacao',
      'trilha_auditoria',
    ]);
  });

  it('aponta GRANT de DELETE em tabela clínica do modelo nas migrações', () => {
    const sql =
      'GRANT SELECT, INSERT, DELETE ON prescricao TO sgh_app;\nGRANT DELETE ON carater_admissao TO sgh_app;';
    expect(grantsDeleteClinicoSgh([{ arquivo: 'x.sql', sql }], decisorDeleteClinico(clinicas))).toEqual([
      { origem: 'script-sgh', onde: 'x.sql', tabela: 'prescricao' },
    ]);
  });

  it('lista vazia é recusa explícita (nunca verde silencioso)', () => {
    expect(() => decisorDeleteClinico([])).toThrow(ErroSemTabelasClinicas);
    expect(() => decisorDeleteClinico(['trilha_auditoria'])).toThrow(/0 tabelas clínicas reconhecidas/);
  });

  it('o código real (portas e migrações) não tem DELETE clínico fora das exceções', () => {
    expect(operacoesComDeleteClinico()).toEqual([]);
  });

  it('o critério do DDL: coluna do paciente, da passagem ou da internação', () => {
    const ddl =
      'CREATE TABLE evolucao_x (\n  id BIGINT,\n  paciente_id BIGINT UNSIGNED NOT NULL\n);\nCREATE TABLE tipo_x (\n  id BIGINT,\n  codigo VARCHAR(30)\n);';
    expect(tabelasClinicasDoDdl(ddl)).toEqual(['evolucao_x']);
  });
});
