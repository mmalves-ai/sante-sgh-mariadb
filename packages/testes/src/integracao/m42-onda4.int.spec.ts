// Onda 4 sobre a cópia (ficha do M42, campos 4, 8 e 10), sob a trava da cópia:
//   - leituras do acompanhamento da competência no schema real (READ ONLY): contas por convênio e situação com as
//     fechadas pelo novo, lotes e protocolos, títulos e movimento do mês, repasse do mês, gravações do novo pela trilha
//     e quem ainda usa o outro sistema por grupo; as parcelas somam o total; só agregados (nenhum nome); tempos;
//   - regra 2 ("a conta é uma só"): uma conta lançada pelo outro sistema (emitida, com os itens do banco) é fechada
//     pelo novo (executor, receita do M30) numa transação desfeita, e a leitura do acompanhamento, na mesma transação,
//     passa a contá-la como fechada pelo novo (a trilha do novo casa com o dia e o usuário do fechamento); a conferência
//     com o retrato informado igual dá 0 diferença e com o valor trocado acusa; depois do ROLLBACK, tudo como antes,
//     contado como no teste do M30: a conta, os itens, o operador em TBUSERS, as linhas dele na SGH_TRILHA, as tabelas
//     SGH_ do fechamento e COUNT(*) da FCCTAEXT;
//   - volume (D-IDX-42): a trilha da cópia tem poucas linhas, então uma trilha SINTÉTICA no volume de produção é semeada
//     na transação desfeita (IDs negativos fora do gerador; o fechamento de toda conta fechada da competência de
//     referência, no dia e pelo usuário do fechamento, e 40 registros de outras operações do mesmo usuário no mesmo dia)
//     e as leituras pela coluna DIA do índice são medidas contra as antigas (tabela derivada e faixa de DATA_HORA), com o
//     mesmo resultado. Nada do semeado é lido para fora: só contagens e tempos.
// Massa: as contas da cópia (só IDs) e o operador sintético. Saída só com contagens e códigos.
import {
  contasDaCompetencia,
  gravacoesDoNovoNoMes,
  lotesDaCompetencia,
  operacao,
  repasseDoMes,
  titulosDoMes,
  usoDoOutroSistemaPorGrupo,
  versaoDaLinhaFaturamento,
} from '@sgh/legado';
import { GRUPOS_ONDA_4, operacoesDaOnda4 } from '@sgh/contratos';
import { diferencasDaCompetencia, resumirContasDaCompetencia } from '@sgh/contratos/regras-faturamento';
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

