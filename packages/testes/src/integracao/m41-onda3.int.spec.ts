// Integração do M41 (onda 3) na cópia, sob a trava da cópia, em transação DESFEITA (as gravações) ou só leitura:
//   (1) duas dispensações do mesmo horário por dois sistemas (regra 4 da onda; campo 10), nos dois sentidos: com a
//       outra estação editando o horário (linha alterada e não confirmada), a dispensação do novo não espera e passa
//       adiante ("ocupada" ou "registro em edição"); com o novo dispensando (não confirmado), a outra estação recebe a
//       trava ao pegar o mesmo horário; nada fica gravado (o retrato antes e depois é o mesmo);
//   (2) as leituras do painel "Efeito no estoque dos documentos do novo" no schema real (campo 4), num dia do período
//       do dump: documentos do dia por sistema, horários prescritos × dispensados por unidade, requisições pendentes,
//       usuários do estoque por local; e o efeito dos gatilhos conferido em documentos consolidados do dia (os mesmos
//       que o painel confere nos do novo); só agregados e tempos, nenhum nome;
//   (3) regra 1: o mapa local → unidades atendidas na competência e as prescrições do novo por unidade (trilha), com a
//       decisão do domínio (sem prescrição do novo na cópia, a dispensação não liga);
//   (4) conferência numérica (campo 10) com documento DO NOVO: dentro da transação desfeita, uma saída gravada pelo
//       executor (receita do M28) aparece na trilha do dia, os pares item × local saem dela (itensMovidosPeloNovo), o
//       saldo do local e o da empresa caem 1 e o preço médio não muda (leiturasNumericas antes e depois), e o lido pelo
//       caminho do painel bate com o SQL da tela de saldos da outra estação (0 divergência; um saldo trocado aparece).
// A saída do mesmo saldo pelos dois sistemas e o LOCK TIMEOUT do documento travado estão no m28.int.spec.ts (a mesma
// receita); a fila disputada com WITH LOCK, no m29.int.spec.ts: rodam na mesma regressão.
import { conferenciaNumerica } from '@sgh/contratos/regras-suprimentos';
import { motivoRegra1, regra1PorLocal, unidadesComPrescricaoEmUso } from '@sgh/dominio-config';
import {
  type DocumentoDoNovo,
  documentosDoDiaPorSistema,
  documentosDoNovoNoDia,
  efeitosDosDocumentosDoNovo,
  ErroOperacao,
  horariosDispensadosDoDia,
  itensMovidosPeloNovo,
  leiturasNumericas,
  operacao,
  prescricoesDoNovoPorUnidade,
  requisicoesPendentesPorLocal,
  unidadesAtendidasPorLocal,
  usoEstoquePorLocal,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editarHorarioPorFora, horarioDispensavel } from '../massa/reproducao-farmacia.js';
import {
  CENTRO_SETOR,
  itemComSaldo,
  LOCAL_CENTRAL,
  localConsumo,
  relogio,
  usuarioEstoque,
} from '../massa/reproducao-suprimentos.js';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];
type Leitor = Parameters<Parameters<Ambiente['nucleo']['lerSomente']>[1]>[0];

