// Etapa 3 do M45 sobre a cópia (ficha, seções 4, 5, 6 e 10; regra 6: "balanço com checagem reenviada offline"), sempre
// em transação desfeita e sob a trava:
//   - um horário "Administrado" EV de verdade da cópia (só o ID, em memória) recebe dois registros do novo do mesmo ato
//     (a checagem reenviada sem rede) e um evento de infusão com o volume: a leitura dos ganhos para o balanço traz o
//     horário UMA vez, com a hora real do primeiro ato e o volume infundido, e o domínio faz dele um ganho só;
//   - o fechamento de 24 horas grava o ganho da checagem e a diurese dos sinais (uma vez cada) e as parcelas; o segundo
//     fechamento e a segunda gravação da mesma origem são recusados (no código e na chave única do banco); o saldo
//     errado é recusado pelo CHECK; o monitoramento da transação mostra só tabelas SGH_ (0 tabela legada);
//   - os domínios do balanço lidos da cópia (os 4 grupos, os 6 tipos de eliminação com o que cada um pede);
//   - a entrada do atendimento lida da cópia (o limite do "de antes da internação");
//   - duas gravações ao mesmo tempo na mesma janela (outra conexão, sem espera): a segunda recusa pela trava da janela
//     (0456); noutra janela, grava;
//   - o ROLLBACK conferido pelas contagens das tabelas SGH_ do teste (pelo usuário do teste) iguais antes e depois.
// Saída só com contagens, códigos e tempos (nenhum nome; volumes sintéticos).
import {
  calcularBalanco,
  comImpressao,
  formulaInsensivel,
  ganhosDaChecagem,
  janelaDoInstante,
  diureseDosSinais,
  parcelasDoBalanco,
  textoDoFechamento,
} from '@sgh/dominio-enfermagem';
import {
  checagensParaBalanco,
  dominiosDoBalanco,
  entradaDoAtendimento,
  gravarEventoInfusao,
  horarioAdministradoEvDeAmostra,
  provarRestricoesDoBalanco,
  registrarChecagemNoNovo,
  ErroOperacao,
  escritasDaTransacao,
  fechamentosDoBalanco,
  fecharBalancoSgh,
  lancamentosDoBalanco,
  lancarBalancoSgh,
  origensJaLancadas,
  sinaisParaBalanco,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const USUARIO = 'SGH.TESTE.M45';
const p2 = (n: number) => String(n).padStart(2, '0');
const texto = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo ?? 'sem-codigo';
    return (
      /SGH_UQ_PEP_BALANCO_ORIGEM|SGH_CK_PEP_BALANCO_FECH_SALDO/.exec(String((e as Error).message))?.[0] ??
      'outro'
    );
  }
}

