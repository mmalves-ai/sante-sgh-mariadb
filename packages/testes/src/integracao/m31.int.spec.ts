// Pós-fechamento sobre a cópia (ficha do M31, seção 10, e regras 2, 4, 5, 11 e 13), sempre em transação desfeita e sob
// a trava da cópia:
//   - numeracao-concorrente (regra 2): dois lotes do mesmo convênio na mesma transação levam números seguidos (nunca
//     repetidos); com outro terminal segurando o contador (WITH LOCK), a montagem devolve "registro em edição";
//   - lote-congelado (regra 5): com o protocolo gravado, os gatilhos recusam apagar o lote e tirar conta dele;
//   - importação idempotente: o mesmo demonstrativo (número ou arquivo) não entra duas vezes;
//   - recurso e retorno na mesma fila: outro terminal segurando o item (WITH LOCK) faz o retorno esperar e devolver
//     "registro em edição";
//   - outbox com retentativa e fila de mortos: o evento do fechamento da competência nasce na transação, falha e é
//     retentado; esgotadas as tentativas, vai a "morto";
//   - guarda-xml (regra 4): em apps/api/src/modulos/tiss/guarda-xml.int.spec.ts (o S3 do projeto);
//   - competencia-fechada (regra 9): com a competência da conta fechada para o convênio, o lote é recusado e nada fica;
//   - guia sem corte: a conta pronta com mais de 500 itens cobrados sai inteira na guia, com o total do banco;
//   - painel-glosa-somas (regra 11): o painel sobre a cópia real reproduz as somas de controle de 2025 (só agregados).
// O retrato antes e depois (contador, lotes e tabelas SGH_ do marco) prova que o ROLLBACK desfez tudo. Massa: contas,
// lotes e itens da cópia (só IDs); o operador sintético. Saída só com contagens e códigos (nenhum nome).
import { criarMontadorLote, guardaXmlMemoria } from '@sgh/dominio-faturamento';
import {
  cicloRelay,
  competencias,
  configuracaoTiss,
  contasProntasLote,
  demonstrativos,
  gradeGlosa,
  guiasEmitidas,
  itensGlosaDaConta,
  lerContaTiss,
  listarLotes,
  loteDetalhe,
  motivosGlosa,
  prazosEnvio,
  resumoCompetencia,
  definirMontadorLoteTiss,
  ErroOperacao,
  importarDemonstrativoSgh,
  operacao,
  painelGlosa,
  type PendenteOutbox,
  versaoDaLinhaFaturamento,
} from '@sgh/legado';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** Contas emitidas, fechadas e fora de lote de um convênio com contador e cadastro TISS (o pré-voo do gatilho passa). */
const SQL_CONTAS = `SELECT FIRST 400 c.ID, c.CON FROM FCCTAEXT c JOIN TBSEGUIA s ON s.CONV = c.CON AND s.TIPO_GUIA = 0
    AND CHAR_LENGTH(TRIM(s.NUM_LOTE)) = 12 JOIN TBCONVEN v ON v.COD = c.CON
    LEFT JOIN FCCTAEXT_FCTISSLOTEPROT x ON x.ID_FCCTAEXT = c.ID
  WHERE c.FECHADA = 'S' AND c.IND_EMI = 'T' AND c.TIPO_CTA = 'E' AND x.ID_FCCTAEXT IS NULL AND v.REG_ANS > 0
    AND COALESCE(c.MED_SOL, -1) = COALESCE((SELECT b.COD FROM TBCBOPRO b WHERE b.ID = c.ID_TBCBOPRO_SOLICITANTE), -1)
    AND COALESCE(c.MED_CTA, -1) = COALESCE((SELECT b.COD FROM TBCBOPRO b WHERE b.ID = c.ID_TBCBOPRO_PRINCIPAL_CTA), -1)
    AND (COALESCE(c.ID_MFCTAREC, 0) = 0 OR EXISTS (SELECT 1 FROM MFCTAREC m WHERE m.ID_MFCTAREC = c.ID_MFCTAREC))
    AND (COALESCE(c.PROC_SOL, 0) = 0 OR (SELECT COUNT(*) FROM TBPROCTO p WHERE p.ID_TBCTRTHM =
       (SELECT v2.THM_E FROM TBCONVEN v2 WHERE v2.COD = c.CON) AND p.COD_PROCEDIMENTO = c.PROC_SOL) = 1)
    AND EXISTS (SELECT 1 FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID AND l.VALOR_C > 0 AND l.TIPO IN (2, 3))
    AND (SELECT COUNT(*) FROM FCLANEXT l WHERE l.ID_FCCTAEXT = c.ID) <= 300
    AND NOT EXISTS (SELECT 1 FROM FCFECMES f WHERE f.CONVENIO = c.CON AND f.ANO = c.ANOPRO AND f.MES = c.MESPRO)
  ORDER BY c.ID DESC`;

