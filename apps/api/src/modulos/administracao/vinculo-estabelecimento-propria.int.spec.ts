// Contrato de efeito do vínculo da conta ao estabelecimento e do escopo de tipo de agenda (01-ADM L59), no MariaDB
// real (cliente f22_o2, massa sintética "L59V"): dar acesso a este estabelecimento a uma conta que já existe em
// outro (vínculo + perfil principal na mesma transação, com a trilha, sem conta nova), as recusas, encerrar o acesso
// (anulado sem apagar quando começou hoje; vigência fechada ontem nos outros dias, com a entrada após o login
// passando para o outro vínculo), vincular de novo, e conceder e retirar tipo de agenda com a retirada lógica.
// Só contagens, códigos e ids sintéticos; nenhum dado real.
// As migrações 02_ADM/94 e 02_ADM/95 (unicidade só entre as linhas vigentes) são aplicadas antes (idempotentes).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { FonteAdministracaoPropria } from './fonte-propria.js';
import type { ContextoGestao, Ctx } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L59V';
const DE_FORA = `${P}.NFORA`;
const SO_AQUI = `${P}.NAQUI`;
const BLOQUEADA = `${P}.NBLOQ`;
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const MIGRACOES = [
  'db/migracoes/02_ADM/94_escopo_usuario_vigente_tabelas.sql',
  'db/migracoes/02_ADM/95_vinculo_estabelecimento_tipo_agenda_vigente_tabelas.sql',
];
const diaLocal = (recuo: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - recuo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(`${String(v).slice(0, 10)}T12:00:00`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    if (e instanceof ErroProblema) return String(e.extras?.['codigo'] ?? e.tipo);
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('vínculo ao estabelecimento e tipo de agenda (MariaDB, cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let fonte: FonteAdministracaoPropria;
  let est = 0;
  let est2 = 0;
  let gestor = 0;
  let deFora = 0;
  let tipoAgenda = 0;
  const c: Ctx = { rede: 'rede-sint', hospital: P, traceId: 'teste-l59v' };
  const ctx = (): ContextoGestao => ({
    rede: 'rede-sint',
    hospital: P,
    correlacao: 'teste-l59v',
    login: `${P}.GESTOR`,
    usuario: gestor,
    chaveIdempotencia: `tl59v-${randomUUID()}`,
    estacao: 'teste',
  });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l59v' }, (l) => l.uma(sql, p)) as Promise<
      Record<string, unknown>
    >;
  const exec = (nome: string, entrada: unknown) => fonte.executar(nome, entrada, ctx());
  const escrever = (sql: string, p: unknown[]) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l59v' }, (e) => e.executar(sql, p));
  /** Linhas da conta numa tabela de vigência, neste estabelecimento: total, vigentes, anuladas e fechadas. */
  const contar = async (tabela: 'usuario_estabelecimento' | 'usuario_perfil', usuario: number) => {
    const n = await um(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(excluido_em IS NULL AND (vigencia_fim IS NULL OR vigencia_fim >= CURRENT_DATE)), 0) AS vigentes,
              COALESCE(SUM(excluido_em IS NOT NULL AND excluido_por = ?), 0) AS anuladas,
              COALESCE(SUM(excluido_em IS NULL AND vigencia_fim < CURRENT_DATE), 0) AS fechadas
         FROM ${tabela} WHERE usuario_id = ? AND estabelecimento_id = ?`,
      [gestor, usuario, est],
    );
    return {
      total: Number(n['total']),
      vigentes: Number(n['vigentes']),
      anuladas: Number(n['anuladas']),
      fechadas: Number(n['fechadas']),
    };
  };

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l59v' }, async (e) => {
      const alvo = `SELECT id FROM usuario WHERE login LIKE '${P}.%'`;
      for (const t of ['usuario_tipo_agenda', 'usuario_perfil', 'usuario_estabelecimento'])
        await e.executar(`DELETE FROM ${t} WHERE usuario_id IN (SELECT id FROM (${alvo}) x)`, []);
      await limparTrilhaDaMassa(e, { codigos: [P, `${P}2`] });
      await e.executar(`DELETE FROM usuario WHERE login LIKE '${P}.%'`, []);
    });
  }

  beforeAll(async () => {
    const banco = (await nucleo.cliente(CLIENTE)).banco;
    if (banco !== `cliente_${CLIENTE}`) throw new Error('Cliente de teste inesperado.');
    for (const m of MIGRACOES)
      execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), banco], {
        input: readFileSync(resolve(RAIZ, m), 'utf8'),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l59v' }, async (e) => {
      const agora = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      const estab = (cod: string) =>
        g(
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `ESTAB ${cod} SINTETICO`, `ESTAB ${cod} SINTETICO`, agora],
        );
      const conta = (login: string, situacao: string) =>
        e.inserir(
          `INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, situacao, bloqueado_em, criado_em)
           VALUES (?, 'CONTA SINTETICA', TRUE, 'pessoa', ?, ?, ?)`,
          [login, situacao, situacao === 'bloqueado' ? agora : null, agora],
        );
      const vinculo = (usuario: number, e1: number, padrao: boolean) =>
        e.inserir(
          'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, padrao, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
          [usuario, e1, padrao, '2020-01-01', agora],
        );
      est = await estab(P);
      est2 = await estab(`${P}2`);
      for (const [cod, ativo] of [
        [`${P}-A`, true],
        [`${P}-B`, true],
        [`${P}-INATIVO`, false],
      ] as const)
        await g(
          'SELECT id FROM perfil_acesso WHERE codigo = ?',
          [cod],
          'INSERT INTO perfil_acesso (codigo, nome, ativo, estabelecimento_id, criado_em) VALUES (?, ?, ?, ?, ?)',
          [cod, `PERFIL ${cod}`, ativo, est, agora],
        );
      tipoAgenda = await g(
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        [`${P}T`],
        "INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES (?, 'TIPO DE AGENDA SINTETICO', ?)",
        [`${P}T`, agora],
      );
      gestor = await conta(`${P}.GESTOR`, 'ativo');
      await vinculo(gestor, est, true);
      await vinculo(gestor, est2, false);
      // Conta que só existe no outro estabelecimento do cliente (entra por lá).
      deFora = await conta(DE_FORA, 'ativo');
      await vinculo(deFora, est2, true);
      // Conta só deste estabelecimento, e uma bloqueada do outro.
      await vinculo(await conta(SO_AQUI, 'ativo'), est, true);
      await vinculo(await conta(BLOQUEADA, 'bloqueado'), est2, true);
    });
    fonte = new FonteAdministracaoPropria(nucleo, CLIENTE, { rede: 'rede-sint' });
    await fonte.carregar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('as receitas aparecem ligadas no banco próprio', () => {
    for (const n of [
      'acesso.vincularEstabelecimentoUsuario',
      'acesso.encerrarVinculoUsuario',
      'acesso.concederTipoAgendaUsuario',
      'acesso.retirarTipoAgendaUsuario',
    ])
      expect(fonte.receita(n).ligada).toBe(true);
  });

  it('vincular: a conta de outro estabelecimento ganha vínculo e perfil aqui, sem conta nova; recusas', async () => {
    expect(await fonte.fichaUsuario(c, DE_FORA, false)).toBeNull();
    const contasAntes = Number((await um('SELECT COUNT(*) AS n FROM usuario', []))['n']);
    for (const [entrada, recusa] of [
      [{ login: `${P}.NAO-EXISTE`, grupo: `${P}-A` }, 'usuario-inexistente'],
      [{ login: BLOQUEADA, grupo: `${P}-A` }, 'conta-sem-acesso'],
      [{ login: SO_AQUI, grupo: `${P}-A` }, 'ja-vinculado'],
      [{ login: DE_FORA, grupo: `${P}-NAO-HA` }, 'grupo-inexistente'],
      [{ login: DE_FORA, grupo: `${P}-INATIVO` }, 'grupo-inativo'],
    ] as const)
      expect(await codigo(exec('acesso.vincularEstabelecimentoUsuario', entrada))).toBe(recusa);
    expect(await contar('usuario_estabelecimento', deFora)).toMatchObject({ total: 0 });

    await exec('acesso.vincularEstabelecimentoUsuario', { login: DE_FORA, grupo: `${P}-A` });
    expect(Number((await um('SELECT COUNT(*) AS n FROM usuario', []))['n'])).toBe(contasAntes);
    const v = await um(
      `SELECT padrao, vigencia_inicio, vigencia_fim, criado_por FROM usuario_estabelecimento
        WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [deFora, est],
    );
    // A entrada após o login continua no estabelecimento de origem.
    expect([
      Number(v['padrao']),
      dia(v['vigencia_inicio']),
      v['vigencia_fim'],
      Number(v['criado_por']),
    ]).toEqual([0, diaLocal(0), null, gestor]);
    const p = await um(
      `SELECT pa.codigo FROM usuario_perfil up JOIN perfil_acesso pa ON pa.id = up.perfil_acesso_id
        WHERE up.usuario_id = ? AND up.estabelecimento_id = ? AND up.excluido_em IS NULL AND up.vigencia_fim IS NULL`,
      [deFora, est],
    );
    expect(p['codigo']).toBe(`${P}-A`);
    const f = await fonte.fichaUsuario(c, DE_FORA, false);
    expect(f?.grupo).toBe(`${P}-A`);
    expect(
      await codigo(exec('acesso.vincularEstabelecimentoUsuario', { login: DE_FORA, grupo: `${P}-B` })),
    ).toBe('ja-vinculado');
    const t = await um(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'usuario_estabelecimento'
          AND entidade_id IN (SELECT id FROM usuario_estabelecimento WHERE usuario_id = ?)`,
      [est, deFora],
    );
    expect(Number(t['n'])).toBe(1);
  });

  it('tipo de agenda: concede (consultar, marcar e cancelar), a ficha mostra, retirar deixa a linha no banco', async () => {
    await exec('acesso.concederTipoAgendaUsuario', { login: DE_FORA, valor: tipoAgenda });
    const l = await um(
      'SELECT pode_consultar, pode_marcar, pode_cancelar FROM usuario_tipo_agenda WHERE usuario_id = ? AND excluido_em IS NULL',
      [deFora],
    );
    expect([Number(l['pode_consultar']), Number(l['pode_marcar']), Number(l['pode_cancelar'])]).toEqual([
      1, 1, 1,
    ]);
    let f = await fonte.fichaUsuario(c, DE_FORA, false);
    expect(f?.escopos['tipoAgenda']?.map((x) => x.valor)).toEqual([String(tipoAgenda)]);
    expect((await fonte.opcoesEscopo(c))['tipoAgenda']?.some((x) => x.valor === String(tipoAgenda))).toBe(
      true,
    );
    expect(
      await codigo(exec('acesso.concederTipoAgendaUsuario', { login: DE_FORA, valor: tipoAgenda })),
    ).toBe('ja-concedido');
    expect(await codigo(exec('acesso.concederTipoAgendaUsuario', { login: DE_FORA, valor: 999999999 }))).toBe(
      'valor-inexistente',
    );
    await exec('acesso.retirarTipoAgendaUsuario', { login: DE_FORA, valor: tipoAgenda });
    f = await fonte.fichaUsuario(c, DE_FORA, false);
    expect(f?.escopos['tipoAgenda']).toEqual([]);
    expect(await codigo(exec('acesso.retirarTipoAgendaUsuario', { login: DE_FORA, valor: tipoAgenda }))).toBe(
      'nao-concedido',
    );
    await exec('acesso.concederTipoAgendaUsuario', { login: DE_FORA, valor: tipoAgenda });
    const n = await um(
      `SELECT COUNT(*) AS total, SUM(excluido_em IS NOT NULL AND excluido_por = ?) AS retiradas,
              SUM(excluido_em IS NULL) AS vigentes FROM usuario_tipo_agenda WHERE usuario_id = ?`,
      [gestor, deFora],
    );
    expect([Number(n['total']), Number(n['retiradas']), Number(n['vigentes'])]).toEqual([2, 1, 1]);
    const t = await um(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'usuario_tipo_agenda'
          AND entidade_id IN (SELECT id FROM usuario_tipo_agenda WHERE usuario_id = ?)`,
      [est, deFora],
    );
    expect(Number(t['n'])).toBe(3);
  });

  it('encerrar no mesmo dia: vínculo e perfil anulados sem apagar; vincular de novo grava linhas novas', async () => {
    await exec('acesso.encerrarVinculoUsuario', { login: DE_FORA });
    expect(await contar('usuario_estabelecimento', deFora)).toEqual({
      total: 1,
      vigentes: 0,
      anuladas: 1,
      fechadas: 0,
    });
    expect(await contar('usuario_perfil', deFora)).toEqual({
      total: 1,
      vigentes: 0,
      anuladas: 1,
      fechadas: 0,
    });
    expect(await fonte.fichaUsuario(c, DE_FORA, false)).toBeNull();
    expect(await codigo(exec('acesso.encerrarVinculoUsuario', { login: DE_FORA }))).toBe('nao-vinculado');
    expect(
      await codigo(exec('acesso.concederTipoAgendaUsuario', { login: DE_FORA, valor: tipoAgenda })),
    ).toBe('usuario-inexistente');
    await exec('acesso.vincularEstabelecimentoUsuario', { login: DE_FORA, grupo: `${P}-A` });
    expect(await contar('usuario_estabelecimento', deFora)).toMatchObject({
      total: 2,
      vigentes: 1,
      anuladas: 1,
    });
    expect(await contar('usuario_perfil', deFora)).toMatchObject({ total: 2, vigentes: 1, anuladas: 1 });
  });

  it('encerrar nos outros dias: a vigência fecha ontem e a entrada após o login passa para o outro vínculo', async () => {
    // O vínculo e o perfil vigentes passam a ter começado antes, e o daqui vira o de entrada.
    for (const t of ['usuario_estabelecimento', 'usuario_perfil'])
      await escrever(
        `UPDATE ${t} SET vigencia_inicio = ? WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [diaLocal(30), deFora, est],
      );
    await escrever(
      'UPDATE usuario_estabelecimento SET padrao = (estabelecimento_id = ?) WHERE usuario_id = ? AND excluido_em IS NULL',
      [est, deFora],
    );
    await exec('acesso.encerrarVinculoUsuario', { login: DE_FORA });
    expect(await contar('usuario_estabelecimento', deFora)).toEqual({
      total: 2,
      vigentes: 0,
      anuladas: 1,
      fechadas: 1,
    });
    expect(await contar('usuario_perfil', deFora)).toEqual({
      total: 2,
      vigentes: 0,
      anuladas: 1,
      fechadas: 1,
    });
    const fim = await um(
      `SELECT vigencia_fim, padrao FROM usuario_estabelecimento
        WHERE usuario_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
      [deFora, est],
    );
    expect([dia(fim['vigencia_fim']), Number(fim['padrao'])]).toEqual([diaLocal(1), 0]);
    const outro = await um(
      'SELECT padrao, vigencia_fim FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
      [deFora, est2],
    );
    expect([Number(outro['padrao']), outro['vigencia_fim']]).toEqual([1, null]);
    expect(await fonte.fichaUsuario(c, DE_FORA, false)).toBeNull();
    // Volta a ter acesso: linha nova hoje, ao lado da fechada e da anulada.
    await exec('acesso.vincularEstabelecimentoUsuario', { login: DE_FORA, grupo: `${P}-B` });
    expect(await contar('usuario_estabelecimento', deFora)).toEqual({
      total: 3,
      vigentes: 1,
      anuladas: 1,
      fechadas: 1,
    });
    expect((await fonte.fichaUsuario(c, DE_FORA, false))?.grupo).toBe(`${P}-B`);
  });

  it('encerrar: recusa o próprio vínculo, o único vínculo da conta e a conta inexistente; nada muda', async () => {
    expect(await codigo(exec('acesso.encerrarVinculoUsuario', { login: `${P}.GESTOR` }))).toBe(
      'proprio-vinculo',
    );
    expect(await codigo(exec('acesso.encerrarVinculoUsuario', { login: SO_AQUI }))).toBe('unico-vinculo');
    expect(await codigo(exec('acesso.encerrarVinculoUsuario', { login: `${P}.NAO-EXISTE` }))).toBe(
      'usuario-inexistente',
    );
    const n = await um(
      `SELECT COUNT(*) AS n FROM usuario_estabelecimento ue JOIN usuario u ON u.id = ue.usuario_id
        WHERE u.login IN (?, ?) AND ue.estabelecimento_id = ? AND ue.excluido_em IS NULL AND ue.vigencia_fim IS NULL`,
      [`${P}.GESTOR`, SO_AQUI, est],
    );
    expect(Number(n['n'])).toBe(2);
  });
});
