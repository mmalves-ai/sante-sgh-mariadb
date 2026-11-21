// Integração da turma de treino contra o MariaDB real (cliente f22_o5, já criado pela obra; se faltar:
// `python3 -I tools/db/criar_cliente.py f22_o5 "Teste F2.2 onda 5"`). Contas fictícias, apagadas no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { cifrarSenha, conferirSenha } from '@sgh/dominio-acesso';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executarRecriarTurma, MOTIVO_DISPENSA_CPF, recriarTurmaTreino } from './treino-turma.ts';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const ALUNOS = ['t0511.aluno1', 't0511.aluno2'];
const ALHEIO = 't0511.servico';
const TODOS = [...ALUNOS, ALHEIO];

interface Conta {
  login: string;
  situacao: string;
  dispensa_cpf: number;
  exige_troca_senha: number;
  versao: number;
  expira_em: Date | null;
}

// Senha sintética só do teste (nunca impressa); o resumo é o que a operação grava.
const SENHA_TESTE = `Turma-${Date.now()}-x`;

describe.skipIf(SEM_BANCO)('turma de treino no banco próprio (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  let resumo = '';
  const pedido = (logins: readonly string[]) => ({ estabelecimento: est, logins, resumoSenha: resumo });
  const limpar = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-05-11-limpeza' }, async (e) => {
      const ids = 'SELECT id FROM usuario WHERE login IN (?, ?, ?)';
      await e.executar(`DELETE FROM usuario_estabelecimento WHERE usuario_id IN (${ids})`, TODOS);
      await e.executar(`DELETE FROM credencial_usuario WHERE usuario_id IN (${ids})`, TODOS);
      await e.executar(`DELETE FROM usuario WHERE login IN (?, ?, ?)`, TODOS);
    });
  const acessos = () =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-05-11' }, (l) =>
      l.consultar<Record<string, unknown>>(
        `SELECT u.login, v.estabelecimento_id, v.padrao, v.vigencia_inicio <= CURDATE() AS vigente_inicio,
                v.vigencia_fim >= CURDATE() AS vigente_fim, c.resumo_senha, c.troca_obrigatoria
           FROM usuario u
           JOIN usuario_estabelecimento v ON v.usuario_id = u.id AND v.excluido_em IS NULL
           JOIN credencial_usuario c ON c.usuario_id = u.id AND c.excluido_em IS NULL
          WHERE u.login IN (?, ?) ORDER BY u.login`,
        ALUNOS,
      ),
    );
  const contas = () =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-05-11' }, (l) =>
      l.consultar<Conta & Record<string, unknown>>(
        'SELECT login, situacao, dispensa_cpf, exige_troca_senha, versao, expira_em FROM usuario WHERE login IN (?, ?) ORDER BY login',
        ALUNOS,
      ),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    resumo = await cifrarSenha(SENHA_TESTE, { memoria: 8192, passes: 1, paralelismo: 1 });
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-05-11-preparo' }, async (e: Escritor) => {
      const l = await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', ['f22o511t']);
      est = l
        ? Number(l.id)
        : await e.inserir(
            'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, NOW(3))',
            ['f22o511t', 'Hospital de treino 05-11', 'Hospital de treino 05-11 (ficticio)'],
          );
    });
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-05-11-preparo' }, (e) =>
      e.inserir(`INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', NOW(3))`, [
        ALHEIO,
        'Conta de serviço de teste 05-11',
      ]),
    );
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('só roda em cliente de treino (treino_<código>): recusa outro cliente sem gravar', async () => {
    await expect(recriarTurmaTreino(nucleo.criarExecutor(), CLIENTE, pedido(ALUNOS))).rejects.toThrow(
      /não é cliente de treino/,
    );
    expect((await contas()).length).toBe(0);
  });

  it('cria as contas da turma com dispensa de CPF, troca de senha e validade, com trilha', async () => {
    const s = await executarRecriarTurma(nucleo.criarExecutor(), CLIENTE, pedido(ALUNOS));
    expect(s.resultado).toEqual({ criados: 2, reativados: 0 });
    const c = await contas();
    expect(
      c.map((x) => [
        x.login,
        x.situacao,
        Number(x.dispensa_cpf),
        Number(x.exige_troca_senha),
        Number(x.versao),
      ]),
    ).toEqual([
      ['t0511.aluno1', 'ativo', 1, 1, 1],
      ['t0511.aluno2', 'ativo', 1, 1, 1],
    ]);
    for (const x of c) expect(new Date(x.expira_em ?? 0).getTime()).toBeGreaterThan(Date.now());
    expect(s.trilha).not.toBeNull();
    const n = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-05-11' }, (l) =>
      l.uma<{ n: number }>('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE id = ?', [s.trilha]),
    );
    expect(Number(n?.n)).toBe(1);
    const motivo = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-05-11' }, (l) =>
      l.uma<{ motivo: string }>('SELECT motivo FROM trilha_auditoria WHERE id = ?', [s.trilha]),
    );
    expect(motivo?.motivo).toBe(MOTIVO_DISPENSA_CPF);
  });

  it('o aluno tem acesso vigente ao estabelecimento de treino (padrão) e entra com a senha inicial', async () => {
    const a = await acessos();
    expect(
      a.map((x) => [
        x['login'],
        Number(x['estabelecimento_id']),
        Number(x['padrao']),
        Number(x['vigente_inicio']),
        Number(x['vigente_fim']),
        Number(x['troca_obrigatoria']),
      ]),
    ).toEqual([
      ['t0511.aluno1', est, 1, 1, 1, 1],
      ['t0511.aluno2', est, 1, 1, 1, 1],
    ]);
    for (const x of a) expect(await conferirSenha(SENHA_TESTE, String(x['resumo_senha']))).toBe(true);
  });

  it('no reinício reativa a conta bloqueada (nova versão) em vez de criar outra', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-05-11-bloqueio' }, (e) =>
      e.executar(
        `UPDATE usuario SET situacao = 'bloqueado', bloqueado_em = NOW(3), versao = versao + 1 WHERE login = ?`,
        [ALUNOS[0]],
      ),
    );
    const s = await executarRecriarTurma(nucleo.criarExecutor(), CLIENTE, pedido(ALUNOS));
    expect(s.resultado).toEqual({ criados: 0, reativados: 2 });
    expect((await acessos()).length).toBe(2);
    const c = await contas();
    expect(c.map((x) => [x.situacao, Number(x.versao)])).toEqual([
      ['ativo', 3],
      ['ativo', 2],
    ]);
  });

  it('recusa login que não é de turma, login inválido, senha em claro e falta de estabelecimento, sem gravar nada', async () => {
    const ex = nucleo.criarExecutor();
    await expect(executarRecriarTurma(ex, CLIENTE, pedido([ALUNOS[0]!, ALHEIO]))).rejects.toThrow();
    await expect(executarRecriarTurma(ex, CLIENTE, pedido(['a:b']))).rejects.toThrow();
    await expect(
      executarRecriarTurma(ex, CLIENTE, { ...pedido(ALUNOS), resumoSenha: SENHA_TESTE }),
    ).rejects.toThrow();
    await expect(
      ex.executar(
        (await import('./treino-turma.ts')).OPERACAO_RECRIAR_TURMA,
        CLIENTE,
        { logins: ALUNOS, validadeDias: 7, resumoSenha: resumo },
        {
          cliente: CLIENTE,
          estabelecimento: null,
          usuario: null,
          correlacao: 'f22-05-11',
          chaveIdempotencia: `t-${Date.now()}`,
        },
      ),
    ).rejects.toThrow();
    const c = await contas();
    expect(c.map((x) => Number(x.versao))).toEqual([3, 2]);
  });
});
