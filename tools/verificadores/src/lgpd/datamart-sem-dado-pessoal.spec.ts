// Regra 9 do M57 (etapa 3; cap-07 §7.5.4; LGPD-06): o data mart (de cada estabelecimento e o da Rede) sem nome, CPF,
// telefone, endereço nem texto livre; o paciente como HMAC com a chave do cofre; pseudônimo comum entre os
// estabelecimentos só com a DP-42 (senão, por estabelecimento, e a reinternação só dentro de cada um). A carga roda
// sobre dois estabelecimentos SINTÉTICOS (leituras falsas, nenhum banco) numa pasta descartável dentro do repositório.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MovimentoInternacao } from '@sgh/contratos';
import { colunasIdentificadoras, ESQUEMA_DATAMART, pseudonimo } from '@sgh/dominio-relatorio/datamart';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  arquivoDaRede,
  arquivoDoEstabelecimento,
  biRedeLiberado,
  carregarEstabelecimento,
  consolidarRede,
  type LeiturasDaCarga,
  type NucleoDaCarga,
  pseudonimoComumLiberado,
} from '../datamart-carga.ts';

const raiz = resolve(import.meta.dirname, '../../../..');
const CHAVE = 'chave-sintetica-de-teste-0123456789';
const DIA = 86_400_000;
const AGORA = Date.UTC(2026, 6, 5, 12);
/** O prontuário sintético de cada estabelecimento (o mesmo paciente: 4101 no pc e 9202 no hs). */
const PRONT = { pc: 4101, hs: 9202 } as const;
const PESSOA = 'pessoa-da-rede-sintetica-0001';

const nucleo: NucleoDaCarga = {
  rede: 'rede-sintetica',
  lerSomente: async (c, fn) => fn({} as never, c.hospital === 'pc' ? 1 : 2),
};

function movimento(cod: 'pc' | 'hs'): MovimentoInternacao {
  const d = (n: number) => new Date(Date.UTC(2026, 5, n));
  const int = (reg: number, ini: number, fim: number | null) => ({
    reg,
    paciente: PRONT[cod],
    bloco: '1',
    acomodacao: 'ENF1',
    leito: '01',
    entrada: d(ini),
    horaEntrada: '10:00',
    alta: fim === null ? null : d(fim),
    horaAlta: fim === null ? null : '10:00',
    motivo: fim === null ? null : 12,
    carater: '2',
    clinica: 'M',
    permanencia: 2,
  });
  const regs = cod === 'pc' ? [int(81_001, 1, 3)] : [int(91_001, 10, 12)];
  return {
    internacoes: regs,
    trechos: regs.map((r) => ({
      reg: r.reg,
      cod: 1,
      bloco: '1',
      acomodacao: 'ENF1',
      leito: '01',
      entrada: r.entrada,
      horaEntrada: '10:00',
      saida: r.alta,
      horaSaida: r.horaAlta,
      tipo: 1,
    })),
    transferencias: [],
    unidades: [
      { bloco: '1', acomodacao: 'ENF1', nome: 'Enfermaria sintética', tipo: 1, leitos: 4, leitosAtivos: 4 },
    ],
    tipos: new Map([[1, 'Enfermaria']]),
    dadosAte: new Date(AGORA - DIA),
  };
}

function leituras(cod: 'pc' | 'hs', comPessoa: boolean): LeiturasDaCarga {
  const mov = movimento(cod);
  return {
    movimento: async () => mov,
    demografia: async () =>
      new Map(
        mov.internacoes.map((i) => [
          i.reg,
          { nascimento: new Date(Date.UTC(1950, 0, 1)), sexo: 'F', convenio: 3 },
        ]),
      ),
    atendimentos: async () => [
      { mes: '2026-06', tipo: 'E', convenio: '3', especialidade: '10', quantidade: cod === 'pc' ? 12 : 30 },
    ],
    itens: async () => [],
    dispensacoes: async () => [{ mes: '2026-06', registros: 5, quantidade: 7 }],
    pessoas: async () => (comPessoa ? new Map([[PRONT[cod], PESSOA]]) : new Map()),
  };
}

const pasta = resolve(raiz, `.tmp/teste-lgpd-m57-${process.pid}`);
beforeAll(() => mkdirSync(pasta, { recursive: true }));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

