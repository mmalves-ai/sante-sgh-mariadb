// W0-09 (catálogos A e B) na cópia: um teste por relatório novo (censo diário por unidade, altas e óbitos, produção por
// profissional e setor, consumo por centro de custo, curva ABC, validade e lote; B: dietas servidas, prontuários emprestados, atendimentos por convênio, produção SUS e escala das agendas). Cada um: a consulta declarada roda
// na cópia em transação READ ONLY, dentro do teto; os três arquivos (CSV, XLSX e o PDF/A pelo Gotenberg local) saem
// das linhas reais; as três exportações ficam em SGH_REL_EXECUCAO com a justificativa e a linha da SGH_TRILHA
// (desfeito no fim). A recusa sem justificativa é do serviço (catalogo-w0-09.spec.ts). Só contagens no log.
import { resolve } from 'node:path';
import { relatorioDoCatalogo } from '@sgh/contratos';
import { textoCanonicoParametros, totaisDasLinhas } from '@sgh/dominio-relatorio';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  executarRelatorioCatalogo,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { converterHtmlEmPdfA } from '../../documento/infra/gotenberg.js';
import { gerarArquivo } from '../aplicacao/exportar.js';
import { portaRelatorioNaTransacao } from '../porta-legado.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE = codigos.length > 0 && travaDaCopiaSegura(process.pid);
let nucleo: NucleoLegado;
const cod = codigos[0] as string;
const ctx = () => ({ rede: nucleo.rede, hospital: cod, traceId: 'int-w009-catalogo' });
const gotenberg = process.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';

/** Período curto de 2026 em cada relatório (na cópia, a internação vai até 04/07/2026: censo e altas em junho). */
const PARAMETROS: Readonly<Record<string, Record<string, string | number>>> = {
  censoDiarioPorUnidade: { dia: '2026-06-15' },
  altasEObitos: { inicio: '2026-06-01', fim: '2026-06-07' },
  producaoPorProfissionalSetor: { mesInicio: '2026-06', mesFim: '2026-06' },
  consumoPorCentroCusto: { mesInicio: '2026-06', mesFim: '2026-06' },
  curvaAbcConsumo: { mesInicio: '2026-06', mesFim: '2026-06' },
  validadeLote: { dias: 60 },
  // Catálogo B (dietas e atendimentos em junho; a cópia não tem BPA nem AIH: a consulta roda e volta vazia).
  dietasServidas: { inicio: '2026-06-01', fim: '2026-06-03' },
  prontuariosEmprestados: { setorSame: 8, inicio: '2026-01-01', fim: '2026-06-30' },
  atendimentosPorConvenio: { inicio: '2026-06-01', fim: '2026-06-07' },
  producaoSus: { mesInicio: '2026-06', mesFim: '2026-06' },
  escalaAgendas: { situacao: 'todas' },
};

