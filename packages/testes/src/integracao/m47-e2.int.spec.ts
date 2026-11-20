// Etapa 2 do M47 sobre a cópia (ficha, seções 4, 5, 8 e 10), sempre em transação desfeita e sob a trava:
//   - as leituras da etapa (a fila da imuno-hematologia, a tipagem e as provas, o estoque com o teto, o histórico da
//     bolsa, os exames imuno-hematológicos já lançados na conta pelo prontuário), com o tempo de cada uma (saída só com
//     contagens; abaixo de 5 vira "<5");
//   - regras 3 e 6 (bolsa, imuno): a requisição e a amostra no novo; a tipagem registrada e a liberação pela mesma pessoa
//     recusada, por outra aceita; a bolsa recebida (o mesmo número de novo recusado) e a prova cruzada; a reserva; o
//     início do ato com a bolsa conferida no estoque NA MESMA transação (a bolsa em quarentena recusada); a bolsa
//     transfundida pelo ato não se movimenta mais; só tabelas SGH_ escritas;
//   - regra 6 (liberacao-agencia): a chave `agencia.completa` ligada em lote no estabelecimento só vale com o
//     pré-requisito cumprido (a DP-21), e os passos do fluxo passam a ser os da agência própria;
//   - o ROLLBACK conferido pelas contagens (iguais antes e depois).
// Nenhum nome nem documento sai daqui; os textos levam a marca "SINTETICO M47".
import { recursoDesligado } from '@sgh/contratos';
import { chaveLibera, recursoLigadoNoEstabelecimento } from '@sgh/dominio-config';
import { passosDoFluxo } from '@sgh/dominio-sadt';
import {
  aplicarLoteLiberacao,
  bolsasDoEstoque,
  cadastrosDoEstoque,
  ErroOperacao,
  escritasDaTransacao,
  examesImunoLancados,
  gravarPrerequisito,
  imunoHematologias,
  iniciarTransfusaoSgh,
  type Leitor,
  lerChavesLiberacao,
  lerPrerequisitos,
  liberarImunoHematologiaSgh,
  movimentarBolsaSgh,
  movimentosDaBolsa,
  provasCruzadasDaRequisicao,
  receberBolsaSgh,
  registrarAmostraTransfusionalSgh,
  registrarImunoHematologiaSgh,
  requisitarTransfusaoSgh,
  resultadosImunoDoPaciente,
  somenteSgh,
  ultimaTipagemLancada,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Ambiente,
  ctx,
  num,
  PODE_ESCREVER,
  partirSemDecisao,
  prepararAmbiente,
} from './escrita.spec-util.js';

const MARCA = 'SINTETICO M47';
const mascara = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));
const codigo = (x: unknown) => (x instanceof ErroOperacao ? String(x.problema.codigo ?? '') : String(x));
const TABELAS = [
  'SGH_SADT_HEMO_REQ',
  'SGH_SADT_HEMO_AMOSTRA',
  'SGH_SADT_HEMO_IMUNO',
  'SGH_SADT_HEMO_BOLSA',
  'SGH_SADT_HEMO_BOLSA_MOV',
  'SGH_SADT_HEMO_ATO',
  'SGH_SADT_HEMO_ATO_SINAL',
  // A liberação ensaiada na regra 6 (as chaves e os pré-requisitos por estabelecimento).
  'SGH_CFG_LIBERACAO',
  'SGH_CFG_PREREQUISITO',
];
/** A trilha gravada pelo ensaio (o usuário sintético da integração, pelo índice de usuário). */
const USUARIO_ENSAIO = 'SINT.M47';
const PACIENTE = 999_472_901;
const ATENDIMENTO = 999_472_902;
const ITEM = 999_472_903;

async function contagens(l: Pick<Leitor, 'consultar'>, hospital: string): Promise<number[]> {
  const r: number[] = [];
  for (const t of TABELAS)
    r.push(num((await l.consultar(`SELECT COUNT(*) N FROM ${t}`, [], { teto: 1 }))[0]?.['N'] ?? 0));
  r.push(
    num(
      (
        await l.consultar(
          'SELECT COUNT(*) N FROM SGH_TRILHA WHERE HOSPITAL = ? AND USUARIO = ?',
          [hospital, USUARIO_ENSAIO],
          { teto: 1 },
        )
      )[0]?.['N'] ?? 0,
    ),
  );
  return r;
}