function celulas(arquivo: string): {
  tabelas: { nome: string; colunas: Record<string, 'texto'> }[];
  textos: string[];
} {
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    const nomes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name);
    const tabelas = nomes.map((n) => ({
      nome: n,
      colunas: Object.fromEntries(
        (db.prepare(`PRAGMA table_info(${n})`).all() as { name: string }[]).map((c) => [
          c.name,
          'texto' as const,
        ]),
      ),
    }));
    const textos = nomes.flatMap((n) =>
      (db.prepare(`SELECT * FROM ${n}`).all() as Record<string, unknown>[]).flatMap((x) =>
        Object.values(x).map((v) => String(v)),
      ),
    );
    return { tabelas, textos };
  } finally {
    db.close();
  }
}

const pacientes = (arquivo: string) => {
  const db = new DatabaseSync(arquivo, { readOnly: true });
  try {
    return (
      db
        .prepare('SELECT estabelecimento, paciente_pseudonimo FROM fato_internacao ORDER BY estabelecimento')
        .all() as {
        estabelecimento: string;
        paciente_pseudonimo: string;
      }[]
    ).map((x) => [x.estabelecimento, x.paciente_pseudonimo]);
  } finally {
    db.close();
  }
};

describe('data mart sem dado pessoal (regra 9)', () => {
  it('o esquema declarado não tem coluna identificadora', () => {
    expect(colunasIdentificadoras(ESQUEMA_DATAMART)).toEqual([]);
  });

  it('por estabelecimento (sem a DP-42): nenhum prontuário, internação ou pessoa no arquivo; pseudônimos diferentes entre os hospitais', async () => {
    for (const cod of ['pc', 'hs'] as const)
      await carregarEstabelecimento(
        nucleo,
        { hospital: cod, chave: CHAVE, modo: 'por-estabelecimento', pasta, agora: AGORA },
        leituras(cod, true),
      );
    const r = consolidarRede(pasta, ['pc', 'hs'], ['pc', 'hs']);
    expect(r.modo).toBe('por-estabelecimento');
    expect(r.linhas['pc']!['fato_internacao']).toBe(1);
    expect(r.linhas['hs']!['fato_atendimento']).toBe(1);
    for (const arq of [
      arquivoDoEstabelecimento(pasta, 'pc'),
      arquivoDoEstabelecimento(pasta, 'hs'),
      arquivoDaRede(pasta),
    ]) {
      const { tabelas, textos } = celulas(arq);
      expect(colunasIdentificadoras(tabelas)).toEqual([]);
      for (const cru of ['4101', '9202', '81001', '91001', PESSOA]) expect(textos).not.toContain(cru);
      expect(textos.some((t) => t.includes(PESSOA))).toBe(false);
    }
    const ps = pacientes(arquivoDaRede(pasta));
    expect(ps.map((x) => x[0])).toEqual(['hs', 'pc']);
    expect(ps[0]![1]).not.toBe(ps[1]![1]);
    expect(ps.find((x) => x[0] === 'pc')![1]).toBe(pseudonimo(CHAVE, 'pc:paciente', PRONT.pc));
  });

  it('comum (com a DP-42): o paciente ligado no MPI tem o mesmo pseudônimo nos dois hospitais; misturar os modos é recusado', async () => {
    await carregarEstabelecimento(
      nucleo,
      { hospital: 'pc', chave: CHAVE, modo: 'comum', pasta, agora: AGORA },
      leituras('pc', true),
    );
    expect(() => consolidarRede(pasta, ['pc', 'hs'], ['pc', 'hs'])).toThrow(/modos de pseudônimo diferentes/);
    const hs = await carregarEstabelecimento(
      nucleo,
      { hospital: 'hs', chave: CHAVE, modo: 'comum', pasta, agora: AGORA },
      leituras('hs', true),
    );
    expect(hs.comPessoaDaRede).toBe(1);
    const r = consolidarRede(pasta, ['pc', 'hs'], ['pc', 'hs']);
    expect(r.modo).toBe('comum');
    const ps = pacientes(arquivoDaRede(pasta));
    expect(ps[0]![1]).toBe(ps[1]![1]);
    const { tabelas, textos } = celulas(arquivoDaRede(pasta));
    expect(colunasIdentificadoras(tabelas)).toEqual([]);
    expect(textos).not.toContain(PESSOA);
  });

  it('o arquivo da Rede só junta estabelecimentos da rede e só as colunas declaradas', async () => {
    const extra = arquivoDoEstabelecimento(pasta, 'zz');
    const db = new DatabaseSync(extra);
    db.exec('CREATE TABLE fato_internacao (estabelecimento TEXT, nome TEXT)');
    db.close();
    const r = consolidarRede(pasta, ['pc', 'hs'], ['pc', 'hs']);
    expect(r.estabelecimentos).toEqual(['pc', 'hs']);
    // Um arquivo de estabelecimento com coluna a mais: o arquivo da Rede copia só as colunas do esquema.
    const pcDb = new DatabaseSync(arquivoDoEstabelecimento(pasta, 'pc'));
    pcDb.exec('ALTER TABLE fato_atendimento ADD COLUMN telefone TEXT');
    pcDb.close();
    consolidarRede(pasta, ['pc', 'hs'], ['pc', 'hs']);
    expect(colunasIdentificadoras(celulas(arquivoDaRede(pasta)).tabelas)).toEqual([]);
  });

  it('a liberação do pseudônimo comum e a do BI da Rede: banco que não responde conta como desligado', async () => {
    const fora: NucleoDaCarga = { rede: 'r', lerSomente: async () => Promise.reject(new Error('fora')) };
    expect(await pseudonimoComumLiberado(fora, ['pc', 'hs'])).toEqual([false, false]);
    expect(await biRedeLiberado(fora, ['pc', 'hs'])).toEqual([false, false]);
  });

  it('D-LIB-BI-57: o estabelecimento com o BI da Rede desligado fica fora do arquivo da Rede; nenhum liberado apaga o arquivo', async () => {
    for (const cod of ['pc', 'hs'] as const)
      await carregarEstabelecimento(
        nucleo,
        { hospital: cod, chave: CHAVE, modo: 'por-estabelecimento', pasta, agora: AGORA },
        leituras(cod, false),
      );
    const r = consolidarRede(pasta, ['pc', 'hs'], ['pc']);
    expect(r.estabelecimentos).toEqual(['pc']);
    expect(r.foraDoBi).toEqual(['hs']);
    const db = new DatabaseSync(arquivoDaRede(pasta), { readOnly: true });
    try {
      for (const t of ['fato_internacao', 'fato_internacao_dia', 'fato_atendimento', 'carga'])
        expect(
          (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE estabelecimento = 'hs'`).get() as { n: number })
            .n,
        ).toBe(0);
    } finally {
      db.close();
    }
    // O arquivo próprio do desligado continua.
    expect(existsSync(arquivoDoEstabelecimento(pasta, 'hs'))).toBe(true);
    // Recolher de todos: o arquivo da Rede sai (não fica o antigo).
    const nada = consolidarRede(pasta, ['pc', 'hs'], []);
    expect(nada).toMatchObject({ modo: null, estabelecimentos: [], foraDoBi: ['pc', 'hs'] });
    expect(existsSync(arquivoDaRede(pasta))).toBe(false);
  });

  it('a carga de outra chave ou de outro ciclo não se junta à da Rede (e o arquivo da Rede antigo sai)', async () => {
    for (const cod of ['pc', 'hs'] as const)
      await carregarEstabelecimento(
        nucleo,
        { hospital: cod, chave: CHAVE, modo: 'por-estabelecimento', pasta, agora: AGORA },
        leituras(cod, false),
      );
    consolidarRede(pasta, ['pc', 'hs'], ['pc', 'hs']);
    expect(existsSync(arquivoDaRede(pasta))).toBe(true);
    // Só o pc recarregado com outra chave (a aleatória de dev de outra execução).
    await carregarEstabelecimento(
      nucleo,
      { hospital: 'pc', chave: `${CHAVE}-outra`, modo: 'por-estabelecimento', pasta, agora: AGORA },
      leituras('pc', false),
    );
    expect(() => consolidarRede(pasta, ['pc', 'hs'], ['pc', 'hs'])).toThrow(
      /chaves de pseudônimo diferentes/,
    );
    expect(existsSync(arquivoDaRede(pasta))).toBe(false);
    // Mesma chave, mas o pc de semanas depois: recusado.
    await carregarEstabelecimento(
      nucleo,
      { hospital: 'pc', chave: CHAVE, modo: 'por-estabelecimento', pasta, agora: AGORA + 20 * DIA },
      leituras('pc', false),
    );
    expect(() => consolidarRede(pasta, ['pc', 'hs'], ['pc', 'hs'])).toThrow(/distam mais de 36 horas/);
    // Recarregados juntos: aceito.
    await carregarEstabelecimento(
      nucleo,
      { hospital: 'hs', chave: CHAVE, modo: 'por-estabelecimento', pasta, agora: AGORA + 20 * DIA },
      leituras('hs', false),
    );
    expect(consolidarRede(pasta, ['pc', 'hs'], ['pc', 'hs']).estabelecimentos).toEqual(['pc', 'hs']);
  });
});
