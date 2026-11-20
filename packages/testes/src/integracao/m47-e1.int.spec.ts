// Etapa 1 do M47 sobre a cópia (ficha, seções 4, 5, 8 e 10), sempre em transação desfeita e sob a trava:
//   - as leituras da etapa (os itens de hemoterapia da prescrição vigente com o teto, o item, os horários, a tipagem do
//     cadastro, os tipos de transfusão e de tipagem, as requisições, os atos e as reações), com o tempo de cada uma
//     (meta a propor: p95 < 500 ms; saída só com contagens, abaixo de 5 vira "<5");
//   - regra 2 (ato-transfusional): um médico da cópia prescreve a hemoterapia (pep.prescrever, M24), a requisição e a
//     amostra no novo, e o início da transfusão checa o horário do item pelo EXECUTOR (enfermagem.checarAdministracao,
//     cenário hemocomponente) com o ato transfusional, os sinais de antes e a requisição no registro próprio da MESMA
//     transação; o reenvio com a mesma chave (a volta da rede) não duplica nada; sem o segundo profissional, a entrada é
//     recusada e nada é gravado;
//   - regras 4 e 7 (balanco-hemocomponente): os sinais aos 10 a 15 minutos, a conclusão com o ganho no balanço hídrico
//     pela chave do ato (o mesmo ganho de novo devolve o já lançado) e a segunda conclusão recusada; a reação depois do
//     ato com a notificação sugerida; tudo relido pelas leituras das telas e o monitoramento só com as tabelas da receita
//     e as SGH_;
//   - regra 6 (liberacao-agencia): a chave `agencia.transfusao` ligada em lote no estabelecimento (transação desfeita)
//     só vale com o pré-requisito cumprido; a `agencia.completa` (DP-21) segue desligada e os passos do fluxo são os da
//     etapa 1;
//   - o ROLLBACK conferido pelas maiores chaves e contagens (iguais antes e depois).
// Nenhum nome nem documento sai daqui; os textos levam a marca "SINTETICO M47".
import { recursoDesligado } from '@sgh/contratos';
import { chaveLibera, recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import { janelaDoInstante } from '@sgh/dominio-enfermagem';
import { passosDoFluxo } from '@sgh/dominio-sadt';
import {
  aplicarLoteLiberacao,
  atosTransfusionais,
  cadastrosDeTipagem,
  concluirTransfusaoSgh,
  ErroOperacao,
  escritasDaTransacao,
  gravarPrerequisito,
  horarioPorId,
  horariosDoItemHemoterapia,
  itemHemoterapiaDaLinha,
  itemHemoterapiaPorId,
  itensHemoterapiaAAtender,
  lancarBalancoSgh,
  type Leitor,
  lerChavesLiberacao,
  lerPrerequisitos,
  operacao,
  reacoesTransfusionais,
  registrarAmostraTransfusionalSgh,
  registrarReacaoTransfusionalSgh,
  registrarSinaisTransfusaoSgh,
  requisicaoTransfusional,
  requisicoesTransfusionais,
  requisitarTransfusaoSgh,
  somenteSgh,
  tipagemDoCadastro,
  tiposDeTransfusao,
  ultimaPrescricaoHemoterapia,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  enfermagemDaCopia,
  entradaDaChecagem,
  estadoEnfermagem,
  horariosDaPrescricao,
} from '../massa/reproducao-enfermagem.js';
import {
  atendimentoAberto,
  cadastrosDoCenario,
  gravacaoDe,
  itemDaForma,
  prescritorDaCopia,
} from '../massa/reproducao-prescricao.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  partirSemDecisao,
  prepararAmbiente,
} from './escrita.spec-util.js';

const MARCA = 'SINTETICO M47';
const t0Teste = Date.now();
const passo = (s: string) => console.log(`[m47] ${s} (${Math.round((Date.now() - t0Teste) / 1000)} s)`);
const mascara = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
const codigo = (x: unknown) => (x instanceof ErroOperacao ? String(x.problema.codigo ?? '') : String(x));
const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const mais = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