/** A conta emitida e consistente que o fechamento aceita (o mesmo critério do teste do M30), lançada pelo outro sistema. */
const SQL_EMITIDA = `SELECT FIRST 1 c.ID, c.CON, c.ANOPRO, c.MESPRO FROM FCCTAEXT c
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

const COMPETENCIA_REFERENCIA = { ano: 2026, mes: 4 };

describe.skipIf(!PODE_ESCREVER)('M42: acompanhamento da competência e a conta única na cópia', () => {
  let a: Ambiente;
  let conta = { id: 0, convenio: 0, ano: 0, mes: 0 };
  beforeAll(async () => {
    a = await prepararAmbiente();
    await a.nucleo.lerSomente(ctx(a), async (l) => {
      const [c] = await l.consultar(SQL_EMITIDA, [], { teto: 1, tempoMaximoMs: 120_000 });
      conta = {
        id: num(c?.['ID']),
        convenio: num(c?.['CON']),
        ano: num(c?.['ANOPRO']),
        mes: num(c?.['MESPRO']),
      };
    });
    expect(conta.id).toBeGreaterThan(0);
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('leituras no schema real (READ ONLY): parcelas que somam, só agregados, dentro do tempo', async () => {
    const { ano, mes } = COMPETENCIA_REFERENCIA;
    const tempos: Record<string, number> = {};
    const medir = async <T>(nome: string, f: () => Promise<T>): Promise<T> => {
      const t0 = performance.now();
      const r = await f();
      tempos[nome] = Math.round(performance.now() - t0);
      return r;
    };
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const filtro = { ano, mes, convenio: null, convenios: null };
      return {
        contas: await medir('contas', () => contasDaCompetencia(l, filtro)),
        lotes: await medir('lotes', () => lotesDaCompetencia(l, filtro)),
        titulos: await medir('titulos', () => titulosDoMes(l, ano, mes)),
        repasse: await medir('repasse', () => repasseDoMes(l, ano, mes)),
        gravacoes: await medir('gravacoes', () => gravacoesDoNovoNoMes(l, operacoesDaOnda4(), ano, mes)),
        uso: await medir('uso', () => usoDoOutroSistemaPorGrupo(l, [...GRUPOS_ONDA_4], `${ano}-0${mes}-01`)),
      };
    });
    const resumo = resumirContasDaCompetencia(r.contas);
    expect(resumo.contas).toBeGreaterThan(0);
    expect(resumo.porSituacao.reduce((t, p) => t + p.contas, 0)).toBe(resumo.contas);
    expect(resumo.fechadasPeloNovo + resumo.fechadasPeloOutro).toBe(resumo.fechadas);
    expect(r.lotes.comProtocolo).toBeLessThanOrEqual(r.lotes.lotes);
    expect(r.lotes.conveniosFechados).toBeLessThanOrEqual(r.lotes.conveniosComConta + 50);
    expect(r.titulos.movimento.reduce((t, m) => t + m.lancamentos, 0)).toBeGreaterThan(0);
    expect(r.gravacoes.map((g) => g.operacao)).toEqual(operacoesDaOnda4());
    expect(r.uso.map((u) => u.grupo)).toEqual([...GRUPOS_ONDA_4]);
    // Só números e códigos: nenhuma chave com texto de pessoa.
    for (const linha of r.contas)
      expect(Object.keys(linha).sort()).toEqual([
        'contas',
        'convenio',
        'fechadasPeloNovo',
        'situacao',
        'valor',
      ]);
    for (const t of Object.values(tempos)) expect(t).toBeLessThan(30_000);
    process.stderr.write(
      `[m42] competência ${ano}-${String(mes).padStart(2, '0')}: ${resumo.contas} contas = ${resumo.porSituacao
        .map((p) => `${p.contas} ${p.situacao}`)
        .join(
          ' + ',
        )}; fechadas ${resumo.fechadas} = ${resumo.fechadasPeloNovo} novo + ${resumo.fechadasPeloOutro} outro; lotes ${r.lotes.lotes} = ${r.lotes.comProtocolo} + ${r.lotes.lotes - r.lotes.comProtocolo}; movimento ${r.titulos.movimento.length} tipos; tempos ${JSON.stringify(tempos)}\n`,
    );
  });

  /**
   * O retrato que o ROLLBACK tem de deixar igual (o do teste do M30): a conta, a soma e a contagem dos itens, as tabelas
   * SGH_ do fechamento da conta, COUNT(*) da FCCTAEXT, o operador sintético em TBUSERS e as linhas dele na SGH_TRILHA,
   * e o acompanhamento da competência. Só contagens.
   */
  const retrato = (login: string, filtro: Parameters<typeof contasDaCompetencia>[1]) =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const [c] = await l.consultar(
        'SELECT FECHADA, USU_FEC, DATA_FEC, DATA_HORA_ULTIMA_ATUALIZACAO V FROM FCCTAEXT WHERE ID = ?',
        [conta.id],
        { teto: 1 },
      );
      const [i] = await l.consultar(
        'SELECT COUNT(*) N, COALESCE(SUM(VALOR_C), 0) S FROM FCLANEXT WHERE ID_FCCTAEXT = ?',
        [conta.id],
        { teto: 1 },
      );
      const [r] = await l.consultar(
        `SELECT (SELECT COUNT(*) FROM SGH_FAT_CONTA_ETAPA WHERE ID_FCCTAEXT = ?) E,
           (SELECT COUNT(*) FROM SGH_FAT_PENDENCIA WHERE ID_FCCTAEXT = ?) P,
           (SELECT COUNT(*) FROM FCCTAEXT) C,
           (SELECT COUNT(*) FROM TBUSERS WHERE NOME IN (?, ?)) U,
           (SELECT COUNT(*) FROM SGH_TRILHA WHERE HOSPITAL = ? AND USUARIO = ? AND DIA >= CURRENT_DATE - 1) T
         FROM RDB$DATABASE`,
        [conta.id, conta.id, login.toUpperCase(), login.toLowerCase(), a.cod, login],
        { teto: 1 },
      );
      return {
        fechada: String(c?.['FECHADA']).trim(),
        usuarioFechamento: c?.['USU_FEC'] === null || c?.['USU_FEC'] === undefined ? null : 'preenchido',
        dataFechamento: String(c?.['DATA_FEC'] ?? ''),
        versao: String(c?.['V']),
        itens: num(i?.['N']),
        somaItens: Number(i?.['S'] ?? 0),
        etapas: num(r?.['E']),
        pendencias: num(r?.['P']),
        contas: num(r?.['C']),
        operador: num(r?.['U']),
        trilhaDoOperador: num(r?.['T']),
        linhas: await contasDaCompetencia(l, filtro),
      };
    });

  it('regra 2: a conta lançada pelo outro sistema, fechada pelo novo, passa a contar como do novo; ROLLBACK deixa tudo igual', async () => {
    const filtro = { ano: conta.ano, mes: conta.mes, convenio: conta.convenio, convenios: null };
    // O login do operador é escolhido antes da transação, para ser contado nos dois retratos.
    const login = (
      await a.nucleo.lerSomente(ctx(a), (l) => loginLivre(l, Date.now() % 1_000_000_000))
    ).toUpperCase();
    const antes = await retrato(login, filtro);
    expect(antes.fechada).toBe('N');
    expect(antes.operador).toBe(0);
    expect(antes.trilhaDoOperador).toBe(0);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      const n0 = resumirContasDaCompetencia(await contasDaCompetencia(e, filtro));
      const [v] = await e.consultar(
        'SELECT DATA_HORA_ULTIMA_ATUALIZACAO C FROM FCCTAEXT WHERE ID = ?',
        [conta.id],
        {
          teto: 1,
        },
      );
      await a.executor.executar(
        operacao('faturamento.fecharConta'),
        a.cod,
        { conta: conta.id, versao: versaoDaLinhaFaturamento(v?.['C'] ?? null) },
        ctxOperacao(a, login),
        { escritor: e },
      );
      const linhas = await contasDaCompetencia(e, filtro);
      const n1 = resumirContasDaCompetencia(linhas);
      const hoje = new Date();
      const grav = await gravacoesDoNovoNoMes(
        e,
        ['faturamento.fecharConta'],
        hoje.getFullYear(),
        hoje.getMonth() + 1,
      );
      // Dentro da transação a operação gravou: o operador e as linhas dele na trilha existem (o retrato as conta).
      const [dentro] = await e.consultar(
        `SELECT (SELECT COUNT(*) FROM TBUSERS WHERE NOME IN (?, ?)) U,
           (SELECT COUNT(*) FROM SGH_TRILHA WHERE HOSPITAL = ? AND USUARIO = ? AND DIA >= CURRENT_DATE - 1) T
         FROM RDB$DATABASE`,
        [login.toUpperCase(), login.toLowerCase(), a.cod, login],
        { teto: 1 },
      );
      // A conferência com o outro sistema: o retrato informado igual ao lido → 0 diferença; um valor trocado → 1.
      const retratoNovo = n1.porConvenio.map((c) => ({
        chave: `convenio ${c.convenio}`,
        valores: { contas: c.contas, fechadas: c.fechadas, valor: c.valor },
      }));
      const iguais = diferencasDaCompetencia(
        retratoNovo,
        retratoNovo.map((x) => ({ ...x })),
      );
      const trocado = diferencasDaCompetencia(
        retratoNovo,
        retratoNovo.map((x) => ({ ...x, valores: { ...x.valores, valor: Number(x.valores.valor) + 1 } })),
      );
      return {
        n0,
        n1,
        grav: grav[0]?.peloNovo ?? 0,
        iguais: iguais.length,
        trocado: trocado.length,
        operadorDentro: num(dentro?.['U']),
        trilhaDentro: num(dentro?.['T']),
      };
    });
    expect(r.n1.fechadasPeloNovo).toBe(r.n0.fechadasPeloNovo + 1);
    expect(r.n1.fechadas).toBe(r.n0.fechadas + 1);
    expect(r.n1.contas).toBe(r.n0.contas);
    expect(r.grav).toBeGreaterThanOrEqual(1);
    expect(r.iguais).toBe(0);
    expect(r.trocado).toBe(1);
    expect(r.operadorDentro).toBe(1);
    expect(r.trilhaDentro).toBeGreaterThanOrEqual(1);
    const depois = await retrato(login, filtro);
    expect(depois).toEqual(antes);
    process.stderr.write(
      `[m42] conta única: fechadas pelo novo ${r.n0.fechadasPeloNovo} → ${r.n1.fechadasPeloNovo} (convênio da conta, competência ${conta.ano}-${conta.mes}); conferência 0 e 1 diferença; na transação: operador ${r.operadorDentro}, ${r.trilhaDentro} linhas dele na trilha; depois do ROLLBACK: conta, ${antes.itens} itens, etapas ${antes.etapas}, pendências ${antes.pendencias}, FCCTAEXT ${antes.contas}, operador ${depois.operador}, trilha dele ${depois.trilhaDoOperador}: tudo igual\n`,
    );
  });

  it('volume (D-IDX-42): sobre uma trilha sintética no volume de produção, as leituras pelo índice do dia conferem com as antigas e ficam no tempo', async () => {
    const { ano, mes } = COMPETENCIA_REFERENCIA;
    const filtro = { ano, mes, convenio: null, convenios: null };
    const RUIDO = 40;
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const [antes] = await e.consultar('SELECT COUNT(*) N FROM SGH_TRILHA WHERE HOSPITAL = ?', [a.cod], {
        teto: 1,
      });
      // O fechamento pelo novo de toda conta fechada da competência (no dia e pelo usuário do fechamento) e o ruído
      // do mesmo usuário no mesmo dia (outras operações): nada é lido para fora do banco.
      await e.executar(
        `EXECUTE BLOCK AS
           DECLARE i BIGINT = 0; DECLARE j INTEGER; DECLARE id BIGINT; DECLARE u VARCHAR(31); DECLARE d DATE;
         BEGIN
           FOR SELECT c.ID, c.USU_FEC, CAST(c.DATA_FEC AS DATE) FROM FCCTAEXT c
                WHERE c.ANOPRO = ${ano} AND c.MESPRO = ${mes} AND c.FECHADA IN ('S', 'A')
                  AND c.USU_FEC IS NOT NULL AND c.DATA_FEC IS NOT NULL
               INTO :id, :u, :d DO
           BEGIN
             j = 0;
             WHILE (j <= ${RUIDO}) DO BEGIN
               INSERT INTO SGH_TRILHA (ID, DATA_HORA, REDE, HOSPITAL, USUARIO, EVENTO, RECURSO, OPERACAO, TABELA_ALVO,
                                       ID_ALVO, RESULTADO, CORRELACAO, HASH_ANTERIOR, HASH_LINHA, DIA)
               VALUES (-8000000000 - :i, CAST(:d AS TIMESTAMP), 'sgh', '${a.cod}', :u, 'sgh.m42.volume', 'faturamento',
                       IIF(:j = 0, 'faturamento.fecharConta', IIF(MOD(:j, 2) = 0, 'acesso.prontuario', 'faturamento.lancarItem')),
                       IIF(:j = 0, 'FCCTAEXT', 'RICADPAC'), IIF(:j = 0, CAST(:id AS VARCHAR(40)), CAST(:j AS VARCHAR(40))),
                       'sucesso', 'm42-volume', 'A42' || LPAD(:i, 61, '0'), 'B42' || LPAD(:i, 61, '0'), :d);
               i = i + 1;
               j = j + 1;
             END
           END
         END`,
      );
      const [depois] = await e.consultar('SELECT COUNT(*) N FROM SGH_TRILHA WHERE HOSPITAL = ?', [a.cod], {
        teto: 1,
      });
      const tempo = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
        const t0 = performance.now();
        const x = await f();
        return [x, Math.round(performance.now() - t0)];
      };
      const [novo, msNovo] = await tempo(() => contasDaCompetencia(e, filtro));
      // A leitura antiga (tabela derivada sobre a trilha inteira do estabelecimento), só para comparar.
      const [antiga, msAntiga] = await tempo(() =>
        e.consultar(
          `SELECT c.CON, c.FECHADA, COUNT(*) N, SUM(CASE WHEN t.ID_ALVO IS NULL THEN 0 ELSE 1 END) NOVO
             FROM FCCTAEXT c
             LEFT JOIN (SELECT DISTINCT ID_ALVO, USUARIO, CAST(DATA_HORA AS DATE) DIA FROM SGH_TRILHA
                         WHERE HOSPITAL = ? AND OPERACAO = 'faturamento.fecharConta' AND TABELA_ALVO = 'FCCTAEXT'
                           AND RESULTADO = 'sucesso') t
               ON t.ID_ALVO = CAST(c.ID AS VARCHAR(40)) AND t.DIA = CAST(c.DATA_FEC AS DATE) AND t.USUARIO = c.USU_FEC
            WHERE c.ANOPRO = ? AND c.MESPRO = ?
            GROUP BY c.CON, c.FECHADA`,
          [a.cod, ano, mes],
          { teto: 2000, tempoMaximoMs: 120_000 },
        ),
      );
      const [grav, msGrav] = await tempo(() => gravacoesDoNovoNoMes(e, operacoesDaOnda4(), ano, mes));
      const [gravAntiga, msGravAntiga] = await tempo(() =>
        e.consultar(
          `SELECT COUNT(*) N FROM SGH_TRILHA t
            WHERE t.HOSPITAL = ? AND t.RESULTADO = 'sucesso' AND t.DATA_HORA >= ? AND t.DATA_HORA < ?
              AND t.OPERACAO = 'faturamento.fecharConta'`,
          [a.cod, new Date(`${ano}-0${mes}-01T00:00:00`), new Date(`${ano}-0${mes + 1}-01T00:00:00`)],
          { teto: 1, tempoMaximoMs: 120_000 },
        ),
      );
      return {
        semeadas: num(depois?.['N']) - num(antes?.['N']),
        novo: resumirContasDaCompetencia(novo),
        antigaNovo: antiga.reduce((t, x) => t + num(x['NOVO']), 0),
        msNovo,
        msAntiga,
        gravNovo: grav.find((g) => g.operacao === 'faturamento.fecharConta')?.peloNovo ?? 0,
        gravAntiga: num(gravAntiga[0]?.['N']),
        msGrav,
        msGravAntiga,
      };
    });
    // Toda conta fechada da competência passa a contar como do novo, nas duas leituras.
    const fechamentos = r.semeadas / (RUIDO + 1);
    expect(Number.isInteger(fechamentos)).toBe(true);
    expect(fechamentos).toBeGreaterThan(0);
    expect(r.novo.fechadasPeloNovo).toBeGreaterThanOrEqual(fechamentos);
    expect(r.antigaNovo).toBe(r.novo.fechadasPeloNovo);
    expect(r.gravNovo).toBeGreaterThanOrEqual(r.gravAntiga);
    expect(r.msNovo).toBeLessThan(20_000);
    expect(r.msGrav).toBeLessThan(20_000);
    process.stderr.write(
      `[m42] volume: ${r.semeadas} linhas sintéticas na trilha (${r.novo.fechadas} fechamentos + ${RUIDO} de ruído cada); contas pelo índice ${r.msNovo} ms × antiga ${r.msAntiga} ms (fechadas pelo novo ${r.novo.fechadasPeloNovo} = ${r.antigaNovo}); gravações do mês pelo DIA ${r.msGrav} ms × por DATA_HORA ${r.msGravAntiga} ms (fecharConta ${r.gravNovo} × ${r.gravAntiga}); desfeito\n`,
    );
    const resto = await a.nucleo.lerSomente(ctx(a), (l) =>
      l.consultar('SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID <= -8000000000', [], { teto: 1 }),
    );
    expect(num(resto[0]?.['N'])).toBe(0);
  }, 900_000);
});