beforeAll(async () => {
  if (!PODE) return;
  nucleo = new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '3' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  await nucleo.verificarSchema(cod);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

describe.skipIf(!PODE)('catálogos A e B do W0-09 na cópia (um teste por relatório)', () => {
  for (const [codigo, valores] of Object.entries(PARAMETROS))
    it(`${codigo}: consulta na cópia, três arquivos e as exportações com justificativa e trilha`, async () => {
      const r = relatorioDoCatalogo(codigo)!;
      const inicio = performance.now();
      const x = await nucleo.lerSomente(ctx(), (l) =>
        executarRelatorioCatalogo(l, codigo, valores, { teto: r.tetoLinhas, tempoMaximoMs: r.tempoMaximoMs }),
      );
      const duracaoMs = Math.round(performance.now() - inicio);
      for (const l of x.linhas.slice(0, 20))
        for (const k of Object.keys(l)) expect(r.colunas.map((c) => c.campo)).toContain(k);
      console.log(`${codigo} na cópia: ${x.linhas.length} linha(s) em ${duracaoMs} ms`);

      const conteudo = {
        relatorio: r,
        linhas: x.linhas,
        totais: totaisDasLinhas(r, x.linhas),
        parametros: valores,
        produto: 'Sante SGH',
        estabelecimento: cod,
        emitidoPor: 'SGH.TESTE',
        emitidoEm: new Date(),
        pdf: async (html: string, titulo: string) =>
          (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf,
      };
      for (const formato of ['csv', 'xlsx', 'pdf'] as const) {
        const a = await gerarArquivo(formato, conteudo);
        const ini = new TextDecoder().decode(a.conteudo.slice(0, 5));
        if (formato === 'pdf') expect(ini).toBe('%PDF-');
        if (formato === 'xlsx') expect(ini.slice(0, 2)).toBe('PK');
        if (formato === 'csv') expect(new TextDecoder().decode(a.conteudo)).toContain(r.colunas[0]!.rotulo);
      }

      await nucleo.desfazendoNaCopia(ctx(), async (e) => {
        const porta = portaRelatorioNaTransacao(e);
        const c = { rede: nucleo.rede, hospital: cod };
        const trilha = (formato: string) => ({
          rede: nucleo.rede,
          hospital: cod,
          usuario: 'SGH.TESTE',
          evento: 'relatorio.exportado',
          recurso: `relatorio.${codigo}`,
          operacao: `exportacao:${formato}:ok`,
          tabelaAlvo: 'SGH_REL_EXECUCAO',
          idAlvo: null,
          chaveNaturalAlvo: codigo,
          resultado: 'sucesso' as const,
          estacao: 'int-w009',
          correlacao: 'int-w009-catalogo',
        });
        for (const formato of ['csv', 'xlsx', 'pdf'] as const)
          await porta.gravarSgh(c, trilha(formato), (g) =>
            g.registrarExecucao({
              relatorio: codigo,
              tipo: 'exportacao',
              formato,
              usuario: 'SGH.TESTE',
              parametros: textoCanonicoParametros(valores),
              linhas: x.linhas.length,
              duracaoMs,
              dadoPessoal: false,
              mascarado: true,
              justificativa: `Conferência W0-09 em ${formato}`,
              situacao: 'ok',
              agendamento: null,
            }),
          );
        const ex = await porta.execucoes(c, { relatorio: codigo, usuario: 'SGH.TESTE', limite: 10 });
        const exportacoes = ex.filter((y) => y.tipo === 'exportacao');
        expect(exportacoes.map((y) => y.formato).sort()).toEqual(['csv', 'pdf', 'xlsx']);
        expect(exportacoes.every((y) => y.temJustificativa)).toBe(true);
        const [t] = await e.consultar(
          `SELECT COUNT(*) N FROM SGH_TRILHA WHERE RECURSO = ? AND CORRELACAO = 'int-w009-catalogo'`,
          [`relatorio.${codigo}`],
          { teto: 1 },
        );
        expect(Number(t?.['N'])).toBe(3);
      });
    });
});

/**
 * Revisão W0-09: cada variante com filtro também roda na cópia (todo SQL declarado chega ao Firebird, não só a
 * variante padrão). O convênio e o local saem da própria cópia: o mais usado no período e o primeiro com validade.
 */
describe.skipIf(!PODE)('variantes com filtro do W0-09 na cópia (todo SQL declarado)', () => {
  const executar = (codigo: string, valores: Record<string, string | number>) => {
    const r = relatorioDoCatalogo(codigo)!;
    return nucleo.lerSomente(ctx(), (l) =>
      executarRelatorioCatalogo(l, codigo, valores, { teto: r.tetoLinhas, tempoMaximoMs: r.tempoMaximoMs }),
    );
  };
  const primeiro = async (sql: string): Promise<number> => {
    const [x] = await nucleo.lerSomente(ctx(), (l) => l.consultar(sql, [], { teto: 1 }));
    return Number(Object.values(x ?? {})[0] ?? 0);
  };

  it('atendimentosPorConvenio com convênio (variante "convenio")', async () => {
    const todos = await executar('atendimentosPorConvenio', PARAMETROS['atendimentosPorConvenio']!);
    const c = (todos.linhas[0]?.['convenio'] as number | undefined) ?? 306;
    const x = await executar('atendimentosPorConvenio', {
      ...PARAMETROS['atendimentosPorConvenio']!,
      convenio: c,
    });
    expect(x.linhas.every((l) => l['convenio'] === c)).toBe(true);
    if (todos.linhas.length > 0) expect(x.linhas.length).toBe(1);
    console.log(`atendimentosPorConvenio (convênio) na cópia: ${x.linhas.length} linha(s)`);
  });

  it('curvaAbcConsumo com local (variante "local")', async () => {
    const local = await primeiro(`SELECT FIRST 1 k.LOCAL FROM GECONITL k WHERE k.ANO = 2026 AND k.MES = 6`);
    const x = await executar('curvaAbcConsumo', { ...PARAMETROS['curvaAbcConsumo']!, local });
    console.log(`curvaAbcConsumo (local) na cópia: ${x.linhas.length} linha(s)`);
    expect(Array.isArray(x.linhas)).toBe(true);
  });

  it('validadeLote com local (variante "local")', async () => {
    const local = await primeiro(`SELECT FIRST 1 v.LOCAL FROM GEVALMEM v WHERE v.QTDE > 0`);
    const x = await executar('validadeLote', { ...PARAMETROS['validadeLote']!, local });
    console.log(`validadeLote (local) na cópia: ${x.linhas.length} linha(s)`);
    expect(Array.isArray(x.linhas)).toBe(true);
  });

  it('escalaAgendas só das ativas (variante "ativas")', async () => {
    const x = await executar('escalaAgendas', { situacao: 'ativas' });
    console.log(`escalaAgendas (ativas) na cópia: ${x.linhas.length} linha(s)`);
    expect(Array.isArray(x.linhas)).toBe(true);
  });
});
