// Contrato de efeito do cadastro da conta no banco próprio (01-ADM L57 e L59), no MariaDB real (cliente f22_o2, massa
// sintética "L57U"): criar a conta (conta + vínculo + perfil principal na mesma transação, com a trilha), alterar o
// nome e o CPF (justificativa na troca), trocar o grupo (o perfil anterior fica no histórico) e conceder e retirar
// escopo (unidade e tipo de prontuário), com as recusas. Só contagens, códigos e ids sintéticos; nenhum dado real.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { FonteAdministracaoPropria } from './fonte-propria.js';
import type { ContextoGestao, Ctx } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L57U';
const NOVO = `${P}.NOVA`;

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

describe.skipIf(SEM_BANCO)('cadastro da conta no banco próprio (MariaDB, cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let fonte: FonteAdministracaoPropria;
  let est = 0;
  let gestor = 0;
  let unidade = 0;
  let tipoDoc = 0;
  const c: Ctx = { rede: 'rede-sint', hospital: P, traceId: 'teste-l57u' };
  const ctx = (): ContextoGestao => ({
    rede: 'rede-sint',
    hospital: P,
    correlacao: 'teste-l57u',
    login: `${P}.GESTOR`,
    usuario: gestor,
    chaveIdempotencia: `tl57u-${randomUUID()}`,
    estacao: 'teste',
  });
  const um = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l57u' }, (l) => l.uma(sql, p)) as Promise<T>;
  const exec = (nome: string, entrada: unknown) => fonte.executar(nome, entrada, ctx());

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l57u' }, async (e) => {
      const alvo = `SELECT id FROM usuario WHERE login LIKE '${P}.N%'`;
      for (const t of [
        'usuario_unidade',
        'usuario_tipo_prontuario',
        'usuario_perfil',
        'usuario_estabelecimento',
      ])
        await e.executar(`DELETE FROM ${t} WHERE usuario_id IN (SELECT id FROM (${alvo}) x)`, []);
      await limparTrilhaDaMassa(e, { codigos: [P] });
      await e.executar(`DELETE FROM usuario WHERE login LIKE '${P}.N%'`, []);
    });
  }

  beforeAll(async () => {
    const banco = (await nucleo.cliente(CLIENTE)).banco;
    if (banco !== `cliente_${CLIENTE}`) throw new Error('Cliente de teste inesperado.');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l57u' }, async (e) => {
      const agora = new Date();
      const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      est = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      gestor = await g(
        'SELECT id FROM usuario WHERE login = ?',
        [`${P}.GESTOR`],
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'GESTOR SINTETICO', TRUE, 'pessoa', ?)",
        [`${P}.GESTOR`, agora],
      );
      await g(
        'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
        [gestor, est],
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [gestor, est, '2020-01-01', agora],
      );
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
      unidade = await g(
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [est, `${P}U`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, 'UNIDADE SINTETICA', 'ambulatorio', ?)",
        [est, `${P}U`, agora],
      );
      tipoDoc = await g(
        'SELECT id FROM tipo_documento_clinico WHERE codigo = ?',
        [`${P}T`],
        "INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, 'TIPO SINTETICO', 'evolucao', ?)",
        [`${P}T`, agora],
      );
    });
    await limpar();
    fonte = new FonteAdministracaoPropria(nucleo, CLIENTE, { rede: 'rede-sint' });
    await fonte.carregar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('as receitas do cadastro aparecem ligadas no banco próprio', () => {
    for (const n of ['acesso.criarUsuario', 'acesso.alterarUsuario', 'acesso.trocarGrupoUsuario'])
      expect(fonte.receita(n).ligada).toBe(true);
  });

  it('criar: conta, vínculo e perfil numa transação, com trilha; recusas de login, grupo e CPF', async () => {
    expect(
      await codigo(exec('acesso.criarUsuario', { login: NOVO, nomeCompleto: 'X', grupo: `${P}-INATIVO` })),
    ).toBe('grupo-inativo');
    expect(
      await codigo(exec('acesso.criarUsuario', { login: NOVO, nomeCompleto: 'X', grupo: 'NAO-EXISTE' })),
    ).toBe('grupo-inexistente');
    const r = await exec('acesso.criarUsuario', {
      login: NOVO,
      nomeCompleto: 'CONTA SINTETICA NOVA',
      grupo: `${P}-A`,
    });
    const id = Number(r['idUsuario']);
    expect(id).toBeGreaterThan(0);
    const u = await um<Record<string, unknown>>(
      'SELECT situacao, dispensa_cpf, cpf, exige_troca_senha, origem, versao FROM usuario WHERE id = ?',
      [id],
    );
    expect(u).toMatchObject({ situacao: 'ativo', cpf: null, origem: 'sistema', versao: 1 });
    expect(Number(u['dispensa_cpf'])).toBe(1);
    expect(Number(u['exige_troca_senha'])).toBe(1);
    const v = await um<Record<string, unknown>>(
      `SELECT (SELECT COUNT(*) FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ? AND padrao) AS vinculos,
              (SELECT COUNT(*) FROM usuario_perfil up JOIN perfil_acesso p ON p.id = up.perfil_acesso_id
                WHERE up.usuario_id = ? AND up.estabelecimento_id = ? AND p.codigo = ?) AS perfis,
              (SELECT COUNT(*) FROM trilha_auditoria WHERE entidade = 'usuario' AND entidade_id = ?) AS trilha`,
      [id, est, id, est, `${P}-A`, id],
    );
    expect({ vinculos: Number(v['vinculos']), perfis: Number(v['perfis']) }).toEqual({
      vinculos: 1,
      perfis: 1,
    });
    expect(Number(v['trilha'])).toBeGreaterThanOrEqual(1);
    const f = await fonte.fichaUsuario(c, NOVO, false);
    expect(f).toMatchObject({ id, grupo: `${P}-A`, bloqueado: false, cpfInformado: false });
    expect(
      await codigo(exec('acesso.criarUsuario', { login: NOVO, nomeCompleto: 'X', grupo: `${P}-A` })),
    ).toBe('login-em-uso');
  });

  it('alterar: nome com versão; CPF novo; troca de CPF exige justificativa; CPF de outra conta recusado', async () => {
    const id = Number((await um<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [NOVO])).id);
    expect(
      await codigo(
        exec('acesso.alterarUsuario', { login: NOVO, nomeCompleto: 'OUTRO NOME', versao: '["9"]' }),
      ),
    ).toBe('conflito-versao');
    await exec('acesso.alterarUsuario', {
      login: NOVO,
      nomeCompleto: 'NOME SINTETICO DOIS',
      versao: '["1"]',
    });
    expect(
      await um<Record<string, unknown>>('SELECT nome, versao FROM usuario WHERE id = ?', [id]),
    ).toMatchObject({
      nome: 'NOME SINTETICO DOIS',
      versao: 2,
    });
    await exec('acesso.alterarUsuario', {
      login: NOVO,
      nomeCompleto: 'NOME SINTETICO DOIS',
      versao: '["2"]',
      cpf: '52998224725',
    });
    const u = await um<Record<string, unknown>>(
      'SELECT cpf, dispensa_cpf, versao FROM usuario WHERE id = ?',
      [id],
    );
    expect(u['cpf']).toBe('52998224725');
    expect(Number(u['dispensa_cpf'])).toBe(0);
    expect(
      await codigo(
        exec('acesso.alterarUsuario', {
          login: NOVO,
          nomeCompleto: 'NOME SINTETICO DOIS',
          versao: '["3"]',
          cpf: '11144477735',
        }),
      ),
    ).toBe('justificativa-obrigatoria');
    expect(
      await codigo(
        exec('acesso.alterarUsuario', { login: NOVO, nomeCompleto: 'NOME SINTETICO DOIS', versao: '["3"]' }),
      ),
    ).toBe('nada-mudou');
  });

  it('trocar grupo: o perfil anterior fica no histórico (corrigido no mesmo dia), recusa o mesmo grupo', async () => {
    const id = Number((await um<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [NOVO])).id);
    expect(await codigo(exec('acesso.trocarGrupoUsuario', { login: NOVO, grupo: `${P}-A` }))).toBe(
      'mesmo-grupo',
    );
    await exec('acesso.trocarGrupoUsuario', { login: NOVO, grupo: `${P}-B` });
    const f = await fonte.fichaUsuario(c, NOVO, false);
    expect(f?.grupo).toBe(`${P}-B`);
    const n = await um<{ n: number }>('SELECT COUNT(*) AS n FROM usuario_perfil WHERE usuario_id = ?', [id]);
    // Perfil aberto hoje: a mesma linha é corrigida (a trilha guarda o anterior), sem linha duplicada.
    expect(Number(n.n)).toBe(1);
    const t = await um<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'usuario_perfil' AND estabelecimento_id = ?",
      [est],
    );
    expect(Number(t.n)).toBeGreaterThanOrEqual(1);
  });

  it('escopo: concede e retira unidade e tipo de prontuário; recusa repetição, item de fora e o que não tem', async () => {
    const id = Number((await um<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [NOVO])).id);
    await exec('acesso.concederUnidadeUsuario', { login: NOVO, valor: String(unidade) });
    await exec('acesso.concederTipoProntuarioUsuario', { login: NOVO, valor: tipoDoc });
    let f = await fonte.fichaUsuario(c, NOVO, false);
    expect(f?.escopos['unidade']?.map((x) => x.valor)).toEqual([String(unidade)]);
    expect(f?.escopos['tipoProntuario']?.map((x) => x.valor)).toEqual([String(tipoDoc)]);
    expect(await codigo(exec('acesso.concederUnidadeUsuario', { login: NOVO, valor: unidade }))).toBe(
      'ja-concedido',
    );
    expect(await codigo(exec('acesso.concederUnidadeUsuario', { login: NOVO, valor: 999999999 }))).toBe(
      'valor-inexistente',
    );
    await exec('acesso.retirarUnidadeUsuario', { login: NOVO, valor: unidade });
    f = await fonte.fichaUsuario(c, NOVO, false);
    expect(f?.escopos['unidade']).toEqual([]);
    expect(await codigo(exec('acesso.retirarUnidadeUsuario', { login: NOVO, valor: unidade }))).toBe(
      'nao-concedido',
    );
    // Reconceder depois de retirar grava de novo (o par é único só entre as linhas existentes).
    await exec('acesso.concederUnidadeUsuario', { login: NOVO, valor: unidade });
    const n = await um<{ n: number }>('SELECT COUNT(*) AS n FROM usuario_unidade WHERE usuario_id = ?', [id]);
    expect(Number(n.n)).toBe(1);
    expect(
      await codigo(exec('acesso.concederUnidadeUsuario', { login: `${P}.GESTOR-NAO`, valor: unidade })),
    ).toBe('usuario-inexistente');
  });
});
