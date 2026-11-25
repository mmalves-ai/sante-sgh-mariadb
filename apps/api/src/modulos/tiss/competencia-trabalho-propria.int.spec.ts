// Contrato de efeito da competência de trabalho do faturista (06-FAT linha 32) contra o MariaDB real. Massa SINTÉTICA
// com códigos "C1132" (nenhum dado real): sem escolha, o padrão é o mês corrente; a primeira escolha inclui a linha em
// competencia_trabalho_usuario (estabelecimento, usuário, módulo, competência no dia 1, período); a segunda altera a
// mesma linha (versão +1, alterado_por), sem duplicar; a versão velha é recusada; competência futura e período fora do
// mês são recusados sem gravar; outro módulo é outra linha; a trilha da gravação fica. No fim, a massa e a trilha do
// estabelecimento sintético são apagadas. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type ContextoOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ServicoCompetenciaTrabalho } from './competencia-trabalho.controller.js';
import { hojeLocal } from './competencia-trabalho-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'C1132';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function codigoDoErro(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const q = (e as { problema?: { codigo?: string } }).problema;
    return String(q?.codigo ?? (e as { codigo?: string }).codigo ?? (e as Error).message);
  }
  throw new Error('a gravação devia ter sido recusada');
}

/** AAAA-MM do mês `delta` meses depois do corrente. */
function mes(delta: number): string {
  const [a, m] = hojeLocal().slice(0, 7).split('-').map(Number);
  const i = a! * 12 + (m! - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

describe.skipIf(SEM_BANCO)('competência de trabalho do faturista na fonte própria (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoCompetenciaTrabalho;
  const ids = { est: 0, usuario: 0 };
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: ids.usuario,
    correlacao: 'teste-c1132',
    chaveIdempotencia: `c1132-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const ler = (modulo = 'fonte_pagadora') =>
    s.ler(
      { cliente: CLIENTE, estabelecimento: ids.est, correlacao: 'teste-c1132', usuario: ids.usuario },
      modulo,
    );
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-c1132' }, fn);
  const linhas = () =>
    escrever((e) =>
      e.consultar<Record<string, unknown>>(
        `SELECT id, modulo, DATE_FORMAT(competencia, '%Y-%m-%d') AS competencia,
                DATE_FORMAT(periodo_inicio, '%Y-%m-%d') AS inicio, DATE_FORMAT(periodo_fim, '%Y-%m-%d') AS fim,
                versao, criado_por, alterado_por
           FROM competencia_trabalho_usuario WHERE estabelecimento_id = ? AND usuario_id = ? ORDER BY modulo`,
        [ids.est, ids.usuario],
      ),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    s = new ServicoCompetenciaTrabalho(nucleo);
    await escrever(async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [`faturista.${P.toLowerCase()}`],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [`faturista.${P.toLowerCase()}`, `FATURISTA ${P} SINTETICO`, agora],
      );
      await e.executar('DELETE FROM competencia_trabalho_usuario WHERE estabelecimento_id = ?', [ids.est]);
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await e.executar('DELETE FROM competencia_trabalho_usuario WHERE estabelecimento_id = ?', [ids.est]);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('sem escolha, o padrão dos filtros é o mês corrente', async () => {
    const l = await ler();
    expect(l).toMatchObject({ competencia: null, versao: null, padrao: mes(0) });
  });

  it('a primeira escolha inclui; a segunda altera a mesma linha (versão +1), sem duplicar', async () => {
    const anterior = mes(-1);
    const r1 = await s.gravar(op(), {
      modulo: 'fonte_pagadora',
      competencia: anterior,
      periodoInicio: `${anterior}-01`,
      periodoFim: `${anterior}-15`,
    });
    expect(r1).toMatchObject({ versao: 1, competencia: anterior });
    let ls = await linhas();
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({
      modulo: 'fonte_pagadora',
      competencia: `${anterior}-01`,
      inicio: `${anterior}-01`,
      fim: `${anterior}-15`,
      versao: 1,
      criado_por: ids.usuario,
    });
    expect(await ler()).toMatchObject({ competencia: anterior, padrao: anterior, versao: 1 });

    const doisAntes = mes(-2);
    const r2 = await s.gravar(op(), { modulo: 'fonte_pagadora', competencia: doisAntes, versao: 1 });
    expect(r2).toMatchObject({ id: r1['id'], versao: 2 });
    ls = await linhas();
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({
      competencia: `${doisAntes}-01`,
      inicio: null,
      fim: null,
      versao: 2,
      alterado_por: ids.usuario,
    });
    const trilha = await escrever((e) =>
      e.consultar<{ n: number }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'competencia_trabalho_usuario' AND entidade_id = ?",
        [String(r1['id'])],
      ),
    );
    expect(Number(trilha[0]!.n)).toBeGreaterThanOrEqual(2);
  });

  it('versão velha ou ausente, competência futura e período fora do mês são recusados sem gravar', async () => {
    expect(await codigoDoErro(s.gravar(op(), { competencia: mes(-3), versao: 1 }))).toMatch(
      /conflito|versao/,
    );
    // Sem versão (ou com versão nula, a de quem leu antes de outra aba gravar) sobre a linha que já existe: conflito.
    expect(await codigoDoErro(s.gravar(op(), { competencia: mes(-3) }))).toBe('conflito-versao');
    expect(await codigoDoErro(s.gravar(op(), { competencia: mes(-3), versao: null }))).toBe(
      'conflito-versao',
    );
    expect(await codigoDoErro(s.gravar(op(), { competencia: mes(1), versao: 2 }))).toBe('competencia-futura');
    expect(
      await codigoDoErro(s.gravar(op(), { competencia: mes(-1), periodoInicio: `${mes(0)}-01`, versao: 2 })),
    ).toBe('periodo-fora-da-competencia');
    const ls = await linhas();
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ competencia: `${mes(-2)}-01`, versao: 2 });
  });

  it('outro módulo é outra linha do mesmo usuário', async () => {
    await s.gravar(op(), { modulo: 'sus_internacao', competencia: mes(0) });
    const ls = await linhas();
    expect(ls.map((l) => l['modulo'])).toEqual(['fonte_pagadora', 'sus_internacao']);
    expect(await ler('sus_internacao')).toMatchObject({ competencia: mes(0), versao: 1 });
    expect(await ler('fonte_pagadora')).toMatchObject({ competencia: mes(-2), versao: 2 });
  });
});
