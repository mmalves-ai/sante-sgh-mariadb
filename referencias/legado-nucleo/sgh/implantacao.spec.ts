// M60, etapa 1 (migração): `sgh:aplicar` retomável (o registro na transação do DDL; o 0001 retomado), com
// tempo por script; `--simular` só com leitura; `--recolher` em ordem reversa de dependência, sem tocar em
// nada de fora do SGH_, e as recusas.
import { describe, expect, it } from 'vitest';
import { escritorDuble } from '../duble-escritor.spec-util.js';
import type { Escritor, Leitor } from '../transacao.js';
import {
  aplicarScripts,
  registraEmTransacaoPropria,
  simularScripts,
  type AcessoScripts,
} from './aplicador.js';
import {
  lerObjetosSgh,
  type ObjetosSgh,
  ordenarVisoesParaRemover,
  planejarRecolhimento,
  recolherSgh,
} from './recolhimento.js';
import { resolve } from 'node:path';
import {
  hashScript,
  lerScriptsSgh,
  objetosCriados,
  ordemDeAplicacao,
  planejarScripts,
  type ScriptSgh,
} from './scripts.js';

const script = (numero: number, comandos: string[]): ScriptSgh => ({
  numero,
  arquivo: `g/sgh/${String(numero).padStart(4, '0')}_x.sql`,
  grupo: 'g',
  descricao: 'x',
  hash: hashScript(comandos.join(';')),
  comandos,
});

const s1 = script(1, ['CREATE ROLE SGH_APLICACAO', 'CREATE TABLE SGH_VERSAO_SCRIPT (N INTEGER)']);
const s2 = script(2, ['CREATE TABLE SGH_B (ID INTEGER)', 'GRANT SELECT ON SGH_B TO ROLE SGH_APLICACAO']);
const s3 = script(3, ['ALTER TABLE SGH_B ADD NOME VARCHAR(10)']);

/**
 * Banco dublê transacional: objetos e registros confirmados só no COMMIT; `cortarNaConfirmacao` derruba a
 * n-ésima confirmação (o processo cai antes do COMMIT: nada daquela transação fica).
 */
function bancoTransacional(cortarNaConfirmacao?: number) {
  let corte = cortarNaConfirmacao;
  const objetos = new Set<string>();
  const registros: { numero: number; hash: string }[] = [];
  const colunas = new Set<string>();
  let confirmacoes = 0;
  const leitor = escritorDuble((c) => {
    if (c.sql.includes('RDB$ROLES WHERE RDB$ROLE_NAME = ?'))
      return [{ N: objetos.has(String(c.parametros[0])) ? 1 : 0 }];
    if (c.sql.includes('FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = ?'))
      return [{ N: objetos.has('SGH_VERSAO_SCRIPT') ? 1 : 0 }];
    if (c.sql.includes('FROM SGH_VERSAO_SCRIPT'))
      return registros.map((r) => ({ NUMERO: r.numero, HASH_SHA256: r.hash }));
    return [];
  });
  const acesso: AcessoScripts = {
    ler: <T>(fn: (l: Leitor) => Promise<T>) => fn(leitor),
    escreverConfirmando: async <T>(fn: (w: Escritor) => Promise<T>) => {
      const novos: string[] = [];
      const novasColunas: string[] = [];
      const novosReg: { numero: number; hash: string }[] = [];
      const e = escritorDuble((c) => {
        const m = /^CREATE\s+(?:TABLE|ROLE)\s+(\w+)/i.exec(c.sql);
        if (m?.[1]) {
          if (objetos.has(m[1])) throw new Error(`objeto ${m[1]} já existe`);
          novos.push(m[1]);
        }
        const a = /^ALTER TABLE (\w+) ADD (\w+)/i.exec(c.sql);
        if (a) {
          if (colunas.has(`${a[1]}.${a[2]}`)) throw new Error('coluna já existe');
          novasColunas.push(`${a[1]}.${a[2]}`);
        }
        if (c.sql.startsWith('INSERT INTO SGH_VERSAO_SCRIPT')) {
          if (!objetos.has('SGH_VERSAO_SCRIPT')) throw new Error('tabela desconhecida');
          novosReg.push({ numero: Number(c.parametros[0]), hash: String(c.parametros[3]) });
        }
        return 1;
      });
      const r = await fn(e);
      confirmacoes++;
      if (confirmacoes === corte) throw new Error('conexão caiu antes do COMMIT');
      novos.forEach((o) => objetos.add(o));
      novasColunas.forEach((o) => colunas.add(o));
      registros.push(...novosReg);
      return r;
    },
  };
  return {
    acesso,
    objetos,
    registros,
    confirmacoes: () => confirmacoes,
    semCorte: () => {
      corte = undefined;
    },
  };
}

