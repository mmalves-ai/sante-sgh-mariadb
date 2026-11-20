// Executor sobre a cópia (ficha do M04, seção 10; regras 6 e 12): prova pós-escrita que desfaz (0 linha
// nova), trava de TBGERSEQ ocupada por outra conexão (registro em edição em outro terminal, sem linha
// gravada), charset (nome acentuado grava e relê sem U+FFFD; emoji recusado antes do banco). Toda gravação
// em transação desfeita; massa sintética marcada; saída só com contagens e códigos.
import { chaveDoEvento, definirOperacao, ErroOperacao, exigirEfeito, operacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  NOME_ACENTUADO,
  pacienteSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const cadastrar = operacao('cadastro.cadastrarPaciente');
const criarUsuario = operacao('acesso.criarUsuarioIntegracao');

describe.skipIf(!PODE_ESCREVER)('executor na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  async function operador(
    e: Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0],
  ): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000)).toUpperCase();
    await a.executor.executar(
      criarUsuario,
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      {
        escritor: e,
      },
    );
    return login;
  }

  it('regra 6: prova que exige efeito inexistente desfaz tudo (0 linha nova em TBUSERS e nas SGH_)', async () => {
    const semEfeito = definirOperacao({
      ...criarUsuario,
      async provar() {
        exigirEfeito(false, 'efeito inexistente de propósito');
      },
    });
    const login = await a.nucleo.lerSomente(ctx(a), (l) => loginLivre(l, Date.now() % 1_000_000));
    const c = ctxOperacao(a, 'SGH.TESTE');
    let codigo = '';
    try {
      await a.executor.executar(semEfeito, a.cod, usuarioSintetico('usuario-tecnico', login), c, {
        desfazer: true,
      });
    } catch (e) {
      codigo = e instanceof ErroOperacao ? (e.problema.codigo ?? '') : 'outro';
    }
    expect(codigo).toBe('acao_sem_efeito');
    const depois = await a.nucleo.lerSomente(ctx(a), async (l) => ({
      usuario: await contar(l, 'SELECT COUNT(*) N FROM TBUSERS WHERE NOME = ?', [login]),
      idem: await contar(l, 'SELECT COUNT(*) N FROM SGH_IDEMPOTENCIA WHERE CHAVE = ?', [c.idempotencyKey]),
      outbox: await contar(l, 'SELECT COUNT(*) N FROM SGH_OUTBOX WHERE CHAVE_EVENTO = ?', [
        chaveDoEvento(a.cod, 'acesso.criarUsuarioIntegracao', c.idempotencyKey, 0),
      ]),
    }));
    expect(depois).toEqual({ usuario: 0, idem: 0, outbox: 0 });
    console.log(`[${a.cod}] prova sem efeito: ${codigo}; linhas novas ${JSON.stringify(depois)}`);
  });

  it('cadastro: grava, os triggers numeram e retratam, a prova passa; trilha, outbox e idempotência na mesma transação', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const cpf = await cpfLivre(e, Date.now() % 90_000_000);
      const cep = await cepCompleto(e, new Set(['81', '8', '65', '100']));
      const c = ctxOperacao(a, usuario);
      const s = await a.executor.executar(cadastrar, a.cod, pacienteSintetico('com-cep', cpf, cep), c, {
        escritor: e,
      });
      const id = num(s.resultado['idPaciente']);
      return {
        id: id > 0,
        prontuario: num(s.resultado['prontuario']) > 0,
        retrato: await contar(e, 'SELECT COUNT(*) N FROM HTPACIENTE WHERE ID_RICADPAC = ?', [id]),
        usuario: await contar(e, 'SELECT COUNT(*) N FROM RICADPAC WHERE ID = ? AND USUARIO = ?', [
          id,
          usuario,
        ]),
        trilha: await contar(e, 'SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID = CAST(? AS BIGINT)', [s.trilha]),
        outbox: await contar(
          e,
          "SELECT COUNT(*) N FROM SGH_OUTBOX WHERE ID = CAST(? AS BIGINT) AND SITUACAO = 'pendente'",
          [s.eventos[0]],
        ),
        idem: await contar(e, 'SELECT COUNT(*) N FROM SGH_IDEMPOTENCIA WHERE CHAVE = ?', [c.idempotencyKey]),
      };
    });
    expect(r).toEqual({ id: true, prontuario: true, retrato: 1, usuario: 1, trilha: 1, outbox: 1, idem: 1 });
    console.log(`[${a.cod}] cadastro desfeito: ${JSON.stringify(r)}`);
  });

  it('charset: nome acentuado do corpus grava e relê igual (sem U+FFFD); emoji é recusado antes do banco', async () => {
    const lido = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const usuario = await operador(e);
      const cpf = await cpfLivre(e, (Date.now() + 17) % 90_000_000);
      const cep = await cepCompleto(e, new Set(['81', '8', '65', '100']));
      const s = await a.executor.executar(
        cadastrar,
        a.cod,
        pacienteSintetico('minimo', cpf, cep),
        ctxOperacao(a, usuario),
        { escritor: e },
      );
      const [l] = await e.consultar(
        'SELECT NOME FROM RICADPAC WHERE ID = ?',
        [num(s.resultado['idPaciente'])],
        { teto: 1 },
      );
      return String(l?.['NOME'] ?? '');
    });
    expect(lido).toBe(NOME_ACENTUADO);
    expect(lido).not.toContain('�');
    let codigo = '';
    try {
      await a.executor.executar(
        cadastrar,
        a.cod,
        { ...pacienteSintetico('minimo', '90000000175', '20000000'), nome: 'PACIENTE 😀' },
        ctxOperacao(a, 'SGH.TESTE'),
        { desfazer: true },
      );
    } catch (e) {
      codigo = e instanceof ErroOperacao ? (e.problema.codigo ?? '') : 'outro';
    }
    expect(codigo).toBe('entrada-invalida');
    console.log(`[${a.cod}] charset: acentuado relido igual; emoji ${codigo}`);
  });

  it('espera de trava: outra conexão segura a linha de TBGERSEQ e o cadastro devolve "registro em edição em outro terminal"', async () => {
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await e.consultar('SELECT SEQ FROM TBGERSEQ WHERE TIPO = 1 WITH LOCK', [], { teto: 1 });
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    await travada;
    const inicio = Date.now();
    let codigo = '';
    let linhas = -1;
    try {
      await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const usuario = await operador(e);
        const cpf = await cpfLivre(e, (Date.now() + 31) % 90_000_000);
        const cep = await cepCompleto(e, new Set(['81', '8', '65', '100']));
        try {
          await a.executor.executar(
            cadastrar,
            a.cod,
            pacienteSintetico('minimo', cpf, cep),
            ctxOperacao(a, usuario),
            { escritor: e },
          );
        } catch (x) {
          codigo = x instanceof ErroOperacao ? (x.problema.codigo ?? '') : String(x);
          linhas = await contar(e, 'SELECT COUNT(*) N FROM RICADPAC WHERE CPF = ?', [Number(cpf)]);
        }
      });
    } finally {
      soltar();
      await segurando;
    }
    const esperou = Date.now() - inicio;
    expect(codigo).toBe('registro-em-edicao');
    expect(linhas).toBe(0);
    expect(esperou).toBeGreaterThanOrEqual(a.nucleo.config.lockTimeoutSegundos * 1000 - 500);
    console.log(
      `[${a.cod}] trava de TBGERSEQ: ${codigo} depois de ${Math.round(esperou / 1000)} s; 0 linha gravada`,
    );
  });
});
