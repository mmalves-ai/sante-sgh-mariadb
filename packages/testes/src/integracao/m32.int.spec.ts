// Financeiro sobre a cópia (ficha do M32, seção 10), sempre em transação desfeita e sob a trava da cópia:
//   - colisão: o título a receber alterado por fora entre a leitura e a baixa (o carimbo do gatilho muda) é recusado com
//     o aviso de colisão, nada gravado;
//   - LOCK TIMEOUT: outro terminal segura o título (WITH LOCK) e a baixa devolve "registro em edição";
//   - Idempotency-Key na baixa e no lançamento do movimento: a mesma chave devolve a gravação anterior sem efeito novo
//     (uma linha só em MFLANCTO; o título baixado uma vez);
//   - transação que falha (o gatilho recusa excluir o título pago) não deixa evento na SGH_OUTBOX nem linha SGH_;
//   - charset: o histórico com acento e cedilha (CP1252) volta igual do banco; o caractere fora do CP1252 é recusado na
//     validação, antes do banco;
//   - D-SALDO-32: entre dois fechamentos MFSALDOS consecutivos da mesma conta, a diferença bate com os movimentos MAIS
//     os títulos recebidos e pagos na conta (a baixa não gera MFLANCTO); só contagens de intervalos;
//   - regra 15: a linha do extrato de uma conta fora do escopo não se concilia (403), nem com o alvo de outra conta;
//   - leituras: o tempo da lista paginada de títulos a pagar, de títulos a receber, das contas sem título e do movimento
//     da conta, medido na cópia (vai ao log, só números).
// O retrato antes e depois (contagens de MFCONPAG, MFCTAREC, MFLANCTO, MFBORDER, SGH_OUTBOX e das tabelas SGH_FIN_)
// prova que o ROLLBACK desfez tudo. Massa: títulos e contas da cópia (só IDs); o operador sintético. Saída só com
// contagens, códigos e tempos (nenhum nome).
import { esquemaLancarMovimento } from '@sgh/contratos';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  borderos,
  confirmarConciliacaoSgh,
  contasDoEscopo,
  contasSemTituloLidas,
  ErroOperacao,
  filaAprovacao,
  movimentoDaConta,
  operacao,
  titulosPagar,
  importarExtratoSgh,
  titulosReceber,
  variacaoDaConta,
  versaoDaLinhaFaturamento,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).name}`;
  }
}

const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

/** Título a receber em aberto do particular (sem conta ligada a ele por gatilho de exclusão). */
const SQL_RECEBER = `SELECT FIRST 1 m.ID, m.VALOR, m.DATA_HORA_ULTIMA_ATUALIZACAO C FROM MFCTAREC m WHERE m.PGTO = '1899-12-30'
   AND m.VALOR > 0 AND COALESCE(m.VLR_PAG, 0) = 0 AND m.DEV IN ('E', 'I') ORDER BY m.ID DESC`;
/** Conta bancária que recebeu títulos recentes (ativa). */
const SQL_CONTA = `SELECT FIRST 1 t.ID, t.ID_CTABAN FROM TBCTABAN t WHERE t.EMPRESA = 1
   AND EXISTS (SELECT 1 FROM MFCTAREC r WHERE r.ID_TBCTABAN = t.ID AND r.PGTO >= '2026-01-01') ORDER BY t.ID`;
/** Classificação gerencial de um movimento recente (existe em TBITEDES). */
const SQL_CLASSIFICACAO = `SELECT FIRST 1 g.GRUPO, g.SUBGRUPO, g.ITEM FROM TBITEDES g WHERE g.GRUPO > 0 ORDER BY g.ID DESC`;

describe.skipIf(!PODE_ESCREVER)('M32: financeiro na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let titulo = { id: 0, valor: 0, versao: '' };
  let conta = { id: 0, ctaban: 0 };
  beforeAll(async () => {
    a = await prepararAmbiente();
    await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [t] = await l.consultar(SQL_RECEBER, [], { teto: 1, tempoMaximoMs: 120_000 });
      titulo = {
        id: num(t?.['ID']),
        valor: num(t?.['VALOR']),
        versao: versaoDaLinhaFaturamento(t?.['C'] ?? null),
      };
      const [c] = await l.consultar(SQL_CONTA, [], { teto: 1, tempoMaximoMs: 120_000 });
      conta = { id: num(c?.['ID']), ctaban: num(c?.['ID_CTABAN']) };
    });
    expect(titulo.id).toBeGreaterThan(0);
    expect(conta.id).toBeGreaterThan(0);
    // A conferência do schema leva minutos na cópia com a VM carregada.
  }, 1_200_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  /** O retrato (só contagens) das tabelas que o marco grava e das SGH_ do marco. */
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const [r] = await l.consultar(
        `SELECT (SELECT COUNT(*) FROM MFCONPAG) P, (SELECT COUNT(*) FROM MFCTAREC) R, (SELECT COUNT(*) FROM MFLANCTO) L,
           (SELECT COUNT(*) FROM MFBORDER) B, (SELECT COUNT(*) FROM SGH_OUTBOX) O,
           (SELECT COUNT(*) FROM SGH_FIN_APROVACAO) A, (SELECT COUNT(*) FROM SGH_FIN_GLOSA_TITULO) G,
           (SELECT COUNT(*) FROM SGH_FIN_RATEIO) T, (SELECT COUNT(*) FROM SGH_FIN_EXTRATO) E,
           (SELECT PGTO FROM MFCTAREC WHERE ID = ?) PG FROM RDB$DATABASE`,
        [titulo.id],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      return { ...r, PG: dia(r?.['PG']) };
    });

  async function operador(e: Escritor): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    // O escopo de conta bancária do operador (MFCTAUSU, como o cadastro de parâmetros faria).
    const [u] = await e.consultar('SELECT ID_TBUSERS FROM TBUSERS WHERE NOME = ?', [login], { teto: 1 });
    await e.executar('INSERT INTO MFCTAUSU (ID_TBUSERS, ID_TBCTABAN) VALUES (?, ?)', [
      num(u?.['ID_TBUSERS']),
      conta.ctaban,
    ]);
    return login;
  }
  const hoje = async (e: Pick<Escritor, 'consultar'>) =>
    dia((await e.consultar('SELECT CURRENT_DATE H FROM RDB$DATABASE', [], { teto: 1 }))[0]?.['H']);
  const baixa = async (e: Escritor, versao: string) => ({
    cenario: 'receber',
    titulo: titulo.id,
    versao,
    conta: conta.id,
    dataRecebimento: await hoje(e),
    valorRecebido: titulo.valor,
    formaPagamento: 1,
    motivo: 'SINTETICO M32: recebimento conferido no extrato',
  });

  it('colisão: o título alterado por fora entre a leitura e a baixa é recusado, nada gravado', async () => {
    const antes = await retrato();
    const c = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      // Outro terminal mexe no título (qualquer alteração recarimba DATA_HORA_ULTIMA_ATUALIZACAO pelo gatilho).
      await new Promise((r) => setTimeout(r, 1_100));
      await e.executar('UPDATE MFCTAREC SET OBS = OBS WHERE ID = ?', [titulo.id]);
      return codigo(
        a.executor.executar(
          operacao('financeiro.baixarTitulo'),
          a.cod,
          await baixa(e, titulo.versao),
          ctxOperacao(a, login),
          {
            escritor: e,
          },
        ),
      );
    });
    expect(c).toBe('titulo-ja-baixado');
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('LOCK TIMEOUT: outro terminal segura o título e a baixa devolve "registro em edição"', async () => {
    const antes = await retrato();
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await e.consultar('SELECT ID FROM MFCTAREC WHERE ID = ? WITH LOCK', [titulo.id], { teto: 1 });
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    await travada;
    let c: string;
    try {
      c = await codigo(
        a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
          const login = await operador(e);
          return a.executor.executar(
            operacao('financeiro.baixarTitulo'),
            a.cod,
            await baixa(e, titulo.versao),
            ctxOperacao(a, login),
            { escritor: e },
          );
        }),
      );
    } finally {
      soltar();
      await segurando;
    }
    expect(c).toBe('registro-em-edicao');
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('Idempotency-Key: a baixa e o lançamento repetidos devolvem a gravação anterior sem efeito novo', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const chaveBaixa = `int-m32-baixa-${Date.now().toString(36)}`;
      const entrada = await baixa(e, titulo.versao);
      const exec = (op: string, x: unknown, chave: string) =>
        a.executor.executar(operacao(op), a.cod, x, ctxOperacao(a, login, chave), { escritor: e });
      const b1 = await exec('financeiro.baixarTitulo', entrada, chaveBaixa);
      const b2 = await exec('financeiro.baixarTitulo', entrada, chaveBaixa);
      const [pg] = await e.consultar('SELECT PGTO, VLR_PAG FROM MFCTAREC WHERE ID = ?', [titulo.id], {
        teto: 1,
      });
      const [k] = await e.consultar(SQL_CLASSIFICACAO, [], { teto: 1 });
      const mov = esquemaLancarMovimento.parse({
        tipo: 'O',
        data: await hoje(e),
        contaCredito: null,
        contaDebito: conta.id,
        valor: 12.34,
        historico: 'SINTETICO M32 tarifa',
        classificacao: { grupo: num(k?.['GRUPO']), subgrupo: num(k?.['SUBGRUPO']), item: num(k?.['ITEM']) },
      });
      const [n0] = await e.consultar('SELECT COUNT(*) N FROM MFLANCTO', [], { teto: 1 });
      const chaveMov = `int-m32-mov-${Date.now().toString(36)}`;
      const m1 = await exec('financeiro.lancarMovimento', mov, chaveMov);
      const m2 = await exec('financeiro.lancarMovimento', mov, chaveMov);
      const [n1] = await e.consultar('SELECT COUNT(*) N FROM MFLANCTO', [], { teto: 1 });
      return {
        baixa: [b1.repetida, b2.repetida],
        pago: dia(pg?.['PGTO']) === (await hoje(e)) && num(pg?.['VLR_PAG']) === titulo.valor,
        movimento: [m1.repetida, m2.repetida],
        linhas: num(n1?.['N']) - num(n0?.['N']),
      };
    });
    expect(r).toEqual({ baixa: [false, true], pago: true, movimento: [false, true], linhas: 1 });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('a transação que falha não deixa evento na SGH_OUTBOX nem linha SGH_', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const conta0 = async () => {
        const [x] = await e.consultar(
          `SELECT (SELECT COUNT(*) FROM SGH_OUTBOX) O, (SELECT COUNT(*) FROM SGH_TRILHA WHERE HOSPITAL = ? AND USUARIO = ?) T,
             (SELECT COUNT(*) FROM SGH_FIN_RATEIO) R, (SELECT COUNT(*) FROM SGH_IDEMPOTENCIA) I FROM RDB$DATABASE`,
          [a.cod, login],
          { teto: 1 },
        );
        return x;
      };
      const [pago] = await e.consultar(
        "SELECT FIRST 1 ID FROM MFCONPAG WHERE DT_PGTO > '1900-01-01' AND EMPRESA = 1 ORDER BY ID DESC",
        [],
        { teto: 1 },
      );
      const antesDaFalha = await conta0();
      // Excluir o título pago: o gatilho TRG_MFCONPAG_AD recusa (E_EXC_MFCONPAG_PAGO) e o executor desfaz o passo.
      const c = await codigo(
        a.executor.executar(
          operacao('financeiro.criarTituloPagar'),
          a.cod,
          { acao: 'excluir', titulo: num(pago?.['ID']), versao: null },
          ctxOperacao(a, login),
          { escritor: e },
        ),
      );
      return { c, igual: JSON.stringify(await conta0()) === JSON.stringify(antesDaFalha) };
    });
    expect(r.c).not.toBe('gravou');
    expect(r.igual).toBe(true);
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('charset: acento e cedilha voltam iguais; caractere fora do CP1252 é recusado antes do banco', async () => {
    const antes = await retrato();
    const HISTORICO = 'Tarifa de manutenção — ÇÃÕÉ ç ã õ é ü º ª';
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const [k] = await e.consultar(SQL_CLASSIFICACAO, [], { teto: 1 });
      const base = {
        tipo: 'O',
        data: await hoje(e),
        contaCredito: null,
        contaDebito: conta.id,
        valor: 1.23,
        classificacao: { grupo: num(k?.['GRUPO']), subgrupo: num(k?.['SUBGRUPO']), item: num(k?.['ITEM']) },
      };
      const s = await a.executor.executar(
        operacao('financeiro.lancarMovimento'),
        a.cod,
        esquemaLancarMovimento.parse({ ...base, historico: HISTORICO }),
        ctxOperacao(a, login),
        { escritor: e },
      );
      const [m] = await e.consultar(
        'SELECT HIST FROM MFLANCTO WHERE ID = ?',
        [num(s.resultado['movimento'])],
        {
          teto: 1,
        },
      );
      const fora = esquemaLancarMovimento.safeParse({ ...base, historico: 'Tarifa 😀 emoji' });
      return { volta: String(m?.['HIST'] ?? '').trim(), recusado: !fora.success };
    });
    expect(r).toEqual({ volta: HISTORICO, recusado: true });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('D-SALDO-32: a diferença entre fechamentos consecutivos bate com movimentos + títulos recebidos − pagos', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const rs = await l.consultar(
        `SELECT ID_TBCTABAN, DATA, SALDO FROM MFSALDOS WHERE DATA >= '2025-01-01' ORDER BY ID_TBCTABAN, DATA`,
        [],
        { teto: 5_000, tempoMaximoMs: 120_000 },
      );
      const pares: { conta: number; de: string; ate: string; diferenca: number }[] = [];
      for (let i = 1; i < rs.length; i++) {
        const x = rs[i - 1];
        const y = rs[i];
        if (!x || !y || num(x['ID_TBCTABAN']) !== num(y['ID_TBCTABAN'])) continue;
        pares.push({
          conta: num(y['ID_TBCTABAN']),
          de: dia(x['DATA']),
          ate: dia(y['DATA']),
          diferenca: num(y['SALDO']) - num(x['SALDO']),
        });
      }
      // Os 60 intervalos mais recentes (teto de massa: cada um são duas consultas agregadas).
      const amostra = pares.sort((p, q) => (p.ate < q.ate ? 1 : -1)).slice(0, 60);
      let soMovimento = 0;
      let comTitulos = 0;
      let comBaixa = 0;
      for (const p of amostra) {
        const v = await variacaoDaConta(l, p.conta, p.de, p.ate);
        const bate = (x: number) => Math.abs(x - p.diferenca) < 0.01;
        if (bate(v.creditos - v.debitos)) soMovimento++;
        if (bate(v.creditos - v.debitos + v.recebidos - v.pagos)) comTitulos++;
        if (v.recebidos !== 0 || v.pagos !== 0) comBaixa++;
      }
      return { intervalos: amostra.length, soMovimento, comTitulos, comBaixa };
    });
    console.log(`[m32] D-SALDO-32 na cópia: ${JSON.stringify(r)}`);
    expect(r.intervalos).toBeGreaterThan(0);
    // Com os títulos, a regra bate na grande maioria dos intervalos e nunca em menos que só com os movimentos.
    expect(r.comTitulos).toBeGreaterThanOrEqual(r.soMovimento);
    expect(r.comTitulos / r.intervalos).toBeGreaterThanOrEqual(0.9);
    if (r.comBaixa > 0) expect(r.comTitulos).toBeGreaterThan(r.soMovimento);
  }, 900_000);

  it('regra 15: a linha do extrato de conta fora do escopo não se concilia; o alvo tem de ser da conta da linha', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const h = await hoje(e);
      const imp = await importarExtratoSgh(e, {
        hospital: a.cod,
        usuario: 'SGH.TESTE',
        conta: conta.id,
        origem: 'csv',
        hashArquivo: `int-m32-escopo-${Date.now().toString(36)}`,
        chaveObjeto: null,
        linhas: [{ data: h, valor: 1.23, historico: 'SINTETICO M32 escopo', documento: '1' }],
      });
      const [linha] = await e.consultar(
        'SELECT CAST(ID AS VARCHAR(20)) ID FROM SGH_FIN_EXTRATO_LINHA WHERE HOSPITAL = ? AND ID_EXTRATO = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)',
        [a.cod, String(imp.id)],
        { teto: 1 },
      );
      const id = num(linha?.['ID']);
      const [mov] = await e.consultar(
        'SELECT FIRST 1 ID FROM MFLANCTO WHERE COALESCE(ID_TBCTABAN_CRE, 0) <> ? AND COALESCE(ID_TBCTABAN_DEV, 0) <> ? ORDER BY ID DESC',
        [conta.id, conta.id],
        { teto: 1 },
      );
      const tentar = (contasEscopo: number[], alvo: unknown) =>
        codigo(
          confirmarConciliacaoSgh(e, {
            hospital: a.cod,
            usuario: 'SGH.TESTE',
            linha: id,
            alvo: alvo as never,
            regra: 'manual',
            contasEscopo,
          }),
        );
      return {
        fora: await tentar([conta.id + 1_000_000], { tipo: 'credito-pendente' }),
        outraConta: await tentar([conta.id], { tipo: 'movimento', id: num(mov?.['ID']) }),
      };
    });
    expect(r).toEqual({ fora: 'fora-do-escopo', outraConta: 'alvo-de-outra-conta' });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('leituras na cópia: títulos a pagar e a receber, fila, borderôs, contas sem título, movimento e escopo (p95 no arquivo)', async () => {
    const tempos: Record<string, number[]> = {};
    const medir = async <T>(nome: string, fn: () => Promise<T>, vezes = 5): Promise<T> => {
      let r: T | undefined;
      for (let i = 0; i < vezes; i++) {
        const t0 = performance.now();
        r = await fn();
        (tempos[nome] ??= []).push(Math.round(performance.now() - t0));
      }
      return r as T;
    };
    const p95 = (xs: readonly number[]) =>
      [...xs].sort((x, y) => x - y)[Math.ceil(0.95 * xs.length) - 1] ?? 0;
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const h = await hoje(l);
      const pagar = await medir('titulosPagar', () =>
        titulosPagar(l, {
          situacao: 'aberto',
          vencimentoDe: null,
          vencimentoAte: null,
          credor: null,
          tipo: null,
          pagina: 0,
          hoje: h,
        }),
      );
      const vencidos = await medir('titulosPagarVencidos', () =>
        titulosPagar(l, {
          situacao: 'vencido',
          vencimentoDe: `${h.slice(0, 4)}-01-01`,
          vencimentoAte: h,
          credor: null,
          tipo: null,
          pagina: 0,
          hoje: h,
        }),
      );
      const receber = await medir('titulosReceber', () =>
        titulosReceber(l, a.cod, {
          devedor: null,
          convenio: null,
          aberto: true,
          vencimentoDe: null,
          vencimentoAte: null,
          pagina: 0,
          hoje: h,
        }),
      );
      const fila = await medir('filaAprovacao', () => filaAprovacao(l, h, h));
      const bords = await medir('borderos', () => borderos(l, `${h.slice(0, 7)}-01`, h));
      const sem = await medir('contasSemTitulo', () =>
        contasSemTituloLidas(l, { convenio: null, ano: Number(h.slice(0, 4)), mes: null }),
      );
      const mov = await medir('movimento', () => movimentoDaConta(l, conta.id, `${h.slice(0, 7)}-01`, h));
      const contas = await medir('contasDoEscopo', () => contasDoEscopo(l, null), 2);
      return {
        pagar: pagar.itens.length,
        vencidos: vencidos.itens.length,
        receber: receber.itens.length,
        fila: fila.length,
        borderos: bords.length,
        sem: sem.length,
        movimento: mov.length,
        contas: contas.length,
      };
    });
    const resumo = Object.fromEntries(
      Object.entries(tempos).map(([k, v]) => [k, { p95: p95(v), n: v.length }]),
    );
    const pasta = resolve(import.meta.dirname, '../../../../docs/marcos/M32');
    mkdirSync(pasta, { recursive: true });
    writeFileSync(
      resolve(pasta, 'carga-leituras.json'),
      `${JSON.stringify({ medidoEm: new Date().toISOString().slice(0, 10), estabelecimento: a.cod, linhas: r, p95Ms: resumo }, null, 2)}\n`,
    );
    expect(r.pagar).toBeGreaterThan(0);
    expect(r.receber).toBeGreaterThan(0);
    expect(r.contas).toBeGreaterThan(0);
    for (const v of Object.values(resumo)) expect(v.p95).toBeLessThan(30_000);
  }, 900_000);
});
