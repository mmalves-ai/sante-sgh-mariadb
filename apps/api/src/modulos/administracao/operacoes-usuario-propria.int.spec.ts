// Contrato de efeito do cadastro da conta no banco próprio (01-ADM L57 e L59), no MariaDB real (cliente f22_o2, massa
// sintética "L57U"): criar a conta (conta + vínculo + perfil principal na mesma transação, com a trilha), alterar o
// nome e o CPF (justificativa na troca), trocar o grupo (corrigir no mesmo dia; fechar a vigência do perfil anterior
// nos outros), conceder e retirar escopo (unidade, local, convênio e tipo de prontuário, com a retirada lógica que
// deixa a linha no banco), o primeiro acesso pela senha provisória (credencial_usuario) e as recusas, inclusive as de
// outro estabelecimento. Só contagens, códigos e ids sintéticos; nenhum dado real.
// A migração 02_ADM/94 (unicidade do escopo só entre as linhas vigentes) é aplicada no cliente antes (idempotente).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cifrarSenha, conferirSenha } from '@sgh/dominio-acesso';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { portaSenhaDoNucleo } from '../acesso/senha/porta-senha.js';
import { FonteAcessoPropria } from '../../sessao/fonte-propria.js';
import { criarContaComSenhaInicial } from './criacao-com-senha.js';
import { FonteAdministracaoPropria } from './fonte-propria.js';
import type { ContextoGestao, Ctx } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L57U';
const NOVO = `${P}.NOVA`;
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const MIGRACOES = [
  'db/migracoes/02_ADM/94_escopo_usuario_vigente_tabelas.sql',
  // Finalidade do convênio (atendimento ou faturamento), aplicada duas vezes para provar que é idempotente.
  'db/migracoes/02_ADM/99zb_usuario_fonte_pagadora_finalidade_tabelas.sql',
  'db/migracoes/02_ADM/99zb_usuario_fonte_pagadora_finalidade_tabelas.sql',
  // Permissão por procedimento do SUS (C2-051), também duas vezes.
  'db/migracoes/02_ADM/99zd_usuario_grupo_sigtap_tabelas.sql',
  'db/migracoes/02_ADM/99zd_usuario_grupo_sigtap_chaves.sql',
  'db/migracoes/02_ADM/99zd_usuario_grupo_sigtap_tabelas.sql',
  'db/migracoes/02_ADM/99zd_usuario_grupo_sigtap_chaves.sql',
];
const ontemLocal = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
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