describe('M60: aplicação retomável e com tempo por script', () => {
  it('o 0001 registra em transação própria; os demais (e o ALTER) registram na transação do DDL', () => {
    expect(registraEmTransacaoPropria(s1)).toBe(true);
    expect(registraEmTransacaoPropria(s2)).toBe(false);
    expect(registraEmTransacaoPropria(script(9, ['ALTER TABLE SGH_VERSAO_SCRIPT ADD X INTEGER']))).toBe(true);
  });

  it('cortada no DDL de um script com ALTER: a reexecução segue dele, sem reaplicar o anterior', async () => {
    const b = bancoTransacional(3); // 1: DDL do 0001, 2: registro do 0001, 3: 0002 (DDL+registro) cai
    await expect(aplicarScripts(b.acesso, [s1, s2, s3], { ambiente: 'dev' })).rejects.toThrow(/caiu/);
    expect(b.registros.map((r) => r.numero)).toEqual([1]);
    expect(b.objetos.has('SGH_B')).toBe(false);
    b.semCorte();
    const r = await aplicarScripts(b.acesso, [s1, s2, s3], { ambiente: 'dev' });
    expect(r.aplicados.map((x) => x.numero)).toEqual([2, 3]);
    expect(r.jaAplicados).toBe(1);
    expect(b.registros.map((x) => x.numero)).toEqual([1, 2, 3]);
  });

  it('--relatorio: cortada no meio, os confirmados chegam por aoTempo e o que falhou por aoFalhar', async () => {
    const b = bancoTransacional(3); // 0001 confirma (DDL + registro); o 0002 cai
    const tempos: unknown[] = [];
    const falhas: unknown[] = [];
    let t = 0;
    await expect(
      aplicarScripts(b.acesso, [s1, s2, s3], {
        ambiente: 'dev',
        relogio: () => (t += 5),
        aoTempo: (x) => tempos.push([x.numero, x.situacao, x.ms]),
        aoFalhar: (f) => falhas.push([f.numero, f.arquivo, f.ms > 0, /caiu/.test(f.erro)]),
      }),
    ).rejects.toThrow(/caiu/);
    expect(tempos).toEqual([[1, 'aplicado', 5]]);
    expect(falhas).toEqual([[2, s2.arquivo, true, true]]);
  });

  it('cortada entre o DDL e o registro do 0001: a reexecução só registra o 0001 ("retomado") e segue', async () => {
    const b = bancoTransacional(2);
    await expect(aplicarScripts(b.acesso, [s1, s2], { ambiente: 'dev' })).rejects.toThrow(/caiu/);
    expect([...b.objetos].sort()).toEqual(['SGH_APLICACAO', 'SGH_VERSAO_SCRIPT']);
    expect(b.registros).toHaveLength(0);
    const sim = await simularScripts(b.acesso.ler, [s1, s2], { ambiente: 'dev' });
    expect(sim.pendentes.map((p) => [p.numero, p.acao])).toEqual([
      [1, 'retomar'],
      [2, 'aplicar'],
    ]);
    expect(sim.bloqueios).toHaveLength(0);
    // Reexecução no mesmo banco (agora sem corte).
    b.semCorte();
    const ok = b;
    const antes = ok.confirmacoes();
    let t = 0;
    const r = await aplicarScripts(ok.acesso, [s1, s2, s3], { ambiente: 'dev', relogio: () => (t += 10) });
    expect(r.tempos.map((x) => [x.numero, x.situacao])).toEqual([
      [1, 'retomado'],
      [2, 'aplicado'],
      [3, 'aplicado'],
    ]);
    expect(r.tempos.every((x) => x.ms === 10 && x.hash.length === 64)).toBe(true);
    expect(r.totalMs).toBeGreaterThan(0);
    expect(ok.registros.map((x) => x.numero)).toEqual([1, 2, 3]);
    // Uma transação por script (o 0001 retomado só registra).
    expect(ok.confirmacoes() - antes).toBe(3);
    // De novo: nada a fazer (idempotente).
    const r2 = await aplicarScripts(ok.acesso, [s1, s2, s3], { ambiente: 'dev' });
    expect(r2).toMatchObject({ aplicados: [], jaAplicados: 3, tempos: [] });
  });

  it('o 0001 pela metade (só o papel) ou objeto de outro script sem registro: recusa e a simulação aponta', async () => {
    const b = bancoTransacional();
    b.objetos.add('SGH_APLICACAO');
    await expect(aplicarScripts(b.acesso, [s1], { ambiente: 'dev' })).rejects.toThrow(
      /já existem sem registro/,
    );
    const c = bancoTransacional();
    await aplicarScripts(c.acesso, [s1], { ambiente: 'dev' });
    c.objetos.add('SGH_B');
    const sim = await simularScripts(c.acesso.ler, [s1, s2], { ambiente: 'dev' });
    expect(sim).toMatchObject({
      jaAplicados: 1,
      bloqueios: [{ arquivo: s2.arquivo, existentes: ['SGH_B'] }],
    });
    await expect(aplicarScripts(c.acesso, [s1, s2], { ambiente: 'dev' })).rejects.toThrow(/SGH_B/);
  });

  it('a simulação não grava nada e lista na ordem com o hash; recusa ambiente inválido e hash divergente', async () => {
    const b = bancoTransacional();
    const sim = await simularScripts(b.acesso.ler, [s1, s2], { ambiente: 'producao' });
    expect(sim.pendentes).toEqual([
      { numero: 1, arquivo: s1.arquivo, hash: s1.hash, comandos: 2, acao: 'aplicar' },
      { numero: 2, arquivo: s2.arquivo, hash: s2.hash, comandos: 2, acao: 'aplicar' },
    ]);
    expect(b.confirmacoes()).toBe(0);
    await expect(simularScripts(b.acesso.ler, [s1], { ambiente: 'x' as never })).rejects.toThrow(/inválido/);
    await aplicarScripts(b.acesso, [s1], { ambiente: 'dev' });
    const outro = { ...s1, hash: 'f'.repeat(64) };
    await expect(simularScripts(b.acesso.ler, [outro], { ambiente: 'dev' })).rejects.toThrow(
      /hash diferente/,
    );
  });

  it('a conta de leitura recebe SELECT só em SGH_VERSAO_SCRIPT (nunca SYSDBA; nome conferido antes do banco)', async () => {
    const b = bancoTransacional();
    const r = await aplicarScripts(b.acesso, [s1], { ambiente: 'dev', contaLeitura: 'sgh_leitura' });
    expect(r.leituraConcedidaA).toBe('SGH_LEITURA');
    const c = bancoTransacional();
    await expect(
      aplicarScripts(c.acesso, [s1], { ambiente: 'dev', contaLeitura: 'x; DROP' }),
    ).rejects.toThrow(/inválido/);
    expect(c.confirmacoes()).toBe(0);
    const d = bancoTransacional();
    expect(
      (await aplicarScripts(d.acesso, [s1], { ambiente: 'dev', contaLeitura: 'sysdba' })).leituraConcedidaA,
    ).toBeNull();
  });
});

