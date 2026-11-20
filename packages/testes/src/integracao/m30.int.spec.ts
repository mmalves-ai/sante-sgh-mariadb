// Conta do paciente sobre a cópia (ficha do M30, seção 10, e regras 1, 4, 5, 7, 12 e 13), sempre em transação desfeita
// e sob a trava da cópia:
//   - regra 1 (sem-criar-conta): nenhuma receita do marco inclui conta; fechar, reabrir e conferir não mudam o número de
//     contas; regra 7 (sem-recalculo): o fechamento e a reabertura não tocam item da conta (os valores ficam iguais);
//   - regra 4 (fechar-reabrir): fecha a conta emitida e consistente e a reabre com o motivo; a apresentada não reabre;
//   - fechamento concorrente com o outro sistema: a conta alterada por fora entre a leitura e o salvar (o carimbo do
//     gatilho muda) é recusada com o conflito de versão, nada gravado;
//   - LOCK TIMEOUT: outro terminal segura a conta (WITH LOCK) e o fechamento devolve "registro em edição";
//   - Idempotency-Key: a mesma chave devolve a gravação anterior (repetida) e, com outro conteúdo, é recusada;
//   - prova pós-escrita falhando: o efeito ausente (a situação relida não é a gravada) lança a falha da prova, e a
//     transação desfeita não deixa nada;
//   - regra 5 (lancamento-tardio): a fila lê as fichas marcadas pelo gatilho (ATU_FAT 'F') de qualquer sistema; a
//     decisão vai só para o novo e é uma por ficha; o lançamento manual em conta fechada é recusado com o aviso da fila;
//   - regra 13 (escopo-convenio): a lista filtra pelo escopo e a conta de outro convênio fica fora;
//   - regra 12 (sem-caucao): o orçamento de urgência com garantia prévia é recusado;
//   - carga (cap-14 §14.5; D-K6-30): o fechamento medido em 10 execuções desfeitas (p95 < 30 s) e a grade de itens da
//     maior conta de internação de 2026 em 20 leituras de 500 itens (p95 < 1,5 s); os tempos vão ao log (só números).
//   - correção: a lista filtra a situação no banco (total coerente com a página, toda linha na situação pedida), em
//     auditoria pela etapa do novo e a idade desde a alta; o lançamento em conta por pacote C é recusado;
// O retrato antes e depois (a conta, os itens e as tabelas SGH_ do marco) prova que o ROLLBACK desfez tudo; nos testes
// de LOCK TIMEOUT e de Idempotency-Key, também o operador sintético (TBUSERS, SGH_TRILHA) e a chave (SGH_IDEMPOTENCIA). Massa: contas
// e itens da cópia (só IDs); o operador sintético. Saída só com contagens e códigos (nenhum nome).
import {
  ErroOperacao,
  ErroProva,
  decidirLancamentoTardioSgh,
  lancamentosTardios,
  itensDaConta,
  listarContasPaciente,
  OPERACOES_FATURAMENTO,
  operacao,
  registrarEtapaSgh,
  registrarOrcamentoSgh,
  versaoDaLinhaFaturamento,
} from '@sgh/legado';
import { SITUACOES_FILTRAVEIS } from '@sgh/dominio-faturamento';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { desfazerFechamentoPorFora, mexerNaContaPorFora } from '../massa/conta-outro-sistema.js';
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

