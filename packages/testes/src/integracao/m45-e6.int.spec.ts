// Etapa 6 do M45 sobre a cópia (ficha, seções 4, 5, 9 e 10; DP-32), sempre em transação desfeita e sob a trava:
//   - os cadastros do estabelecimento lidos da cópia pela PK (oftalmologia: 6 grupos, 35 exames, 24 acuidades, 5
//     graduações, 6 tipos de arquivo; 5 tipos de protocolo; 4 tipos de parto), com o tempo, e todo rótulo de acuidade
//     interpretado pelo domínio (decimal ou medida qualitativa), sem exceção;
//   - a internação aberta lida pelo leitor da etapa (os dois identificadores presentes, o sexo no vocabulário);
//   - o ciclo só SGH_ numa transação desfeita: o exame com os exames complementares do cadastro real, o protocolo pelo
//     hash, o ciclo com as doses do domínio sobre a internação real e a validação por outra pessoa, o partograma, o
//     recém-nascido e a ordem do lactário com a conferência; relidos pelas leituras das telas com o corpus CP1252 igual,
//     e o monitoramento da transação só com tabelas SGH_ (0 tabela legada);
//   - a ligação do ciclo com a prescrição geral (as prescrições da internação no dia lidas da cópia, com o tempo), a
//     validação recusada sem ela, e o tratamento novo com o mesmo protocolo (o curso na chave única);
//   - o retrato (COUNT das tabelas SGH_ da etapa e da trilha) igual antes e depois da transação desfeita.
// Saída só com contagens e códigos (nenhum nome; textos sintéticos).
import { CORPUS_CP1252 } from '@sgh/contratos';
import {
  calcularDoses,
  clearanceCockcroftGault,
  conferirExameOftalmologico,
  decimalDaAcuidade,
  hashProtocolo,
  superficieCorporalOnco,
} from '@sgh/dominio-pep';
import {
  cadastrosOftalmologia,
  ciclosDoPaciente,
  type Leitor,
  conferirOrdemLactarioSgh,
  escritasDaTransacao,
  examesOftalmologicos,
  internacaoParaEspecialidade,
  internacoesAbertas,
  ordemLactario,
  partogramaDaInternacao,
  prescricoesDaInternacaoNoDia,
  protocoloOncologico,
  publicarProtocoloOncologicoSgh,
  recemNascidosDaInternacao,
  registrarCicloOncologicoSgh,
  registrarExameOftalmologicoSgh,
  registrarOrdemLactarioSgh,
  registrarPartogramaSgh,
  registrarRecemNascidoSgh,
  somenteSgh,
  tiposDeParto,
  tiposDeProtocoloOncologico,
  validarCicloOncologicoSgh,
  vincularPrescricaoCicloSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, contar, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const AUTOR = 'SGH.TESTE.M45';
const OUTRO = 'SGH.TESTE.M45C';
// O corpus aceito pelo CP1252 (o recusado tem caractere fora da página).
const CORPUS = CORPUS_CP1252.filter((t) => !t.includes('₂'));
const TABELAS_DA_ETAPA = [
  'SGH_PEP_OFT_EXAME',
  'SGH_PEP_OFT_EXAME_ITEM',
  'SGH_PEP_ONCO_PROTOCOLO',
  'SGH_PEP_ONCO_CICLO',
  'SGH_PEP_ONCO_CICLO_PRESC',
  'SGH_PEP_OBST_PARTOGRAMA',
  'SGH_PEP_OBST_RN',
  'SGH_HOT_LACTARIO_ORDEM',
  'SGH_TRILHA',
] as const;
const texto = (n: number) => `SINTETICO ${CORPUS[n % CORPUS.length]}`.slice(0, 200).trim();

describe.skipIf(!PODE_ESCREVER)('M45 etapa 6 na cópia (transação desfeita)', () => {
  let a: Ambiente;

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('cadastros pela PK com as contagens da ficha e cada rótulo de acuidade interpretado', async () => {
    const t0 = Date.now();
    const [c, tipos, partos] = await a.nucleo.lerSomente(
      ctx(a),
      async (l) =>
        [await cadastrosOftalmologia(l), await tiposDeProtocoloOncologico(l), await tiposDeParto(l)] as const,
    );
    const ms = Date.now() - t0;
    console.log(
      `[M45.6] cadastros: grupos ${c.grupos.length}, exames ${c.exames.length}, acuidades ${c.acuidades.length}, graduações ${c.graduacoes.length}, tipos de arquivo ${c.tiposArquivo.length}, protocolos ${tipos.length}, partos ${partos.length} (${ms} ms)`,
    );
    expect([
      c.grupos.length,
      c.exames.length,
      c.acuidades.length,
      c.graduacoes.length,
      c.tiposArquivo.length,
    ]).toEqual([6, 35, 24, 5, 6]);
    expect(tipos).toHaveLength(5);
    expect(partos).toHaveLength(4);
    expect(ms).toBeLessThan(2_000);
    const lidas = c.acuidades.map((x) => decimalDaAcuidade(x.nome));
    const decimais = lidas.filter((x) => x.decimal !== null).length;
    const qualitativas = lidas.filter((x) => x.qualitativa).length;
    console.log(`[M45.6] acuidades: ${decimais} com decimal, ${qualitativas} qualitativas`);
    expect(decimais + qualitativas).toBe(24);
    expect(decimais).toBeGreaterThanOrEqual(12);
  });

  /** O retrato: as contagens das tabelas SGH_ da etapa e da trilha (a transação desfeita não deixa rastro). */
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l: Leitor) => {
      const r: Record<string, number> = {};
      for (const t of TABELAS_DA_ETAPA) r[t] = await contar(l, `SELECT COUNT(*) N FROM ${t}`);
      return r;
    });

  it('o ciclo só SGH_ numa transação desfeita, relido pelas leituras das telas, sem tabela legada', async () => {
    const antes = await retrato();
    const internadas = await a.nucleo.lerSomente(ctx(a), (l) => internacoesAbertas(l, { intensivas: [] }));
    expect(internadas.itens.length).toBeGreaterThan(0);
    const reg = internadas.itens[0]!.reg;
    const resumo = await a.nucleo.desfazendoNaCopia(ctx(a), async (e0) => {
      const e = somenteSgh(e0);
      const i = await internacaoParaEspecialidade(e, reg);
      expect(i).not.toBeNull();
      expect(i!.nome.length).toBeGreaterThan(0);
      expect(['M', 'F', 'I']).toContain(i!.sexo);
      const pac = { hospital: a.cod, reg: i!.reg, pront: i!.pront, paciente: i!.paciente };
      const cad = await cadastrosOftalmologia(e);
      const dominio = {
        exames: new Map(cad.exames.map((x) => [x.codigo, x.nome])),
        acuidades: new Map(cad.acuidades.map((x) => [x.codigo, x.nome])),
        graduacoes: new Map(cad.graduacoes.map((x) => [x.codigo, x.nome])),
      };
      // O exame: a acuidade, a graduação e os exames do cadastro real; a classificação e os alertas do domínio.
      const entrada = {
        internacao: i!.reg,
        od: {
          acuidadeSemCorrecao: cad.acuidades[9]!.codigo,
          acuidadeComCorrecao: cad.acuidades[3]!.codigo,
          pio: 24,
          gonioscopia: cad.graduacoes[3]!.codigo,
        },
        oe: {
          acuidadeSemCorrecao: cad.acuidades[5]!.codigo,
          acuidadeComCorrecao: null,
          pio: 17,
          gonioscopia: null,
        },
        metodoPio: 'aplanacao' as const,
        exames: [{ exame: cad.exames[32]!.codigo, lado: 'ao' as const, resultado: texto(0) }],
        conduta: texto(1),
      };
      const r = conferirExameOftalmologico(entrada, dominio, 21);
      const exame = await registrarExameOftalmologicoSgh(e, {
        ...pac,
        od: {
          avSc: entrada.od.acuidadeSemCorrecao,
          avCc: entrada.od.acuidadeComCorrecao,
          pio: 24,
          gonio: entrada.od.gonioscopia,
        },
        oe: { avSc: entrada.oe.acuidadeSemCorrecao, avCc: null, pio: 17, gonio: null },
        metodoPio: 'aplanacao',
        classificacao: r.classificacao,
        alertas: r.alertas,
        conduta: entrada.conduta,
        itens: entrada.exames,
        vinculo: 1,
        usuario: AUTOR,
      });
      const exames = await examesOftalmologicos(e, a.cod, i!.reg);
      const lido = exames.find((x) => x.id === exame)!;
      expect(lido.itens[0]!.resultado).toBe(texto(0));
      expect(lido.conduta).toBe(texto(1));
      expect(lido.alertas).toEqual(r.alertas);

      // O protocolo pelo hash, o ciclo com as doses do domínio e a validação por outra pessoa.
      const tipos = await tiposDeProtocoloOncologico(e);
      const proto = {
        codigo: 'SGHT-M45',
        nome: texto(2).slice(0, 100),
        tipo: tipos[2]!.codigo,
        intervaloDias: 21,
        ciclos: 6,
        farmacos: [
          { nome: 'Paclitaxel', dose: 175, unidade: 'mg/m2' as const, via: 'iv' as const, dias: [1] },
          { nome: 'Carboplatina', dose: 5, unidade: 'auc' as const, via: 'iv' as const, dias: [1] },
        ],
        referencia: texto(3),
      };
      const hash = await hashProtocolo(proto);
      const p = await publicarProtocoloOncologicoSgh(e, {
        hospital: a.cod,
        ...proto,
        indicacao: null,
        hash,
        vinculo: 1,
        usuario: AUTOR,
      });
      const pl = await protocoloOncologico(e, a.cod, p.id);
      expect(pl).toMatchObject({ versao: 1, vigente: true, hash });
      expect(
        await hashProtocolo({ ...proto, nome: pl!.nome, referencia: pl!.referencia, farmacos: pl!.farmacos }),
      ).toBe(hash);
      const sc = superficieCorporalOnco(70, 170);
      const tfg = clearanceCockcroftGault(60, 70, 1, i!.sexo);
      const doses = calcularDoses(proto.farmacos, {
        superficieM2: sc,
        pesoKg: 70,
        clearanceMlMin: tfg,
        reducaoPct: 0,
      });
      const ciclo = await registrarCicloOncologicoSgh(e, {
        ...pac,
        protocolo: p.id,
        codigoProtocolo: proto.codigo,
        numero: 1,
        dataPrevista: '2026-10-26',
        pesoKg: 70,
        alturaCm: 170,
        superficieM2: sc,
        creatininaMgDl: 1,
        clearanceMlMin: tfg,
        reducaoPct: 0,
        motivoReducao: null,
        justificativaIntervalo: null,
        doses,
        vinculo: 1,
        usuario: AUTOR,
      });
      await expect(
        validarCicloOncologicoSgh(e, {
          hospital: a.cod,
          id: ciclo,
          doses: [1, 1],
          observacao: null,
          vinculo: 1,
          usuario: AUTOR,
        }),
      ).rejects.toThrow(/outra pessoa/);
      // Sem a prescrição dos medicamentos ligada, nem outra pessoa valida.
      await expect(
        validarCicloOncologicoSgh(e, {
          hospital: a.cod,
          id: ciclo,
          doses: doses.map((d) => d.final),
          observacao: null,
          vinculo: 2,
          usuario: OUTRO,
        }),
      ).rejects.toThrow(/prescrição dos medicamentos ligada/);
      // As prescrições da internação que valem no dia (lidas da cópia); liga a primeira, ou um ID sintético.
      const hoje = new Date();
      const p2 = (n: number) => String(n).padStart(2, '0');
      const dia = `${hoje.getFullYear()}-${p2(hoje.getMonth() + 1)}-${p2(hoje.getDate())}`;
      const tp = Date.now();
      const doDia = await prescricoesDaInternacaoNoDia(e, i!.reg, i!.paciente, dia);
      const msPresc = Date.now() - tp;
      console.log(
        `[M45.6] prescrições da internação no dia: ${doDia.length < 5 ? '<5' : doDia.length} (${msPresc} ms)`,
      );
      expect(msPresc).toBeLessThan(2_000);
      const prescricao = doDia[0]?.id ?? 2_000_000_456;
      await vincularPrescricaoCicloSgh(e, { hospital: a.cod, ciclo, prescricao, vinculo: 1, usuario: AUTOR });
      await expect(
        vincularPrescricaoCicloSgh(e, { hospital: a.cod, ciclo, prescricao, vinculo: 1, usuario: AUTOR }),
      ).rejects.toThrow(/SGH_PK_PEP_ONCO_CICLO_PRESC/);
      await validarCicloOncologicoSgh(e, {
        hospital: a.cod,
        id: ciclo,
        doses: doses.map((d) => d.final),
        observacao: texto(4),
        vinculo: 2,
        usuario: OUTRO,
      });
      // Depois da validação, a ligação não muda.
      await expect(
        vincularPrescricaoCicloSgh(e, {
          hospital: a.cod,
          ciclo,
          prescricao: prescricao + 1,
          vinculo: 1,
          usuario: AUTOR,
        }),
      ).rejects.toThrow(/já foi validado/);
      const ciclos = await ciclosDoPaciente(e, a.cod, i!.paciente);
      const c1 = ciclos.find((x) => x.id === ciclo)!;
      expect(c1).toMatchObject({
        situacao: 'validado',
        validadoPor: OUTRO,
        superficieM2: sc,
        curso: 1,
        motivoCurso: null,
        prescricoes: [prescricao],
      });
      expect(c1.doses.map((d) => d.final)).toEqual(doses.map((d) => d.final));
      // O tratamento novo com o mesmo protocolo: o ciclo 1 no curso 2, com o motivo; o mesmo curso e número, recusado.
      const base = {
        ...pac,
        protocolo: p.id,
        codigoProtocolo: proto.codigo,
        dataPrevista: '2027-03-01',
        pesoKg: 70,
        alturaCm: 170,
        superficieM2: sc,
        creatininaMgDl: 1,
        clearanceMlMin: tfg,
        reducaoPct: 0,
        motivoReducao: null,
        justificativaIntervalo: null,
        doses,
        vinculo: 1,
        usuario: AUTOR,
      };
      await expect(registrarCicloOncologicoSgh(e, { ...base, numero: 1, curso: 1 })).rejects.toThrow(
        /SGH_UQ_PEP_ONCO_CICLO_CURSO/,
      );
      await expect(registrarCicloOncologicoSgh(e, { ...base, numero: 1, curso: 2 })).rejects.toThrow(
        /SGH_CK_PEP_ONCO_CICLO_CURSO/,
      );
      const novo = await registrarCicloOncologicoSgh(e, {
        ...base,
        numero: 1,
        curso: 2,
        motivoCurso: texto(8),
      });
      const c2 = (await ciclosDoPaciente(e, a.cod, i!.paciente)).find((x) => x.id === novo)!;
      expect(c2).toMatchObject({ curso: 2, numero: 1, motivoCurso: texto(8), prescricoes: [] });

      // O partograma, o recém-nascido e a ordem do lactário com a conferência.
      const ponto = await registrarPartogramaSgh(e, {
        ...pac,
        em: '2026-10-25T10:00',
        dilatacaoCm: 4,
        alturaApresentacao: -1,
        bcf: 140,
        contracoes10min: 3,
        duracaoContracaoS: 40,
        bolsa: 'integra',
        liquido: null,
        paSistolica: 120,
        paDiastolica: 80,
        temperatura: 36.6,
        ocitocina: null,
        observacao: texto(5),
        alertas: [],
        vinculo: 1,
        usuario: AUTOR,
      });
      const pontos = await partogramaDaInternacao(e, a.cod, i!.reg);
      expect(pontos.find((x) => x.id === ponto)).toMatchObject({
        em: '2026-10-25T10:00',
        dilatacaoCm: 4,
        observacao: texto(5),
      });
      const tipoParto = (await tiposDeParto(e))[0]!.codigo;
      const rn = await registrarRecemNascidoSgh(e, {
        ...pac,
        nascimentoEm: '2026-10-25T14:10',
        sexo: 'F',
        pesoG: 3200,
        comprimentoCm: 49,
        perimetroCefalicoCm: 34,
        apgar1: 8,
        apgar5: 9,
        apgar10: null,
        igSemanas: 39,
        igDias: 2,
        tipoParto,
        reanimacao: false,
        classificacaoIg: 'A termo (37 a 41 semanas)',
        classificacaoPeso: 'Peso adequado (2.500 a 3.999 g)',
        classificacaoApgar: 'Apgar do 5º minuto normal (7 a 10)',
        observacao: texto(6),
        vinculo: 1,
        usuario: AUTOR,
      });
      const rns = await recemNascidosDaInternacao(e, a.cod, i!.reg);
      expect(rns.find((x) => x.id === rn)).toMatchObject({
        nascimentoEm: '2026-10-25T14:10',
        tipoParto,
        observacao: texto(6),
      });
      const ordem = await registrarOrdemLactarioSgh(e, {
        ...pac,
        formula: texto(7).slice(0, 60),
        volumeMl: 90,
        horarios: ['09:00', '12:00'],
        preparoEm: '2026-10-25T08:00',
        validadeEm: '2026-10-26T08:00',
        lote: 'L-SINT',
        observacao: null,
        usuario: AUTOR,
      });
      await expect(
        conferirOrdemLactarioSgh(e, { hospital: a.cod, id: ordem, usuario: AUTOR }),
      ).rejects.toThrow(/outra pessoa/);
      await conferirOrdemLactarioSgh(e, { hospital: a.cod, id: ordem, usuario: OUTRO });
      const o = await ordemLactario(e, a.cod, ordem);
      expect(o).toMatchObject({
        situacao: 'conferida',
        conferidoPor: OUTRO,
        horarios: ['09:00', '12:00'],
        validadeEm: '2026-10-26T08:00',
      });
      expect(o!.formula).toBe(texto(7).slice(0, 60));
      return escritasDaTransacao(e);
    });
    const tabelas = resumo.map((w) => w.tabela).sort();
    console.log(`[M45.6] tabelas escritas na transação desfeita: ${tabelas.join(', ')}`);
    expect(tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
    expect(tabelas).toEqual(
      expect.arrayContaining([
        'SGH_PEP_OFT_EXAME',
        'SGH_PEP_OFT_EXAME_ITEM',
        'SGH_PEP_ONCO_PROTOCOLO',
        'SGH_PEP_ONCO_CICLO',
        'SGH_PEP_ONCO_CICLO_PRESC',
        'SGH_PEP_OBST_PARTOGRAMA',
        'SGH_PEP_OBST_RN',
        'SGH_HOT_LACTARIO_ORDEM',
      ]),
    );
    // A transação desfeita não deixa rastro: as contagens voltam ao que eram.
    expect(await retrato()).toEqual(antes);
  });
});