describe.skipIf(!PODE_ESCREVER)('M47 etapa 2 na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let antes: number[];
  beforeAll(async () => {
    a = await prepararAmbiente();
    antes = await a.nucleo.lerSomente(ctx(a), (l) => contagens(l, a.cod));
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('as leituras da etapa: fila, tipagem e provas, estoque, histórico e exames de tipagem lançados (contagens e tempos)', async () => {
    const tempos: Record<string, number> = {};
    const medir = async <T>(nome: string, fn: () => Promise<T>) => {
      const t0 = performance.now();
      const r = await fn();
      tempos[nome] = Math.round(performance.now() - t0);
      return r;
    };
    const agora = '2026-10-25T10:00';
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const fila = await medir('fila', () => imunoHematologias(l, { hospital: a.cod, estado: 'registrado' }));
      const tipagem = await medir('tipagem', () => resultadosImunoDoPaciente(l, a.cod, PACIENTE));
      const provas = await medir('provas', () => provasCruzadasDaRequisicao(l, a.cod, 1));
      const estoque = await medir('estoque', () => bolsasDoEstoque(l, { hospital: a.cod, agora }));
      const historico = await medir('historico', () => movimentosDaBolsa(l, a.cod, 1));
      // O lançamento mais recente da tipagem no laboratório (o exame em uso no cadastro), só para medir.
      const ult = await ultimaTipagemLancada(l);
      const prontuario = ult?.prontuario ?? 0;
      const naData = `${ult?.dia ?? '2026-10-25'}T12:00`;
      const exames = await medir('examesLancados', () => examesImunoLancados(l, prontuario, naData));
      return {
        fila: fila.itens.length,
        tipagem: tipagem.length,
        provas: provas.length,
        estoque: estoque.itens.length,
        historico: historico.length,
        exames: exames.length,
        codigos: [...new Set(exames.map((x) => x.exame))],
      };
    });
    console.log(`[m47.2] leituras ${JSON.stringify({ ...r, exames: mascara(r.exames), tempos })}`);
    expect(r.exames).toBeGreaterThan(0);
    expect(r.codigos).toContain('TIPS');
    for (const t of Object.values(tempos)) expect(t).toBeLessThan(1_000);
  });

  it('regras 3 e 6: tipagem com a dupla conferência, bolsa, prova, reserva, início com a bolsa do estoque na transação', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e0) => {
      const e = somenteSgh(e0);
      const h = a.cod;
      const q = await requisitarTransfusaoSgh(e, {
        hospital: h,
        item: ITEM,
        prescricao: 999_472_904,
        atendimento: ATENDIMENTO,
        paciente: PACIENTE,
        hemocomponente: 'CH',
        quantidadeBolsas: 1,
        volumeMl: null,
        urgencia: 2,
        programadaPara: null,
        prazo: '2026-10-26T10:00',
        indicacao: `Indicacao ${MARCA} da integracao`,
        examesDeApoio: null,
        termo: 999_472_999,
        justificativaUrgencia: null,
        transfusaoAnterior: 'nao',
        reacaoAnterior: 'nao',
        gestacaoAnterior: 'naoSeAplica',
        usuario: 'SINT.MEDICO',
        chave: null,
      });
      await registrarAmostraTransfusionalSgh(e, {
        hospital: h,
        requisicao: q.id,
        pulseiraLida: true,
        motivoSemPulseira: null,
        coletadaEm: '2026-10-25T09:00',
        validaAte: '2026-10-28T09:00',
        usuario: 'SINT.ENF',
        estacao: 'integracao-m47',
        chave: null,
      });
      const comum = {
        hospital: h,
        paciente: PACIENTE,
        requisicao: q.id,
        metodo: 'gelTeste' as const,
        origem: 'digitado' as const,
        exameLancado: null,
        observacao: null,
        usuario: 'SINT.BIO',
        chave: null,
      };
      const tip = await registrarImunoHematologiaSgh(e, {
        ...comum,
        tipo: 'aboRh',
        direta: { antiA: 4, antiB: 0, antiD: 4, controle: 0 },
        reversa: { hemaciaA1: 0, hemaciaB: 4 },
        tipagem: { abo: 'A', rh: 'positivo' },
      });
      const mesma = await liberarImunoHematologiaSgh(e, {
        hospital: h,
        id: tip.id,
        usuario: 'SINT.BIO',
      }).catch(codigo);
      await liberarImunoHematologiaSgh(e, { hospital: h, id: tip.id, usuario: 'SINT.HEMO' });
      const numero = `SINT47I${String(Date.now()).slice(-6)}`;
      const bolsa = (n: string, situacao: 'liberada' | 'quarentena', local = 0) =>
        receberBolsaSgh(e, {
          hospital: h,
          numero: n,
          hemocomponente: 'CH',
          tipagem: { abo: 'A', rh: 'positivo' },
          volumeMl: 290,
          validade: '2026-12-31T23:59',
          origem: `Hemocentro ${MARCA}`,
          local,
          irradiada: false,
          leucorreduzida: true,
          temperaturaC: situacao === 'liberada' ? 4 : 15,
          inspecaoOk: true,
          situacao,
          usuario: 'SINT.BIO',
          chave: null,
        });
      const b = await bolsa(numero, 'liberada');
      const repetida = await bolsa(numero, 'liberada').catch(codigo);
      const quarentena = await bolsa(`${numero}Q`, 'quarentena');
      // O local e o motivo do cadastro relidos na transação; a quarentena da temperatura sai só com o motivo.
      // Um código fora do cadastro (pela leitura do adaptador; teto 500, os cadastros reais têm poucas linhas).
      const cad = await cadastrosDoEstoque(e as unknown as Leitor);
      const fora = (xs: readonly { readonly codigo: number }[]) => {
        let c = 32_767;
        while (xs.some((x) => x.codigo === c)) c--;
        return c;
      };
      const semLocal = await bolsa(`${numero}L`, 'liberada', fora(cad.locais)).catch(codigo);
      const quente = await bolsa(`${numero}T`, 'quarentena');
      const mover = (x: {
        acao: 'liberar' | 'descartar';
        motivo: string | null;
        motivoCadastro: number | null;
      }) =>
        movimentarBolsaSgh(e, {
          hospital: h,
          bolsa: quente.id,
          requisicao: null,
          versao: 0,
          agora: '2026-10-25T10:00',
          usuario: 'SINT.BIO',
          chave: null,
          ...x,
        }).catch(codigo);
      const semMotivo = await mover({ acao: 'liberar', motivo: null, motivoCadastro: null });
      const semCadastro = await mover({
        acao: 'descartar',
        motivo: `Descarte ${MARCA}`,
        motivoCadastro: fora(cad.motivos),
      });
      const comMotivo = await mover({ acao: 'liberar', motivo: `Reaferida ${MARCA}`, motivoCadastro: null });
      const prova = await registrarImunoHematologiaSgh(e, {
        ...comum,
        tipo: 'provaCruzada',
        bolsa: numero,
        resultado: 'compativel',
        faseAntiglobulina: true,
        tipagem: null,
      });
      await liberarImunoHematologiaSgh(e, { hospital: h, id: prova.id, usuario: 'SINT.HEMO' });
      await movimentarBolsaSgh(e, {
        hospital: h,
        bolsa: b.id,
        acao: 'reservar',
        requisicao: q.id,
        motivoCadastro: null,
        motivo: null,
        versao: 0,
        agora: '2026-10-25T10:00',
        usuario: 'SINT.BIO',
        chave: null,
      });
      const inicio = (n: string) =>
        iniciarTransfusaoSgh(e, {
          hospital: h,
          requisicao: q.id,
          horario: null,
          bolsa: {
            numero: n,
            hemocomponente: 'CH',
            abo: 1,
            rh: 1,
            validade: '2026-12-31T23:59',
            volumeMl: 290,
          },
          inicioEm: '2026-10-25T10:30',
          pulseiraLida: true,
          motivoSemPulseira: null,
          profissional: 'SINT.ENF',
          conferente: 'SINT.ENF.APOIO',
          alertas: [],
          justificativaRh: null,
          sinaisAntes: { pas: 120, pad: 80, fc: 80, temperatura: 36.5 },
          sinaisAntesEm: '2026-10-25T10:25',
          chave: null,
          estoque: true,
        });
      const naoLiberada = await inicio(`${numero}Q`).catch(codigo);
      const ato = await inicio(numero);
      const depois = await movimentarBolsaSgh(e, {
        hospital: h,
        bolsa: b.id,
        acao: 'descartar',
        requisicao: null,
        motivoCadastro: 0,
        motivo: `Descarte ${MARCA}`,
        versao: 1,
        agora: '2026-10-25T11:00',
        usuario: 'SINT.BIO',
        chave: null,
      }).catch(codigo);
      const lida = await bolsasDoEstoque(e as unknown as Leitor, {
        hospital: h,
        agora: '2026-10-25T11:00',
        numero,
      });
      const tipagem = await resultadosImunoDoPaciente(e as unknown as Leitor, h, PACIENTE);
      const escritas = await escritasDaTransacao(e0);
      return {
        mesma,
        repetida,
        naoLiberada,
        ato: ato.id > 0,
        depois,
        situacoes: lida.itens.map((x) => x.situacao),
        liberadas: tipagem.filter((x) => x.estado === 'liberado').length,
        quarentena: quarentena.id > 0,
        semLocal,
        semMotivo,
        semCadastro,
        comMotivo: typeof comMotivo === 'string' ? comMotivo : comMotivo.situacao,
        tabelas: escritas.map((x) => x.tabela),
      };
    });
    console.log(`[m47.2] escrita ${JSON.stringify(r)}`);
    expect(r.mesma).toBe('mesmo-profissional');
    expect(r.repetida).toBe('bolsa-ja-recebida');
    expect(r.semLocal).toBe('local-inexistente');
    expect(r.semMotivo).toBe('motivo-da-liberacao');
    expect(r.semCadastro).toBe('motivo-inexistente');
    expect(r.comMotivo).toBe('liberada');
    expect(r.naoLiberada).toBe('bolsa-indisponivel');
    expect(r.ato).toBe(true);
    expect(r.depois).toBe('bolsa-transfundida');
    expect(r.situacoes).toContain('transfundida');
    expect(r.liberadas).toBe(1);
    expect(r.tabelas.length).toBeGreaterThan(0);
    expect(r.tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
  });

  it('regra 6 (liberação): agencia.completa ligada em lote só vale com o pré-requisito (DP-21); os passos da agência própria', async () => {
    const hospital = a.cod;
    const trilha = (operacao: string) => ({
      rede: a.nucleo.rede,
      hospital,
      usuario: USUARIO_ENSAIO,
      evento: `config.liberacao.${operacao}`,
      recurso: 'config.liberacao',
      operacao,
      chaveNaturalAlvo: null,
      resultado: 'sucesso',
      estacao: 'integracao-m47',
      correlacao: `m47e2-liberacao-${Date.now().toString(36)}`,
    });
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // M61: a cópia pode estar com a liberação full; o teste parte do "sem decisão" na própria transação.
      for (const chave of ['agencia.transfusao', 'agencia.completa'])
        await partirSemDecisao(e, { rede: a.nucleo.rede, hospital, chave });
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
      const antesC = await estado('agencia.completa');
      for (const chave of ['agencia.transfusao', 'agencia.completa'])
        await aplicarLoteLiberacao(
          e,
          {
            hospital,
            tipo: 'recurso',
            chave,
            planejar: ({ chaves }) => [
              {
                escopo: 'hospital',
                valor: '*',
                ligada: true,
                antes: chaves.find((c) => c.escopo === 'hospital' && c.valor === '*')?.ligada ?? null,
              },
            ],
            justificativa: `ensaio da etapa 2 (${MARCA})`,
            autor: 'SINT.M47',
          },
          trilha('ligar'),
        );
      const chaveLigada = chaveLibera(
        (await lerChavesLiberacao(e, hospital)).filter((c) => c.chave === 'agencia.completa'),
        'SINT.M47',
        undefined,
        undefined,
      );
      const semPrerequisito = await estado('agencia.completa');
      for (const chave of ['agencia.transfusao', 'agencia.completa'])
        for (const d of recursoDesligado(chave)?.prerequisitos ?? [])
          await gravarPrerequisito(
            e,
            {
              hospital,
              recurso: chave,
              tipo: d.tipo,
              situacao: 'cumprido',
              validade: null,
              evidencia: `ensaio ${MARCA}`,
              autor: 'SINT.M47',
            },
            trilha('prerequisito'),
          );
      return {
        antesC,
        chaveLigada,
        semPrerequisito,
        transfusao: await estado('agencia.transfusao'),
        completa: await estado('agencia.completa'),
      };
    });
    console.log(`[m47.2] liberacao ${JSON.stringify(r)}`);
    expect(r.antesC).toBe(false);
    expect(r.chaveLigada).toBe(true);
    expect(r.semPrerequisito).toBe(false);
    expect(r.completa).toBe(true);
    expect(passosDoFluxo({ transfusaoLigada: r.transfusao, agenciaCompleta: r.completa })).toEqual([
      'requisicao',
      'amostra',
      'imunoHematologia',
      'provaCruzada',
      'liberacaoDaBolsa',
      'ato',
      'reacao',
    ]);
  });

  it('o ROLLBACK devolve tudo (contagens iguais)', async () => {
    expect(await a.nucleo.lerSomente(ctx(a), (l) => contagens(l, a.cod))).toEqual(antes);
  });
});