const catalogo = (o: Partial<ObjetosSgh> = {}): ObjetosSgh => ({
  tabelas: ['SGH_VERSAO_SCRIPT', 'SGH_B', 'SGH_A'],
  visoes: ['SGH_V2', 'SGH_V1'],
  dependenciasDeVisao: [
    { visao: 'SGH_V2', de: 'SGH_V1' },
    { visao: 'SGH_V1', de: 'SGH_A' },
  ],
  chavesEstrangeiras: [{ tabela: 'SGH_B', restricao: 'SGH_FK_B_A' }],
  sequencias: ['SGH_SEQ_A'],
  papeis: ['SGH_APLICACAO', 'SGH_OUTRO'],
  dependentesDeFora: [],
  ...o,
});

describe('M60: recolhimento (só objetos SGH_, ordem reversa)', () => {
  it('FKs, visões dependentes primeiro, tabelas, sequências, SGH_VERSAO_SCRIPT e o papel da aplicação no fim', () => {
    expect(planejarRecolhimento(catalogo())).toEqual([
      'ALTER TABLE SGH_B DROP CONSTRAINT SGH_FK_B_A',
      'DROP VIEW SGH_V2',
      'DROP VIEW SGH_V1',
      'DROP TABLE SGH_A',
      'DROP TABLE SGH_B',
      'DROP SEQUENCE SGH_SEQ_A',
      'DROP TABLE SGH_VERSAO_SCRIPT',
      'DROP ROLE SGH_OUTRO',
      'DROP ROLE SGH_APLICACAO',
    ]);
    expect(
      planejarRecolhimento(
        catalogo({ tabelas: [], visoes: [], chavesEstrangeiras: [], sequencias: [], papeis: [] }),
      ),
    ).toEqual([]);
  });

  it('recusa quando algo de fora do SGH_ depende de um SGH_, nome fora do padrão e visões em ciclo', () => {
    expect(() =>
      planejarRecolhimento(catalogo({ dependentesDeFora: [{ dependente: 'PRC_LEGADA', de: 'SGH_A' }] })),
    ).toThrow(/PRC_LEGADA → SGH_A/);
    expect(() => planejarRecolhimento(catalogo({ tabelas: ['PACIENTE'] }))).toThrow(/fora do padrão/);
    expect(() =>
      ordenarVisoesParaRemover(
        ['SGH_X', 'SGH_Y'],
        [
          { visao: 'SGH_X', de: 'SGH_Y' },
          { visao: 'SGH_Y', de: 'SGH_X' },
        ],
      ),
    ).toThrow(/circular/);
  });

  it('lê o catálogo do sistema (visão por RDB$RELATION_TYPE; dependente de fora e FK de fora apontados)', async () => {
    const l = escritorDuble((c) => {
      if (c.sql.includes('FROM RDB$RELATIONS'))
        return [
          { NOME: 'SGH_A', TIPO: 0 },
          { NOME: 'SGH_V1', TIPO: 1 },
        ];
      if (c.sql.includes('JOIN RDB$REF_CONSTRAINTS')) return [{ DEPENDENTE: 'TBLEGADA', DE: 'SGH_A' }];
      if (c.sql.includes('FROM RDB$RELATION_CONSTRAINTS'))
        return [{ TABELA: 'SGH_A', RESTRICAO: 'SGH_FK_A' }];
      if (c.sql.includes('FROM RDB$DEPENDENCIES'))
        return [
          { DEPENDENTE: 'SGH_V1', DE: 'SGH_A' },
          { DEPENDENTE: 'TRG_LEGADO', DE: 'SGH_A' },
        ];
      if (c.sql.includes('FROM RDB$GENERATORS')) return [{ NOME: 'SGH_SEQ' }];
      if (c.sql.includes('FROM RDB$ROLES')) return [{ NOME: 'SGH_APLICACAO' }];
      return [];
    });
    const o = await lerObjetosSgh(l);
    expect(o).toEqual({
      tabelas: ['SGH_A'],
      visoes: ['SGH_V1'],
      dependenciasDeVisao: [{ visao: 'SGH_V1', de: 'SGH_A' }],
      chavesEstrangeiras: [{ tabela: 'SGH_A', restricao: 'SGH_FK_A' }],
      sequencias: ['SGH_SEQ'],
      papeis: ['SGH_APLICACAO'],
      dependentesDeFora: [
        { dependente: 'TRG_LEGADO', de: 'SGH_A' },
        { dependente: 'TBLEGADA', de: 'SGH_A' },
      ],
    });
    // Só consultas: nada executado na leitura.
    expect(l.comandos.every((c) => c.tipo === 'consultar')).toBe(true);
  });

  it('recolher: um DROP por transação, com o tempo; produção só com a autorização própria', async () => {
    const vazio = escritorDuble(() => []);
    const feitos: string[] = [];
    const acesso = {
      ler: <T>(fn: (l: Leitor) => Promise<T>) =>
        fn(
          escritorDuble((c) => {
            if (c.sql.includes('FROM RDB$RELATIONS')) return [{ NOME: 'SGH_VERSAO_SCRIPT', TIPO: 0 }];
            if (c.sql.includes('FROM RDB$ROLES')) return [{ NOME: 'SGH_APLICACAO' }];
            return [];
          }),
        ),
      escreverConfirmando: async <T>(fn: (e: Escritor) => Promise<T>) =>
        fn(
          escritorDuble((c) => {
            feitos.push(c.sql);
            return 1;
          }),
        ),
    };
    let t = 0;
    const r = await recolherSgh(acesso, { ambiente: 'dev', relogio: () => (t += 5) });
    expect(feitos).toEqual(['DROP TABLE SGH_VERSAO_SCRIPT', 'DROP ROLE SGH_APLICACAO']);
    expect(r.comandos.map((c) => c.ms)).toEqual([5, 5]);
    await expect(recolherSgh(acesso, { ambiente: 'producao' })).rejects.toThrow(/autorização própria/);
    await expect(
      recolherSgh(acesso, {
        ambiente: 'producao',
        autorizacao: '| 2026-11-01 | sgh:recolher producao pc | dono |',
      }),
    ).resolves.toBeTruthy();
    await expect(
      recolherSgh({ ...acesso, ler: (fn) => fn(vazio) }, { ambiente: 'x' as never }),
    ).rejects.toThrow(/inválido/);
  });
});

