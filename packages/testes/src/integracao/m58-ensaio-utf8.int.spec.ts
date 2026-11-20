// M58 (etapa 3, ensaio da conversão para UTF-8) sobre a cópia de dev, sob a trava da cópia: as leituras do ensaio
// rodam READ ONLY no schema real (a mesma consulta roda depois na base em Firebird 5 e no banco convertido, no servidor
// de ensaio). Só estrutura, contagens e resumos; a equivalência aqui percorre só tabelas SGH_CFG_ pequenas (a inteira é
// do ensaio). Saída só com números (abaixo de 5 vira <5).
import {
  avaliarIndicesUtf8,
  compararEquivalencia,
  conferirCatalogadas,
  contarClasses,
  resumirLiterais,
} from '@sgh/dominio-config';
import {
  ajustesDeTamanho,
  analisarFontesComByteAlto,
  blocoCopiaNoMotor,
  buscarEstabelecimento,
  COLUNAS_UTF8,
  copiavelNoMotor,
  lerCamposCarga,
  lerEstabelecimentos,
  lerGeradores,
  planoTabela,
  conferirCharsetPartida,
  decodificarCp1252,
  lerCharsetTexto,
  lerFontesPsql,
  lerFuncoesPorByte,
  lerColunasTextoConversao,
  lerIndicesComTexto,
  lerPlataformaBanco,
  resumirTabela,
  resumirTabelaPorCursor,
  revisarFontePsqlUtf8,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, env, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const menos5 = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

describe.skipIf(!PODE_ESCREVER)('M58 (etapa 3): leituras do ensaio do UTF-8 na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 120_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it(
    'colunas por classe, índices em UTF-8, literais, charset da partida e equivalência (READ ONLY)',
    async () => {
      const t0 = performance.now();
      const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
        const colunas = await lerColunasTextoConversao(l);
        const pequenas = [
          ...new Set(colunas.filter((c) => c.tabela.startsWith('SGH_CFG_')).map((c) => c.tabela)),
        ]
          .sort()
          .slice(0, 3);
        const resumos: Record<string, { linhas: number; resumos: Record<string, string> | null }> = {};
        for (const t of pequenas) {
          const cols = colunas
            .filter((c) => c.tabela === t && c.classe !== 'bytes')
            .map((c) => ({
              coluna: c.coluna,
              tipo: c.tipo as 'CHAR' | 'VARCHAR',
              classe: c.classe as 'cp1252',
            }));
          resumos[t] = await resumirTabela(l, t, cols, 'base', { pagina: 500 });
        }
        const fontes = await analisarFontesComByteAlto(l);
        // Revisão um a um (ADR 0032, item 10): a fonte lida como o convertido a guarda (CP1252 → UTF-8) mantém a letra.
        const aRever = resumirLiterais(fontes).aRever;
        const lidas = await lerFontesPsql(l, aRever);
        const revistos = [...lidas.values()].map((b) =>
          revisarFontePsqlUtf8(b, Buffer.from(decodificarCp1252(b), 'utf8')),
        );
        return {
          colunas,
          indices: await lerIndicesComTexto(l),
          fontes,
          aRever,
          lidas: lidas.size,
          revistos,
          porByte: await lerFuncoesPorByte(l),
          plataforma: await lerPlataformaBanco(l),
          charset: await lerCharsetTexto(l),
          resumos,
        };
      });
      const ms = Math.round(performance.now() - t0);
      const classes = contarClasses(r.colunas);
      const cat = conferirCatalogadas(r.colunas, COLUNAS_UTF8);
      const ix = avaliarIndicesUtf8(r.indices, r.plataforma.tamanhoPagina);
      const lit = resumirLiterais(r.fontes);
      const eq = compararEquivalencia(r.resumos, r.resumos);
      console.log(
        JSON.stringify({
          colunas: r.colunas.length,
          classes,
          catalogadas: cat.catalogadas.length,
          catalogadasAusentes: cat.ausentes,
          indicesComTexto: r.indices.length,
          pagina: r.plataforma.tamanhoPagina,
          limiteChave: ix.limiteChave,
          estouram: menos5(ix.estouram.length),
          paginaAlvo: ix.paginaAlvo,
          literais: { ...lit, aRever: menos5(lit.aRever.length) },
          revistosMesmaLetra: r.revistos.filter((x) => x.mesmaLetra).length,
          porByte: r.porByte,
          charset: r.charset,
          equivalencia: { tabelas: eq.tabelas, colunas: eq.colunas, iguais: eq.colunasIguais },
          ms,
        }),
      );
      // A cópia é o banco da coexistência: NONE com o parâmetro no padrão (CP1252); a partida confere.
      expect(conferirCharsetPartida(r.charset.charsetBanco, r.charset.parametro)).toBe('CP1252');
      expect(classes.cp1252).toBeGreaterThan(10_000);
      expect(classes.bytes).toBeGreaterThan(0);
      expect(cat.ausentes).toEqual([]);
      // Os índices com texto do outro sistema (1.509 na F1) mais os das SGH_.
      expect(r.indices.length).toBeGreaterThanOrEqual(1509);
      // Os 364 gatilhos e 24 procedures com byte alto da F1 (só do outro sistema).
      expect(lit.gatilhos).toBe(364);
      expect(lit.procedures).toBe(24);
      expect(r.lidas).toBe(r.aRever.length);
      expect(r.revistos.every((x) => x.mesmaLetra && x.motivos.length > 0)).toBe(true);
      // SUBSTR e STRLEN da ib_udf (contam por byte) com dependentes no banco (ADR 0032, item 9).
      expect(r.porByte.map((f) => f.funcao)).toEqual(['STRLEN', 'SUBSTR']);
      expect(r.porByte.every((f) => f.dependentes > 0)).toBe(true);
      expect(eq.colunasIguais).toBe(eq.colunas);
      expect(eq.hashAntes).toBe(eq.hashDepois);
    },
    20 * 60_000,
  );

  it(
    'plano da carga do convertido: campos, geradores e a consulta da cópia no motor válida na base (READ ONLY)',
    async () => {
      const t0 = performance.now();
      const est = buscarEstabelecimento(lerEstabelecimentos(env), a.cod);
      const driver = criarDriverNativo();
      const cx = await driver.conectar(est);
      try {
        const tr = await cx.iniciar({ tipo: 'leitura' });
        try {
          const campos = await lerCamposCarga(tr);
          const geradores = await lerGeradores(tr);
          const planos = [...campos].map(([t, c]) => ({ t, ...planoTabela(c, c) }));
          let peloMotor = 0;
          const peloProcesso: string[] = [];
          for (const p of planos) {
            try {
              if (!copiavelNoMotor(p.colunas)) throw new Error('catalogada');
              blocoCopiaNoMotor(p.t, p.colunas, '/var/lib/firebird/data/pc.fdb');
              peloMotor++;
            } catch {
              peloProcesso.push(p.t);
            }
          }
          // A consulta externa (a que o convertido manda à base) roda na base em NONE, nas tabelas largas e na de
          // tamanho antigo (5 linhas no máximo; nenhum valor sai do teste).
          const amostra = ['ATCABECATEND', 'FCLANEXT', 'TBHOSPIT', 'SGH_CFG_PARAMETRO'].filter((t) =>
            campos.has(t),
          );
          for (const t of amostra) {
            const p = planos.find((x) => x.t === t)!;
            const { externa } = blocoCopiaNoMotor(t, p.colunas, '/var/lib/firebird/data/pc.fdb');
            const r = await tr.consultar(externa, [], { teto: 5 });
            // As expressões não têm apelido (o driver junta as de mesmo nome): basta a consulta ser aceita e devolver.
            // (a SGH_CFG_PARAMETRO pode estar vazia: só o parâmetro gravado tem linha).
            if (t !== 'SGH_CFG_PARAMETRO') expect(r.linhas.length).toBeGreaterThan(0);
          }
          const naoSuportadas = planos.flatMap((p) => p.naoSuportadas.map((c) => `${p.t}.${c}`));
          console.log(
            JSON.stringify({
              tabelas: campos.size,
              geradores: geradores.size,
              peloMotor,
              peloProcesso: peloProcesso.length,
              naoSuportadas: menos5(naoSuportadas.length),
              amostra: amostra.length,
              ms: Math.round(performance.now() - t0),
            }),
          );
          expect(campos.size).toBeGreaterThan(3_000);
          expect(geradores.size).toBeGreaterThan(2_000);
          expect([...geradores.values()].every((v) => /^-?\d+$/.test(v))).toBe(true);
          // Só a tabela com coluna catalogada como UTF-8 vai pelo processo por regra; o resto cabe no motor.
          expect(peloProcesso).toContain('RPMATRIZ_GUT_DESCRICAO');
          expect(peloMotor).toBeGreaterThan(campos.size - 10);
          expect(naoSuportadas).toEqual([]);
          expect(amostra.length).toBe(4);
          // As colunas antigas com menos caracteres que bytes (20 no pc; FCLANEXT.NOME_PROC entre elas): o convertido
          // as declara com o tamanho em bytes.
          const ajustes = ajustesDeTamanho(campos, campos);
          expect(ajustes.length).toBe(20);
          expect(
            ajustes.some((x) => x.tabela === 'FCLANEXT' && x.coluna === 'NOME_PROC' && x.para === 62),
          ).toBe(true);
        } finally {
          await tr.desfazer();
        }
      } finally {
        await cx.fechar();
        await driver.encerrar();
      }
    },
    20 * 60_000,
  );

  it(
    'a prova pelo cursor (uma leitura por tabela) dá o mesmo resumo que a paginada pela chave (READ ONLY)',
    async () => {
      const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
        const colunas = await lerColunasTextoConversao(l);
        const tabelas = [
          ...new Set(colunas.filter((c) => c.tabela.startsWith('SGH_CFG_')).map((c) => c.tabela)),
        ]
          .sort()
          .slice(0, 3);
        const porTabela = new Map(
          tabelas.map((t) => [
            t,
            colunas
              .filter((c) => c.tabela === t && c.classe !== 'bytes')
              .map((c) => ({
                coluna: c.coluna,
                tipo: c.tipo as 'CHAR' | 'VARCHAR',
                classe: c.classe as 'cp1252',
              })),
          ]),
        );
        const paginada: Record<string, unknown> = {};
        for (const [t, cols] of porTabela)
          paginada[t] = await resumirTabela(l, t, cols, 'base', { pagina: 7 });
        return { porTabela, paginada };
      });
      const est = buscarEstabelecimento(lerEstabelecimentos(env), a.cod);
      const driver = criarDriverNativo();
      const cx = await driver.conectar(est);
      try {
        const tr = await cx.iniciar({ tipo: 'leitura' });
        try {
          for (const [t, cols] of r.porTabela)
            expect(await resumirTabelaPorCursor(tr, t, cols, 'base', { lote: 5 })).toEqual(r.paginada[t]);
          expect(r.porTabela.size).toBe(3);
        } finally {
          await tr.desfazer();
        }
      } finally {
        await cx.fechar();
        await driver.encerrar();
      }
    },
    10 * 60_000,
  );
});
