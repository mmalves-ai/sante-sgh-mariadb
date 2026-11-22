// M60.3, sobre o banco próprio: o anexo dos privilégios do papel da aplicação, gerado das migrações e do código.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lerMigracoes } from './listas.ts';
import {
  ANEXOS_PRIVILEGIOS,
  anexoDePrivilegios,
  comandoGrant,
  COMANDO_PAPEL,
  comandoRevoke,
  conferirAnexoPrivilegios,
  lerFontes,
  PAPEL,
  privilegiosDoPapel,
  privilegiosDoRepositorio,
  tabelasComExclusaoFisica,
  tabelasDoDdl,
  tabelasDoModelo,
} from './privilegios.ts';

const DDL = `-- CREATE TABLE no comentário não conta
CREATE TABLE trilha_auditoria (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  criado_em DATETIME(3) NOT NULL
) COMMENT='Trilha';
CREATE TABLE paciente (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL COMMENT 'Nome (excluido_em no comentário não conta)',
  excluido_em DATETIME(3) NULL
) COMMENT='Paciente';
ALTER TABLE paciente ADD CONSTRAINT fk_x FOREIGN KEY (id) REFERENCES paciente (id);
CREATE TABLE IF NOT EXISTS sequencia_negocio (
  id BIGINT UNSIGNED NOT NULL
);
CREATE TABLE reserva (
  id BIGINT UNSIGNED NOT NULL,
  excluido_em DATETIME(3) NULL
);`;

const raiz = resolve(import.meta.dirname, '../../..');

