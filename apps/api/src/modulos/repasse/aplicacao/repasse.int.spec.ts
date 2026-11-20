// Integração do repasse na cópia (M33; ficha, seção 10), sempre em transação DESFEITA, pelo executor:
//   - apuração concorrente no outro sistema: um lançamento integrado à apuração gravado "por fora" no período durante a
//     apuração do novo → a gravação da apuração do novo é recusada (periodo-apurado-no-legado) e nada muda;
//   - RPA e título na mesma transação: o RPA emitido traz o título do repasse (ONDE R, ligado ao RPA) junto; o lançamento
//     já em RPA é recusado e nada muda (nem RPA nem título);
//   - falha no título desfaz o RPA (ficha §10): o INSERT do MFLANGSI falha (forçado no escritor, depois do RPRPA, do
//     RPLANRPA, do RPRPA_TBCBOPRO e do MFCONPAG já incluídos no banco) e o executor desfaz tudo (SAVEPOINT): as
//     contagens das cinco tabelas voltam ao que eram.
// Só contagens e códigos; o médico, o evento e a classificação são os da cópia (só em memória).
import { ErroOperacao, operacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).message}`;
  }
}

describe.skipIf(!PODE_ESCREVER)('repasse na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('apuração concorrente recusada; RPA e título juntos; já em RPA recusado', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m33' }, async (e) => {
      const [m] = await e.consultar(
        `SELECT FIRST 1 b.ID, b.COD, (SELECT FIRST 1 i.EVENTO FROM RPINTEVE i WHERE i.EMPRESA = 1 AND EXISTS
             (SELECT 1 FROM RPEVENTO r WHERE r.ID_RPEVENTO = i.EVENTO AND COALESCE(r.ATIVO, 'T') <> 'F')) ID_RPEVENTO
           FROM RPLANEVE_TBCBOPRO v JOIN TBCBOPRO b ON b.ID = v.ID_TBCBOPRO
           JOIN RPLANEVE ev ON ev.ID_RPLANEVE = v.ID_RPLANEVE
          WHERE ev.TIPO = 'M' AND ev.COD_PRESTADOR = b.COD AND ev.DATA >= '2025-06-01'
          ORDER BY ev.ID_RPLANEVE DESC`,
        [],
        { teto: 1, tempoMaximoMs: 120_000 },
      );
      const [u] = await e.consultar(
        "SELECT FIRST 1 c.USUARIO FROM MFCONPAG c WHERE c.ONDE = 'R' AND c.USUARIO IS NOT NULL ORDER BY c.ID DESC",
        [],
        { teto: 1 },
      );
      const [h] = await e.consultar('SELECT CURRENT_DATE H FROM RDB$DATABASE', [], { teto: 1 });
      const hoje = (h?.['H'] instanceof Date ? h['H'].toISOString() : String(h?.['H'])).slice(0, 10);
      const competencia = hoje.slice(0, 7);
      const usuario = String(u?.['USUARIO'] ?? '').trim();
      let n = 0;
      const octx = () => ({
        ...a.c,
        traceId: 'int-m33',
        usuarioLegado: usuario,
        idempotencyKey: `int-m33-${Date.now().toString(36)}-${++n}`,
        reautenticadoEm: Date.now(),
      });
      const executar = (op: string, entrada: unknown) =>
        a.executor.executar(operacao(op), a.c.hospital, entrada, octx(), { escritor: e });
      const lancamento = async (valor: number) => {
        const x = await executar('repasse.lancarEvento', {
          origem: 'ajuste',
          empresa: 1,
          competencia,
          data: hoje,
          evento: Number(m?.['ID_RPEVENTO']),
          tipo: 'M',
          prestador: Number(m?.['COD']),
          profissional: Number(m?.['ID']),
          valor,
          justificativa: 'Integração sintética do repasse (M33)',
        });
        return Number(x.resultado['lancamento']);
      };
      if (!m || !Number(m['ID_RPEVENTO']))
        throw new Error('Cópia sem médico com lançamento ou sem evento integrado.');
      // Uma apuração aprovada sintética do novo (SGH_, na transação desfeita).
      const apuracao = async () => {
        const [g] = await e.consultar(
          'SELECT CAST(NEXT VALUE FOR SGH_GEN_REP_APURACAO AS VARCHAR(20)) ID FROM RDB$DATABASE',
          [],
          { teto: 1 },
        );
        const id = String(g?.['ID'] ?? '');
        await e.executar(
          'DELETE FROM SGH_REP_APURACAO WHERE HOSPITAL = ? AND EMPRESA = 1 AND COMPETENCIA = ?',
          [a.c.hospital, competencia],
        );
        await e.executar(
          `INSERT INTO SGH_REP_APURACAO (ID, HOSPITAL, EMPRESA, COMPETENCIA, ESTADO, APURADO_POR, APROVADO_POR)
           VALUES (CAST(CAST(? AS VARCHAR(20)) AS BIGINT), ?, 1, ?, 'aprovada', 'SINT.A', 'SINT.B')`,
          [id, a.c.hospital, competencia],
        );
        return Number(id);
      };
      // Dois itens faturados quaisquer, ainda não integrados (só IDs).
      const itens = (
        await e.consultar(
          `SELECT FIRST 2 l.ID FROM FCLANEXT l WHERE l.ID > (SELECT MAX(ID) - 200000 FROM FCLANEXT)
             AND NOT EXISTS (SELECT 1 FROM FCINTEGRPA f WHERE f.ID_FCLANEXT = l.ID) ORDER BY l.ID DESC`,
          [],
          { teto: 2, tempoMaximoMs: 120_000 },
        )
      ).map((x) => Number(x['ID']));
      const ap = await apuracao();
      // "Por fora": a apuração do período gravada (lançamento + item integrado) antes da do novo.
      const fora = await lancamento(10);
      await executar('repasse.integrarItens', {
        apuracao: ap,
        empresa: 1,
        competencia,
        lancamentos: [
          { lancamento: fora, itens: [{ item: itens[0], regra: null, percentual: 0, valor: 10 }] },
        ],
      });
      const [i0] = await e.consultar('SELECT COUNT(*) N FROM FCINTEGRPA', [], { teto: 1 });
      const novo = await lancamento(20);
      const concorrente = await codigo(
        executar('repasse.integrarItens', {
          apuracao: ap,
          empresa: 1,
          competencia,
          lancamentos: [
            { lancamento: novo, itens: [{ item: itens[1], regra: null, percentual: 0, valor: 20 }] },
          ],
        }),
      );
      const [i1] = await e.consultar('SELECT COUNT(*) N FROM FCINTEGRPA', [], { teto: 1 });
      // RPA e título juntos.
      const lr = await lancamento(500);
      const pedido = {
        empresa: 1,
        competencia,
        tipo: 'M',
        prestador: Number(m?.['COD']),
        profissional: Number(m?.['ID']),
        lancamentos: [lr],
        emissao: hoje,
        vencimento: hoje,
        retencoes: {
          bruto: 500,
          baseInss: 500,
          inss: 55,
          baseIrrf: 445,
          faixaIrrf: 0,
          irrf: 0,
          iss: 25,
          liquido: 420,
        },
      };
      const rpa = await executar('repasse.emitirRpa', pedido);
      const idRpa = Number(rpa.resultado['rpa']);
      const [t] = await e.consultar(
        "SELECT COUNT(*) N, MAX(VALOR) V FROM MFCONPAG WHERE ONDE = 'R' AND ID_RPRPA = ?",
        [idRpa],
        { teto: 1 },
      );
      const [c0] = await e.consultar(
        'SELECT (SELECT COUNT(*) FROM RPRPA) R, (SELECT COUNT(*) FROM MFCONPAG) T FROM RDB$DATABASE',
        [],
        {
          teto: 1,
        },
      );
      const repetido = await codigo(executar('repasse.emitirRpa', pedido));
      const [c1] = await e.consultar(
        'SELECT (SELECT COUNT(*) FROM RPRPA) R, (SELECT COUNT(*) FROM MFCONPAG) T FROM RDB$DATABASE',
        [],
        {
          teto: 1,
        },
      );
      // Falha no título: o escritor da operação lança erro no INSERT do MFLANGSI (o passo do título que vem depois do
      // MFCONPAG); tudo o que a operação incluiu antes é desfeito no banco.
      const lf = await lancamento(300);
      const contar = async () => {
        const [x] = await e.consultar(
          `SELECT (SELECT COUNT(*) FROM RPRPA) R, (SELECT COUNT(*) FROM RPLANRPA) L, (SELECT COUNT(*) FROM RPRPA_TBCBOPRO) V,
                  (SELECT COUNT(*) FROM MFCONPAG) T, (SELECT COUNT(*) FROM MFLANGSI) G FROM RDB$DATABASE`,
          [],
          { teto: 1, tempoMaximoMs: 120_000 },
        );
        return ['R', 'L', 'V', 'T', 'G'].map((k) => Number(x?.[k]));
      };
      const antes = await contar();
      const vistos: string[] = [];
      const comFalha = new Proxy(e, {
        get(alvo, k) {
          if (k === 'executar' || k === 'executarRetornando')
            return async (sql: string, p?: readonly unknown[]) => {
              const t = /^\s*INSERT INTO (\w+)/.exec(sql)?.[1];
              if (t) vistos.push(t);
              if (t === 'MFLANGSI') throw new Error('falha forçada no título do repasse (teste)');
              return k === 'executar' ? alvo.executar(sql, p) : alvo.executarRetornando(sql, p);
            };
          const v = Reflect.get(alvo, k);
          return typeof v === 'function' ? v.bind(alvo) : v;
        },
      });
      const falhou = await codigo(
        a.executor.executar(
          operacao('repasse.emitirRpa'),
          a.c.hospital,
          {
            ...pedido,
            lancamentos: [lf],
            retencoes: {
              bruto: 300,
              baseInss: 300,
              inss: 33,
              baseIrrf: 267,
              faixaIrrf: 0,
              irrf: 0,
              iss: 15,
              liquido: 252,
            },
          },
          octx(),
          { escritor: comFalha },
        ),
      );
      const depois = await contar();
      const [emRpa] = await e.consultar('SELECT COUNT(*) N FROM RPLANRPA WHERE ID_RPLANEVE = ?', [lf], {
        teto: 1,
      });
      return {
        falhaNoTitulo: falhou,
        incluiuAntesDaFalha: ['RPRPA', 'RPLANRPA', 'RPRPA_TBCBOPRO', 'MFCONPAG'].every((t) =>
          vistos.includes(t),
        ),
        desfezTudo: JSON.stringify(antes) === JSON.stringify(depois),
        lancamentoLivre: Number(emRpa?.['N']) === 0,
        temMedico: m !== undefined,
        concorrente,
        integradasIguais: Number(i0?.['N']) === Number(i1?.['N']),
        tituloDoRpa: Number(t?.['N']),
        liquido: Number(t?.['V']),
        repetido,
        nadaMudou: Number(c0?.['R']) === Number(c1?.['R']) && Number(c0?.['T']) === Number(c1?.['T']),
      };
    });
    expect(r.temMedico).toBe(true);
    expect(r.concorrente).toBe('periodo-apurado-no-legado');
    expect(r.integradasIguais).toBe(true);
    expect(r.tituloDoRpa).toBe(1);
    expect(r.liquido).toBe(420);
    expect(r.repetido).toBe('ja-em-rpa');
    expect(r.nadaMudou).toBe(true);
    expect(r.falhaNoTitulo).toBe('erro-interno');
    expect(r.incluiuAntesDaFalha).toBe(true);
    expect(r.desfezTudo).toBe(true);
    expect(r.lancamentoLivre).toBe(true);
  }, 900_000);
});