describe.skipIf(!PODE_ESCREVER)('M31: pós-fechamento na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let convenio = 0;
  let contas: number[] = [];
  beforeAll(async () => {
    a = await prepararAmbiente();
    definirMontadorLoteTiss(criarMontadorLote(guardaXmlMemoria()));
    await a.nucleo.lerSomente(ctx(a), async (l) => {
      const r = await l.consultar(SQL_CONTAS, [], { teto: 400, tempoMaximoMs: 120_000 });
      const porConv = new Map<number, number[]>();
      for (const x of r) porConv.set(num(x['CON']), [...(porConv.get(num(x['CON'])) ?? []), num(x['ID'])]);
      const [c, ids] = [...porConv].find(([, v]) => v.length >= 2) ?? [0, []];
      convenio = c;
      contas = ids.slice(0, 2);
    });
    expect(contas).toHaveLength(2);
  }, 600_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  /** O retrato do contador, dos lotes e das tabelas SGH_ do marco (só contagens e o número do contador). */
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const [r] = await l.consultar(
        `SELECT (SELECT NUM_LOTE FROM TBSEGUIA WHERE CONV = ? AND TIPO_GUIA = 0) C,
           (SELECT COUNT(*) FROM FCTISSLOTEPROT) L, (SELECT COUNT(*) FROM FCCTAEXT_FCTISSLOTEPROT) V,
           (SELECT COUNT(*) FROM SGH_FAT_LOTE_XML) X, (SELECT COUNT(*) FROM SGH_FAT_PROTOCOLO) P,
           (SELECT COUNT(*) FROM SGH_FAT_DEMONSTRATIVO) D, (SELECT COUNT(*) FROM FCFECMES) F FROM RDB$DATABASE`,
        [convenio],
        { teto: 1 },
      );
      return r;
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
    return login;
  }
  const versaoConta = async (l: Pick<Escritor, 'consultar'>, id: number) => {
    const [r] = await l.consultar('SELECT DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCCTAEXT WHERE ID = ?', [id], {
      teto: 1,
    });
    return versaoDaLinhaFaturamento(r?.['C'] ?? null);
  };

  it('numeracao-concorrente (regra 2): dois lotes seguidos do mesmo convênio, números distintos e seguidos', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const numeros: string[] = [];
      for (const id of contas) {
        const s = await a.executor.executar(
          operacao('faturamento.gerarLote'),
          a.cod,
          { convenio, tipoGuia: 2, contas: [{ id, versao: await versaoConta(e, id) }] },
          ctxOperacao(a, login),
          { escritor: e },
        );
        numeros.push(String(s.resultado['numeroLote']));
      }
      return numeros;
    });
    expect(new Set(r).size).toBe(2);
    expect(BigInt(r[1]!) - BigInt(r[0]!)).toBe(1n);
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('numeracao-concorrente (regra 2): outro terminal segurando o contador → "registro em edição", nada gravado', async () => {
    const antes = await retrato();
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const v = await a.nucleo.lerSomente(ctx(a), (l) => versaoConta(l, contas[0]!));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await e.consultar('SELECT CONV FROM TBSEGUIA WHERE CONV = ? AND TIPO_GUIA = 0 WITH LOCK', [convenio], {
        teto: 1,
      });
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
            operacao('faturamento.gerarLote'),
            a.cod,
            { convenio, tipoGuia: 2, contas: [{ id: contas[0]!, versao: v }] },
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

  it('lote-congelado (regra 5): com o protocolo, apagar o lote e tirar a conta dele são recusados', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const s = await a.executor.executar(
        operacao('faturamento.gerarLote'),
        a.cod,
        { convenio, tipoGuia: 2, contas: [{ id: contas[0]!, versao: await versaoConta(e, contas[0]!) }] },
        ctxOperacao(a, login),
        { escritor: e },
      );
      const lote = num(s.resultado['lote']);
      await a.executor.executar(
        operacao('faturamento.registrarProtocolo'),
        a.cod,
        { lote, acao: 'registrar', protocolo: ' INT31\r\n' },
        ctxOperacao(a, login),
        { escritor: e },
      );
      const recusou = async (sql: string) => {
        try {
          await e.executar(sql, [lote]);
          return false;
        } catch (x) {
          return /TISS_PROTOCOLO|exception/i.test(x instanceof Error ? x.message : String(x));
        }
      };
      const [p] = await e.consultar('SELECT NUM_PROTOCOLO FROM FCTISSLOTEPROT WHERE ID = ?', [lote], {
        teto: 1,
      });
      return {
        protocolo: String(p?.['NUM_PROTOCOLO']).trim(),
        tirarConta: await recusou('DELETE FROM FCCTAEXT_FCTISSLOTEPROT WHERE ID_FCTISSLOTEPROT = ?'),
        apagarLote: await recusou('DELETE FROM FCTISSLOTEPROT WHERE ID = ?'),
      };
    });
    expect(r).toEqual({ protocolo: 'INT31', tirarConta: true, apagarLote: true });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('importação idempotente: o mesmo demonstrativo (número ou arquivo) não entra duas vezes', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const [l] = await e.consultar(
        'SELECT FIRST 1 x.ID_FCTISSLOTEPROT L FROM FCCTAEXT_FCTISSLOTEPROT x ORDER BY x.ID_FCTISSLOTEPROT DESC',
        [],
        { teto: 1 },
      );
      const base = {
        hospital: a.cod,
        usuario: 'SGH.TESTE',
        lote: num(l?.['L']),
        tipo: 'analise' as const,
        origem: 'digitacao' as const,
        numero: `INT31-${Date.now() % 1_000_000}`,
        dataEmissao: '2026-10-20',
        itens: [
          {
            numeroGuia: 'G',
            sequencial: 1,
            codigoProcedimento: '1',
            valorInformado: 10,
            valorPago: 5,
            quantidadePaga: 1,
            motivo: 0,
          },
        ],
        hashArquivo: 'f'.repeat(64),
        chaveObjeto: null,
      };
      const um = await importarDemonstrativoSgh(e, base);
      const mesmoNumero = await importarDemonstrativoSgh(e, { ...base, hashArquivo: null });
      const mesmoArquivo = await importarDemonstrativoSgh(e, { ...base, numero: `${base.numero}-B` });
      return {
        um: um.repetido,
        mesmoNumero: mesmoNumero.repetido && mesmoNumero.id === um.id,
        mesmoArquivo: mesmoArquivo.repetido,
      };
    });
    expect(r).toEqual({ um: false, mesmoNumero: true, mesmoArquivo: true });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('recurso e retorno na mesma fila: o item seguro por outro terminal → "registro em edição"', async () => {
    const item = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [x] = await l.consultar(
        `SELECT FIRST 1 i.ID, i.DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCCTAEXT c JOIN FCLANEXT i ON i.ID_FCCTAEXT = c.ID
          WHERE c.FECHADA = 'A' AND c.ANOPRO >= 2025 AND i.VLR_RE > 0.02 AND i.VLR_RP = 0 AND i.DT_RP < '1900-01-01'
            AND i.DT_RE >= '1900-01-01' ORDER BY c.ID DESC`,
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      return { id: num(x?.['ID']), versao: versaoDaLinhaFaturamento(x?.['C'] ?? null) };
    });
    expect(item.id).toBeGreaterThan(0);
    let soltar: () => void = () => undefined;
    let pronto: () => void = () => undefined;
    const travada = new Promise<void>((r) => (pronto = r));
    const segurando = a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await e.consultar('SELECT ID FROM FCLANEXT WHERE ID = ? WITH LOCK', [item.id], { teto: 1 });
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
            operacao('faturamento.registrarRetornoRecurso'),
            a.cod,
            {
              itens: [{ item: item.id, versao: item.versao, desfecho: 'acatado' }],
              data: '2026-10-20',
              numeroDemonstrativo: 'INT31',
            },
            ctxOperacao(a, login),
            { escritor: e },
          );
        }),
      );
    } finally {
      soltar();
      await segurando;
    }
    expect(['registro-em-edicao', 'conflito-versao']).toContain(c);
  }, 600_000);

  it('competencia-fechada (regra 9): a conta de competência fechada para o convênio não entra em lote; nada gravado', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const [k] = await e.consultar('SELECT ANOPRO, MESPRO FROM FCCTAEXT WHERE ID = ?', [contas[0]], {
        teto: 1,
      });
      await a.executor.executar(
        operacao('faturamento.fecharCompetencia'),
        a.cod,
        { convenio, ano: num(k?.['ANOPRO']), mes: num(k?.['MESPRO']) },
        ctxOperacao(a, login),
        { escritor: e },
      );
      const [l0] = await e.consultar('SELECT COUNT(*) N FROM FCTISSLOTEPROT', [], { teto: 1 });
      const c = await codigo(
        a.executor.executar(
          operacao('faturamento.gerarLote'),
          a.cod,
          { convenio, tipoGuia: 2, contas: [{ id: contas[0]!, versao: await versaoConta(e, contas[0]!) }] },
          ctxOperacao(a, login),
          { escritor: e },
        ),
      );
      const [l1] = await e.consultar('SELECT COUNT(*) N FROM FCTISSLOTEPROT', [], { teto: 1 });
      return { c, lotes: num(l1?.['N']) - num(l0?.['N']) };
    });
    expect(r).toEqual({ c: 'competencia-fechada', lotes: 0 });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('guia sem corte: a conta pronta com mais de 500 itens cobrados sai inteira, com o total do banco (só contagens)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [c] = await l.consultar(
        `SELECT FIRST 1 c.ID, c.TIPO_CTA FROM FCCTAEXT c LEFT JOIN FCCTAEXT_FCTISSLOTEPROT x ON x.ID_FCCTAEXT = c.ID
          WHERE c.FECHADA = 'S' AND c.IND_EMI = 'T' AND x.ID_FCCTAEXT IS NULL
            AND (SELECT COUNT(*) FROM FCLANEXT i WHERE i.ID_FCCTAEXT = c.ID AND i.VALOR_C > 0) > 500
          ORDER BY c.ID DESC`,
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      if (!c) return null;
      const id = num(c['ID']);
      const [s] = await l.consultar(
        'SELECT COUNT(*) N, COALESCE(SUM(VALOR_C), 0) S FROM FCLANEXT WHERE ID_FCCTAEXT = ? AND VALOR_C > 0',
        [id],
        { teto: 1 },
      );
      const g = await lerContaTiss(l, id, String(c['TIPO_CTA']).trim() === 'I' ? 3 : 2);
      const total = g.itens.reduce((t, i) => t + Math.round(i.quantidade * i.valorUnitario * 100), 0) / 100;
      return {
        itens: g.itens.length,
        esperados: num(s?.['N']),
        diferenca: Math.abs(total - num(s?.['S'])) <= 0.005 * g.itens.length + 0.005,
      };
    });
    expect(r, 'a cópia tem contas prontas com mais de 500 itens (8 no pc)').not.toBeNull();
    expect(r!.itens).toBeGreaterThan(500);
    expect(r!.itens).toBe(r!.esperados);
    expect(r!.diferenca).toBe(true);
  }, 600_000);

  it('outbox: o evento do fechamento da competência falha, é retentado e, esgotado, vai a "morto"', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = await operador(e);
      const [d] = await e.consultar(
        'SELECT EXTRACT(YEAR FROM DATEADD(-1 MONTH TO CURRENT_DATE)) A, EXTRACT(MONTH FROM DATEADD(-1 MONTH TO CURRENT_DATE)) M FROM RDB$DATABASE',
        [],
        { teto: 1 },
      );
      const [v] = await e.consultar(
        "SELECT FIRST 1 v.COD FROM TBCONVEN v WHERE v.SITUACAO = 'A' AND v.COD > 0 AND NOT EXISTS (SELECT 1 FROM FCFECMES f WHERE f.CONVENIO = v.COD AND f.ANO = ? AND f.MES = ?) ORDER BY v.COD",
        [num(d?.['A']), num(d?.['M'])],
        { teto: 1 },
      );
      const s = await a.executor.executar(
        operacao('faturamento.fecharCompetencia'),
        a.cod,
        { convenio: num(v?.['COD']), ano: num(d?.['A']), mes: num(d?.['M']) },
        ctxOperacao(a, login),
        { escritor: e },
      );
      const tipo = 'faturamento.competencia.fechada';
      const acesso = {
        ler: <T>(fn: (l: typeof e) => Promise<T>) => fn(e),
        escrever: <T>(fn: (w: typeof e) => Promise<T>) => fn(e),
      };
      const cfg = { lote: 1000, tentativas: 2, esperaInicialS: 0, esperaMaximaS: 0 };
      const falhar = async (ev: PendenteOutbox) => {
        if (ev.tipo === tipo) throw new Error('connect ECONNREFUSED 127.0.0.1:1');
      };
      const situacao = async () => {
        const [x] = await e.consultar(
          'SELECT FIRST 1 SITUACAO, TENTATIVAS FROM SGH_OUTBOX WHERE TIPO = ? ORDER BY ID DESC',
          [tipo],
          { teto: 1 },
        );
        return `${String(x?.['SITUACAO']).trim()}/${num(x?.['TENTATIVAS'])}`;
      };
      const t0 = await situacao();
      await cicloRelay(acesso, a.cod, falhar, cfg);
      const t1 = await situacao();
      await cicloRelay(acesso, a.cod, falhar, cfg);
      const t2 = await situacao();
      return { eventos: s.eventos.length, t0, t1, t2 };
    });
    expect(r).toEqual({
      eventos: 1,
      t0: 'pendente/0',
      t1: 'pendente/1',
      t2: 'morto/2',
    });
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('leituras e carga (seção 4): cada consulta do marco na cópia real, no tempo-alvo (p95; só tempos e contagens)', async () => {
    const tempos: Record<string, number[]> = {};
    const medir = async <T>(nome: string, fn: () => Promise<T>, n = 5): Promise<T> => {
      let r: T | undefined;
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        r = await fn();
        (tempos[nome] ??= []).push(Math.round(performance.now() - t0));
      }
      return r as T;
    };
    const p95 = (v: number[]) =>
      [...v].sort((x, y) => x - y)[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)]!;
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const hoje = (
        await l.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], { teto: 1 })
      )[0]?.['H'] as string;
      const prontas = await medir('contasProntas', () =>
        contasProntasLote(l, { convenio, tipoGuia: 2, ano: null, mes: null, convenios: null }),
      );
      const lotes = await medir('lotes', () =>
        listarLotes(l, a.cod, {
          convenio: null,
          de: '2026-01-01',
          ate: hoje,
          semProtocolo: false,
          convenios: null,
          pagina: 0,
          porPagina: 50,
          hoje,
        }),
      );
      const lote = lotes.itens[0]?.id ?? 0;
      const detalhe = await medir('lote', () => loteDetalhe(l, a.cod, lote, hoje));
      const prazos = await medir('prazos', () =>
        prazosEnvio(l, { hoje, paradoDias: 15, prazoRecurso: '', convenios: null }),
      );
      const comps = await medir('competencias', () =>
        competencias(l, { convenio: null, ano: null, convenios: null }),
      );
      await medir('resumoCompetencia', () => resumoCompetencia(l, { convenio, ano: 2026, mes: 5 }));
      const grade = await medir('gradeGlosa', () =>
        gradeGlosa(l, {
          convenios: null,
          convenio: null,
          ano: 2026,
          mes: 5,
          estado: 'com-glosa',
          pagina: 0,
          porPagina: 500,
        }),
      );
      const conta = grade.contas[0]?.conta ?? 0;
      const itens = await medir('itensGlosa', () => itensGlosaDaConta(l, a.cod, conta, ''));
      const mot = await medir('motivos', () => motivosGlosa(l), 2);
      await medir('guias', () => guiasEmitidas(l, { convenio, ano: null, mes: null, convenios: null }));
      await medir('demonstrativos', () => demonstrativos(l, a.cod, { lote: null, convenios: null }), 2);
      const cfg = await medir('configuracao', () => configuracaoTiss(l, a.cod), 2);
      return {
        prontas: prontas.length,
        lotes: lotes.itens.length,
        detalhe: detalhe?.contasDoLote.length ?? 0,
        prazos: prazos.length,
        competencias: comps.length,
        grade: grade.contas.length,
        itens: itens.length,
        motivos: mot.length,
        semCredencial: !JSON.stringify(cfg).match(/SENHA|LOGIN_PRESTADOR|CERTIFICADO/i),
      };
    });
    const resumo = Object.fromEntries(
      Object.entries(tempos).map(([k, v]) => [k, { p95: p95(v), n: v.length }]),
    );
    console.log(`[carga M31] ${JSON.stringify(resumo)}`);
    const pasta = resolve(import.meta.dirname, '../../../../docs/marcos/M31');
    mkdirSync(pasta, { recursive: true });
    writeFileSync(
      resolve(pasta, 'carga-leituras.json'),
      `${JSON.stringify({ medidoEm: new Date().toISOString().slice(0, 10), estabelecimento: a.cod, p95Ms: resumo }, null, 2)}\n`,
    );
    expect(r.prontas).toBeGreaterThan(0);
    expect(r.lotes).toBeGreaterThan(0);
    expect(r.motivos).toBeGreaterThan(600);
    expect(r.semCredencial).toBe(true);
    expect(resumo['contasProntas']!.p95).toBeLessThan(1_500);
    expect(resumo['lotes']!.p95).toBeLessThan(1_000);
    expect(resumo['prazos']!.p95).toBeLessThan(1_000);
    expect(resumo['gradeGlosa']!.p95).toBeLessThan(1_500);
  }, 600_000);

  it('painel-glosa-somas (regra 11): 2025 por competência reproduz as somas de controle (só agregados)', async () => {
    const t0 = Date.now();
    const p = await a.nucleo.lerSomente(ctx(a), (l) =>
      painelGlosa(l, { de: '2025-01', ate: '2025-12', convenios: null, hospital: a.cod }),
    );
    console.log(`[painel 2025] ${Date.now() - t0} ms`);
    expect(p.somas.itensEmitidos).toBe(742_667);
    expect(p.somas.emitido).toBeCloseTo(83_915_367.63, 1);
    expect(p.somas.itensConciliados).toBe(648_438);
    expect(p.somas.conciliado).toBeCloseTo(76_458_279.56, 1);
    expect(p.somas.pago).toBeCloseTo(65_668_076.21, 1);
    expect(p.somas.glosaLiquida).toBeCloseTo(10_790_203.35, 1);
    expect(p.somas.glosaPositiva).toBeCloseTo(10_911_341.46, 1);
    expect(p.somas.itensPagosAMaior).toBe(1_012);
    expect(p.somas.contestado).toBeCloseTo(5_790_772.2, 1);
    expect(p.somas.recuperado).toBeCloseTo(3_346_426.32, 1);
    expect(p.somas.nuncaRecorrido).toBeCloseTo(4_999_431.15, 1);
  }, 600_000);
});