describe('privilégios do papel da aplicação no banco do cliente e no da plataforma', () => {
  it('lê as tabelas do DDL com a marca da exclusão lógica', () => {
    expect(tabelasDoDdl(DDL)).toEqual([
      { tabela: 'trilha_auditoria', exclusaoLogica: false },
      { tabela: 'paciente', exclusaoLogica: true },
      { tabela: 'sequencia_negocio', exclusaoLogica: false },
      { tabela: 'reserva', exclusaoLogica: true },
    ]);
  });

  it('menor privilégio: trilha só de acréscimo; exclusão lógica sem DELETE, salvo exclusão física no código', () => {
    const fisica = tabelasComExclusaoFisica(['await l.executar("DELETE FROM reserva WHERE id = ?", [id]);']);
    const itens = privilegiosDoPapel(tabelasDoDdl(DDL), fisica);
    expect(itens).toEqual([
      { tabela: 'paciente', acoes: ['SELECT', 'INSERT', 'UPDATE'] },
      { tabela: 'reserva', acoes: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
      { tabela: 'sequencia_negocio', acoes: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
      { tabela: 'trilha_auditoria', acoes: ['SELECT', 'INSERT'] },
    ]);
    expect(comandoGrant(itens[0]!)).toBe(`GRANT SELECT, INSERT, UPDATE ON paciente TO ${PAPEL};`);
    expect(comandoRevoke(itens[0]!)).toBe(`REVOKE DELETE ON paciente FROM ${PAPEL};`);
    expect(comandoRevoke(itens[1]!)).toBeNull();
    expect(comandoRevoke(itens[3]!)).toBe(`REVOKE UPDATE, DELETE ON trilha_auditoria FROM ${PAPEL};`);
  });

  it('exclusão física pelo núcleo: Escritor.excluir e excluirAuditado com a tabela literal', () => {
    const fisica = tabelasComExclusaoFisica([
      "await tx.excluir('plantao', num(p['id']), num(p['versao']));",
      'await tx.excluir("escala", e.id, e.versao);',
      "await excluirAuditado(e, 'reserva_leito', id, versao);",
      'return this.servico.excluir(sessaoDe(req), idDaRota(id), corpo(x, b));',
    ]);
    expect([...fisica].sort()).toEqual(['escala', 'plantao', 'reserva_leito']);
  });

  it('exclusão lógica acrescentada depois por ALTER TABLE (em outra migração) tira o DELETE', () => {
    const criacao = 'CREATE TABLE regra_visita (\n  id BIGINT UNSIGNED NOT NULL\n);';
    const depois = `-- ALTER TABLE regra_visita ADD COLUMN excluido_em no comentário não conta
ALTER TABLE outra ADD COLUMN nome VARCHAR(10) NULL;
ALTER TABLE regra_visita
  ADD COLUMN excluido_em DATETIME(3) NULL AFTER versao,
  ADD COLUMN excluido_por BIGINT UNSIGNED NULL;`;
    expect(tabelasDoModelo([criacao, depois])).toEqual([{ tabela: 'regra_visita', exclusaoLogica: true }]);
    expect(tabelasDoModelo([criacao])).toEqual([{ tabela: 'regra_visita', exclusaoLogica: false }]);
    const [item] = privilegiosDoPapel(tabelasDoModelo([criacao, depois]));
    expect(item?.acoes).toEqual(['SELECT', 'INSERT', 'UPDATE']);
  });

  it('recusa nome de tabela fora do padrão de identificador', () => {
    expect(() => privilegiosDoPapel([{ tabela: 'tb"; DROP', exclusaoLogica: false }])).toThrow(
      /nome inválido/,
    );
  });

  it('o anexo só cria o papel, concede e retira (convergente); a conferência acusa a tabela nova e o papel ausente', () => {
    const itens = privilegiosDoPapel(tabelasDoDdl(DDL));
    const sql = anexoDePrivilegios(itens);
    const comandos = sql
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('--'))
      .join('\n');
    expect(comandos).not.toMatch(/\b(ALTER|DROP|CREATE TABLE|DELETE FROM|UPDATE \w+ SET|INSERT INTO)\b/i);
    expect(comandos.split('\n').every((l) => /^(CREATE ROLE IF NOT EXISTS|GRANT|REVOKE) /.test(l))).toBe(
      true,
    );
    // Cada REVOKE vem logo depois do GRANT da mesma tabela (o REVOKE nunca falha por falta de concessão).
    const linhas = comandos.split('\n');
    linhas.forEach((l, i) => {
      if (l.startsWith('REVOKE')) {
        const tabela = l.split(' ON ')[1]!.split(' ')[0];
        const anterior = linhas[i - 1] ?? '';
        expect(anterior.startsWith('GRANT ') && anterior.includes(` ON ${tabela} TO`)).toBe(true);
      }
    });
    expect(sql).toContain(COMANDO_PAPEL);
    expect(
      conferirAnexoPrivilegios(sql.replace(`REVOKE DELETE ON paciente FROM ${PAPEL};`, ''), itens),
    ).toEqual(['paciente']);
    expect(conferirAnexoPrivilegios(sql, itens)).toEqual([]);
    const mais = privilegiosDoPapel([...tabelasDoDdl(DDL), { tabela: 'nova', exclusaoLogica: false }]);
    expect(conferirAnexoPrivilegios(sql, mais)).toEqual(['nova']);
    expect(conferirAnexoPrivilegios(sql.replace(COMANDO_PAPEL, ''), itens)).toEqual(['(papel)']);
  });

  it('o modelo do repositório: toda tabela das migrações tem privilégio e a trilha só de acréscimo', () => {
    const itens = privilegiosDoRepositorio(raiz).cliente;
    const criadas = lerMigracoes(raiz)
      .filter((m) => m.etapa === 'tabelas')
      .map((m) => readFileSync(resolve(raiz, 'db/migracoes', m.arquivo), 'utf8'))
      .join('\n')
      .split('\n')
      .filter((l) => /^\s*CREATE\s+TABLE\b/i.test(l)).length;
    expect(itens.length).toBe(criadas);
    expect(itens.find((i) => i.tabela === 'trilha_auditoria')?.acoes).toEqual(['SELECT', 'INSERT']);
    expect(itens.find((i) => i.tabela === 'regra_visita_unidade')?.acoes).not.toContain('DELETE');
  });

  it('o repositório: toda tabela apagada pelo núcleo (.excluir) tem DELETE, e os anexos gerados estão em dia', () => {
    const p = privilegiosDoRepositorio(raiz);
    const fontes = lerFontes([resolve(raiz, 'apps'), resolve(raiz, 'packages')]);
    const apagadas = new Set(
      fontes.flatMap((f) =>
        [...f.matchAll(/\.excluir\(\s*['"`]([a-z][a-z0-9_]*)['"`]\s*,/g)].map((m) => m[1]!),
      ),
    );
    expect(apagadas.size).toBeGreaterThan(0);
    const semDelete = [...apagadas].filter(
      (t) => !p.cliente.find((i) => i.tabela === t)?.acoes.includes('DELETE'),
    );
    expect(semDelete).toEqual([]);
    for (const banco of ['cliente', 'plataforma'] as const) {
      const anexo = resolve(raiz, ANEXOS_PRIVILEGIOS[banco]);
      expect(existsSync(anexo)).toBe(true);
      expect(conferirAnexoPrivilegios(readFileSync(anexo, 'utf8'), p[banco])).toEqual([]);
    }
  });

  it('o banco da plataforma tem o seu anexo: clientes, credencial e fila do conector; a linha do tempo só de acréscimo', () => {
    const p = privilegiosDoRepositorio(raiz).plataforma;
    expect(p.map((i) => i.tabela)).toEqual(
      expect.arrayContaining([
        'cliente',
        'administrador_plataforma',
        'credencial_administrador_plataforma',
        'conector_execucao',
      ]),
    );
    expect(p.find((i) => i.tabela === 'cliente_evento')?.acoes).toEqual(['SELECT', 'INSERT']);
    expect(anexoDePrivilegios(p, 'plataforma')).toContain('banco da PLATAFORMA');
  });
});