describe.skipIf(SEM_BANCO)('cadastro da conta no banco próprio (MariaDB, cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let fonte: FonteAdministracaoPropria;
  let est = 0;
  let gestor = 0;
  let unidade = 0;
  let tipoDoc = 0;
  let local = 0;
  let convenio = 0;
  let unidadeOutro = 0;
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
        'usuario_local_atendimento',
        'usuario_fonte_pagadora',
        'usuario_tipo_prontuario',
        'usuario_grupo_sigtap',
        'credencial_usuario',
        'historico_senha',
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
    for (const m of MIGRACOES)
      execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), banco], {
        input: readFileSync(resolve(RAIZ, m), 'utf8'),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    await limpar();
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
      const ponto = await g(
        'SELECT id FROM ponto_recepcao WHERE estabelecimento_id = ? AND codigo = ?',
        [est, `${P}R`],
        "INSERT INTO ponto_recepcao (estabelecimento_id, codigo, descricao, criado_em) VALUES (?, ?, 'RECEPCAO SINTETICA', ?)",
        [est, `${P}R`, agora],
      );
      local = await g(
        'SELECT id FROM local_atendimento WHERE estabelecimento_id = ? AND codigo = ?',
        [est, `${P}L`],
        "INSERT INTO local_atendimento (estabelecimento_id, ponto_recepcao_id, codigo, descricao, criado_em) VALUES (?, ?, ?, 'LOCAL SINTETICO', ?)",
        [est, ponto, `${P}L`, agora],
      );
      convenio = await g(
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}F`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'CONVENIO SINTETICO', 'operadora', 'ativa', ?)",
        [`${P}F`, agora],
      );
      // Outro estabelecimento do mesmo cliente, com uma unidade e uma conta só dele.
      const est2 = await g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}2`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}2`, `ESTAB ${P}2 SINTETICO`, `ESTAB ${P}2 SINTETICO`, agora],
      );
      unidadeOutro = await g(
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [est2, `${P}U2`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, 'UNIDADE SINTETICA 2', 'ambulatorio', ?)",
        [est2, `${P}U2`, agora],
      );
      const outra = await e.inserir(
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'CONTA SINTETICA OUTRA', TRUE, 'pessoa', ?)",
        [`${P}.NOUTRO`, agora],
      );
      await e.inserir(
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [outra, est2, '2020-01-01', agora],
      );
    });
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

  it('trocar grupo nos outros dias: a vigência do perfil anterior fecha ontem e a linha nova abre hoje', async () => {
    const id = Number((await um<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [NOVO])).id);
    // Preparo: o perfil vigente passa a ter começado antes de hoje (como se a conta fosse antiga).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l57u' }, (e) =>
      e.executar(
        "UPDATE usuario_perfil SET vigencia_inicio = '2026-01-01' WHERE usuario_id = ? AND excluido_em IS NULL",
        [id],
      ),
    );
    await exec('acesso.trocarGrupoUsuario', { login: NOVO, grupo: `${P}-A` });
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l57u' }, (l) =>
      l.consultar(
        `SELECT p.codigo, DATE_FORMAT(up.vigencia_inicio, '%Y-%m-%d') AS inicio,
                DATE_FORMAT(up.vigencia_fim, '%Y-%m-%d') AS fim, up.excluido_em IS NULL AS viva
           FROM usuario_perfil up JOIN perfil_acesso p ON p.id = up.perfil_acesso_id WHERE up.usuario_id = ? ORDER BY up.id`,
        [id],
      ),
    );
    expect(linhas.map((x) => [x['codigo'], x['inicio'], x['fim'], Number(x['viva'])])).toEqual([
      [`${P}-B`, '2026-01-01', ontemLocal(), 1],
      [`${P}-A`, expect.any(String), null, 1],
    ]);
    expect((await fonte.fichaUsuario(c, NOVO, false))?.grupo).toBe(`${P}-A`);
  });

  it('escopo: concede e retira unidade, local, convênio e tipo de prontuário; a retirada fica no banco; trilha', async () => {
    const id = Number((await um<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [NOVO])).id);
    await exec('acesso.concederUnidadeUsuario', { login: NOVO, valor: String(unidade) });
    await exec('acesso.concederTipoProntuarioUsuario', { login: NOVO, valor: tipoDoc });
    await exec('acesso.concederLocalUsuario', { login: NOVO, valor: local });
    await exec('acesso.concederConvenioUsuario', { login: NOVO, valor: convenio });
    let f = await fonte.fichaUsuario(c, NOVO, false);
    expect(f?.escopos['unidade']?.map((x) => x.valor)).toEqual([String(unidade)]);
    expect(f?.escopos['tipoProntuario']?.map((x) => x.valor)).toEqual([String(tipoDoc)]);
    expect(f?.escopos['local']?.map((x) => x.valor)).toEqual([String(local)]);
    expect(f?.escopos['convenio']?.map((x) => x.valor)).toEqual([String(convenio)]);
    expect(await codigo(exec('acesso.concederUnidadeUsuario', { login: NOVO, valor: unidade }))).toBe(
      'ja-concedido',
    );
    expect(await codigo(exec('acesso.concederConvenioUsuario', { login: NOVO, valor: convenio }))).toBe(
      'ja-concedido',
    );
    expect(await codigo(exec('acesso.concederUnidadeUsuario', { login: NOVO, valor: 999999999 }))).toBe(
      'valor-inexistente',
    );
    // A unidade de outro estabelecimento do mesmo cliente não se concede daqui.
    expect(await codigo(exec('acesso.concederUnidadeUsuario', { login: NOVO, valor: unidadeOutro }))).toBe(
      'valor-inexistente',
    );
    for (const op of [
      'acesso.retirarUnidadeUsuario',
      'acesso.retirarLocalUsuario',
      'acesso.retirarConvenioUsuario',
      'acesso.retirarTipoProntuarioUsuario',
    ])
      await exec(op, {
        login: NOVO,
        valor: op.includes('Unidade')
          ? unidade
          : op.includes('Local')
            ? local
            : op.includes('Convenio')
              ? convenio
              : tipoDoc,
      });
    f = await fonte.fichaUsuario(c, NOVO, false);
    expect([
      f?.escopos['unidade'],
      f?.escopos['local'],
      f?.escopos['convenio'],
      f?.escopos['tipoProntuario'],
    ]).toEqual([[], [], [], []]);
    expect(await codigo(exec('acesso.retirarUnidadeUsuario', { login: NOVO, valor: unidade }))).toBe(
      'nao-concedido',
    );
    // Reconceder depois de retirar grava uma linha nova; a retirada continua no banco (exclusão lógica).
    await exec('acesso.concederUnidadeUsuario', { login: NOVO, valor: unidade });
    const n = await um<Record<string, unknown>>(
      `SELECT COUNT(*) AS total, SUM(excluido_em IS NOT NULL AND excluido_por = ?) AS retiradas,
              SUM(excluido_em IS NULL) AS vigentes FROM usuario_unidade WHERE usuario_id = ?`,
      [gestor, id],
    );
    expect([Number(n['total']), Number(n['retiradas']), Number(n['vigentes'])]).toEqual([2, 1, 1]);
    const ficou = await um<Record<string, unknown>>(
      `SELECT (SELECT COUNT(*) FROM usuario_local_atendimento WHERE usuario_id = ? AND excluido_em IS NOT NULL) AS l,
              (SELECT COUNT(*) FROM usuario_fonte_pagadora WHERE usuario_id = ? AND excluido_em IS NOT NULL) AS c,
              (SELECT COUNT(*) FROM usuario_tipo_prontuario WHERE usuario_id = ? AND excluido_em IS NOT NULL) AS t`,
      [id, id, id],
    );
    expect([Number(ficou['l']), Number(ficou['c']), Number(ficou['t'])]).toEqual([1, 1, 1]);
    // Trilha: a concessão e a retirada de cada escopo, pela linha do escopo.
    const t = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l57u' }, (l) =>
      l.consultar(
        `SELECT t.entidade, COUNT(*) AS n FROM trilha_auditoria t
          WHERE t.estabelecimento_id = ? AND t.entidade IN ('usuario_unidade','usuario_local_atendimento','usuario_fonte_pagadora','usuario_tipo_prontuario')
            AND t.entidade_id IN (SELECT id FROM usuario_unidade WHERE usuario_id = ? UNION ALL SELECT id FROM usuario_local_atendimento WHERE usuario_id = ?
              UNION ALL SELECT id FROM usuario_fonte_pagadora WHERE usuario_id = ? UNION ALL SELECT id FROM usuario_tipo_prontuario WHERE usuario_id = ?)
          GROUP BY t.entidade ORDER BY t.entidade`,
        [est, id, id, id, id],
      ),
    );
    expect(Object.fromEntries(t.map((x) => [x['entidade'], Number(x['n']) >= 2]))).toEqual({
      usuario_fonte_pagadora: true,
      usuario_local_atendimento: true,
      usuario_tipo_prontuario: true,
      usuario_unidade: true,
    });
  });

  it('procedimento do SUS: concede o ramo da tabela unificada, recusa repetido e inexistente; retirada lógica', async () => {
    const id = Number((await um<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [NOVO])).id);
    const g = await um<{ id: number; codigo_sigtap: string }>(
      "SELECT id, codigo_sigtap FROM grupo_sigtap WHERE nivel = 'grupo' AND vigencia_fim IS NULL ORDER BY codigo_sigtap LIMIT 1",
      [],
    );
    const grupo = Number(g.id);
    await exec('acesso.concederProcedimentoSusUsuario', { login: NOVO, valor: grupo });
    let f = await fonte.fichaUsuario(c, NOVO, false);
    expect(
      f?.escopos['procedimentoSus']?.map((x) => [x.valor, x.rotulo.startsWith(`${g.codigo_sigtap} `)]),
    ).toEqual([[String(grupo), true]]);
    expect(await codigo(exec('acesso.concederProcedimentoSusUsuario', { login: NOVO, valor: grupo }))).toBe(
      'ja-concedido',
    );
    expect(
      await codigo(exec('acesso.concederProcedimentoSusUsuario', { login: NOVO, valor: 999999999 })),
    ).toBe('valor-inexistente');
    await exec('acesso.retirarProcedimentoSusUsuario', { login: NOVO, valor: grupo });
    f = await fonte.fichaUsuario(c, NOVO, false);
    expect(f?.escopos['procedimentoSus']).toEqual([]);
    expect(await codigo(exec('acesso.retirarProcedimentoSusUsuario', { login: NOVO, valor: grupo }))).toBe(
      'nao-concedido',
    );
    const n = await um<Record<string, unknown>>(
      'SELECT COUNT(*) AS n FROM usuario_grupo_sigtap WHERE usuario_id = ? AND grupo_sigtap_id = ? AND excluido_em IS NOT NULL',
      [id, grupo],
    );
    expect(Number(n['n'])).toBe(1);
  });

  it('convênio do faturamento: concessão à parte da do atendimento, mesma tabela pela finalidade; retirada lógica; trilha', async () => {
    const id = Number((await um<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [NOVO])).id);
    await exec('acesso.concederConvenioUsuario', { login: NOVO, valor: convenio });
    await exec('acesso.concederConvenioFaturamentoUsuario', { login: NOVO, valor: convenio });
    let f = await fonte.fichaUsuario(c, NOVO, false);
    expect([f?.escopos['convenio']?.length, f?.escopos['convenioFaturamento']?.map((x) => x.valor)]).toEqual([
      1,
      [String(convenio)],
    ]);
    expect(
      await codigo(exec('acesso.concederConvenioFaturamentoUsuario', { login: NOVO, valor: convenio })),
    ).toBe('ja-concedido');
    expect(
      await codigo(exec('acesso.concederConvenioFaturamentoUsuario', { login: NOVO, valor: 999999999 })),
    ).toBe('valor-inexistente');
    // Retirar o do faturamento não mexe no do atendimento.
    await exec('acesso.retirarConvenioFaturamentoUsuario', { login: NOVO, valor: convenio });
    f = await fonte.fichaUsuario(c, NOVO, false);
    expect([f?.escopos['convenio']?.length, f?.escopos['convenioFaturamento']]).toEqual([1, []]);
    expect(
      await codigo(exec('acesso.retirarConvenioFaturamentoUsuario', { login: NOVO, valor: convenio })),
    ).toBe('nao-concedido');
    await exec('acesso.retirarConvenioUsuario', { login: NOVO, valor: convenio });
    const n = await um<Record<string, unknown>>(
      `SELECT SUM(finalidade = 'faturamento' AND excluido_em IS NOT NULL AND excluido_por = ?) AS fat,
              SUM(finalidade = 'atendimento' AND excluido_em IS NULL) AS vig FROM usuario_fonte_pagadora WHERE usuario_id = ?`,
      [gestor, id],
    );
    expect([Number(n['fat']), Number(n['vig'])]).toEqual([1, 0]);
    // O vocabulário da finalidade é do banco (CHECK).
    expect(
      await codigo(
        nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-l57u-ck' }, (e) =>
          e.executar("UPDATE usuario_fonte_pagadora SET finalidade = 'outra' WHERE usuario_id = ? LIMIT 1", [
            id,
          ]),
        ),
      ),
    ).toMatch(/^outro: .*(CONSTRAINT|ck_usuario_fonte_pagadora_finalidade)/i);
  });

  it('nada vaza para outro estabelecimento: conta de lá e conta inexistente recusadas', async () => {
    for (const login of [`${P}.NOUTRO`, `${P}.GESTOR-NAO`]) {
      expect(await codigo(exec('acesso.concederUnidadeUsuario', { login, valor: unidade }))).toBe(
        'usuario-inexistente',
      );
      expect(await codigo(exec('acesso.trocarGrupoUsuario', { login, grupo: `${P}-B` }))).toBe(
        'usuario-inexistente',
      );
      expect(
        await codigo(exec('acesso.alterarUsuario', { login, nomeCompleto: 'X Y', versao: '["1"]' })),
      ).toBe('usuario-inexistente');
    }
    const n = await um<{ n: number }>(
      `SELECT COUNT(*) AS n FROM usuario_unidade x JOIN usuario u ON u.id = x.usuario_id WHERE u.login = ?`,
      [`${P}.NOUTRO`],
    );
    expect(Number(n.n)).toBe(0);
  });

  it('criar: CPF de outra conta e CPF inválido recusados, nada gravado', async () => {
    expect(
      await codigo(
        exec('acesso.criarUsuario', {
          login: `${P}.NCPF`,
          nomeCompleto: 'X Y',
          grupo: `${P}-A`,
          cpf: '52998224725',
        }),
      ),
    ).toBe('cpf-em-uso');
    for (const cpf of ['00000000000', '52998224724'])
      expect(
        await codigo(
          exec('acesso.criarUsuario', { login: `${P}.NCPF`, nomeCompleto: 'X Y', grupo: `${P}-A`, cpf }),
        ),
      ).not.toBe('gravou');
    const n = await um<{ n: number }>('SELECT COUNT(*) AS n FROM usuario WHERE login = ?', [`${P}.NCPF`]);
    expect(Number(n.n)).toBe(0);
  });

  it('primeiro acesso: a conta criada recebe a senha provisória (credencial com troca obrigatória e histórico)', async () => {
    const id = Number((await um<{ id: number }>('SELECT id FROM usuario WHERE login = ?', [NOVO])).id);
    expect(
      Number(
        (await um<{ n: number }>('SELECT COUNT(*) AS n FROM credencial_usuario WHERE usuario_id = ?', [id]))
          .n,
      ),
    ).toBe(0);
    const porta = portaSenhaDoNucleo(nucleo, () => nucleo.criarExecutor({ log: () => undefined }), CLIENTE);
    const resumo = await cifrarSenha(`P${randomUUID()}9`, { memoria: 8_192, passes: 1, paralelismo: 1 });
    const gravou = await porta.gravar(
      P,
      NOVO,
      resumo,
      {
        rede: 'rede-sint',
        estabelecimento: P,
        autor: `${P}.GESTOR`,
        correlacao: 'teste-l57u',
        chaveIdempotencia: `tl57u-${randomUUID()}`,
        estacao: 'teste',
        reautenticadoEm: Date.now(),
      },
      'redefinicao',
    );
    expect(gravou).toBe(id);
    const cr = await um<Record<string, unknown>>(
      `SELECT COUNT(*) AS n, MAX(troca_obrigatoria) AS troca, MAX(algoritmo) AS alg,
              (SELECT COUNT(*) FROM historico_senha WHERE usuario_id = ?) AS hist
         FROM credencial_usuario WHERE usuario_id = ? AND excluido_em IS NULL`,
      [id, id],
    );
    expect([Number(cr['n']), Number(cr['troca']), cr['alg'], Number(cr['hist'])]).toEqual([
      1,
      1,
      'argon2id',
      1,
    ]);
  });

  it('criar com a senha inicial numa transação: conta, vínculo, perfil, credencial de troca obrigatória e histórico; a pessoa entra com a provisória; nada fica pela metade', async () => {
    const login = `${P}.NSENHA`;
    const clara = `P${randomUUID()}9`;
    const leve = { memoria: 8_192, passes: 1, paralelismo: 1 };
    let criadas = 0;
    const criar = (l: string) => (resumo: string | null) => {
      criadas += 1;
      return exec('acesso.criarUsuario', {
        login: l,
        nomeCompleto: 'USUARIA SINTETICA SENHA',
        grupo: `${P}-A`,
        ...(resumo === null ? {} : { resumoSenhaInicial: resumo }),
      });
    };
    const preparar = async () => ({ senha: clara, resumo: await cifrarSenha(clara, leve) });
    const r = await criarContaComSenhaInicial(preparar, criar(login));
    expect(r.senhaInicial).toEqual({
      emitida: true,
      senha: { senhaProvisoria: clara, trocaObrigatoria: true },
    });
    const retrato = async (l: string) => {
      const u = await um<Record<string, unknown> | null>(
        `SELECT u.id, u.exige_troca_senha AS exige,
                (SELECT COUNT(*) FROM usuario_estabelecimento x WHERE x.usuario_id = u.id AND x.excluido_em IS NULL) AS vinculos,
                (SELECT COUNT(*) FROM usuario_perfil x WHERE x.usuario_id = u.id AND x.excluido_em IS NULL) AS perfis,
                (SELECT COUNT(*) FROM credencial_usuario x WHERE x.usuario_id = u.id AND x.excluido_em IS NULL) AS credenciais,
                (SELECT COUNT(*) FROM historico_senha x WHERE x.usuario_id = u.id AND x.forma_troca = 'criacao'
                    AND x.operacao = 'inclusao' AND x.responsavel_usuario_id = ?) AS historico
           FROM usuario u WHERE u.login = ?`,
        [gestor, l],
      );
      return u ? ['exige', 'vinculos', 'perfis', 'credenciais', 'historico'].map((k) => Number(u[k])) : null;
    };
    expect(await retrato(login)).toEqual([1, 1, 1, 1, 1]);
    const cr = await um<Record<string, unknown>>(
      `SELECT c.resumo_senha, c.troca_obrigatoria, c.algoritmo, c.tentativas_invalidas FROM credencial_usuario c
         JOIN usuario u ON u.id = c.usuario_id WHERE u.login = ? AND c.excluido_em IS NULL`,
      [login],
    );
    // A senha entregue é a que a credencial gravada confere, e a troca é obrigatória.
    expect(Number(cr['troca_obrigatoria'])).toBe(1);
    expect(cr['algoritmo']).toBe('argon2id');
    expect(Number(cr['tentativas_invalidas'])).toBe(0);
    expect(await conferirSenha(clara, String(cr['resumo_senha']))).toBe(true);
    expect(await conferirSenha(`${clara}x`, String(cr['resumo_senha']))).toBe(false);
    // A trilha da criação nunca leva o resumo nem a senha.
    const t = await um<Record<string, unknown>>(
      `SELECT COUNT(*) AS n, SUM(CONCAT_WS(' ', dados_antes, dados_depois, motivo) LIKE ? OR CONCAT_WS(' ', dados_antes, dados_depois, motivo) LIKE ?) AS vaza
         FROM trilha_auditoria WHERE entidade = 'usuario' AND entidade_id = ?`,
      [`%${String(cr['resumo_senha']).slice(-20)}%`, `%${clara}%`, r.conta['idUsuario']],
    );
    expect(Number(t['n'])).toBeGreaterThanOrEqual(1);
    expect(Number(t['vaza'] ?? 0)).toBe(0);

    // Primeiro acesso pelo caminho real do login: a provisória entra, com troca obrigatória; outra senha não.
    // O login aceita só código de estabelecimento em minúsculas: a conta ganha também o vínculo a um sintético assim.
    const LOGIN_EST = 'l57ux';
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l57u' }, async (e) => {
      const agora = new Date();
      const x = await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [LOGIN_EST]);
      const idEst = x
        ? Number(x.id)
        : await e.inserir(
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
            [LOGIN_EST, 'ESTAB L57UX SINTETICO', 'ESTAB L57UX SINTETICO', agora],
          );
      await e.inserir(
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [r.conta['idUsuario'], idEst, '2020-01-01', agora],
      );
    });
    const acesso = new FonteAcessoPropria(nucleo, CLIENTE, 'rede-sint', () => undefined);
    await acesso.carregar();
    const ok = await acesso.autenticar(LOGIN_EST, login, clara);
    expect(ok.desfecho).toBe('ok');
    expect(ok.desfecho === 'ok' && ok.conta.trocaObrigatoria).toBe(true);
    expect((await acesso.autenticar(LOGIN_EST, login, `${clara}x`)).desfecho).toBe('credencial-invalida');

    // Resumo fora do argon2id: a criação inteira é recusada e nada fica gravado (nem conta sem senha).
    const torto = `${P}.NTORTO`;
    expect(
      await codigo(
        criarContaComSenhaInicial(async () => ({ senha: clara, resumo: 'sem-cifra' }), criar(torto)),
      ),
    ).toBe('senha-sem-cifra');
    expect(await retrato(torto)).toBeNull();

    // Sem como gerar a senha: a conta nasce sem credencial e a resposta diz pendente.
    const pend = `${P}.NPEND`;
    const f = await criarContaComSenhaInicial(async () => {
      throw new Error('política ilegível');
    }, criar(pend));
    expect(f.senhaInicial.emitida).toBe(false);
    expect(await retrato(pend)).toEqual([1, 1, 1, 0, 0]);

    // A criação recusada (login em uso) não grava credencial nova nem histórico.
    const antes = criadas;
    expect(await codigo(criarContaComSenhaInicial(preparar, criar(login)))).toBe('login-em-uso');
    expect(criadas).toBe(antes + 1);
    expect(await retrato(login)).toEqual([1, 2, 1, 1, 1]);
  });
});