const SQL_EMITIDA = `SELECT FIRST 1 c.ID FROM FCCTAEXT c
  WHERE c.FECHADA = 'N' AND c.IND_EMI = 'T' AND c.REMESSA <> 0 AND c.DATA_EMI > CAST('1900-01-01' AS DATE)
    AND c.TIPO_CTA = 'E' AND COALESCE(c.PACOTE, '') IN ('N', '')
    AND COALESCE(c.MED_SOL, -1) = COALESCE((SELECT b.COD FROM TBCBOPRO b WHERE b.ID = c.ID_TBCBOPRO_SOLICITANTE), -1)
    AND COALESCE(c.MED_CTA, -1) = COALESCE((SELECT b.COD FROM TBCBOPRO b WHERE b.ID = c.ID_TBCBOPRO_PRINCIPAL_CTA), -1)
    AND (COALESCE(c.ID_MFCTAREC, 0) = 0 OR EXISTS (SELECT 1 FROM MFCTAREC m WHERE m.ID_MFCTAREC = c.ID_MFCTAREC))
    AND (COALESCE(c.PROC_SOL, 0) = 0 OR (SELECT COUNT(*) FROM TBPROCTO p WHERE p.ID_TBCTRTHM = (SELECT v.THM_E FROM TBCONVEN v WHERE v.COD = c.CON)
       AND p.COD_PROCEDIMENTO = c.PROC_SOL) = 1)
    AND EXISTS (SELECT 1 FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID)
    AND ABS(COALESCE(c.TOTAL_CONTA, 0) - (SELECT COALESCE(SUM(l.VALOR_C), 0) FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID)) <= 0.005
    AND NOT EXISTS (SELECT 1 FROM FCFECMES f WHERE f.CONVENIO = c.CON AND f.ANO = c.ANOPRO AND f.MES = c.MESPRO)
  ORDER BY c.ID DESC`;

