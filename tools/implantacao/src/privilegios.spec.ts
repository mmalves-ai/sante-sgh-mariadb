// M60.3: o anexo dos privilégios de escrita do papel SGH_APLICACAO, gerado do registro das receitas.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OPERACOES } from '@sgh/legado';
import { describe, expect, it } from 'vitest';
import {
  anexoDePrivilegios,
  comandoGrant,
  conferirAnexoPrivilegios,
  MARCA_EXCECOES,
  MARCA_PSQL,
  PAPEL,
  privilegiosDoPapel,
} from './privilegios.ts';

const passo = (tabela: string, acao: 'INSERT' | 'UPDATE' | 'DELETE') => ({
  ordem: 1,
  tabela,
  acao,
  colunas: {},
});
const efeito = (tabela: string, acao: 'INSERT' | 'UPDATE' | 'DELETE') => ({
  trigger: 'TRG_X',
  tabela,
  acao,
  faz: '',
});

describe('privilégios do papel nas tabelas do sistema anterior', () => {
  it('junta passos e efeitos por tabela, ações em ordem fixa, sem tabela SGH_', () => {
    const itens = privilegiosDoPapel([
      {
        nome: 'a.um',
        passos: [passo('TBB', 'UPDATE'), passo('SGH_X', 'INSERT')],
        efeitos: [efeito('TBA', 'INSERT')],
      },
      { nome: 'a.dois', passos: [passo('tbb', 'INSERT'), passo('TBB', 'DELETE')], efeitos: [] },
    ]);
    expect(itens).toEqual([
      { tabela: 'TBA', acoes: ['INSERT'], receitas: 1 },
      { tabela: 'TBB', acoes: ['INSERT', 'UPDATE', 'DELETE'], receitas: 2 },
    ]);
    expect(comandoGrant(itens[1]!)).toBe('GRANT INSERT, UPDATE, DELETE ON "TBB" TO ROLE SGH_APLICACAO;');
  });

  it('recusa nome de tabela fora do padrão de identificador (nada de SQL montado com texto livre)', () => {
    expect(() =>
      privilegiosDoPapel([{ nome: 'a.mau', passos: [passo('TB"; DROP', 'INSERT')], efeitos: [] }]),
    ).toThrow(/nome inválido/);
  });

  it('o anexo só concede (GRANT), traz o bloco das sequências e a conferência acusa a tabela nova', () => {
    const itens = privilegiosDoPapel([{ nome: 'a.um', passos: [passo('TBA', 'INSERT')], efeitos: [] }]);
    const sql = anexoDePrivilegios(itens);
    const comandos = sql
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('--'))
      .join('\n');
    expect(comandos).not.toMatch(/\b(ALTER|DROP|CREATE|DELETE FROM|UPDATE \w+ SET|INSERT INTO|REVOKE)\b/i);
    expect(sql).toContain('GRANT USAGE ON SEQUENCE');
    expect(sql).toContain("NOT STARTING WITH 'SGH_'");
    expect(conferirAnexoPrivilegios(sql, itens)).toEqual([]);
    const mais = privilegiosDoPapel([
      { nome: 'a.um', passos: [passo('TBA', 'INSERT'), passo('TBN', 'UPDATE')], efeitos: [] },
    ]);
    expect(conferirAnexoPrivilegios(sql, mais)).toEqual(['TBN']);
  });

  it('efeito com procedimento: o anexo dá ao papel o EXECUTE nos módulos que os gatilhos chamam, sem escrita direta a mais', () => {
    // O retrato do atendimento: o gatilho de ATCABECATEND chama SPHISTATENDIMENTO, que grava HTATENDIMENTO.
    const itens = privilegiosDoPapel([
      {
        nome: 'internacao.internar',
        passos: [passo('ATCABECATEND', 'UPDATE')],
        efeitos: [
          {
            trigger: 'TRG_ATCABECATEND_AIU',
            tabela: 'HTATENDIMENTO',
            acao: 'INSERT',
            faz: 'retrato do atendimento (SPHISTATENDIMENTO)',
          },
        ],
      },
    ]);
    const sql = anexoDePrivilegios(itens);
    const bloco = sql.slice(sql.indexOf(MARCA_PSQL));
    expect(bloco.length).toBeGreaterThan(0);
    // Fecho tirado do banco: os módulos (5 procedimento, 15 função) que os gatilhos chamam e os que esses chamam;
    // a escrita vai a todo gatilho do sistema anterior e aos módulos do fecho (caminhos que a assinatura não percorreu).
    expect(bloco).toContain('WHERE d.RDB$DEPENDENT_TYPE = 2 AND d.RDB$DEPENDED_ON_TYPE IN (5, 15)');
    expect(bloco).toContain('(d.RDB$DEPENDENT_TYPE = 2 AND COALESCE(g.RDB$SYSTEM_FLAG, 1) = 0)');
    expect(bloco).toContain('d.RDB$DEPENDED_ON_TYPE IN (5, 15)');
    expect(bloco).toContain('WHILE (novos > 0) DO');
    expect(bloco).toContain(`'GRANT EXECUTE ON PROCEDURE "' || :n || '" TO ROLE ${PAPEL}'`);
    expect(bloco).toContain(`'GRANT EXECUTE ON FUNCTION "' || :n || '" TO ROLE ${PAPEL}'`);
    // A escrita das tabelas que o módulo toca vai ao próprio módulo ou gatilho, nunca ao papel.
    expect(bloco).toContain("DECODE(:k, 2, 'TRIGGER', 5, 'PROCEDURE', 'FUNCTION')");
    const aoPapel = bloco.match(/GRANT [A-Z, ]+ ON [A-Z]* ?"' \|\| :\w+ \|\| '" TO ROLE/g) ?? [];
    expect(aoPapel.every((g) => g.startsWith('GRANT EXECUTE ON '))).toBe(true);
    expect(aoPapel).toHaveLength(2);
    // Só concede; o bloco fecha com COMMIT.
    expect(bloco).not.toMatch(/\b(ALTER|DROP|CREATE|DELETE FROM|UPDATE \w+ SET|INSERT INTO|REVOKE)\b/i);
    expect(bloco.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(conferirAnexoPrivilegios(sql, itens)).toEqual([]);
    // Um anexo sem o bloco (o da 1ª versão do M60.3) é acusado pela conferência do verificar.
    expect(conferirAnexoPrivilegios(sql.slice(0, sql.indexOf(MARCA_EXCECOES)), itens)).toEqual([
      '(exceções dos gatilhos)',
      '(procedimentos e funções dos gatilhos)',
    ]);
    // As exceções que as regras dos gatilhos levantam: USAGE ao papel, todas as do sistema anterior.
    expect(sql).toContain(`'GRANT USAGE ON EXCEPTION "' || :e || '" TO ROLE ${PAPEL}'`);
    expect(sql.indexOf(MARCA_EXCECOES)).toBeLessThan(sql.indexOf(MARCA_PSQL));
  });

  it('o anexo do repositório está em dia com as receitas registradas (inclui a trilha do login)', () => {
    const itens = privilegiosDoPapel(Object.values(OPERACOES).map((o) => o.receita));
    const texto = readFileSync(
      resolve(import.meta.dirname, '../../../docs/implantacao/anexos/privilegios-papel.sql'),
      'utf8',
    );
    expect(conferirAnexoPrivilegios(texto, itens)).toEqual([]);
    expect(texto).toContain('GRANT INSERT ON "TBCABTRILHA" TO ROLE SGH_APLICACAO;');
    expect(texto).toContain(MARCA_PSQL);
    expect(itens.every((i) => !i.tabela.startsWith('SGH_'))).toBe(true);
  });
});
