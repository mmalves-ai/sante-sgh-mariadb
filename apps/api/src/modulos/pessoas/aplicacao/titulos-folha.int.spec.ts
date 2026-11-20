// Títulos da folha na cópia (M53.9, etapa F8; ficha do M53, seção 10 "lote completo da competência com títulos e
// apropriações; falha no meio desfaz tudo" e regra 10), sempre numa transação DESFEITA: (1) o serviço real lança a folha
// sintética pelo executor (`financeiro.criarTituloPagar`, ação `incluir-folha`): um título por destino no contas a pagar,
// cada um com a apropriação gerencial, o lançamento, os títulos e os fatos em SGH_PES_FOLHA_*, a soma dos títulos igual ao
// líquido mais os encargos (parcelas impressas no teste) e a segunda tentativa recusada; (2) com a falha forçada na
// gravação do SEGUNDO título, nada fica: nem o primeiro título, nem a apropriação, nem o lançamento SGH_, nem a outbox.
// Só IDs, contagens e valores sintéticos; nenhum dado pessoal.
import { esquemaCriarTituloPagar, type IncluirTitulosFolhaEntrada } from '@sgh/contratos';
import {
  type Escritor,
  incluirLoteFolhaPesSgh,
  incluirResumoFolhaPesSgh,
  proximoIdLoteFolhaPesSgh,
  registrarLancamentoFolhaPesSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import { ErroProblema } from '../../../problema.filter.js';
import { cenarioTitulosFolha, lancarFolhaSintetica } from './titulos-folha.spec-util.js';

const n = (v: unknown) => Number(v ?? 0);
const INSERE_TITULO = /^\s*INSERT\s+INTO\s+MFCONPAG\s*\(/i;

/** Quantas gravações de título o escritor com falha viu (a falha é a forçada, e não uma recusa antes dela). */
let tentados = 0;
/** O escritor que falha na gravação do `n`-ésimo título a pagar (o resto passa direto ao escritor da transação). */
function falhaNoTitulo(e: Escritor, enesimo: number): Escritor {
  const conferir = (sql: string) => {
    if (INSERE_TITULO.test(sql) && ++tentados === enesimo)
      throw new Error(`falha forçada na gravação do título ${enesimo}`);
  };
  return new Proxy(e, {
    get(alvo, p, r) {
      if (p === 'executar')
        return (sql: string, ps?: readonly unknown[]) => (conferir(sql), alvo.executar(sql, ps));
      if (p === 'executarRetornando')
        return (sql: string, ps?: readonly unknown[]) => (conferir(sql), alvo.executarRetornando(sql, ps));
      const v: unknown = Reflect.get(alvo, p, r);
      return typeof v === 'function' ? (v as (...xs: unknown[]) => unknown).bind(alvo) : v;
    },
  });
}

async function contagens(
  e: Escritor,
  hospital: string,
  origem: number,
  credor: number,
  docs: readonly number[],
) {
  const [l] = await e.consultar(
    `SELECT COUNT(*) N FROM SGH_PES_FOLHA_LANCAMENTO WHERE HOSPITAL = ? AND ORIGEM = 'fechamento'
        AND ID_ORIGEM = CAST(CAST(? AS VARCHAR(20)) AS BIGINT)`,
    [hospital, String(origem)],
    { teto: 1 },
  );
  const marcas = docs.map(() => '?').join(', ');
  const [t] = await e.consultar(
    `SELECT COUNT(*) N, SUM(VALOR) V FROM MFCONPAG WHERE EMPRESA = 1 AND FORN = ? AND DOC IN (${marcas})`,
    [credor, ...docs],
    { teto: 1 },
  );
  const [g] = await e.consultar(
    `SELECT COUNT(*) N FROM MFLANGSI WHERE EMPRESA = 1 AND FORN = ? AND TP_LAN = 0 AND DOC IN (${marcas})`,
    [credor, ...docs],
    { teto: 1 },
  );
  return {
    lancamentos: n(l?.['N']),
    titulos: n(t?.['N']),
    valor: Number(t?.['V'] ?? 0),
    apropriacoes: n(g?.['N']),
  };
}

describe.skipIf(!PODE_ESCREVER)('títulos da folha (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('lote completo: um título por destino com a apropriação, o registro SGH_ e a soma; repetir é recusado', async () => {
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m539-titulos' }, async (e) => {
      const x = await cenarioTitulosFolha(a, e);
      // As leituras da tela no banco: as classificações ativas, o nome do credor do de-para e a busca pelo código.
      const apoio = await x.servico.apoioTela(x.sessao(), 1);
      expect(apoio.classificacoes.length).toBeGreaterThan(0);
      expect(apoio.credores.map((c) => c.codigo)).toEqual([x.credor]);
      const busca = await x.servico.credores(x.sessao(), { termo: String(x.credor) });
      expect(busca.itens.map((c) => c.codigo)).toEqual([x.credor]);
      const porNome = await x.servico.credores(x.sessao(), { termo: apoio.credores[0]!.nome.slice(0, 4) });
      expect(porNome.itens.length).toBeGreaterThan(0);
      const { previa, lancar } = await lancarFolhaSintetica(x);
      expect(previa.pendencias).toEqual([]);
      expect(previa.titulos.map((t) => t.destino)).toEqual(['liquido-mensal', 'inss', 'fgts']);
      // A conta impressa: líquido 4.200,00 + INSS 500,00 + FGTS 400,00 = 5.100,00.
      expect(previa.parcelas.map((p) => p.valor)).toEqual([420_000, 50_000, 40_000]);
      expect(previa.total).toBe(420_000 + 50_000 + 40_000);
      expect(previa.esperado).toBe(previa.total);
      const r = await lancar();
      expect(r.lancamento).toMatchObject({ total: 510_000, liquido: 420_000, encargos: 90_000 });
      const docs = r.lancamento.titulos.map((t) => t.documento);
      const c = await contagens(e, a.c.hospital, x.origem, x.credor, docs);
      expect(c).toEqual({ lancamentos: 1, titulos: 3, valor: 5_100, apropriacoes: 3 });
      // Os títulos relidos do contas a pagar estão em aberto; os fatos são por centro, rotina e natureza.
      const d = await x.servico.detalhe(x.sessao(), r.lancamento.id);
      expect(d.titulos.map((t) => [t.destino, t.pago])).toEqual([
        ['liquido-mensal', false],
        ['inss', false],
        ['fgts', false],
      ]);
      expect(r.lancamento.fatos).toBeGreaterThanOrEqual(4);
      // A origem lançada: a prévia acusa e o lançamento é recusado.
      const de2 = await lancarFolhaSintetica(x);
      expect(de2.previa.pendencias.map((p) => p.codigo)).toContain('ja-lancado');
      const recusa = await de2.lancar().catch((z: unknown) => z);
      expect(recusa).toBeInstanceOf(ErroProblema);
      expect((recusa as ErroProblema).extras['codigo']).toBe('titulos-com-pendencias');
    });
  }, 600_000);

  it('regra 10: a falha forçada no segundo título desfaz tudo (título, apropriação, registro SGH_ e outbox)', async () => {
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m539-falha' }, async (e) => {
      const [o0] = await e.consultar(
        "SELECT COUNT(*) N FROM SGH_OUTBOX WHERE TIPO = 'PESSOAS_FOLHA_CUSTO_PESSOAL'",
        [],
        {
          teto: 1,
        },
      );
      // O serviço real sobre o escritor da transação que falha na gravação do segundo título (como uma recusa do banco).
      const x = await cenarioTitulosFolha(a, e, falhaNoTitulo(e, 2));
      const { previa, lancar } = await lancarFolhaSintetica(x);
      expect(previa.pendencias).toEqual([]);
      const docs = previa.titulos.map((t) => t.documento);
      tentados = 0;
      await expect(lancar()).rejects.toBeDefined();
      // O primeiro título foi gravado na transação e a falha veio no segundo.
      expect(tentados).toBe(2);
      const c = await contagens(e, a.c.hospital, x.origem, x.credor, docs);
      expect(c).toEqual({ lancamentos: 0, titulos: 0, valor: 0, apropriacoes: 0 });
      const [o1] = await e.consultar(
        "SELECT COUNT(*) N FROM SGH_OUTBOX WHERE TIPO = 'PESSOAS_FOLHA_CUSTO_PESSOAL'",
        [],
        {
          teto: 1,
        },
      );
      expect(n(o1?.['N'])).toBe(n(o0?.['N']));
      // Sem a falha, a mesma prévia lança (a falha não deixou nada que barrasse).
      const ok = await (await lancarFolhaSintetica({ ...x, servico: x.servicoSobre(e) })).lancar();
      expect(ok.lancamento.titulos).toHaveLength(3);
    });
  }, 600_000);
  it('origem interface com vencimento ajustado na prévia: as linhas do resumo ficam com o MFCONPAG.ID de cada título', async () => {
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m539-resumo' }, async (e) => {
      const h = a.c.hospital;
      // O retorno da F0 pelas mesmas gravações SGH_ que a importação usa (exportado → recebido conferido → resumo).
      const lote = async (sentido: 'exportado' | 'recebido', situacao: string, exportado: number | null) => {
        const id = await proximoIdLoteFolhaPesSgh(e);
        await incluirLoteFolhaPesSgh(e, {
          hospital: h,
          id,
          empresa: 1,
          competencia: '2099-11',
          sentido,
          loteExportado: exportado,
          leiaute: 'v1',
          situacao,
          colaboradores: 0,
          soma: 0,
          totais: '{}',
          vinculos: null,
          divergencias: null,
          resumo: 'b'.repeat(64),
          geradoEm: '2099-12-01T08:00:00',
          por: 'SINT.FOLHA',
        });
        return id;
      };
      const exp = await lote('exportado', 'gerado', null);
      const rec = await lote('recebido', 'conferido', exp);
      await incluirResumoFolhaPesSgh(e, {
        hospital: h,
        interface: rec,
        empresa: 1,
        competencia: '2099-11',
        linhas: [
          { vinculo: null, centroCusto: null, rubrica: 'inss', valor: 50_000, vencimento: '2099-12-20' },
          { vinculo: null, centroCusto: null, rubrica: 'fgts', valor: 40_000, vencimento: '2099-12-07' },
        ],
      });
      const BIG = 'CAST(CAST(? AS VARCHAR(20)) AS BIGINT)';
      const titulo = (
        destino: 'inss' | 'fgts',
        rotina: number,
        sugerido: string,
        vencimento: string,
        valor: number,
      ) => ({
        chave: `${destino}:${sugerido}`,
        destino,
        rotina,
        credor: 9_001,
        documento: 2_099_110_000 + rotina * 100 + Number(vencimento.slice(8, 10)),
        vencimento,
        valor,
        classificacao: { grupo: 296, subgrupo: 4, item: 2 },
        referente: 'Folha 11/2099: encargo',
      });
      const entrada = esquemaCriarTituloPagar.parse({
        acao: 'incluir-folha',
        empresa: 1,
        origem: 'interface',
        idOrigem: rec,
        apuracao: 'mensal',
        periodo: '2099-11',
        resumo: 'c'.repeat(64),
        emissao: '2099-12-01',
        liquido: 0,
        encargos: 90_000,
        // O INSS teve o vencimento ajustado na prévia (20/12 → 28/12); o FGTS ficou no sugerido.
        titulos: [
          titulo('inss', 16, '2099-12-20', '2099-12-28', 50_000),
          titulo('fgts', 15, '2099-12-07', '2099-12-07', 40_000),
        ],
        fatos: [],
      }) as IncluirTitulosFolhaEntrada;
      await registrarLancamentoFolhaPesSgh(e, {
        rede: a.c.rede,
        hospital: h,
        entrada,
        ids: [2_000_000_001, 2_000_000_002],
        por: 'SINT.FOLHA',
      });
      const ls = await e.consultar(
        `SELECT RUBRICA_RESUMO R, ID_MFCONPAG T FROM SGH_PES_FOLHA_RESUMO WHERE ID_INTERFACE = ${BIG} ORDER BY RUBRICA_RESUMO`,
        [String(rec)],
        { teto: 10 },
      );
      expect(ls.map((x) => [String(x['R']).trim(), n(x['T'])])).toEqual([
        ['fgts', 2_000_000_002],
        ['inss', 2_000_000_001],
      ]);
    });
  }, 600_000);
});