describe.skipIf(!PODE_ESCREVER)('M30: conta do paciente na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let conta = 0;
  let apresentada = 0;
  beforeAll(async () => {
    a = await prepararAmbiente();
    await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [c] = await l.consultar(SQL_EMITIDA, [], { teto: 1, tempoMaximoMs: 120_000 });
      conta = num(c?.['ID']);
      const [p] = await l.consultar(
        "SELECT FIRST 1 ID FROM FCCTAEXT WHERE FECHADA = 'A' ORDER BY ID DESC",
        [],
        { teto: 1 },
      );
      apresentada = num(p?.['ID']);
    });
    expect(conta).toBeGreaterThan(0);
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  /** O retrato da conta e dos itens (situação, total, soma e versão dos itens) e das tabelas SGH_ do marco. */
  const retrato = (id: number) =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const [c] = await l.consultar(
        'SELECT FECHADA, USU_FEC, TOTAL_CONTA, DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCCTAEXT WHERE ID = ?',
        [id],
        { teto: 1 },
      );
      const [i] = await l.consultar(
        "SELECT COUNT(*) N, COALESCE(SUM(VALOR_C), 0) S, SUM(CASE WHEN COALESCE(USUARIO_CONFERENCIA, '') = '' THEN 1 ELSE 0 END) NC FROM FCLANEXT WHERE ID_FCCTAEXT = ?",
        [id],
        { teto: 1 },
      );
      const [s] = await l.consultar(
        'SELECT (SELECT COUNT(*) FROM SGH_FAT_CONTA_ETAPA WHERE ID_FCCTAEXT = ?) E, (SELECT COUNT(*) FROM SGH_FAT_PENDENCIA WHERE ID_FCCTAEXT = ?) P, (SELECT COUNT(*) FROM SGH_FAT_LANC_TARDIO) T, (SELECT COUNT(*) FROM SGH_FAT_ORCAMENTO) O FROM RDB$DATABASE',
        [id, id],
        { teto: 1 },
      );
      const [n] = await l.consultar('SELECT COUNT(*) N FROM FCCTAEXT', [], { teto: 1 });
      return { c, i, s, contas: num(n?.['N']) };
    });

  /**
   * O que a transação desfeita deixou do operador sintético e da chave de idempotência (tem de ser nada): o usuário em
   * TBUSERS, as linhas dele na SGH_TRILHA e a chave em SGH_IDEMPOTENCIA. Só contagens.
   */
  const rastro = (login: string, chave: string | null) =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const [r] = await l.consultar(
        `SELECT (SELECT COUNT(*) FROM TBUSERS WHERE NOME IN (?, ?)) U,
           (SELECT COUNT(*) FROM SGH_TRILHA WHERE HOSPITAL = ? AND USUARIO = ? AND DIA >= CURRENT_DATE - 1) T,
           (SELECT COUNT(*) FROM SGH_IDEMPOTENCIA WHERE CHAVE = ?) I FROM RDB$DATABASE`,
        [login.toUpperCase(), login.toLowerCase(), a.cod, login, chave ?? ''],
        { teto: 1 },
      );
      return { usuarios: num(r?.['U']), trilha: num(r?.['T']), idempotencia: num(r?.['I']) };
    });
  const NADA = { usuarios: 0, trilha: 0, idempotencia: 0 };

  async function operador(e: Escritor): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      {
        escritor: e,
      },
    );
    return login;
  }
  const versao = async (e: Escritor, id: number) => {
    const [r] = await e.consultar('SELECT DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCCTAEXT WHERE ID = ?', [id], {
      teto: 1,
    });
    return versaoDaLinhaFaturamento(r?.['C'] ?? null);
  };

  it('regra 1 (sem-criar-conta): nenhuma receita inclui conta; regras 4 e 7: fecha e reabre sem tocar os itens', async () => {
    for (const o of OPERACOES_FATURAMENTO)
      expect(
        o.receita.passos.some((p) => p.tabela === 'FCCTAEXT' && p.acao === 'INSERT'),
        o.receita.nome,
      ).toBe(false);
    const antes = await retrato(conta);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const exec = (op: string, x: unknown, chave?: string) =>
        a.executor.executar(operacao(op), a.cod, x, ctxOperacao(a, login, chave), { escritor: e });
      const [n0] = await e.consultar('SELECT COUNT(*) N FROM FCCTAEXT', [], { teto: 1 });
      const [i0] = await e.consultar(
        'SELECT COALESCE(SUM(VALOR_C), 0) S, COUNT(*) N FROM FCLANEXT WHERE ID_FCCTAEXT = ?',
        [conta],
        { teto: 1 },
      );
      await exec('faturamento.fecharConta', { conta, versao: await versao(e, conta) });
      const [f] = await e.consultar('SELECT FECHADA, USU_FEC FROM FCCTAEXT WHERE ID = ?', [conta], {
        teto: 1,
      });
      await exec('faturamento.reabrirConta', {
        conta,
        versao: await versao(e, conta),
        motivo: 'teste de integração: reabrir',
      });
      const [g] = await e.consultar(
        'SELECT FECHADA, USU_FEC, SUBSTRING(CAST(DATA_FEC AS VARCHAR(24)) FROM 1 FOR 10) DF FROM FCCTAEXT WHERE ID = ?',
        [conta],
        { teto: 1 },
      );
      const [n1] = await e.consultar('SELECT COUNT(*) N FROM FCCTAEXT', [], { teto: 1 });
      const [i1] = await e.consultar(
        'SELECT COALESCE(SUM(VALOR_C), 0) S, COUNT(*) N FROM FCLANEXT WHERE ID_FCCTAEXT = ?',
        [conta],
        { teto: 1 },
      );
      const [m] = await e.consultar(
        "SELECT COUNT(*) N FROM SGH_FAT_CONTA_ETAPA WHERE ID_FCCTAEXT = ? AND ETAPA = 'reabertura' AND OBSERVACAO STARTING WITH 'teste'",
        [conta],
        { teto: 1 },
      );
      return {
        fechada: String(f?.['FECHADA']).trim(),
        quemFechou: String(f?.['USU_FEC']).trim() === login,
        reaberta: String(g?.['FECHADA']).trim(),
        usu: String(g?.['USU_FEC']).trim(),
        df: String(g?.['DF']),
        contas: num(n1?.['N']) - num(n0?.['N']),
        itens: [num(i0?.['S']), num(i0?.['N'])].join('/') === [num(i1?.['S']), num(i1?.['N'])].join('/'),
        motivo: num(m?.['N']),
      };
    });
    expect(r).toEqual({
      fechada: 'S',
      quemFechou: true,
      reaberta: 'N',
      usu: '0',
      df: '1899-12-30',
      contas: 0,
      itens: true,
      motivo: 1,
    });
    expect(await retrato(conta)).toEqual(antes);
  }, 600_000);

  it('regra 4: a conta apresentada não reabre (nada gravado)', async () => {
    expect(apresentada).toBeGreaterThan(0);
    const antes = await retrato(apresentada);
    const c = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      return codigo(
        a.executor.executar(
          operacao('faturamento.reabrirConta'),
          a.cod,
          { conta: apresentada, versao: await versao(e, apresentada), motivo: 'teste: apresentada' },
          ctxOperacao(a, login),
          { escritor: e },
        ),
      );
    });
    expect(c).toBe('conta-apresentada');
    expect(await retrato(apresentada)).toEqual(antes);
  }, 600_000);

  it('concorrência: a conta alterada por fora entre a leitura e o salvar é recusada (conflito de versão)', async () => {
    const antes = await retrato(conta);
    const c = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const lida = await versao(e, conta);
      // O outro sistema mexe na conta (qualquer alteração recarimba DATA_HORA_ULTIMA_ATUALIZACAO pelo gatilho).
      await new Promise((r) => setTimeout(r, 1_100));
      await mexerNaContaPorFora(e, conta);
      return codigo(
        a.executor.executar(
          operacao('faturamento.fecharConta'),
          a.cod,
          { conta, versao: lida },
          ctxOperacao(a, login),
          { escritor: e },
        ),
      );
    });
    expect(c).toBe('conflito-versao');
    expect(await retrato(conta)).toEqual(antes);
  }, 600_000);

  it('LOCK TIMEOUT: outro terminal segura a conta e o fechamento devolve "registro em edição"', async () => {
    const antes = await retrato(conta);
    let login = '';
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const v = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [r] = await l.consultar(
        'SELECT DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCCTAEXT WHERE ID = ?',
        [conta],
        { teto: 1 },
      );
      return versaoDaLinhaFaturamento(r?.['C'] ?? null);
    });
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await e.consultar('SELECT ID FROM FCCTAEXT WHERE ID = ? WITH LOCK', [conta], { teto: 1 });
      pronto();
      await new Promise<void>((r) => (soltar = r));
    });
    await travada;
    let c: string;
    try {
      c = await codigo(
        a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
          login = await operador(e);
          return a.executor.executar(
            operacao('faturamento.fecharConta'),
            a.cod,
            { conta, versao: v },
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
    expect(await retrato(conta)).toEqual(antes);
    expect(await rastro(login, null)).toEqual(NADA);
  }, 600_000);

  it('Idempotency-Key: a mesma chave devolve a gravação anterior; com outro conteúdo, recusa', async () => {
    const antes = await retrato(conta);
    const chave = `int-m30-idem-${Date.now().toString(36)}`;
    let login = '';
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      login = await operador(e);
      const [it] = await e.consultar(
        "SELECT FIRST 2 ID, DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCLANEXT WHERE ID_FCCTAEXT = ? AND COALESCE(USUARIO_CONFERENCIA, '') = ''",
        [conta],
        { teto: 2 },
      );
      const [it2] = await e.consultar(
        "SELECT FIRST 1 SKIP 1 ID, DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCLANEXT WHERE ID_FCCTAEXT = ? AND COALESCE(USUARIO_CONFERENCIA, '') = ''",
        [conta],
        { teto: 1 },
      );
      const entrada = {
        conta,
        itens: [{ id: num(it?.['ID']), versao: versaoDaLinhaFaturamento(it?.['C'] ?? null) }],
      };
      const exec = (x: unknown) =>
        a.executor.executar(operacao('faturamento.conferirItem'), a.cod, x, ctxOperacao(a, login, chave), {
          escritor: e,
        });
      const p = await exec(entrada);
      const s = await exec(entrada);
      const d = it2
        ? await codigo(
            exec({
              conta,
              itens: [{ id: num(it2['ID']), versao: versaoDaLinhaFaturamento(it2['C'] ?? null) }],
            }),
          )
        : 'idempotencia-divergente';
      return { primeira: p.repetida, segunda: s.repetida, divergente: d };
    });
    expect(r).toEqual({ primeira: false, segunda: true, divergente: 'idempotencia-divergente' });
    expect(await retrato(conta)).toEqual(antes);
    expect(await rastro(login, chave)).toEqual(NADA);
  }, 600_000);

  it('lista de contas: a situação é filtrada no banco (total coerente com as páginas); em auditoria pela etapa do novo', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const hoje = '2026-10-23';
      const [m] = await e.consultar('SELECT ANOPRO, MESPRO FROM FCCTAEXT WHERE ID = ?', [conta], { teto: 1 });
      const comp = { ano: num(m?.['ANOPRO']), mes: num(m?.['MESPRO']) };
      const porSituacao: Record<string, { coerente: boolean; todas: boolean }> = {};
      for (const s of SITUACOES_FILTRAVEIS) {
        const l = await listarContasPaciente(
          e,
          a.cod,
          { situacao: s, convenios: null, ...comp, pagina: 0, porPagina: 200 },
          hoje,
        );
        porSituacao[s] = {
          coerente: l.contas.length === Math.min(200, l.total),
          todas: l.contas.every((c) => c.situacao === s),
        };
      }
      const login = await operador(e);
      await registrarEtapaSgh(e, {
        hospital: a.cod,
        usuario: login,
        conta,
        etapa: 'auditoria',
        acao: 'iniciar',
        observacao: '',
      });
      const so = (s: 'em-auditoria' | 'em-conferencia' | 'emitida') =>
        listarContasPaciente(
          e,
          a.cod,
          { situacao: s, convenios: null, termo: String(conta), pagina: 0, porPagina: 50 },
          hoje,
        );
      const aud = await so('em-auditoria');
      const conf = await so('em-conferencia');
      const emi = await so('emitida');
      // A idade desde a alta: só contas com alta até a data pedida.
      const alta = await listarContasPaciente(
        e,
        a.cod,
        { convenios: null, ...comp, altaAte: '2000-01-01', pagina: 0, porPagina: 50 },
        hoje,
      );
      return {
        porSituacao,
        auditoria: aud.contas.map((c) => c.id).includes(conta) && aud.total >= 1,
        conferencia: conf.contas.some((c) => c.id === conta),
        emitida: emi.contas.some((c) => c.id === conta),
        alta: alta.contas.every((c) => c.alta !== null && c.alta <= '2000-01-01'),
      };
    });
    for (const [s, x] of Object.entries(r.porSituacao)) expect(x, s).toEqual({ coerente: true, todas: true });
    expect(r).toMatchObject({ auditoria: true, conferencia: false, emitida: false, alta: true });
  }, 900_000);

  it('lançamento manual em conta por pacote C: recusado, o TOTAL_CONTA do pacote não muda', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const [c] = await e.consultar(
        "SELECT FIRST 1 ID, TOTAL_CONTA FROM FCCTAEXT WHERE FECHADA = 'N' AND COALESCE(IND_EMI, 'F') <> 'T' AND PACOTE = 'C' ORDER BY ID DESC",
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      if (!c) return { semMassa: true, codigo: 'sem-massa', igual: true };
      const id = num(c['ID']);
      const login = await operador(e);
      const cod = await codigo(
        a.executor.executar(
          operacao('faturamento.lancarItem'),
          a.cod,
          {
            conta: id,
            tipo: 3,
            codigo: 40302199,
            quantidade: 1,
            data: '2026-01-15',
            hora: '1000',
            local: 0,
            ato: 0,
          },
          ctxOperacao(a, login),
          { escritor: e },
        ),
      );
      const [d] = await e.consultar('SELECT TOTAL_CONTA FROM FCCTAEXT WHERE ID = ?', [id], { teto: 1 });
      return { semMassa: false, codigo: cod, igual: num(d?.['TOTAL_CONTA']) === num(c['TOTAL_CONTA']) };
    });
    expect(r).toMatchObject({ codigo: 'conta-pacote', igual: true });
  }, 600_000);

  it('prova pós-escrita: o efeito ausente lança a falha da prova (e o ROLLBACK não deixa nada)', async () => {
    const antes = await retrato(conta);
    const op = operacao('faturamento.fecharConta');
    const falhou = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const tx = {
        ...e,
        uma: async (sql: string, p: readonly unknown[] = []) =>
          (await e.consultar(sql, p, { teto: 1 }))[0] ?? null,
      };
      const octx = ctxOperacao(a, login);
      const s = await op.gravar(tx as never, { conta, versao: await versao(e, conta) }, octx);
      // O efeito some (como se o banco não tivesse gravado): a prova relê e recusa.
      await desfazerFechamentoPorFora(e, conta);
      try {
        await op.provar(tx as never, { conta, versao: '' }, s, octx);
        return 'provou';
      } catch (x) {
        return x instanceof ErroProva ? 'ErroProva' : String(x);
      }
    });
    expect(falhou).toBe('ErroProva');
    expect(await retrato(conta)).toEqual(antes);
  }, 600_000);

  it('regra 5 (lancamento-tardio): a fila lê ATU_FAT F; a decisão é uma por ficha; o lançamento em conta fechada é recusado', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const fila = await lancamentosTardios(e, a.cod, {
        desde: '2025-01-01',
        convenios: null,
        pagina: 0,
        porPagina: 50,
      });
      const [conf] = await e.consultar(
        "SELECT COUNT(*) N FROM RECADATE WHERE ATU_FAT = 'F' AND DT_ATE >= CAST('2025-01-01' AS DATE)",
        [],
        { teto: 1 },
      );
      const ficha = fila.itens.find((x) => x.decisao === null);
      let segunda = 'sem-ficha';
      if (ficha) {
        await decidirLancamentoTardioSgh(e, {
          hospital: a.cod,
          usuario: login,
          registro: ficha.registro,
          decisao: 'descartar',
          motivo: 'teste de integração',
          conta: ficha.conta,
        });
        segunda = await codigo(
          decidirLancamentoTardioSgh(e, {
            hospital: a.cod,
            usuario: login,
            registro: ficha.registro,
            decisao: 'descartar',
            motivo: 'teste de integração',
            conta: ficha.conta,
          }),
        );
      }
      const [fech] = await e.consultar(
        "SELECT FIRST 1 ID FROM FCCTAEXT WHERE FECHADA = 'S' ORDER BY ID DESC",
        [],
        { teto: 1 },
      );
      const lan = await codigo(
        a.executor.executar(
          operacao('faturamento.lancarItem'),
          a.cod,
          {
            conta: num(fech?.['ID']),
            tipo: 3,
            codigo: 40302199,
            quantidade: 1,
            data: '2026-01-15',
            hora: '1000',
            local: 0,
            ato: 0,
          },
          ctxOperacao(a, login),
          { escritor: e },
        ),
      );
      return { total: fila.total === num(conf?.['N']), segunda, lan };
    });
    expect(r).toEqual({ total: true, segunda: 'ja-decidido', lan: 'conta-fechada' });
  }, 600_000);

  it('regra 13 (escopo-convenio): a lista filtra pelo escopo; regra 12 (sem-caucao): urgência com garantia recusada', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const [c] = await e.consultar('SELECT CON FROM FCCTAEXT WHERE ID = ?', [conta], { teto: 1 });
      const conv = num(c?.['CON']);
      const hoje = '2026-10-23';
      const dentro = await listarContasPaciente(
        e,
        a.cod,
        { convenios: [conv], termo: String(conta), pagina: 0, porPagina: 50 },
        hoje,
      );
      const fora = await listarContasPaciente(
        e,
        a.cod,
        { convenios: [conv === 32_000 ? 32_001 : 32_000], termo: String(conta), pagina: 0, porPagina: 50 },
        hoje,
      );
      const vazio = await listarContasPaciente(e, a.cod, { convenios: [], pagina: 0, porPagina: 50 }, hoje);
      const login = await operador(e);
      const caucao = await codigo(
        registrarOrcamentoSgh(e, {
          hospital: a.cod,
          usuario: login,
          prontuario: 0,
          nome: 'PACIENTE SINTETICO',
          itens: [{ descricao: 'Consulta', quantidade: 1, unitario: 100 }],
          desconto: 0,
          validadeDias: 30,
          urgencia: true,
          exigeGarantiaAntes: true,
        }),
      );
      return {
        dentro: dentro.contas.some((x) => x.id === conta),
        fora: fora.contas.length,
        vazio: vazio.contas.length,
        todasDoConvenio: dentro.contas.every((x) => x.convenio === conv),
        caucao,
      };
    });
    expect(r).toEqual({ dentro: true, fora: 0, vazio: 0, todasDoConvenio: true, caucao: 'caucao-proibida' });
  }, 600_000);

  const p95 = (xs: number[]) =>
    [...xs].sort((x, y) => x - y)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? 0;

  it('carga: fechar conta p95 < 30 s e a grade da maior conta de internação p95 < 1,5 s', async () => {
    const tempos: number[] = [];
    for (let k = 0; k < 10; k++)
      await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
        const login = await operador(e);
        const v = await versao(e, conta);
        const t0 = performance.now();
        await a.executor.executar(
          operacao('faturamento.fecharConta'),
          a.cod,
          { conta, versao: v },
          ctxOperacao(a, login),
          { escritor: e },
        );
        tempos.push(performance.now() - t0);
      });
    const grande = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [r] = await l.consultar(
        "SELECT FIRST 1 c.ID, (SELECT COUNT(*) FROM FCLANEXT x WHERE x.ID_FCCTAEXT = c.ID) N FROM FCCTAEXT c WHERE c.TIPO_CTA = 'I' AND c.ANOPRO = 2026 ORDER BY 2 DESC",
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      return { id: num(r?.['ID']), itens: num(r?.['N']) };
    });
    const grade: number[] = [];
    for (let k = 0; k < 20; k++) {
      const t0 = performance.now();
      await a.nucleo.lerSomente(ctx(a), (l) =>
        itensDaConta(l, a.cod, grande.id, {
          pagina: k % Math.max(1, Math.ceil(grande.itens / 500)),
          porPagina: 500,
        }),
      );
      grade.push(performance.now() - t0);
    }
    // O resultado agregado (só números) vai às evidências do marco.
    const pasta = resolve(import.meta.dirname, '../../../../docs/marcos/M30');
    mkdirSync(pasta, { recursive: true });
    writeFileSync(
      resolve(pasta, 'carga-fechar-conta.json'),
      `${JSON.stringify({ medidoEm: new Date().toISOString().slice(0, 10), fecharConta: { execucoes: tempos.length, p95Ms: Math.round(p95(tempos)), maxMs: Math.round(Math.max(...tempos)), metaMs: 30_000 }, gradeItens: { leituras: grade.length, itensDaConta: grande.itens, porPagina: 500, p95Ms: Math.round(p95(grade)), maxMs: Math.round(Math.max(...grade)), metaMs: 1_500 } }, null, 2)}\n`,
    );
    expect(p95(tempos)).toBeLessThan(30_000);
    expect(p95(grade)).toBeLessThan(1_500);
  }, 900_000);
});
