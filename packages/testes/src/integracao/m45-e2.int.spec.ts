// Etapa 2 do M45 sobre a cópia (ficha, seções 4, 5, 9 e 10; regras 1 a 5, 9 e 16), sempre em transação desfeita (ou só
// leitura) e sob a trava:
//   - a configuração dos índices de UTI lida da cópia é a do fixture (mesma impressão: 21 agrupamentos, 109 variáveis,
//     121 faixas, 30 itens de Glasgow) e o caso publicado do APACHE II dá 22 pontos e 45,2% com ela; a leitura simples
//     pela chave primária fica no tempo;
//   - as escalas em formulário do prontuário (Braden e Morse) de um paciente com registro: a contagem e o total gravado
//     lidos dentro do tempo-alvo (50 por paciente; p95 < 1 s) e a entrada e a alta das internações;
//   - o ciclo só SGH_ inteiro numa transação: a aferição com o NEWS2 e a mudança de quadro, a escala com os cuidados e a
//     baixa da programada, a dispensa, a classificação do turno, o índice registrado e validado, relidos pelas leituras
//     da tela (com o último de cada escala); o monitoramento da transação mostra só tabelas SGH_ (0 tabela legada) e
//     as contagens das tabelas gravadas são as mesmas antes e depois do ROLLBACK.
// Saída só com contagens, códigos e tempos (nenhum nome; nenhum valor de paciente).
import {
  calcularApache2,
  categoriasDoTipo,
  comImpressao,
  CONFIGURACAO_INDICES_SINTETICA,
} from '@sgh/dominio-pep';
import {
  classificacoesDaUnidade,
  classificarPacienteSgh,
  configuracaoIndicesUti,
  cumprirReavaliacoesSgh,
  dispensarReavaliacaoSgh,
  escalasEmFormulario,
  escoresDosPacientes,
  escritasDaTransacao,
  gravarCuidadosSgh,
  gravarEscoreSgh,
  gravarSinalVital,
  indicesUtiDoPaciente,
  internacoesParaEscores,
  internacoesRecentes,
  pacienteComFormularioDeEscala,
  programarReavaliacaoSgh,
  reavaliacoesDosPacientes,
  registrarIndiceUtiSgh,
  somenteSgh,
  ultimosEscoresDosPacientes,
  validarIndiceUtiSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const USUARIO = 'SGH.TESTE.M45E2';
/** Paciente, internação e atendimento SINTÉTICOS (nenhuma FK: só identificadores fora do cadastro). */
const PAC = { paciente: 4_500_901, reg: 4_500_902, atendimento: 4_500_903, unidade: 'SINT' };

async function tempo<T>(fn: () => Promise<T>): Promise<{ r: T; ms: number }> {
  const t0 = performance.now();
  const r = await fn();
  return { r, ms: Math.round(performance.now() - t0) };
}

describe.skipIf(!PODE_ESCREVER)('M45 etapa 2 na cópia', () => {
  let a: Ambiente;
  /** A configuração do fixture da cópia (a sintética é igual a ela: sintetica.spec.ts). */
  let FIXTURE: { impressao: string };
  beforeAll(async () => {
    a = await prepararAmbiente();
    FIXTURE = await comImpressao(CONFIGURACAO_INDICES_SINTETICA);
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('a configuração dos índices da cópia é a do fixture; o caso publicado do APACHE II dá 22 e 45,2%', async () => {
    const { r: cfg0, ms } = await tempo(() => a.nucleo.lerSomente(ctx(a), (l) => configuracaoIndicesUti(l)));
    const cfg = await comImpressao(cfg0);
    const faixas = cfg.variaveis.reduce((s, v) => s + v.faixas.length, 0);
    console.log(
      JSON.stringify({
        agrupamentos: cfg.agrupamentos.length,
        variaveis: cfg.variaveis.length,
        faixas,
        glasgow: cfg.glasgow.length,
        ms,
        igualAoFixture: cfg.impressao === FIXTURE.impressao,
      }),
    );
    expect([cfg.agrupamentos.length, cfg.variaveis.length, faixas, cfg.glasgow.length]).toEqual([
      21, 109, 121, 30,
    ]);
    expect(cfg.impressao).toBe(FIXTURE.impressao);
    expect(ms).toBeLessThan(5_000);
    const sepse = categoriasDoTipo(cfg, 'nao-cirurgico').find((c) => c.nome === 'Sepse')!;
    const r = calcularApache2(cfg, {
      variaveis: {
        TEMP: 39.2,
        PAM: 65,
        FC: 125,
        FR: 28,
        FIO2: 0.4,
        PAO2: 68,
        PH: 7.3,
        NASERICO: 138,
        KSERICO: 3.2,
        CREATININA: 1.8,
        HEMATOCRITO: 32,
        LEUCOCITO: 18_000,
      },
      glasgow: { ocular: 3, verbal: 8, motora: 15 },
      idade: 67,
      tipoAdmissao: 'nao-cirurgico',
      categoria: sepse.id,
      insuficienciaCronica: false,
      falhaRenalAguda: false,
    });
    expect(r.ok && r.pontuacao).toBe(22);
    expect(r.ok && r.mortalidade).toBeCloseTo(0.4521, 3);
  });

  it('as escalas em formulário de um paciente com registro e as internações: contagens e tempos', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      // Um paciente com registro de Braden e um com registro de Morse (só os identificadores, em memória).
      const paciente = (await pacienteComFormularioDeEscala(l, 'ENF021')) ?? 0;
      // A categoria do Morse é uma lista; o total sai das respostas do modelo.
      const pacienteMorse = (await pacienteComFormularioDeEscala(l, 'MORSE')) ?? 0;
      const morse = pacienteMorse
        ? (await escalasEmFormulario(l, [pacienteMorse], '2020-01-01T00:00')).filter(
            (z) => z.modelo === 'MORSE',
          )
        : [];
      const tempos: number[] = [];
      let lidas: Awaited<ReturnType<typeof escalasEmFormulario>> = [];
      for (let i = 0; i < 5; i++) {
        const t = await tempo(() => escalasEmFormulario(l, [paciente], '2020-01-01T00:00'));
        tempos.push(t.ms);
        lidas = t.r;
      }
      const [reg] = await internacoesRecentes(l);
      const ti = await tempo(() => internacoesParaEscores(l, [reg ?? 0]));
      return {
        achouPaciente: paciente > 0,
        registros: lidas.length,
        comTotal: lidas.filter((y) => y.total !== null).length,
        escalas: [...new Set(lidas.map((y) => y.escala))].sort(),
        maiorMs: Math.max(...tempos),
        internacoes: ti.r.length,
        internacoesMs: ti.ms,
        morse: {
          achouPaciente: pacienteMorse > 0,
          registros: morse.length,
          comTotal: morse.filter((z) => z.total !== null).length,
          comFaixa: morse.filter((z) => z.faixaFormulario !== null).length,
          totaisNaEscala: morse.every((z) => z.total === null || (z.total >= 0 && z.total <= 125)),
        },
      };
    });
    console.log(JSON.stringify(r));
    expect(r.achouPaciente).toBe(true);
    expect(r.registros).toBeGreaterThan(0);
    expect(r.registros).toBeLessThanOrEqual(50);
    expect(r.maiorMs).toBeLessThan(1_000);
    expect(r.internacoes).toBe(1);
    // Morse: a categoria escolhida vem como a faixa do formulário e o total (0 a 125) das respostas do modelo.
    if (r.morse.achouPaciente) {
      expect(r.morse.registros).toBeGreaterThan(0);
      expect(r.morse.comFaixa + r.morse.comTotal).toBeGreaterThan(0);
      expect(r.morse.totaisNaEscala).toBe(true);
    }
  });

  it('o ciclo só SGH_ inteiro numa transação desfeita: relido pelas leituras da tela e só tabelas SGH_', async () => {
    // As contagens das tabelas gravadas (do paciente sintético e no total) antes e depois do ROLLBACK.
    const TABELAS = [
      'SGH_PEP_SINAL_VITAL',
      'SGH_PEP_ESCORE',
      'SGH_PEP_REAVALIACAO',
      'SGH_PEP_CLASSIF_PAC',
      'SGH_PEP_INDICE_UTI',
    ] as const;
    const retrato = () =>
      a.nucleo.lerSomente(ctx(a), async (l) => {
        const r: Record<string, number> = {};
        const conta = async (sql: string, ps: unknown[]) =>
          Number((await l.consultar(sql, ps, { teto: 1 }))[0]?.['N'] ?? 0);
        for (const t of TABELAS) {
          r[`${t}:total`] = await conta(`SELECT COUNT(*) N FROM ${t}`, []);
          r[`${t}:paciente`] = await conta(
            `SELECT COUNT(*) N FROM ${t} WHERE HOSPITAL = ? AND ID_RICADPAC = ?`,
            [a.cod, PAC.paciente],
          );
        }
        r['SGH_PEP_ESCORE_CUIDADO:total'] = await conta('SELECT COUNT(*) N FROM SGH_PEP_ESCORE_CUIDADO', []);
        r['SGH_ADM_AVISO:total'] = await conta('SELECT COUNT(*) N FROM SGH_ADM_AVISO', []);
        return r;
      });
    const antes = await retrato();
    expect(TABELAS.map((t) => antes[`${t}:paciente`])).toEqual([0, 0, 0, 0, 0]);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e0) => {
      const e = somenteSgh(e0);
      const h = a.cod;
      const sinal = await gravarSinalVital(e, {
        hospital: h,
        paciente: PAC.paciente,
        atendimento: PAC.atendimento,
        horario: null,
        tipo: 'fr',
        valor: 26,
        unidade: 'irpm',
        metodo: null,
        foraDaFaixa: true,
        horaReal: '2026-10-25T10:00:00',
        origemOffline: false,
        observacao: null,
        usuario: USUARIO,
      });
      const news2 = await gravarEscoreSgh(e, {
        hospital: h,
        ...PAC,
        escala: 'news2',
        versaoRegra: 1,
        itens: { fr: 3, spo2: 2, o2: 2 },
        total: 7,
        faixa: 'alto',
        gatilho: 'trr',
        suspeitaInfeccao: true,
        origem: 'afericao',
        sinalVital: sinal,
        aferidoEm: '2026-10-25T10:00',
        usuario: USUARIO,
      });
      const reav = await programarReavaliacaoSgh(e, {
        hospital: h,
        paciente: PAC.paciente,
        reg: PAC.reg,
        unidade: PAC.unidade,
        escala: 'braden',
        motivo: 'mudanca-quadro',
        chave: `quadro:news2:${news2}`,
        devidaEm: '2026-10-25T10:00:00',
        prazoEm: '2026-10-25T22:00:00',
        observacao: 'NEWS2 7',
        usuario: USUARIO,
      });
      const outra = await programarReavaliacaoSgh(e, {
        hospital: h,
        paciente: PAC.paciente,
        reg: PAC.reg,
        unidade: PAC.unidade,
        escala: 'morse',
        motivo: 'mudanca-quadro',
        chave: `quadro:news2:${news2}`,
        devidaEm: '2026-10-25T10:00:00',
        prazoEm: '2026-10-25T22:00:00',
        observacao: null,
        usuario: USUARIO,
      });
      const braden = await gravarEscoreSgh(e, {
        hospital: h,
        ...PAC,
        escala: 'braden',
        versaoRegra: 1,
        itens: { percepcao: 2, umidade: 2, atividade: 1, mobilidade: 2, nutricao: 2, friccao: 1 },
        total: 10,
        faixa: 'alto',
        gatilho: 'prevencao',
        suspeitaInfeccao: false,
        origem: 'tela',
        sinalVital: null,
        aferidoEm: '2026-10-25T11:00',
        usuario: USUARIO,
      });
      await gravarCuidadosSgh(e, {
        hospital: h,
        escore: braden,
        usuario: USUARIO,
        decisoes: [
          { codigo: 'mudancaDecubito', decisao: 'aceito' },
          { codigo: 'hidratacaoPele', decisao: 'recusado', motivo: 'Pele íntegra — ação nº 1' },
        ],
      });
      const cumpridas = await cumprirReavaliacoesSgh(e, {
        hospital: h,
        paciente: PAC.paciente,
        escala: 'braden',
        quando: '2026-10-25T11:00',
        escore: braden,
        registroFormulario: null,
        usuario: USUARIO,
      });
      await dispensarReavaliacaoSgh(e, {
        hospital: h,
        id: outra,
        motivo: 'Avaliada no formulário',
        quando: '2026-10-25T11:05',
        usuario: USUARIO,
      });
      await classificarPacienteSgh(e, {
        hospital: h,
        ...PAC,
        data: '2026-10-25',
        turno: 'diurno',
        instrumento: 'nas',
        versao: 1,
        itens: { '1': '1b', '17': 'sim' },
        total: 19.1,
        categoria: 'nas',
        horas24h: 4.6,
        usuario: USUARIO,
      });
      const indice = await registrarIndiceUtiSgh(e, {
        hospital: h,
        ...PAC,
        indice: 'sofa',
        variaveis: { parcelas: [{ sigla: 'PAO2', pontos: 3, nome: 'Relação — ação' }] },
        pontuacao: 16,
        categoria: null,
        tipoAdmissao: null,
        mortalidade: null,
        impressaoConfig: FIXTURE.impressao,
        coletadoEm: '2026-10-25T08:00',
        usuario: USUARIO,
      });
      await validarIndiceUtiSgh(e, {
        hospital: h,
        id: indice,
        validadoPor: `${USUARIO}M`,
        vinculo: 1,
        quando: '2026-10-25T09:00',
      });
      // As leituras da tela relêem o que a transação gravou.
      const escores = await escoresDosPacientes(e, h, [PAC.paciente], '2026-10-25T00:00');
      const ultimos = await ultimosEscoresDosPacientes(e, h, [PAC.paciente], '2026-10-18T00:00');
      const reavs = await reavaliacoesDosPacientes(e, h, [PAC.paciente], '2026-10-24T00:00');
      const classif = await classificacoesDaUnidade(e, h, PAC.unidade, '2026-10-25', 'diurno');
      const indices = await indicesUtiDoPaciente(e, h, PAC.paciente);
      const escritas = await escritasDaTransacao(e);
      return {
        escores: escores.map((x) => `${x.escala}:${x.total}:${x.origem}`),
        ultimos: ultimos.map(
          (x) => `${x.escala}:${x.id === braden ? 'braden' : x.id === news2 ? 'news2' : '?'}`,
        ),
        reavaliacoes: reavs.map((x) => `${x.escala}:${x.situacao}:${x.cumpridaPor ?? '-'}`).sort(),
        cumpridas,
        reavId: reav > 0,
        classificacoes: classif
          .filter((x) => x.paciente === PAC.paciente)
          .map((x) => `${x.instrumento}:${x.total}`),
        indices: indices.map((x) => `${x.indice}:${x.pontuacao}:${x.situacao}`),
        corpusRelido: JSON.stringify(indices[0]?.variaveis).includes('ação'),
        tabelas: escritas.map((x) => x.tabela),
      };
    });
    console.log(JSON.stringify(r));
    expect(r.escores).toEqual(['braden:10:tela', 'news2:7:afericao']);
    expect(r.ultimos).toEqual(['braden:braden', 'news2:news2']);
    expect(r.reavaliacoes).toEqual(['braden:cumprida:escore', 'morse:dispensada:-']);
    expect(r.cumpridas).toBe(1);
    expect(r.classificacoes).toEqual(['nas:19.1']);
    expect(r.indices).toEqual(['sofa:16:validado']);
    expect(r.corpusRelido).toBe(true);
    expect(r.tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
    expect(r.tabelas).toEqual(
      expect.arrayContaining([
        'SGH_PEP_SINAL_VITAL',
        'SGH_PEP_ESCORE',
        'SGH_PEP_REAVALIACAO',
        'SGH_PEP_ESCORE_CUIDADO',
        'SGH_PEP_CLASSIF_PAC',
        'SGH_PEP_INDICE_UTI',
      ]),
    );
    // O ROLLBACK desfez tudo: as mesmas contagens de antes (nada do paciente sintético fica na cópia).
    expect(await retrato()).toEqual(antes);
  });
});