/** As contagens das tabelas SGH_ da agência e do balanço, onde vai o ganho da conclusão (o ROLLBACK as devolve). */
async function contagensAgencia(l: Pick<Leitor, 'consultar'>): Promise<number[]> {
  const r: number[] = [];
  for (const t of [
    'SGH_SADT_HEMO_REQ',
    'SGH_SADT_HEMO_AMOSTRA',
    'SGH_SADT_HEMO_ATO',
    'SGH_SADT_HEMO_ATO_SINAL',
    'SGH_SADT_HEMO_REACAO',
    'SGH_PEP_BALANCO',
    'SGH_PEP_BALANCO_TRAVA',
  ])
    r.push(num((await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 }))[0]?.['N'] ?? 0));
  return r;
}

describe.skipIf(!PODE_ESCREVER)('M47 etapa 1 na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let antes: number[];
  let antesAgencia: number[];
  beforeAll(async () => {
    a = await prepararAmbiente();
    antes = await a.nucleo.lerSomente(ctx(a), (l) => estadoEnfermagem(l));
    antesAgencia = await a.nucleo.lerSomente(ctx(a), (l) => contagensAgencia(l));
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('as leituras da etapa: itens a atender com o teto, item, horários, tipagem e cadastros, requisições, atos e reações (contagens e tempos)', async () => {
    const tempos: Record<string, number> = {};
    const medir = async <T>(nome: string, fn: () => Promise<T>) => {
      const t0 = performance.now();
      const r = await fn();
      tempos[nome] = Math.round(performance.now() - t0);
      return r;
    };
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      // O retrato da cópia é de dias atrás: a vigência é a do instante logo depois da prescrição de hemoterapia mais
      // recente (ao menos um item vigente).
      const ultima = (await ultimaPrescricaoHemoterapia(l)) ?? new Date();
      const itens = await medir('itens', () =>
        itensHemoterapiaAAtender(l, { agora: new Date(ultima.getTime() + 60_000), hospital: a.cod }),
      );
      const primeiro = itens.itens[0];
      const item = primeiro ? await medir('item', () => itemHemoterapiaPorId(l, primeiro.item)) : null;
      const horarios = primeiro
        ? await medir('horarios', () => horariosDoItemHemoterapia(l, primeiro.item))
        : [];
      const tipagem = primeiro
        ? await medir('tipagem', () => tipagemDoCadastro(l, primeiro.paciente.id))
        : null;
      const tipos = await medir('tiposTransfusao', () => tiposDeTransfusao(l));
      const cad = await medir('cadastrosTipagem', () => cadastrosDeTipagem(l));
      const reqs = await medir('requisicoes', () =>
        requisicoesTransfusionais(l, { hospital: a.cod, agora: iso(new Date()) }),
      );
      const atos = await medir('atos', () => atosTransfusionais(l, { hospital: a.cod, de: '2026-01-01' }));
      const reacoes = await medir('reacoes', () =>
        reacoesTransfusionais(l, { hospital: a.cod, de: '2026-01-01' }),
      );
      return { itens, item, horarios, tipagem, tipos, cad, reqs, atos, reacoes };
    });
    console.log(
      JSON.stringify({
        itensVigentes: mascara(r.itens.itens.length),
        cortada: r.itens.cortada,
        horariosDoPrimeiro: mascara(r.horarios.length),
        tipagemConhecida: r.tipagem ? r.tipagem.abo !== null : null,
        tiposDeTransfusao: r.tipos.map((t) => t.id),
        tiposConhecidos: r.cad.tipos.filter((t) => t.conhecido).length,
        fatoresConhecidos: r.cad.fatores.filter((t) => t.conhecido).length,
        requisicoes: mascara(r.reqs.itens.length),
        atos: mascara(r.atos.length),
        reacoes: mascara(r.reacoes.length),
        tempos,
      }),
    );
    expect(r.itens.itens.length).toBeGreaterThan(0);
    expect(r.itens.itens.length).toBeLessThanOrEqual(100);
    if (r.itens.itens[0]) expect(r.item?.item).toBe(r.itens.itens[0].item);
    expect(r.horarios.length).toBeLessThanOrEqual(50);
    // Os 4 tipos de transfusão da RDC 34 com os IDs 1 a 4 (os códigos da urgência).
    expect(r.tipos.map((t) => t.id).filter((x) => x >= 1 && x <= 4)).toEqual([1, 2, 3, 4]);
    expect(r.cad.tipos.filter((t) => t.conhecido)).toHaveLength(4);
    expect(r.cad.fatores.filter((t) => t.conhecido)).toHaveLength(2);
    // O tempo-alvo é meta a propor (Fase 5, regra 8): aqui só a folga larga da cópia compartilhada.
    for (const ms of Object.values(tempos)) expect(ms).toBeLessThan(10_000);
  });

  it('regras 2, 4, 5 e 7: a checagem do hemocomponente grava o ato na mesma transação; o reenvio não duplica; sem dupla checagem, nada; o ganho uma vez só', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const medico = await prescritorDaCopia(e, '2251');
      const enf = await enfermagemDaCopia(e, medico);
      const conferente = await enfermagemDaCopia(e, enf);
      const at = await atendimentoAberto(e);
      const c = await cadastrosDoCenario(e);
      const item = await itemDaForma(e, { tipo: 'hemoterapia', frequencia: 3, horarios: 1 }, 0, c, []);
      const g = await gravacaoDe(e, at, medico, [item], c);
      const op = { escritor: e };
      const p = await a.executor.executar(
        operacao('pep.prescrever'),
        a.cod,
        g,
        ctxOperacao(a, medico.login),
        op,
      );
      const prescricao = num(p.resultado['prescricao']);
      passo('hemoterapia prescrita');
      const [h] = (await horariosDaPrescricao(e, prescricao)).filter((x) => x.faixa === null);
      if (!h) throw new Error('A prescrição de hemoterapia não gravou horário.');
      const idItem = (await itemHemoterapiaDaLinha(e, h.item)) ?? 0;
      const [ag] = await e.consultar('SELECT CURRENT_TIMESTAMP T FROM RDB$DATABASE', [], { teto: 1 });
      const agora = ag?.['T'] as Date;
      const s = somenteSgh(e);
      const req = await requisitarTransfusaoSgh(s, {
        hospital: a.cod,
        item: idItem,
        prescricao,
        atendimento: at.id,
        paciente: at.paciente,
        hemocomponente: 'CH',
        quantidadeBolsas: 1,
        volumeMl: null,
        urgencia: 2,
        programadaPara: null,
        prazo: iso(mais(agora, 24 * 60)),
        indicacao: `Indicacao ${MARCA} da integracao`,
        examesDeApoio: null,
        termo: 999_470_499,
        justificativaUrgencia: null,
        transfusaoAnterior: 'nao',
        reacaoAnterior: 'nao',
        gestacaoAnterior: 'naoSeAplica',
        usuario: medico.login,
        chave: `int-m47-req-${Date.now().toString(36)}`,
      });
      await registrarAmostraTransfusionalSgh(s, {
        hospital: a.cod,
        requisicao: req.id,
        pulseiraLida: true,
        motivoSemPulseira: null,
        coletadaEm: iso(mais(agora, -60)),
        validaAte: iso(mais(agora, 71 * 60)),
        usuario: enf.login,
        estacao: 'integracao-m47',
        chave: null,
      });
      passo('requisição e amostra no novo');
      const base = entradaDaChecagem(
        {
          prescricao,
          atendimento: at.id,
          paciente: at.paciente,
          cbo: enf.cbo,
          horario: h,
          situacao: 'A',
          quantidade: 1,
          justificativa: null,
        },
        agora,
      );
      const bloco = {
        requisicao: req.id,
        bolsa: {
          numero: `SINT${String(req.id).slice(-10)}`,
          hemocomponente: 'CH',
          abo: 4,
          rh: 2,
          validade: iso(mais(agora, 30 * 24 * 60)),
          volumeMl: 300,
        },
        inicioEm: iso(agora),
        pulseiraLida: true,
        motivoSemPulseira: null,
        profissional: enf.login,
        conferente: conferente.login,
        alertas: [],
        justificativaRh: null,
        sinaisAntes: { pas: 120, pad: 80, fc: 80, temperatura: 36.5 },
        sinaisAntesEm: iso(agora),
        chave: null,
      };
      // Sem o segundo profissional: recusado pela entrada, nada gravado.
      let semDupla = '';
      try {
        await a.executor.executar(
          operacao('enfermagem.checarAdministracao'),
          a.cod,
          { ...base, hemocomponente: bloco },
          ctxOperacao(a, enf.login),
          op,
        );
      } catch (x) {
        semDupla = codigo(x);
      }
      const atosSemDupla = await atosTransfusionais(e, { hospital: a.cod, requisicao: req.id });
      const chave = `int-m47-ato-${Date.now().toString(36)}`;
      const entrada = {
        ...base,
        sgh: { ...base.sgh, conferente: conferente.login },
        hemocomponente: { ...bloco, chave },
      };
      const t0 = performance.now();
      const r1 = await a.executor.executar(
        operacao('enfermagem.checarAdministracao'),
        a.cod,
        entrada,
        ctxOperacao(a, enf.login, chave),
        op,
      );
      const ms = Math.round(performance.now() - t0);
      const relido = await horarioPorId(e, h.id, a.cod);
      const atos1 = await atosTransfusionais(e, { hospital: a.cod, requisicao: req.id });
      passo('início com a dupla checagem');
      // O reenvio com a mesma chave (a volta da rede): o resultado original, sem novo ato.
      const r2 = await a.executor.executar(
        operacao('enfermagem.checarAdministracao'),
        a.cod,
        entrada,
        ctxOperacao(a, enf.login, chave),
        op,
      );
      const atos2 = await atosTransfusionais(e, { hospital: a.cod, requisicao: req.id });
      const ato = atos1[0]!;
      await registrarSinaisTransfusaoSgh(s, {
        hospital: a.cod,
        ato: ato.id,
        momento: 'durante',
        sinais: { pas: 118, pad: 78, fc: 86, temperatura: 36.7 },
        medidoEm: iso(mais(agora, 12)),
        foraJanela: false,
        usuario: enf.login,
        chave: null,
      });
      const janela = janelaDoInstante(iso(mais(agora, 1)), '07:00').inicio;
      const conc = await concluirTransfusaoSgh(s, {
        hospital: a.cod,
        ato: ato.id,
        terminoEm: iso(mais(agora, 1)),
        volumeTransfundidoMl: 290,
        interrompida: false,
        motivoInterrupcao: null,
        usuario: enf.login,
        janelaBalanco: janela,
      });
      // Regra 7: o mesmo ganho de novo (a chave do ato) devolve o já lançado; a segunda conclusão é recusada.
      const deNovo = await lancarBalancoSgh(s, {
        hospital: a.cod,
        paciente: at.paciente,
        atendimento: at.id,
        sentido: 'ganho',
        grupo: 4,
        via: null,
        tipoEliminacao: null,
        intensidade: null,
        aspecto: null,
        estimado: false,
        volumeMl: 290,
        horaReal: iso(mais(agora, 1)),
        descricao: null,
        origemOffline: false,
        usuario: enf.login,
        chave: `hemo-ato:${ato.id}`,
        janelaInicio: janela,
      });
      let segunda = '';
      try {
        await concluirTransfusaoSgh(s, {
          hospital: a.cod,
          ato: ato.id,
          terminoEm: iso(mais(agora, 2)),
          volumeTransfundidoMl: 290,
          interrompida: false,
          motivoInterrupcao: null,
          usuario: enf.login,
          janelaBalanco: janela,
        });
      } catch (x) {
        segunda = codigo(x);
      }
      await registrarSinaisTransfusaoSgh(s, {
        hospital: a.cod,
        ato: ato.id,
        momento: 'depois',
        sinais: { pas: 116, pad: 76, fc: 82, temperatura: 36.6 },
        medidoEm: iso(mais(agora, 2)),
        foraJanela: false,
        usuario: enf.login,
        chave: null,
      });
      const reacao = await registrarReacaoTransfusionalSgh(s, {
        hospital: a.cod,
        ato: ato.id,
        tipo: 'alergica',
        descricaoOutra: null,
        grau: 1,
        correlacao: 'provavel',
        inicioEm: iso(mais(agora, 3)),
        sinaisESintomas: `Urticaria ${MARCA}`,
        condutas: ['comunicarMedico', 'medicar'],
        condutaOutra: null,
        destinoBolsa: 'naoSeAplica',
        prioridade: 'rotina',
        usuario: enf.login,
        chave: null,
        sinais: null,
        interromper: null,
      });
      const requisicao = await requisicaoTransfusional(e, a.cod, req.id, iso(agora));
      const atosFim = await atosTransfusionais(e, { hospital: a.cod, requisicao: req.id });
      const reacoes = await reacoesTransfusionais(e, { hospital: a.cod, reacao: reacao.id });
      const escritas = await escritasDaTransacao(e);
      return {
        semDupla,
        atosSemDupla,
        r1,
        r2,
        relido,
        atos1,
        atos2,
        ms,
        conc,
        deNovo,
        segunda,
        requisicao,
        atosFim,
        reacoes,
        escritas,
        horario: h.id,
      };
    });
    console.log(
      JSON.stringify({
        semDupla: r.semDupla,
        inicioMs: r.ms,
        repetida: r.r2.repetida,
        tabelas: r.escritas.map((w) => w.tabela),
      }),
    );
    expect(r.semDupla).toBe('entrada-invalida');
    expect(r.atosSemDupla).toHaveLength(0);
    // Regra 2: o horário administrado e o ato na mesma transação, ligado ao horário; a chave repetida não duplica.
    expect(r.relido?.situacao).toBe('A');
    expect(r.atos1).toHaveLength(1);
    expect(r.atos1[0]).toMatchObject({ estado: 'emCurso', horario: r.horario, pulseiraLida: true });
    expect(r.atos1[0]!.sinais.map((x) => x.momento)).toEqual(['antes']);
    expect(r.r2.repetida).toBe(true);
    expect(r.atos2).toHaveLength(1);
    // Regras 4 e 7: os três momentos, o ganho uma vez, a requisição atendida, a segunda conclusão recusada.
    expect(r.conc.ganho).not.toBeNull();
    expect(r.deNovo).toEqual({ id: r.conc.ganho, repetida: true });
    expect(r.segunda).toBe('ato-encerrado');
    expect(r.atosFim[0]).toMatchObject({
      estado: 'concluido',
      ganhoLancado: true,
      volumeTransfundidoMl: 290,
    });
    expect(r.atosFim[0]!.sinais.map((x) => x.momento).sort()).toEqual(['antes', 'depois', 'durante']);
    expect(r.requisicao).toMatchObject({ estado: 'atendida', bolsasTransfundidas: 1 });
    // Regra 5: a reação com a sugestão de notificação (rotina no grau 1).
    expect(r.reacoes[0]).toMatchObject({
      tipo: 'alergica',
      notificacao: { prioridade: 'rotina', enviadaEm: null },
    });
    // As tabelas da receita da checagem (o hemocomponente sem extrato) e as SGH_ do ato na mesma transação; nada na
    // conta nem no estoque.
    const tabelas = r.escritas.map((w) => w.tabela);
    for (const t of [
      'PRCHKGERAL',
      'HTCHKGERAL',
      'PRASSINAT_DOC_PRCHKGERAL',
      'SGH_PEP_CHECAGEM_EXT',
      'SGH_SADT_HEMO_ATO',
    ])
      expect(tabelas).toContain(t);
    expect(tabelas.some((t) => ['FCLANEXT', 'GELANSAI', 'GESALDOS'].includes(t))).toBe(false);
  });

  it('regra 6 (liberação): agencia.transfusao ligada em lote só vale com o pré-requisito; agencia.completa segue desligada', async () => {
    const hospital = a.cod;
    const trilha = (operacao: string) => ({
      rede: a.nucleo.rede,
      hospital,
      usuario: 'SINT.M47',
      evento: `config.liberacao.${operacao}`,
      recurso: 'config.liberacao',
      operacao,
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: 'integracao-m47',
      correlacao: `m47-liberacao-${Date.now().toString(36)}`,
    });
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // M61: a cópia pode estar com a liberação full; o teste parte do "sem decisão" na própria transação.
      for (const chave of ['agencia.transfusao', 'agencia.completa'])
        await partirSemDecisao(e, { rede: a.nucleo.rede, hospital, chave });
      const declarados = recursoDesligado('agencia.transfusao')?.prerequisitos ?? [];
      const estado = async (chave: string) => {
        const chaves = (await lerChavesLiberacao(e, hospital)).filter((c) => c.chave === chave);
        const pre = (await lerPrerequisitos(e, hospital)).filter((p) => p.recurso === chave);
        return recursoLigadoNoEstabelecimento(
          chaves,
          recursoDesligado(chave)?.prerequisitos ?? [],
          pre,
          new Date(),
        );
      };
      const antesT = await estado('agencia.transfusao');
      await aplicarLoteLiberacao(
        e,
        {
          hospital,
          tipo: 'recurso',
          chave: 'agencia.transfusao',
          planejar: ({ chaves }) => [
            {
              escopo: 'hospital',
              valor: '*',
              ligada: true,
              antes: chaves.find((c) => c.escopo === 'hospital' && c.valor === '*')?.ligada ?? null,
            },
          ],
          justificativa: `ensaio da etapa 1 (${MARCA})`,
          autor: 'SINT.M47',
        },
        trilha('ligar'),
      );
      const chaveLigada = chaveLibera(
        (await lerChavesLiberacao(e, hospital)).filter((c) => c.chave === 'agencia.transfusao'),
        'SINT.M47',
        undefined,
        undefined,
      );
      const semPrerequisito = await estado('agencia.transfusao');
      for (const d of declarados)
        await gravarPrerequisito(
          e,
          {
            hospital,
            recurso: 'agencia.transfusao',
            tipo: d.tipo,
            situacao: 'cumprido',
            validade: null,
            evidencia: `ensaio ${MARCA}`,
            autor: 'SINT.M47',
          },
          trilha('prerequisito'),
        );
      const comPrerequisito = await estado('agencia.transfusao');
      const completa = await estado('agencia.completa');
      return {
        antesT,
        chaveLigada,
        semPrerequisito,
        comPrerequisito,
        completa,
        declarados: declarados.length,
      };
    });
    console.log(JSON.stringify(r));
    expect(r.declarados).toBeGreaterThan(0);
    expect(r.chaveLigada).toBe(true);
    expect(r.semPrerequisito).toBe(false);
    expect(r.comPrerequisito).toBe(true);
    expect(r.completa).toBe(false);
    expect(passosDoFluxo({ transfusaoLigada: r.comPrerequisito, agenciaCompleta: r.completa })).toEqual([
      'requisicao',
      'amostra',
      'recebimentoDoHemocentro',
      'ato',
      'reacao',
    ]);
  });

  it('o ROLLBACK devolve tudo (maiores chaves e contagens iguais)', async () => {
    expect(await a.nucleo.lerSomente(ctx(a), (l) => estadoEnfermagem(l))).toEqual(antes);
    expect(await a.nucleo.lerSomente(ctx(a), (l) => contagensAgencia(l))).toEqual(antesAgencia);
  });
});