describe.skipIf(!PODE_ESCREVER)('M45 etapa 3 na cópia (transação desfeita)', () => {
  let a: Ambiente;

  /** As linhas do usuário do teste nas tabelas SGH_ que o teste toca (só contagens). */
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const contar = async (tabela: string, coluna = 'USUARIO') =>
        Number(
          (
            await l.consultar(`SELECT COUNT(*) N FROM ${tabela} WHERE ${coluna} = ?`, [USUARIO], { teto: 1 })
          )[0]?.['N'] ?? 0,
        );
      return {
        balanco: await contar('SGH_PEP_BALANCO'),
        fechamentos: await contar('SGH_PEP_BALANCO_FECH'),
        travas: await contar('SGH_PEP_BALANCO_TRAVA', 'ATUALIZADO_POR'),
        checagens: await contar('SGH_PEP_CHECAGEM_EXT'),
        infusoes: await contar('SGH_PEP_INFUSAO_EVENTO'),
      };
    });

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('balanço com a checagem reenviada sem rede: o ganho entra uma vez só; o fechamento grava uma vez; só SGH_', async () => {
    const inicio = Date.now();
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e0) => {
      // Um horário administrado EV da cópia (só os IDs e a hora).
      const h = await horarioAdministradoEvDeAmostra(e0);
      if (!h) throw new Error('Nenhum horário administrado EV na cópia.');
      const { horario, atendimento } = h;
      const checado = texto(h.checadoEm);
      const janela = janelaDoInstante(checado, '0700');
      const e = somenteSgh(e0);
      // O mesmo ato duas vezes no registro do novo (a checagem reenviada sem rede) e o volume infundido.
      for (const k of [1, 2])
        await registrarChecagemNoNovo(
          e,
          { hospital: a.cod, usuarioLegado: USUARIO, idempotencyKey: `m45-3-offline-${k}` },
          {
            prescricao: 1,
            atendimento,
            paciente: 1,
            marcacoes: [{ horario, item: 1, situacao: 'A', quantidade: 1, papel: 'principal' }],
            sgh: {
              horaReal: checado,
              motivo: null,
              observacao: null,
              pulseiraLida: false,
              motivoSemPulseira: null,
              gtin: null,
              lote: null,
              validade: null,
              conferente: null,
              dispositivo: null,
              origemOffline: true,
              avisos: [],
            },
          } as never,
        );
      await gravarEventoInfusao(e, {
        hospital: a.cod,
        horario,
        solucao: null,
        paciente: 1,
        evento: 'fim',
        velocidadeMlH: null,
        volumeMl: 250,
        observacao: null,
        horaReal: checado,
        usuario: USUARIO,
      });
      const lidas = await checagensParaBalanco(e0, {
        hospital: a.cod,
        atendimento,
        de: janela.inicio,
        ate: janela.fim,
      });
      const doHorario = lidas.itens.filter((x) => x.horario === horario);
      const g = ganhosDaChecagem(lidas.itens, new Set(), janela);
      const pendente = g.pendentes.filter((p) => p.referencia === horario);
      const dominios = await dominiosDoBalanco(e0);
      const calc = await comImpressao(
        calcularBalanco({
          inicio: janela.inicio,
          ate: janela.fim,
          parcelas: parcelasDoBalanco([], [...pendente, ...diureseDosSinais([], new Set(), janela)]),
          pesoKg: 70,
          temperaturaMaxima: null,
          formula: formulaInsensivel('PI-2026.1'),
          dominios,
        }),
      );
      const f = {
        hospital: a.cod,
        paciente: 1,
        atendimento,
        unidade: 'SINT',
        horaCorte: '07:00',
        tipo: 'total' as const,
        inicio: janela.inicio,
        fim: janela.fim,
        lancamentosVistos: [],
        pendentes: pendente,
        ganhosMl: calc.ganhosMl,
        perdasMl: calc.perdasMl,
        insensiveisMl: calc.insensiveisMl,
        saldoMl: calc.saldoMl,
        diureseMl: calc.diureseMl,
        pesoKg: calc.pesoKg,
        temperaturaMaxima: null,
        debitoUrinario: calc.debitoUrinario,
        oliguria: calc.oliguria,
        formula: calc.formula,
        lancamentos: calc.lancamentos,
        parcelas: textoDoFechamento(calc),
        usuario: USUARIO,
      };
      const fech = await fecharBalancoSgh(e, f);
      const lancados = await lancamentosDoBalanco(e0, {
        hospital: a.cod,
        atendimento,
        de: janela.inicio,
        ate: janela.fim,
      });
      const origens = await origensJaLancadas(e0, { hospital: a.cod, horarios: [horario], sinais: [] });
      const depois = ganhosDaChecagem(
        (await checagensParaBalanco(e0, { hospital: a.cod, atendimento, de: janela.inicio, ate: janela.fim }))
          .itens,
        origens.horarios,
        janela,
      );
      // As recusas: o segundo de 24 horas, a mesma origem de novo (no código e na chave única) e o saldo errado.
      const segundo = await codigo(fecharBalancoSgh(e, { ...f, lancamentosVistos: fech.importados }));
      const outraParcial = await codigo(
        // O mesmo ganho da checagem num parcial de outro atendimento (sintético, sem fechamento): a origem é única.
        fecharBalancoSgh(e, {
          ...f,
          atendimento: 999_450_399,
          tipo: 'parcial',
          fim: janela.fim.replace(/T07:00$/, 'T06:00'),
          lancamentosVistos: [],
        }),
      );
      const prova = await provarRestricoesDoBalanco(e, {
        hospital: a.cod,
        atendimento,
        horario,
        usuario: USUARIO,
      });
      const chaveUnica = prova.origemRepetida;
      const saldoErrado = prova.saldoErrado;
      const fechamentos = await fechamentosDoBalanco(e0, a.cod, atendimento);
      const sinais = await sinaisParaBalanco(e0, {
        hospital: a.cod,
        paciente: 1,
        de: janela.inicio,
        ate: janela.fim,
      });
      const escritas = await escritasDaTransacao(e0);
      const entrada = await entradaDoAtendimento(e0, atendimento);
      return {
        entradaLida: entrada === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(entrada),
        entradaAntesDoAto: entrada === null || entrada <= checado,
        lidasDoHorario: doHorario.length,
        horaRealPrimeiroAto: doHorario[0]?.horaReal === checado,
        volumeInfundido: doHorario[0]?.volumeInfundidoMl,
        pendentes: pendente.map((p) => [p.origem, p.grupo, p.volumeMl]),
        importados: fech.importados.length,
        lancadosDaChecagem: lancados.itens.filter((l) => l.origem === 'checagem' && l.horario === horario)
          .length,
        pendenteDepois: depois.pendentes.filter((p) => p.referencia === horario).length,
        segundo,
        outraParcial,
        chaveUnica,
        saldoErrado,
        fechamento:
          fechamentos.find((x) => x.tipo === 'total' && x.inicio === janela.inicio)?.saldoMl === calc.saldoMl,
        dominios: [dominios.grupos.length, dominios.tiposEliminacao.length, dominios.intensidades.length],
        pedeIntensidade: dominios.tiposEliminacao.filter((t) => t.pedeIntensidade).map((t) => t.codigo),
        sinaisVazios: sinais.diurese.length === 0,
        tabelas: escritas.map((w) => w.tabela).sort(),
      };
    });
    const depois = await retrato();
    console.log(JSON.stringify({ ...r, antes, depois, ms: Date.now() - inicio }));
    expect(depois).toEqual(antes);
    expect(r).toMatchObject({
      entradaLida: true,
      entradaAntesDoAto: true,
      lidasDoHorario: 1,
      horaRealPrimeiroAto: true,
      volumeInfundido: 250,
      pendentes: [['checagem', 4, 250]],
      importados: 1,
      lancadosDaChecagem: 1,
      pendenteDepois: 0,
      segundo: 'ja-fechado',
      outraParcial: 'balanco-mudou',
      chaveUnica: 'SGH_UQ_PEP_BALANCO_ORIGEM',
      saldoErrado: 'SGH_CK_PEP_BALANCO_FECH_SALDO',
      fechamento: true,
      dominios: [4, 6, 4],
      pedeIntensidade: [3, 4],
      sinaisVazios: true,
    });
    expect(r.tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
    expect(r.tabelas).toEqual(
      expect.arrayContaining([
        'SGH_PEP_BALANCO',
        'SGH_PEP_BALANCO_FECH',
        'SGH_PEP_BALANCO_TRAVA',
        'SGH_PEP_CHECAGEM_EXT',
        'SGH_PEP_INFUSAO_EVENTO',
      ]),
    );
  });
  it('duas gravações ao mesmo tempo na mesma janela: a segunda recusa pela trava (sem espera); noutra janela, grava', async () => {
    const antes = await retrato();
    // Atendimento e janela sintéticos (nenhum paciente real): só a linha de trava e o lançamento, desfeitos.
    const atendimento = 999_450_398;
    const janela = { inicio: '2026-01-01T07:00', fim: '2026-01-02T07:00' };
    const vazio = {
      hospital: a.cod,
      paciente: 1,
      atendimento,
      unidade: 'SINT',
      horaCorte: '07:00',
      tipo: 'parcial' as const,
      lancamentosVistos: [],
      pendentes: [],
      ganhosMl: 0,
      perdasMl: 0,
      insensiveisMl: 0,
      saldoMl: 0,
      diureseMl: 0,
      pesoKg: null,
      temperaturaMaxima: null,
      debitoUrinario: null,
      oliguria: false,
      formula: 'PI-2026.1',
      lancamentos: 0,
      parcelas: 'prova',
      usuario: USUARIO,
    };
    const inicio = Date.now();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e1) => {
      const t1 = somenteSgh(e1);
      await lancarBalancoSgh(t1, {
        hospital: a.cod,
        paciente: 1,
        atendimento,
        sentido: 'ganho',
        grupo: 1,
        via: null,
        tipoEliminacao: null,
        intensidade: null,
        aspecto: null,
        estimado: false,
        volumeMl: 10,
        horaReal: '2026-01-01T10:00',
        descricao: null,
        origemOffline: false,
        usuario: USUARIO,
        chave: null,
        janelaInicio: janela.inicio,
      });
      // A outra transação (outra conexão, sem espera) tenta fechar a mesma janela enquanto o lançamento não confirmou.
      const t0 = Date.now();
      const mesma = await codigo(
        a.nucleo.desfazendoNaCopia(
          ctx(a),
          (e2) =>
            fecharBalancoSgh(somenteSgh(e2), { ...vazio, inicio: janela.inicio, fim: '2026-01-01T12:00' }),
          { semEspera: true },
        ),
      );
      const ms = Date.now() - t0;
      const outra = await codigo(
        a.nucleo.desfazendoNaCopia(
          ctx(a),
          (e2) =>
            fecharBalancoSgh(somenteSgh(e2), {
              ...vazio,
              inicio: '2026-01-02T07:00',
              fim: '2026-01-02T12:00',
            }),
          { semEspera: true },
        ),
      );
      return { mesma, menosDe5s: ms < 5_000, outra };
    });
    const depois = await retrato();
    console.log(JSON.stringify({ ...r, antes, depois, ms: Date.now() - inicio }));
    expect(r).toEqual({ mesma: 'balanco-em-uso', menosDe5s: true, outra: 'gravou' });
    expect(depois).toEqual(antes);
  });
});
