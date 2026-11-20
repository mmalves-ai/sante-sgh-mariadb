// M54.1, regra 1 da ficha, sobre a cópia (seção 10: "fato gravado por fora entra no lote; reprocessamento idempotente;
// leitura incremental sem perder linha alterada"): numa transação desfeita, o estado da fonte das contas a pagar começa
// perto do fim da tabela; o primeiro ciclo lê as linhas novas e registra os fatos; um título é alterado "por fora" (a
// gravação direta na tabela, como faria o outro sistema, na mesma transação) e o ciclo seguinte gera o estorno e o fato
// novo; o terceiro ciclo, sem mudança, não grava nada na janela relida (a varredura segue para as linhas antigas). Depois do ROLLBACK, as contagens SGH_CTB_* são as de antes.
// Correção da revisão do M54.1: (a) a linha de maior chave com a marca logo abaixo dela (a linha nova "por fora") vira
// fato, e o reprocessamento da competência desse fato, pela mesma rotina do `pnpm contabil:reprocessar` (lerPeriodoContabil
// e conferirExecucoes), dá os mesmos lançamentos com fatos > 0 (a regra e as duas contas são SINTÉTICAS, em memória: a
// cópia não tem regra publicada nem plano); (b) a linha alterada entre a leitura do lote e a gravação (um acesso que
// intercala o UPDATE logo depois de lerNovos) é relida no ciclo seguinte: estorno e fato novo.
// Só contagens (abaixo de 5 vira <5); nenhum dado de pessoa.
import { resolve } from 'node:path';
import type { ContaPlano, RegraContabil } from '@sgh/contratos';
import { cicloDaFonte, conferirExecucoes, type LeituraDoPeriodo } from '@sgh/dominio-contabil';
import {
  acessoCicloFatos,
  type Escritor,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  estadosDasFontesSgh,
  gravarEstadoFonteSgh,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerPeriodoContabil,
  NucleoLegado,
  somenteSgh,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const raiz = resolve(import.meta.dirname, '../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE_ESCREVER = codigos.length > 0 && travaDaCopiaSegura(process.pid);
const pouco = (n: number) => (n < 5 ? '<5' : String(n));
const T = 'MFCONPAG';

describe.skipIf(!PODE_ESCREVER)('leitura dos fatos contábeis na cópia (transação desfeita)', () => {
  let nucleo: NucleoLegado;
  const cod = codigos[0] as string;
  beforeAll(async () => {
    nucleo = new NucleoLegado({
      env: { ...env, FB_POOL_TETO: '4', FB_LOCK_TIMEOUT_S: '2' },
      driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
      pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    });
    await nucleo.verificarSchema(cod);
    // A conferência do schema da cópia passa de 1 min com a máquina ocupada (o E2E e a outra cópia).
  }, 600_000);
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  const contagens = () =>
    nucleo.lerSomente({ rede: nucleo.rede, hospital: cod, traceId: 'int-m54-contagens' }, async (l) => {
      const [x] = await l.consultar(
        `SELECT (SELECT COUNT(*) FROM SGH_CTB_FATO WHERE HOSPITAL = ?) F,
                (SELECT COUNT(*) FROM SGH_CTB_FONTE WHERE HOSPITAL = ?) S,
                (SELECT COUNT(*) FROM SGH_TRILHA WHERE HOSPITAL = ? AND USUARIO = 'SGH.CONTABIL') T
           FROM RDB$DATABASE`,
        [cod, cod, cod],
        { teto: 1 },
      );
      return { fatos: Number(x?.['F']), fontes: Number(x?.['S']), trilha: Number(x?.['T']) };
    });

  it('o título alterado por fora vira estorno e fato novo; o ciclo sem mudança não grava; nada fica', async () => {
    const antes = await contagens();
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m54-fatos' };
    const t0 = performance.now();
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const mesma = <X>(fn: (x: typeof e0) => Promise<X>) => fn(e0);
      const acesso = acessoCicloFatos(mesma, mesma, { rede: nucleo.rede, hospital: cod });
      // O alvo: o título mais recente com emissão e valor (lido "como o outro sistema gravou").
      const [alvo] = await e0.consultar(
        `SELECT FIRST 1 CAST(ID AS VARCHAR(20)) ID FROM MFCONPAG
          WHERE ID > (SELECT MAX(ID) - 2000 FROM MFCONPAG) AND EMISSAO > '1900-01-01' AND VALOR > 0
          ORDER BY ID DESC`,
        [],
        { teto: 1 },
      );
      const id = Number(alvo?.['ID']);
      if (!Number.isSafeInteger(id)) throw new Error('A cópia não tem título a pagar recente com valor.');
      // O estado começa 30 chaves atrás do alvo (a leitura da cópia inteira levaria horas: a marca é a de um ciclo já
      // em andamento).
      const existente = (await estadosDasFontesSgh(e0, cod)).find((x) => x.tabela === T);
      await gravarEstadoFonteSgh(somenteSgh(e0), {
        hospital: cod,
        tabela: T,
        marca: id - 30,
        varredura: 1,
        lidosNovos: 0,
        lidosAlterados: 0,
        fatosGravados: 0,
        versaoVista: existente?.versao ?? null,
      });
      const c = { empresa: 1, hoje: '2026-10-29', opcoes: { lote: 200, folga: 40, faixaVarredura: 10 } };
      const primeiro = await cicloDaFonte(acesso, T, c);
      // "Por fora": a gravação direta na tabela do título (como o outro sistema), na mesma transação desfeita.
      await e0.executar('UPDATE MFCONPAG SET VALOR = VALOR + 1 WHERE ID = ?', [id]);
      const segundo = await cicloDaFonte(acesso, T, c);
      // Os fatos da janela relida (a revisão); a varredura do terceiro ciclo anda para linhas antigas ainda não lidas
      // e pode registrá-las (é a leitura do histórico, não repetição).
      const daJanela = async () => {
        const [x] = await e0.consultar(
          `SELECT COUNT(*) N FROM SGH_CTB_FATO WHERE HOSPITAL = ? AND TABELA = ? AND CHAVE_ORIGEM > ?`,
          [cod, T, id - 30 - c.opcoes.folga],
          { teto: 1 },
        );
        return Number(x?.['N']);
      };
      const janelaAntes = await daJanela();
      const terceiro = await cicloDaFonte(acesso, T, c);
      const janelaDepois = await daJanela();
      const [doAlvo] = await e0.consultar(
        `SELECT COUNT(*) N, SUM(CASE WHEN ESTORNO = 'S' THEN 1 ELSE 0 END) E FROM SGH_CTB_FATO
          WHERE HOSPITAL = ? AND TABELA = ? AND CHAVE_ORIGEM = ? AND TIPO = 'tituloPagar'`,
        [cod, T, id],
        { teto: 1 },
      );
      return {
        primeiro,
        segundo,
        terceiro,
        janelaAntes,
        janelaDepois,
        fatosDoAlvo: Number(doAlvo?.['N']),
        estornosDoAlvo: Number(doAlvo?.['E']),
      };
    });
    const ms = Math.round(performance.now() - t0);
    console.log(
      `[${cod}] fatos: 1º ciclo novos ${pouco(r.primeiro.lidosNovos)}, gravados ${pouco(r.primeiro.gravados)}; ` +
        `2º alterados ${pouco(r.segundo.lidosAlterados)}, estornos ${pouco(r.segundo.estornos)}; ` +
        `3º gravados na janela ${r.janelaDepois - r.janelaAntes} (varredura ${pouco(r.terceiro.gravados)}); ${ms} ms`,
    );
    expect(r.primeiro.lidosNovos).toBeGreaterThan(0);
    expect(r.primeiro.gravados).toBeGreaterThan(0);
    expect(r.segundo.lidosAlterados).toBeGreaterThanOrEqual(1);
    expect(r.segundo.estornos).toBeGreaterThanOrEqual(1);
    // O título: o fato original, o estorno dele e o fato novo com o valor alterado.
    expect(r.fatosDoAlvo).toBe(3);
    expect(r.estornosDoAlvo).toBe(1);
    // Reprocessar a mesma janela sem mudança não grava nada (idempotente).
    expect(r.terceiro).toMatchObject({ lidosNovos: 0, lidosAlterados: 0, estornos: 0 });
    expect(r.janelaDepois).toBe(r.janelaAntes);
    expect(await contagens()).toEqual(antes);
  }, 600_000);

  // ── Correção da revisão ──────────────────────────────────────────────────────────────────────────
  const C = { empresa: 1, hoje: '2026-10-29', opcoes: { lote: 200, folga: 40, faixaVarredura: 10 } };

  /** O título mais recente com emissão e valor e o estado da fonte com a marca `atras` chaves abaixo dele. */
  async function prepararTitulo(e0: Escritor, atras: number): Promise<number> {
    const [alvo] = await e0.consultar(
      `SELECT FIRST 1 CAST(ID AS VARCHAR(20)) ID FROM MFCONPAG
        WHERE ID > (SELECT MAX(ID) - 2000 FROM MFCONPAG) AND EMISSAO > '1900-01-01' AND VALOR > 0
        ORDER BY ID DESC`,
      [],
      { teto: 1 },
    );
    const id = Number(alvo?.['ID']);
    if (!Number.isSafeInteger(id)) throw new Error('A cópia não tem título a pagar recente com valor.');
    const existente = (await estadosDasFontesSgh(e0, cod)).find((x) => x.tabela === T);
    await gravarEstadoFonteSgh(somenteSgh(e0), {
      hospital: cod,
      tabela: T,
      marca: id - atras,
      varredura: 1,
      lidosNovos: 0,
      lidosAlterados: 0,
      fatosGravados: 0,
      versaoVista: existente?.versao ?? null,
    });
    return id;
  }

  const fatosDoTitulo = async (e0: Escritor, id: number) => {
    const [x] = await e0.consultar(
      `SELECT COUNT(*) N, SUM(CASE WHEN ESTORNO = 'S' THEN 1 ELSE 0 END) E, MAX(COMPETENCIA) C FROM SGH_CTB_FATO
        WHERE HOSPITAL = ? AND TABELA = ? AND CHAVE_ORIGEM = ? AND TIPO = 'tituloPagar'`,
      [cod, T, id],
      { teto: 1 },
    );
    return { n: Number(x?.['N']), estornos: Number(x?.['E'] ?? 0), competencia: String(x?.['C'] ?? '') };
  };

  // A regra e as duas contas SINTÉTICAS (a cópia não tem regra publicada nem plano): título a pagar, despesa × fornecedor.
  const conta = (
    codigo: string,
    grupo: ContaPlano['grupo'],
    natureza: ContaPlano['natureza'],
  ): ContaPlano => ({
    empresa: 1,
    codigo,
    nome: `Conta sintética ${codigo}`,
    grupo,
    tipo: 'analitica',
    natureza,
    referencialTipo: null,
    referencialConta: null,
    contaExportacao: null,
    exigeCentroCusto: false,
    ativa: true,
  });
  const PLANO_SINTETICO = [
    conta('4.1.1.01.0001', 'despesa', 'devedora'),
    conta('2.1.1.01.0001', 'passivo', 'credora'),
  ];
  const REGRA_SINTETICA: RegraContabil = {
    empresa: 1,
    origem: 1,
    tipoFato: 'tituloPagar',
    versao: 1,
    nome: 'Título a pagar (sintética)',
    vigenciaInicio: '1900-01-01',
    vigenciaFim: null,
    prioridade: 100,
    condicoes: [],
    partidas: [
      {
        lado: 'D',
        conta: { modo: 'fixa', conta: '4.1.1.01.0001' },
        valor: { base: 'valorFato' },
        historico: 'Título {documento}',
        centroCusto: 'nenhum',
      },
      {
        lado: 'C',
        conta: { modo: 'fixa', conta: '2.1.1.01.0001' },
        valor: { base: 'valorFato' },
        historico: 'Título {documento}',
        centroCusto: 'nenhum',
      },
    ],
  };
  const comSinteticos = (l: LeituraDoPeriodo): LeituraDoPeriodo => ({
    ...l,
    plano: [...l.plano, ...PLANO_SINTETICO],
    regras: l.regras.length ? l.regras : [REGRA_SINTETICA],
  });

  it('a linha nova por fora acima da marca vira fato; reprocessar a competência dela dá os mesmos lançamentos', async () => {
    const antes = await contagens();
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m54-novo-reprocessar' };
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const mesma = <X>(fn: (x: typeof e0) => Promise<X>) => fn(e0);
      const acesso = acessoCicloFatos(mesma, mesma, { rede: nucleo.rede, hospital: cod });
      // A marca logo abaixo do título mais recente: ele é a linha "nova", gravada por fora depois da última leitura.
      const id = await prepararTitulo(e0, 1);
      const ciclo = await cicloDaFonte(acesso, T, C);
      const doAlvo = await fatosDoTitulo(e0, id);
      // O reprocessamento da competência do fato, duas leituras independentes do período, a mesma conferência do CLI.
      const primeira = comSinteticos(await lerPeriodoContabil(e0, cod, 1, doAlvo.competencia, 20_000));
      const segunda = comSinteticos(await lerPeriodoContabil(e0, cod, 1, doAlvo.competencia, 20_000));
      return { ciclo, doAlvo, conferencia: conferirExecucoes(primeira, segunda) };
    });
    console.log(
      `[${cod}] linha nova: novos ${pouco(r.ciclo.lidosNovos)}, gravados ${pouco(r.ciclo.gravados)}; ` +
        `reprocessar ${r.doAlvo.competencia}: fatos ${pouco(r.conferencia.fatos)}, lançamentos ` +
        `${pouco(r.conferencia.lancamentos.primeira)} e ${pouco(r.conferencia.lancamentos.segunda)}, ` +
        `${r.conferencia.identico ? 'IDÊNTICO' : 'DIFERENTE'}`,
    );
    expect(r.ciclo.lidosNovos).toBeGreaterThanOrEqual(1);
    expect(r.doAlvo.n).toBe(1);
    expect(r.doAlvo.competencia).toMatch(/^\d{4}-\d{2}$/);
    expect(r.conferencia.fatos).toBeGreaterThan(0);
    expect(r.conferencia.lancamentos.primeira).toBeGreaterThan(0);
    expect(r.conferencia.lancamentos.segunda).toBe(r.conferencia.lancamentos.primeira);
    expect(r.conferencia.totais.segunda).toEqual(r.conferencia.totais.primeira);
    expect(r.conferencia).toMatchObject({ identico: true, parcial: false, diferentes: 0 });
    expect(await contagens()).toEqual(antes);
  }, 600_000);

  it('a linha alterada entre a leitura do lote e a gravação é relida no ciclo seguinte', async () => {
    const antes = await contagens();
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m54-intercalado' };
    const r = await nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const mesma = <X>(fn: (x: typeof e0) => Promise<X>) => fn(e0);
      const acesso = acessoCicloFatos(mesma, mesma, { rede: nucleo.rede, hospital: cod });
      const id = await prepararTitulo(e0, 30);
      // O outro sistema grava o título logo depois de o lote ser lido e antes da gravação dos fatos.
      let intercalou = false;
      const intercalado: typeof acesso = {
        ...acesso,
        lerNovos: async (tabela, acimaDe, lote) => {
          const linhas = await acesso.lerNovos(tabela, acimaDe, lote);
          if (!intercalou && linhas.some((x) => x.id === id)) {
            intercalou = true;
            await e0.executar('UPDATE MFCONPAG SET VALOR = VALOR + 1 WHERE ID = ?', [id]);
          }
          return linhas;
        },
      };
      const primeiro = await cicloDaFonte(intercalado, T, C);
      const depoisDoPrimeiro = await fatosDoTitulo(e0, id);
      const segundo = await cicloDaFonte(acesso, T, C);
      const depoisDoSegundo = await fatosDoTitulo(e0, id);
      const terceiro = await cicloDaFonte(acesso, T, C);
      const depoisDoTerceiro = await fatosDoTitulo(e0, id);
      return { intercalou, primeiro, segundo, terceiro, depoisDoPrimeiro, depoisDoSegundo, depoisDoTerceiro };
    });
    console.log(
      `[${cod}] intercalado: 1º gravados ${pouco(r.primeiro.gravados)} (fatos do título ${r.depoisDoPrimeiro.n}); ` +
        `2º alterados ${pouco(r.segundo.lidosAlterados)}, estornos ${pouco(r.segundo.estornos)} ` +
        `(fatos do título ${r.depoisDoSegundo.n})`,
    );
    expect(r.intercalou).toBe(true);
    // O primeiro ciclo grava o fato com o valor que leu; a alteração intercalada não se perde: o seguinte a relê.
    expect(r.depoisDoPrimeiro.n).toBeGreaterThanOrEqual(1);
    expect(r.depoisDoSegundo).toMatchObject({ n: 3, estornos: 1 });
    expect(r.depoisDoTerceiro).toMatchObject({ n: 3, estornos: 1 });
    expect(await contagens()).toEqual(antes);
  }, 600_000);
});