describe('ordem de aplicação (cópia limpa: script que cita objeto de script de número maior)', () => {
  const a = script(10, ['CREATE TABLE SGH_CONTA (ID INTEGER, ID_AUD INTEGER REFERENCES SGH_AUD (ID))']);
  const b = script(11, [
    'CREATE TABLE SGH_CONTA_EVT (ID INTEGER, ID_CONTA INTEGER REFERENCES SGH_CONTA (ID))',
  ]);
  const c = script(12, ['CREATE TABLE SGH_OUTRA (ID INTEGER)']);
  const d = script(19, ['CREATE TABLE SGH_AUD (ID INTEGER NOT NULL PRIMARY KEY)']);

  it('adia o script e quem depende dele até o criador; o resto segue o número', () => {
    expect(ordemDeAplicacao([d, c, b, a]).map((s) => s.numero)).toEqual([12, 19, 10, 11]);
    expect(planejarScripts([a, b, c, d], []).pendentes.map((s) => s.numero)).toEqual([12, 19, 10, 11]);
  });

  it('sem dependência adiante: a ordem do número; objeto já aplicado não conta', () => {
    expect(ordemDeAplicacao([s1, s2, s3]).map((s) => s.numero)).toEqual([1, 2, 3]);
    const p = planejarScripts([a, b, c, d], [{ numero: 19, hash: d.hash }]);
    expect(p.pendentes.map((s) => s.numero)).toEqual([10, 11, 12]);
  });

  it('objeto recriado por script posterior: o dono é o primeiro criador', () => {
    const x = script(20, ['CREATE TABLE SGH_X (ID INTEGER)']);
    const y = script(21, ['ALTER TABLE SGH_X ADD N INTEGER']);
    const z = script(22, ['DROP TABLE SGH_X', 'CREATE TABLE SGH_X (ID INTEGER)']);
    expect(ordemDeAplicacao([x, y, z]).map((s) => s.numero)).toEqual([20, 21, 22]);
  });

  it('ciclo: recusa', () => {
    const p = script(30, ['CREATE TABLE SGH_P (ID INTEGER, Q INTEGER REFERENCES SGH_Q (ID))']);
    const q = script(31, ['CREATE TABLE SGH_Q (ID INTEGER, P INTEGER REFERENCES SGH_P (ID))']);
    expect(() => ordemDeAplicacao([p, q])).toThrow(/circular/);
  });

  it('os scripts do repositório: nenhum cita objeto ainda não criado na ordem de aplicação', () => {
    const todos = lerScriptsSgh(resolve(import.meta.dirname, '../..'));
    const ordem = ordemDeAplicacao(todos);
    expect(ordem).toHaveLength(todos.length);
    expect(ordem[0]?.numero).toBe(1);
    const criados = new Set<string>();
    const donos = new Set(todos.flatMap((s) => objetosCriados(s)));
    for (const s of ordem) {
      const proprios = new Set(objetosCriados(s));
      for (const cmd of s.comandos) {
        for (const nome of cmd.toUpperCase().match(/\bSGH_[A-Z0-9_$]+/g) ?? []) {
          if (donos.has(nome) && !proprios.has(nome))
            expect(criados.has(nome), `${s.arquivo}: ${nome}`).toBe(true);
        }
      }
      for (const o of proprios) criados.add(o);
    }
  });
});
