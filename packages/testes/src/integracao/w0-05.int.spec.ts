// W0-05 sobre a cópia (programa CRUD completo; critério de aceite 3), sempre em transação desfeita e sob a trava:
//   - desfazer a ligação ciclo–prescrição remove só o vínculo SGH_: a linha da PRPRESC e os itens dela (PRLANGERAL) são
//     lidos antes de ligar, depois de ligar e depois de desfazer, e os três retratos são idênticos;
//   - o evento da ligação desfeita fica em SGH_PEP_ONCO_EVENTO e o ciclo relido não tem mais a prescrição;
//   - o ciclo validado não desfaz a ligação (a recusa do comando, zero linha);
//   - o monitoramento da transação só tem tabelas SGH_ (nenhuma escrita em PRPRESC nem em outra tabela do legado);
//   - o retrato (COUNT das tabelas SGH_ do pacote e da trilha) igual antes e depois da transação desfeita.
// Revisão: TODOS os comandos novos do pacote rodam no Firebird (CHECKs, tipos, subselects e o WITH LOCK dos scripts 1040
// a 1042), numa internação sintética só do novo, também em transação desfeita: a triagem, a meta e o acompanhamento
// retificados e estornados; a avaliação da NPT e a recusa da segunda; o adendo e o estorno do social (e o adendo do
// estornado recusado); a ordem do lactário alterada, conferida, etiquetada e cancelada (e a alteração depois da
// conferência recusada); a refeição do acompanhante alterada (o anterior relido com a observação); o ciclo ajustado (a
// versão anterior relida na transação, a recusa com a prescrição ligada), suspenso, retomado e cancelado; a revogação
// recontada na transação (mais ciclos que na ciência recusa), a revogação dupla recusada e o ciclo novo na versão
// revogada e no protocolo inativo recusados dentro da transação; as leituras com ORIGEM_TERAPIA, INATIVA, ANDAMENTO e
// ETIQUETA_EM. Só tabelas SGH_ escritas; o retrato igual depois.
// Saída só com contagens e códigos (nenhum nome; textos sintéticos).
import { calcularMeta, hashProtocolo, superficieCorporalOnco, calcularDoses } from '@sgh/dominio-pep';
import {
  acompanhantesDaInternacao,
  ajustarCicloOncologicoSgh,
  alteracoesHot,
  alterarDietaAcompanhanteSgh,
  alterarOrdemLactarioSgh,
  avaliacoesNptDaInternacao,
  cancelarOrdemLactarioSgh,
  ciclosDaVersao,
  conferirOrdemLactarioSgh,
  correcoesDosRegistros,
  eventosDosProtocolos,
  marcarEtiquetaLactarioSgh,
  mudarAndamentoCicloSgh,
  ordemLactario,
  registrarAcompanhamentoTerapiaSgh,
  registrarAdendoSocialSgh,
  registrarAlteracaoHotSgh,
  registrarAvaliacaoNptSgh,
  registrarAvaliacaoSocialSgh,
  registrarCorrecaoNutricaoSgh,
  registrarDietaAcompanhanteSgh,
  registrarMetaTerapiaSgh,
  registrarOrdemLactarioSgh,
  registrarTriagemNutricionalSgh,
  registrosSociaisDaInternacao,
  revogarVersaoProtocoloSgh,
  terapiaDaInternacao,
  triagensDasInternacoes,
  ciclosDoPaciente,
  desligarPrescricaoCicloSgh,
  escritasDaTransacao,
  eventosDosCiclos,
  type Escritor,
  internacaoParaEspecialidade,
  internacoesAbertas,
  type Leitor,
  linhasDaPrescricaoGeral,
  prescricaoMaisRecenteDaInternacao,
  prescricoesDaInternacaoNoDia,
  publicarProtocoloOncologicoSgh,
  registrarCicloOncologicoSgh,
  registrarEventoOncoSgh,
  somenteSgh,
  tiposDeProtocoloOncologico,
  validarCicloOncologicoSgh,
  vincularPrescricaoCicloSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, contar, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const AUTOR = 'SGH.TESTE.W005';
const OUTRO = 'SGH.TESTE.W005C';
const TABELAS = [
  'SGH_PEP_NUTRI_TRIAGEM',
  'SGH_PEP_NUTRI_TERAPIA',
  'SGH_PEP_NUTRI_CORRECAO',
  'SGH_PEP_NUTRI_NPT_AVAL',
  'SGH_PEP_SOCIAL',
  'SGH_HOT_LACTARIO_ORDEM',
  'SGH_HOT_DIETA_ACOMP',
  'SGH_HOT_ALTERACAO',
  'SGH_PEP_ONCO_PROTOCOLO',
  'SGH_PEP_ONCO_CICLO',
  'SGH_PEP_ONCO_CICLO_PRESC',
  'SGH_PEP_ONCO_EVENTO',
  'SGH_TRILHA',
] as const;

/** O retrato textual de linhas do legado (datas, blobs e números normalizados) para comparar antes e depois. */
function retratoDasLinhas(ls: readonly Record<string, unknown>[]): string {
  return JSON.stringify(ls, (_k, v: unknown) => {
    if (v instanceof Date) return `D:${v.toISOString()}`;
    if (typeof v === 'bigint') return `N:${v.toString()}`;
    if (Buffer.isBuffer(v)) return `B:${v.toString('hex')}`;
    return v;
  });
}

/** A prescrição inteira do legado (a linha da PRPRESC e os itens), lida pelo adaptador, em texto comparável. */
async function prescricaoDoLegado(l: Leitor, id: number): Promise<string> {
  const ls = await linhasDaPrescricaoGeral(l, id);
  expect(ls.length).toBeGreaterThan(0);
  return retratoDasLinhas(ls);
}

describe.skipIf(!PODE_ESCREVER)('W0-05 na cópia (transação desfeita)', () => {
  let a: Ambiente;

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l: Leitor) => {
      const r: Record<string, number> = {};
      for (const t of TABELAS) r[t] = await contar(l, `SELECT COUNT(*) N FROM ${t}`);
      return r;
    });

  it('desfazer a ligação ciclo–prescrição deixa a PRPRESC idêntica (antes, ligada e desfeita); só SGH_ escrita', async () => {
    const antes = await retrato();
    // Uma internação aberta com prescrição (a cópia é um retrato antigo: a mais recente da internação, no dia em que
    // ela começa a valer, que é o dia previsto do ciclo sintético).
    const alvo = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const abertas = await internacoesAbertas(l, { intensivas: [] });
      for (const x of abertas.itens.slice(0, 60)) {
        const i = await internacaoParaEspecialidade(l, x.reg);
        if (!i) continue;
        const p = await prescricaoMaisRecenteDaInternacao(l, i.reg, i.paciente);
        if (!p) continue;
        const dia = p.inicio.slice(0, 10);
        const doDia = await prescricoesDaInternacaoNoDia(l, i.reg, i.paciente, dia);
        if (doDia.some((d) => d.id === p.id)) return { i, prescricao: p.id, dia };
      }
      return null;
    });
    console.log(`[W0-05] internação com prescrição no dia: ${alvo ? 'sim' : 'não'}`);
    expect(alvo).not.toBeNull();
    const { i, prescricao, dia } = alvo!;
    const pac = { hospital: a.cod, reg: i.reg, pront: i.pront, paciente: i.paciente };

    const resumo = await a.nucleo.desfazendoNaCopia(ctx(a), async (e0) => {
      const e: Escritor = somenteSgh(e0);
      const r0 = await prescricaoDoLegado(e0, prescricao);
      const tipos = await tiposDeProtocoloOncologico(e);
      const proto = {
        codigo: 'SGHT-W005',
        nome: 'SINTETICO W0-05',
        tipo: tipos[0]!.codigo,
        intervaloDias: 21,
        ciclos: 6,
        farmacos: [
          { nome: 'Paclitaxel', dose: 80, unidade: 'mg/m2' as const, via: 'iv' as const, dias: [1] },
        ],
        referencia: 'SINTETICO',
      };
      const p = await publicarProtocoloOncologicoSgh(e, {
        hospital: a.cod,
        ...proto,
        indicacao: null,
        hash: await hashProtocolo(proto),
        vinculo: 1,
        usuario: AUTOR,
      });
      const sc = superficieCorporalOnco(70, 170);
      const doses = calcularDoses(proto.farmacos, {
        superficieM2: sc,
        pesoKg: 70,
        clearanceMlMin: null,
        reducaoPct: 0,
      });
      const base = {
        ...pac,
        protocolo: p.id,
        codigoProtocolo: proto.codigo,
        dataPrevista: dia,
        pesoKg: 70,
        alturaCm: 170,
        superficieM2: sc,
        creatininaMgDl: null,
        clearanceMlMin: null,
        reducaoPct: 0,
        motivoReducao: null,
        justificativaIntervalo: null,
        doses,
        vinculo: 1,
        usuario: AUTOR,
      };
      const ciclo = await registrarCicloOncologicoSgh(e, { ...base, numero: 1 });
      await vincularPrescricaoCicloSgh(e, { hospital: a.cod, ciclo, prescricao, vinculo: 1, usuario: AUTOR });
      const r1 = await prescricaoDoLegado(e0, prescricao);
      const ligado = (await ciclosDoPaciente(e, a.cod, i.paciente)).find((x) => x.id === ciclo)!;
      expect(ligado.prescricoes).toEqual([prescricao]);

      // Desfaz a ligação (o vínculo SGH_) com o evento; a prescrição do legado continua idêntica.
      await desligarPrescricaoCicloSgh(e, { hospital: a.cod, ciclo, prescricao });
      await registrarEventoOncoSgh(e, {
        hospital: a.cod,
        evento: 'prescricao-desligada',
        codigoProtocolo: proto.codigo,
        protocolo: p.id,
        ciclo,
        prescricao,
        categoria: null,
        ciclosAfetados: null,
        antes: null,
        motivo: 'SINTETICO: ligada ao ciclo errado',
        vinculo: 1,
        usuario: AUTOR,
      });
      const r2 = await prescricaoDoLegado(e0, prescricao);
      expect(r1).toBe(r0);
      expect(r2).toBe(r0);
      const desligado = (await ciclosDoPaciente(e, a.cod, i.paciente)).find((x) => x.id === ciclo)!;
      expect(desligado.prescricoes).toEqual([]);
      const ev = await eventosDosCiclos(e, a.cod, [ciclo]);
      expect(ev.map((x) => [x.evento, x.prescricao])).toEqual([['prescricao-desligada', prescricao]]);
      // Desfazer de novo: zero linha (a recusa); o ciclo validado também não desfaz a ligação.
      await expect(desligarPrescricaoCicloSgh(e, { hospital: a.cod, ciclo, prescricao })).rejects.toThrow(
        /não está ligada/,
      );
      await vincularPrescricaoCicloSgh(e, { hospital: a.cod, ciclo, prescricao, vinculo: 1, usuario: AUTOR });
      await validarCicloOncologicoSgh(e, {
        hospital: a.cod,
        id: ciclo,
        doses: doses.map((d) => d.final),
        observacao: null,
        vinculo: 2,
        usuario: OUTRO,
      });
      await expect(desligarPrescricaoCicloSgh(e, { hospital: a.cod, ciclo, prescricao })).rejects.toThrow(
        /já foi validado/,
      );
      expect(await prescricaoDoLegado(e0, prescricao)).toBe(r0);
      console.log(
        `[W0-05] PRPRESC: ${r0.length} caractere(s) no retrato; igual depois de ligar, de desfazer e de validar`,
      );
      return escritasDaTransacao(e0);
    });
    const tabelas = resumo.map((w) => w.tabela).sort();
    console.log(`[W0-05] tabelas escritas na transação desfeita: ${tabelas.join(', ')}`);
    expect(tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
    expect(tabelas).not.toContain('PRPRESC');
    expect(tabelas).toEqual(
      expect.arrayContaining(['SGH_PEP_ONCO_CICLO', 'SGH_PEP_ONCO_CICLO_PRESC', 'SGH_PEP_ONCO_EVENTO']),
    );
    expect(await retrato()).toEqual(antes);
  });

  it('revisão: os comandos novos de nutrição, social, lactário, acompanhante e oncologia no Firebird; só SGH_ escrita', async () => {
    const antes = await retrato();
    // Internação sintética só do novo (as tabelas SGH_ não têm FK para o legado): números fora da faixa real.
    const reg = 2_000_005_005;
    const pac = { hospital: a.cod, reg, pront: reg, paciente: reg };
    const codigoDe = async (p: Promise<unknown>) => {
      try {
        await p;
        return 'gravou';
      } catch (x) {
        return (x as { problema?: { codigo?: string } }).problema?.codigo ?? `erro: ${(x as Error).message}`;
      }
    };
    const resumo = await a.nucleo.desfazendoNaCopia(ctx(a), async (e0) => {
      const e: Escritor = somenteSgh(e0);
      const r: Record<string, unknown> = {};
      const corr = (registro: 'triagem' | 'meta' | 'acompanhamento' | 'social', id: number) => ({
        hospital: a.cod,
        registro,
        id,
        reg,
        vinculo: 1,
        usuario: AUTOR,
      });

      // ── Triagem: retificar (nova versão + correção) e estornar; a versão inativa não se corrige de novo.
      const tri = {
        ...pac,
        instrumento: 'nrs2002' as const,
        versao: 'NRS-2002',
        respostas: 'sintetico',
        estado: 1,
        gravidade: 1,
        idade: 0,
        total: 2,
        risco: 'sem-risco' as const,
        conduta: null,
        pesoKg: 70,
        alturaCm: 170,
        imc: 24.2,
        admissao: '2026-11-10T08:00',
        horasDesdeAdmissao: 20,
        reavaliarEm: '2026-11-17',
        vinculo: 1,
        usuario: AUTOR,
      };
      const t1 = await registrarTriagemNutricionalSgh(e, tri);
      const t2 = await registrarTriagemNutricionalSgh(e, {
        ...tri,
        total: 3,
        risco: 'risco',
        reavaliarEm: null,
      });
      await registrarCorrecaoNutricaoSgh(e, {
        ...corr('triagem', t1),
        acao: 'retificacao',
        idNovo: t2,
        motivo: 'SINTETICO: resposta errada',
      });
      await registrarCorrecaoNutricaoSgh(e, {
        ...corr('triagem', t2),
        acao: 'estorno',
        idNovo: null,
        motivo: 'SINTETICO: paciente errado',
      });
      r['triagemDeNovo'] = await codigoDe(
        registrarCorrecaoNutricaoSgh(e, {
          ...corr('triagem', t1),
          acao: 'estorno',
          idNovo: null,
          motivo: 'SINTETICO: de novo',
        }),
      );
      const kt = await correcoesDosRegistros(e, a.cod, 'triagem', [t1, t2]);
      r['triagem'] = [kt.inativa.get(t1)?.acao, kt.inativa.get(t2)?.acao, kt.substitui.get(t2) === t1];
      r['triagensLidas'] = (await triagensDasInternacoes(e, a.cod, [reg])).length;

      // ── Meta parenteral informada, a NPT (uma vez), o acompanhamento retificado e estornado, a nova versão e o
      //    encerramento.
      const m = calcularMeta({
        pesoKg: 60,
        kcalPorKg: 25,
        proteinaGPorKg: 1,
        densidadeKcalMl: 1,
        proteinaGL: 40,
      });
      const meta = {
        ...pac,
        via: 'parenteral' as const,
        itemDieta: null,
        dieta: null,
        pesoKg: 60,
        kcalPorKg: 25,
        proteinaGPorKg: 1,
        densidadeKcalMl: 1,
        proteinaGL: 40,
        ...m,
        observacao: null,
        vinculo: 1,
        usuario: AUTOR,
      };
      const m1 = await registrarMetaTerapiaSgh(e, meta);
      await registrarAvaliacaoNptSgh(e, {
        hospital: a.cod,
        reg,
        meta: m1,
        parecer: 'ajustar',
        acesso: 'periferico',
        osmolaridade: 950.5,
        estabilidade: true,
        compatibilidade: false,
        observacao: 'SINTETICO: reduzir o cálcio',
        vinculo: 1,
        usuario: OUTRO,
      });
      r['nptDeNovo'] = await codigoDe(
        registrarAvaliacaoNptSgh(e, {
          hospital: a.cod,
          reg,
          meta: m1,
          parecer: 'adequada',
          acesso: 'central',
          osmolaridade: 1200,
          estabilidade: true,
          compatibilidade: true,
          observacao: null,
          vinculo: 1,
          usuario: OUTRO,
        }),
      );
      const acomp = {
        ...pac,
        via: 'parenteral' as const,
        meta: m1,
        data: '2026-11-11',
        volumePrescritoMl: null,
        volumeInfundidoMl: 800,
        origemVolume: 'informado' as const,
        kcalAtingida: 800,
        proteinaAtingidaG: 32,
        pctKcal: 53.3,
        pctProteina: 53.3,
        motivo: 'progressao' as const,
        observacao: null,
        vinculo: 1,
        usuario: AUTOR,
      };
      const ac1 = await registrarAcompanhamentoTerapiaSgh(e, acomp);
      const ac2 = await registrarAcompanhamentoTerapiaSgh(e, {
        ...acomp,
        volumeInfundidoMl: 1200,
        kcalAtingida: 1200,
      });
      await registrarCorrecaoNutricaoSgh(e, {
        ...corr('acompanhamento', ac1),
        acao: 'retificacao',
        idNovo: ac2,
        motivo: 'SINTETICO: volume digitado errado',
      });
      await registrarCorrecaoNutricaoSgh(e, {
        ...corr('acompanhamento', ac2),
        acao: 'estorno',
        idNovo: null,
        motivo: 'SINTETICO: dia lançado errado',
      });
      const m2 = await registrarMetaTerapiaSgh(e, { ...meta, kcalPorKg: 30 });
      await registrarCorrecaoNutricaoSgh(e, {
        ...corr('meta', m1),
        acao: 'nova-versao',
        idNovo: m2,
        motivo: 'SINTETICO: necessidade maior',
      });
      await registrarCorrecaoNutricaoSgh(e, {
        ...corr('meta', m2),
        acao: 'encerramento',
        idNovo: null,
        motivo: 'SINTETICO: alta da terapia',
      });
      const ter = await terapiaDaInternacao(e, a.cod, reg);
      r['origem'] = ter.metas.map((x) => x.origemTerapia);
      const km = await correcoesDosRegistros(e, a.cod, 'meta', [m1, m2]);
      const ka = await correcoesDosRegistros(e, a.cod, 'acompanhamento', [ac1, ac2]);
      r['meta'] = [km.inativa.get(m1)?.acao, km.inativa.get(m2)?.acao];
      r['acompanhamento'] = [ka.inativa.get(ac1)?.acao, ka.inativa.get(ac2)?.acao];
      const npt = await avaliacoesNptDaInternacao(e, a.cod, reg);
      r['npt'] = npt.map((x) => [x.parecer, x.acesso, x.osmolaridade, x.estabilidade, x.compatibilidade]);

      // ── Serviço social: o adendo do registro ativo e o estorno; o adendo do estornado recusado.
      const s1 = await registrarAvaliacaoSocialSgh(e, {
        ...pac,
        tipo: 'avaliacao',
        redeApoio: 'fragil',
        vulnerabilidades: ['transporte'],
        risco: 'medio',
        encaminhamentos: ['familia'],
        parecer: 'SINTETICO: parecer',
        orientacoes: null,
        barreira: null,
        vinculo: 1,
        usuario: AUTOR,
      });
      const ad = await registrarAdendoSocialSgh(e, {
        hospital: a.cod,
        reg,
        de: s1.id,
        texto: 'SINTETICO: complemento',
        motivo: 'SINTETICO: faltou a visita',
        vinculo: 1,
        usuario: OUTRO,
      });
      await registrarCorrecaoNutricaoSgh(e, {
        ...corr('social', s1.id),
        acao: 'estorno',
        idNovo: null,
        motivo: 'SINTETICO: internação errada',
      });
      r['adendoDoEstornado'] = await codigoDe(
        registrarAdendoSocialSgh(e, {
          hospital: a.cod,
          reg,
          de: s1.id,
          texto: 'x',
          motivo: 'SINTETICO: de novo',
          vinculo: 1,
          usuario: OUTRO,
        }),
      );
      const soc = await registrosSociaisDaInternacao(e, a.cod, reg);
      r['social'] = soc.map((x) => [x.tipo, x.id === ad ? 'adendo' : 'original']).sort();

      // ── Lactário: alterar (o anterior relido com a validade e a observação), conferir (outra pessoa), a alteração
      //    depois recusada, a etiqueta (a primeira marca), o cancelamento com o motivo, uma vez.
      const ordem = {
        ...pac,
        formula: 'SINTETICO formula 1',
        volumeMl: 60,
        horarios: ['15:00', '18:00'],
        preparoEm: '2026-11-11T14:00',
        validadeEm: '2026-11-12T14:00',
        lote: 'L1',
        observacao: 'SINTETICO: morno',
        usuario: AUTOR,
      };
      const o1 = await registrarOrdemLactarioSgh(e, ordem);
      const oAntes = await alterarOrdemLactarioSgh(e, {
        hospital: a.cod,
        id: o1,
        formula: 'SINTETICO formula 2',
        volumeMl: 90,
        horarios: ['18:00'],
        preparoEm: '2026-11-11T14:30',
        validadeEm: '2026-11-12T14:30',
        lote: null,
        observacao: null,
      });
      r['ordemAntes'] = [
        oAntes.formula,
        oAntes.volumeMl,
        oAntes.preparoEm,
        oAntes.validadeEm,
        oAntes.observacao,
      ];
      await registrarAlteracaoHotSgh(e, {
        hospital: a.cod,
        tabela: 'SGH_HOT_LACTARIO_ORDEM',
        id: o1,
        evento: 'alterada',
        antes: JSON.stringify(oAntes),
        depois: '{"formula":"SINTETICO formula 2"}',
        motivo: 'SINTETICO: troca da fórmula',
        usuario: AUTOR,
      });
      await conferirOrdemLactarioSgh(e, { hospital: a.cod, id: o1, usuario: OUTRO });
      r['alterarConferida'] = await codigoDe(
        alterarOrdemLactarioSgh(e, {
          hospital: a.cod,
          id: o1,
          formula: 'x',
          volumeMl: 60,
          horarios: ['18:00'],
          preparoEm: '2026-11-11T14:30',
          validadeEm: '2026-11-12T14:30',
          lote: null,
          observacao: null,
        }),
      );
      r['etiqueta'] = [
        await marcarEtiquetaLactarioSgh(e, { hospital: a.cod, id: o1 }),
        await marcarEtiquetaLactarioSgh(e, { hospital: a.cod, id: o1 }),
      ];
      await cancelarOrdemLactarioSgh(e, {
        hospital: a.cod,
        id: o1,
        motivo: 'SINTETICO: dieta oral',
        usuario: AUTOR,
      });
      await registrarAlteracaoHotSgh(e, {
        hospital: a.cod,
        tabela: 'SGH_HOT_LACTARIO_ORDEM',
        id: o1,
        evento: 'cancelada',
        antes: 'conferida',
        depois: 'cancelada',
        motivo: 'SINTETICO: dieta oral',
        usuario: AUTOR,
      });
      r['cancelarDeNovo'] = await codigoDe(
        cancelarOrdemLactarioSgh(e, { hospital: a.cod, id: o1, motivo: 'x', usuario: AUTOR }),
      );
      const ol = await ordemLactario(e, a.cod, o1);
      r['ordem'] = [
        ol?.formula,
        ol?.situacao,
        ol?.canceladaPor,
        ol?.etiquetaEm !== null,
        ol?.motivoCancelamento,
      ];
      r['logOrdem'] = (await alteracoesHot(e, a.cod, 'SGH_HOT_LACTARIO_ORDEM', [o1])).map((x) => x.evento);

      // ── A refeição do acompanhante alterada (o anterior relido com a observação; o fim com o início conferido).
      const ac = await registrarDietaAcompanhanteSgh(e, {
        hospital: a.cod,
        reg,
        pront: reg,
        baseLegal: 'idoso',
        refeicoes: [1, 2],
        inicio: '2026-11-10',
        fim: null,
        observacao: 'SINTETICO: sem lactose',
        usuario: AUTOR,
      });
      const acAntes = await alterarDietaAcompanhanteSgh(e, {
        hospital: a.cod,
        id: ac,
        dieta: 'Hipossódica',
        refeicoes: [4, 1],
        fim: '2026-11-20',
        observacao: null,
      });
      r['acompAntes'] = acAntes;
      const acl = (await acompanhantesDaInternacao(e, a.cod, reg)).find((x) => x.id === ac);
      r['acomp'] = [acl?.dieta, acl?.refeicoes, acl?.fim];

      // ── Oncologia: ajustar (o anterior relido na transação), a recusa com prescrição ligada, suspender, retomar,
      //    cancelar; revogar com a recontagem; a oferta conferida na transação do ciclo novo.
      const tipos = await tiposDeProtocoloOncologico(e);
      const proto = {
        codigo: 'SGHT-W005R',
        nome: 'SINTETICO W0-05 revisao',
        tipo: tipos[0]!.codigo,
        intervaloDias: 7,
        ciclos: 6,
        farmacos: [
          { nome: 'Paclitaxel', dose: 80, unidade: 'mg/m2' as const, via: 'iv' as const, dias: [1] },
        ],
        referencia: 'SINTETICO',
      };
      const p = await publicarProtocoloOncologicoSgh(e, {
        hospital: a.cod,
        ...proto,
        indicacao: null,
        hash: await hashProtocolo(proto),
        vinculo: 1,
        usuario: AUTOR,
      });
      const sc = superficieCorporalOnco(70, 170);
      const doses = (reducaoPct: number) =>
        calcularDoses(proto.farmacos, { superficieM2: sc, pesoKg: 70, clearanceMlMin: null, reducaoPct });
      const ciclo = {
        ...pac,
        protocolo: p.id,
        codigoProtocolo: proto.codigo,
        dataPrevista: '2026-11-11',
        pesoKg: 70,
        alturaCm: 170,
        superficieM2: sc,
        creatininaMgDl: null,
        clearanceMlMin: null,
        reducaoPct: 0,
        motivoReducao: null,
        justificativaIntervalo: null,
        doses: doses(0),
        vinculo: 1,
        usuario: AUTOR,
      };
      const c1 = await registrarCicloOncologicoSgh(e, { ...ciclo, numero: 1 });
      const anterior = await ajustarCicloOncologicoSgh(e, {
        hospital: a.cod,
        id: c1,
        dataPrevista: '2026-11-12',
        reducaoPct: 20,
        motivoReducao: 'SINTETICO: neutropenia',
        justificativaIntervalo: null,
        doses: doses(20),
      });
      r['cicloAntes'] = [anterior.dataPrevista, anterior.reducaoPct, anterior.doses.map((d) => d.final)];
      await registrarEventoOncoSgh(e, {
        hospital: a.cod,
        evento: 'ciclo-ajustado',
        codigoProtocolo: proto.codigo,
        protocolo: p.id,
        ciclo: c1,
        prescricao: null,
        categoria: null,
        ciclosAfetados: null,
        antes: JSON.stringify(anterior),
        motivo: 'SINTETICO: toxicidade',
        vinculo: 1,
        usuario: AUTOR,
      });
      await vincularPrescricaoCicloSgh(e, {
        hospital: a.cod,
        ciclo: c1,
        prescricao: 99_999_001,
        dataPrevista: '2026-11-12',
        vinculo: 1,
        usuario: AUTOR,
      });
      r['ajusteComLigacao'] = await codigoDe(
        ajustarCicloOncologicoSgh(e, {
          hospital: a.cod,
          id: c1,
          dataPrevista: '2026-11-13',
          reducaoPct: 20,
          motivoReducao: 'SINTETICO: neutropenia',
          justificativaIntervalo: null,
          doses: doses(20),
        }),
      );
      r['ligarDataVelha'] = await codigoDe(
        vincularPrescricaoCicloSgh(e, {
          hospital: a.cod,
          ciclo: c1,
          prescricao: 99_999_002,
          dataPrevista: '2026-11-11',
          vinculo: 1,
          usuario: AUTOR,
        }),
      );
      await mudarAndamentoCicloSgh(e, { hospital: a.cod, id: c1, de: ['ativo'], para: 'suspenso' });
      await mudarAndamentoCicloSgh(e, { hospital: a.cod, id: c1, de: ['suspenso'], para: 'ativo' });
      const c2 = await registrarCicloOncologicoSgh(e, { ...ciclo, numero: 2, dataPrevista: '2026-11-19' });
      await mudarAndamentoCicloSgh(e, {
        hospital: a.cod,
        id: c2,
        de: ['ativo', 'suspenso'],
        para: 'cancelado',
      });
      r['retomarCancelado'] = await codigoDe(
        mudarAndamentoCicloSgh(e, { hospital: a.cod, id: c2, de: ['suspenso'], para: 'ativo' }),
      );
      const dep = await ciclosDaVersao(e, a.cod, p.id);
      r['dependencias'] = [dep.total, dep.emAndamento, dep.cortada];
      const rev = {
        hospital: a.cod,
        codigoProtocolo: proto.codigo,
        protocolo: p.id,
        motivo: 'SINTETICO: dose de referência errada',
        vinculo: 1,
        usuario: AUTOR,
      };
      r['revogarComMais'] = await codigoDe(revogarVersaoProtocoloSgh(e, { ...rev, emAndamentoCiente: 0 }));
      await revogarVersaoProtocoloSgh(e, { ...rev, emAndamentoCiente: 1 });
      r['revogarDeNovo'] = await codigoDe(revogarVersaoProtocoloSgh(e, { ...rev, emAndamentoCiente: 1 }));
      r['cicloNaRevogada'] = await codigoDe(
        registrarCicloOncologicoSgh(e, { ...ciclo, numero: 3, dataPrevista: '2026-11-26' }),
      );
      const p2 = await publicarProtocoloOncologicoSgh(e, {
        hospital: a.cod,
        ...proto,
        codigo: 'SGHT-W005I',
        indicacao: null,
        hash: await hashProtocolo({ ...proto, codigo: 'SGHT-W005I' }),
        vinculo: 1,
        usuario: AUTOR,
      });
      await registrarEventoOncoSgh(e, {
        hospital: a.cod,
        evento: 'protocolo-inativado',
        codigoProtocolo: 'SGHT-W005I',
        protocolo: null,
        ciclo: null,
        prescricao: null,
        categoria: null,
        ciclosAfetados: null,
        antes: null,
        motivo: 'SINTETICO: fora da padronização',
        vinculo: 1,
        usuario: AUTOR,
      });
      r['cicloNoInativo'] = await codigoDe(
        registrarCicloOncologicoSgh(e, {
          ...ciclo,
          protocolo: p2.id,
          codigoProtocolo: 'SGHT-W005I',
          numero: 1,
        }),
      );
      const evp = (await eventosDosProtocolos(e, a.cod)).filter((x) =>
        x.codigoProtocolo.startsWith('SGHT-W005'),
      );
      r['eventosProtocolos'] = evp.map((x) => [x.evento, x.ciclosAfetados]).sort();
      const evc = await eventosDosCiclos(e, a.cod, [c1]);
      r['antesNoEvento'] = JSON.parse(evc.find((x) => x.evento === 'ciclo-ajustado')!.antes!).reducaoPct;
      const lidos = await ciclosDoPaciente(e, a.cod, reg);
      r['ciclos'] = lidos.map((x) => [x.numero, x.dataPrevista, x.reducaoPct, x.andamento]).sort();
      return { r, escritas: await escritasDaTransacao(e0) };
    });
    console.log(`[W0-05 revisão] ${JSON.stringify(resumo.r)}`);
    expect(resumo.r).toMatchObject({
      triagemDeNovo: 'registro-ja-corrigido',
      triagem: ['retificacao', 'estorno', true],
      triagensLidas: 2,
      nptDeNovo: 'avaliacao-registrada',
      origem: ['informada', 'informada'],
      meta: ['nova-versao', 'encerramento'],
      acompanhamento: ['retificacao', 'estorno'],
      npt: [['ajustar', 'periferico', 950.5, true, false]],
      adendoDoEstornado: 'registro-ja-corrigido',
      ordemAntes: ['SINTETICO formula 1', 60, '2026-11-11T14:00', '2026-11-12T14:00', 'SINTETICO: morno'],
      alterarConferida: 'ordem-conferida',
      etiqueta: [1, 0],
      cancelarDeNovo: 'ordem-cancelada',
      ordem: ['SINTETICO formula 2', 'conferida', AUTOR, true, 'SINTETICO: dieta oral'],
      logOrdem: ['cancelada', 'alterada'],
      acompAntes: { dieta: null, refeicoes: [1, 2], fim: null, observacao: 'SINTETICO: sem lactose' },
      acomp: ['Hipossódica', [1, 4], '2026-11-20'],
      cicloAntes: ['2026-11-11', 0, [145.6]],
      ajusteComLigacao: 'ciclo-com-prescricao',
      ligarDataVelha: 'ciclo-desatualizado',
      retomarCancelado: 'ciclo-desatualizado',
      dependencias: [2, 1, false],
      revogarComMais: 'versao-com-ciclos',
      revogarDeNovo: 'versao-ja-revogada',
      cicloNaRevogada: 'versao-revogada',
      cicloNoInativo: 'protocolo-inativo',
      eventosProtocolos: [
        ['protocolo-inativado', null],
        ['versao-revogada', 2],
      ],
      antesNoEvento: 0,
      ciclos: [
        [1, '2026-11-12', 20, 'ativo'],
        [2, '2026-11-19', 0, 'cancelado'],
      ],
    });
    const tabelas = [...new Set(resumo.escritas.map((w) => w.tabela))].sort();
    console.log(`[W0-05 revisão] tabelas escritas na transação desfeita: ${tabelas.join(', ')}`);
    expect(tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
    expect(tabelas).toEqual(
      expect.arrayContaining([
        'SGH_PEP_NUTRI_TRIAGEM',
        'SGH_PEP_NUTRI_TERAPIA',
        'SGH_PEP_NUTRI_CORRECAO',
        'SGH_PEP_NUTRI_NPT_AVAL',
        'SGH_PEP_SOCIAL',
        'SGH_HOT_LACTARIO_ORDEM',
        'SGH_HOT_DIETA_ACOMP',
        'SGH_HOT_ALTERACAO',
        'SGH_PEP_ONCO_CICLO',
        'SGH_PEP_ONCO_EVENTO',
      ]),
    );
    expect(await retrato()).toEqual(antes);
  });
});