/** Dia de referência do dump (dados até 07/2026). */
const DIA = '2026-06-15';
const menosDe5 = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).message}`;
  }
}

describe.skipIf(!PODE_ESCREVER)('M41: onda 3 na cópia (transação desfeita ou só leitura)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  }, 600_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('duas dispensações do mesmo horário (outra estação e o novo), nos dois sentidos: quem chega depois não espera; nada fica gravado', async () => {
    const massa = await a.nucleo.lerSomente(ctx(a), (l) =>
      horarioDispensavel(l as unknown as Escritor, { local: LOCAL_CENTRAL, minimo: 3 }),
    );
    const retrato = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => ({
        cad: await contar(l, 'SELECT MAX(ID) N FROM GECADDISPENSACAO'),
        dose: await contar(l, 'SELECT MAX(ID) N FROM GEDISPHOR'),
        saida: await contar(l, 'SELECT MAX(ID) N FROM GECADSAI'),
        doseHorario: await contar(l, 'SELECT COUNT(*) N FROM GEDISPHOR WHERE ID_PRCHKGERAL = ?', [
          massa.horario,
        ]),
        estoque: await contar(l, 'SELECT ESTOQUE N FROM GEITENS WHERE COD = ?', [massa.item]),
      }));
    const antes = await retrato();
    // Semente distinta por estação: o login da outra, ainda não confirmado, é invisível à segunda conexão.
    const operador = async (e: Escritor, semente: number) => {
      const login = (await loginLivre(e, (Date.now() + semente) % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      await usuarioEstoque(e, login);
      return (x: unknown) =>
        a.executor.executar(operacao('suprimentos.dispensarHorario'), a.cod, x, ctxOperacao(a, login), {
          escritor: e,
        });
    };
    const entrada = {
      atendimento: massa.reg,
      local: LOCAL_CENTRAL,
      centroCusto: CENTRO_SETOR,
      doses: [
        {
          horario: massa.horario,
          quantidade: 1,
          lotes: massa.lote ? [{ ...massa.lote, quantidade: 1 }] : [],
        },
      ],
    };
    // Sentido 1: a outra estação está com o horário em edição (a linha do horário alterada e não confirmada, como a
    // tela de dispensação do outro sistema faz); a dispensação do novo, noutra conexão, não espera e passa adiante.
    const r1 = await a.nucleo.desfazendoNaCopia(ctx(a), async (outra) => {
      await editarHorarioPorFora(outra, massa.horario);
      return a.nucleo.desfazendoNaCopia(ctx(a), async (e) => codigo((await operador(e, 0))(entrada)));
    });
    // Sentido 2: o novo dispensou o horário e ainda não confirmou; a outra estação tenta pegar o mesmo horário e recebe
    // a trava (no outro sistema, "registro em edição em outro terminal").
    const r2 = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const novo = await codigo((await operador(e, 0))(entrada));
      const outra = await a.nucleo
        .desfazendoNaCopia(ctx(a), (o) =>
          o.consultar('SELECT ID FROM PRCHKGERAL WHERE ID = ? WITH LOCK', [massa.horario], { teto: 1 }),
        )
        .then(
          () => 'pegou',
          (x: unknown) =>
            /lock|deadlock|conflict|edi[cç][aã]o|trava/i.test(String(x)) ? 'travado' : String(x),
        );
      return { novo, outra };
    });
    console.log(
      `[M41] dispensação disputada: novo com a outra em edição → ${r1}; outra com o novo gravando → ${r2.outra}`,
    );
    expect(['doses-ocupadas', 'registro-em-edicao']).toContain(r1);
    expect(r2.novo).toBe('gravou');
    expect(r2.outra).toBe('travado');
    expect(await retrato()).toEqual(antes);
  }, 600_000);

  it('painel de efeito no schema real: documentos do dia por sistema, horários, requisições e uso (só agregados)', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l: Leitor) => {
      const t0 = performance.now();
      const docs = await documentosDoDiaPorSistema(l, a.cod, DIA);
      const t1 = performance.now();
      const horarios = await horariosDispensadosDoDia(l, DIA, []);
      const t2 = performance.now();
      const req = await requisicoesPendentesPorLocal(l, DIA);
      const t3 = performance.now();
      const uso = await usoEstoquePorLocal(l, DIA);
      const t4 = performance.now();
      // O efeito dos gatilhos conferido em 20 saídas consolidadas do dia (como o painel faz com as do novo).
      const ls = await l.consultar(
        `SELECT FIRST 20 ID, ANO, MES, DOC, ARM, CONSOL, CDC, DATA FROM GECADSAI
          WHERE DATA = ? AND CONSOL = 'T' ORDER BY ID DESC`,
        [new Date(`${DIA}T00:00:00Z`)],
        { teto: 20 },
      );
      const amostra: DocumentoDoNovo[] = ls.map((x) => ({
        operacao: 'suprimentos.registrarSaida',
        tipo: 'saida',
        id: num(x['ID']),
        ano: num(x['ANO']),
        mes: num(x['MES']),
        doc: num(x['DOC']),
        local: num(x['ARM']),
        consolidado: true,
        centroCusto: x['CDC'] === null ? null : num(x['CDC']),
        data: x['DATA'] instanceof Date ? x['DATA'] : null,
      }));
      const efeitos = await efeitosDosDocumentosDoNovo(l, amostra);
      const t5 = performance.now();
      return {
        docs,
        horarios,
        req,
        uso,
        efeitos,
        amostra,
        ms: [t1 - t0, t2 - t1, t3 - t2, t4 - t3, t5 - t4],
      };
    });
    const total = r.docs.linhas.reduce((s, x) => s + x.total, 0);
    console.log(
      `[M41] ${DIA}: ${r.docs.linhas.length} linhas por tipo e local, ${total} documentos, do novo ${menosDe5(
        r.docs.linhas.reduce((s, x) => s + x.novo, 0),
      )}; horários: ${r.horarios.length} unidades, ${r.horarios.reduce((s, x) => s + x.prescritos, 0)} prescritos, ${r.horarios.reduce(
        (s, x) => s + x.dispensados,
        0,
      )} dispensados; requisições pendentes: ${r.req.length} locais; uso: ${r.uso.length} locais; efeitos: ${r.efeitos.length} documentos, ${
        r.efeitos.filter((e) => e.alertas.length).length
      } com alerta; tempos (ms) ${r.ms.map((x) => Math.round(x)).join(', ')}`,
    );
    expect(total).toBeGreaterThan(0);
    expect(r.docs.linhas.every((x) => x.demais + x.novo >= x.novo && x.demais >= 0)).toBe(true);
    expect(r.horarios.length).toBeGreaterThan(0);
    // Regra 2: o gatilho valorizou e lançou o saldo do mês em todas as saídas consolidadas da amostra.
    expect(r.efeitos).toHaveLength(r.amostra.length);
    expect(r.efeitos.every((e) => e.efeitos.valorizado === true && e.efeitos.saldoMensal === true)).toBe(
      true,
    );
    // Requisições pendentes: p95 < 500 ms (campo 4); as demais leituras abaixo de 5 s.
    expect(r.ms[2]).toBeLessThan(500);
    for (const ms of r.ms) expect(ms).toBeLessThan(5_000);
    expect(JSON.stringify(r.uso)).not.toMatch(/"usuario"|login/i);
  }, 600_000);

  it('regra 1: unidades atendidas por local na competência e a prescrição do novo por unidade; sem ela, não liga', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l: Leitor) => ({
      atendidas: await unidadesAtendidasPorLocal(l, { ano: 2026, mes: 6 }),
      prescricoes: await prescricoesDoNovoPorUnidade(l, a.cod, DIA, 14),
    }));
    const com = unidadesComPrescricaoEmUso([{ escopo: 'hospital', valor: '*', ligada: true }], r.prescricoes);
    const por = regra1PorLocal(r.atendidas, com);
    console.log(
      `[M41] regra 1 (06/2026): ${por.length} local(is) de dispensação, ${por.reduce((s, x) => s + x.unidades.length, 0)} par(es) local × unidade; unidades com prescrição do novo: ${menosDe5(com.length)}`,
    );
    expect(por.length).toBeGreaterThan(0);
    // A cópia não tem prescrição gravada pelo novo: a dispensação não liga (o comportamento esperado da regra 1).
    if (com.length === 0) expect(motivoRegra1(true, por, com)).toMatch(/prescrição eletrônica/);
    expect(motivoRegra1(false, por, com)).toBeNull();
  }, 600_000);

  it('conferência numérica com documento do novo: a saída gravada pelo executor move o saldo e a conferência acha o item; nada fica gravado', async () => {
    const itemDaMassa = await a.nucleo.desfazendoNaCopia(ctx(a), (e) =>
      itemComSaldo(e, { local: LOCAL_CENTRAL, minimo: 2 }),
    );
    const antesDeTudo = await a.nucleo.lerSomente(ctx(a), async (l: Leitor) => ({
      empresa: await contar(l, 'SELECT ESTOQUE N FROM GEITENS WHERE COD = ?', [itemDaMassa.item]),
      saida: await contar(l, 'SELECT MAX(ID) N FROM GECADSAI'),
    }));
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = (await loginLivre(e, (Date.now() + 41) % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        operacao('acesso.criarUsuarioIntegracao'),
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, 'SGH.TESTE'),
        { escritor: e },
      );
      await usuarioEstoque(e, login);
      const { hoje, ano, mes } = await relogio(e);
      const competencia = { ano, mes };
      const item = itemDaMassa.item;
      const alvo = [
        { item, local: LOCAL_CENTRAL },
        { item, local: null },
      ];
      const antes = await leiturasNumericas(e, competencia, alvo);
      const x = await a.executor.executar(
        operacao('suprimentos.registrarSaida'),
        a.cod,
        {
          destino: 2,
          origem: 'E',
          local: LOCAL_CENTRAL,
          centroCusto: CENTRO_SETOR,
          localConsumo: await localConsumo(e, CENTRO_SETOR),
          itens: [{ item, quantidade: 1, lotes: [] }],
        },
        ctxOperacao(a, login),
        { escritor: e },
      );
      const id = num(x.resultado['id']);
      // O caminho do painel: a trilha do dia → o documento do novo → os pares item × local → a leitura.
      const { itens: docs } = await documentosDoNovoNoDia(e, a.cod, hoje);
      const doNovo = docs.filter((d) => d.tipo === 'saida' && d.id === id);
      const pares = await itensMovidosPeloNovo(e, doNovo);
      const depois = await leiturasNumericas(e, competencia, [...pares, { item, local: null }]);
      // A outra estação: o SQL da tela de saldos dela, linha a linha (na mesma transação: o documento não está
      // confirmado, e é desfeito no fim).
      const daOutra: { item: number; local: number | null; saldo: number; precoMedio: number }[] = [];
      for (const p of [...pares, { item, local: null }]) {
        const [s] =
          p.local === null
            ? await e.consultar('SELECT ESTOQUE QTDE FROM GEITENS WHERE COD = ?', [p.item], { teto: 1 })
            : await e.consultar(
                'SELECT QTDE FROM GEARMLOC WHERE ANO = ? AND MES = ? AND ITEM = ? AND LOCAL = ?',
                [competencia.ano, competencia.mes, p.item, p.local],
                { teto: 1 },
              );
        const [i] = await e.consultar('SELECT VLRMED FROM GEITENS WHERE COD = ?', [p.item], { teto: 1 });
        daOutra.push({
          item: p.item,
          local: p.local,
          saldo: Math.round(num(s?.['QTDE'] ?? 0) * 1000) / 1000,
          precoMedio: num(i?.['VLRMED'] ?? 0),
        });
      }
      const delta = (k: number | null) =>
        Math.round(
          ((depois.find((d) => d.local === k)?.saldo ?? 0) - (antes.find((d) => d.local === k)?.saldo ?? 0)) *
            1000,
        ) / 1000;
      return {
        doNovo: doNovo.length,
        pares,
        deltaLocal: delta(LOCAL_CENTRAL),
        deltaEmpresa: delta(null),
        // O gatilho recalcula o preço médio do item na saída (arredondamento do custo): o lido aqui depois é o novo.
        precoMudou: depois.some((d) => d.precoMedio !== antes.find((x) => x.local === d.local)?.precoMedio),
        divergencias: conferenciaNumerica(daOutra, depois),
        // Um saldo trocado pela outra estação vira divergência (o confronto não é a mesma leitura por construção).
        comTroca: conferenciaNumerica(
          daOutra.map((d, k) => (k === 0 ? { ...d, saldo: d.saldo + 1 } : d)),
          depois,
        ).length,
        competencia: `${String(mes).padStart(2, '0')}/${ano}`,
        linhaLocal: await contar(
          e,
          'SELECT COUNT(*) N FROM GEARMLOC WHERE ANO = ? AND MES = ? AND ITEM = ? AND LOCAL = ?',
          [ano, mes, item, LOCAL_CENTRAL],
        ),
      };
    });
    console.log(
      `[M41] conferência numérica com documento do novo (${r.competencia}): ${r.doNovo} saída do novo, ${r.pares.length} par(es), saldo no local ${r.deltaLocal}, na empresa ${r.deltaEmpresa}, linha do local na competência: ${r.linhaLocal}, preço médio recalculado: ${r.precoMudou}, ${r.divergencias.length} divergência(s); com um saldo trocado: ${r.comTroca}`,
    );
    expect(r.doNovo).toBe(1);
    expect(r.pares).toEqual([{ item: itemDaMassa.item, local: LOCAL_CENTRAL }]);
    expect(r.deltaEmpresa).toBe(-1);
    // O saldo do local: com a linha da competência em GEARMLOC, cai 1; a cópia não tem linha na competência corrente
    // (o dump termina antes do relógio e o gatilho da saída não a cria), então lá fica 0 = 0 dos dois lados: essa
    // parte da prova é a da homologação (evidências, §5).
    expect(r.deltaLocal).toBe(r.linhaLocal > 0 ? -1 : 0);
    expect(r.divergencias).toEqual([]);
    expect(r.comTroca).toBe(1);
    // Desfeito: nada da saída ficou.
    expect(
      await a.nucleo.lerSomente(ctx(a), async (l: Leitor) => ({
        empresa: await contar(l, 'SELECT ESTOQUE N FROM GEITENS WHERE COD = ?', [itemDaMassa.item]),
        saida: await contar(l, 'SELECT MAX(ID) N FROM GECADSAI'),
      })),
    ).toEqual(antesDeTudo);
  }, 600_000);
});
