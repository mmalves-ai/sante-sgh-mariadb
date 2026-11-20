// Etapa 4 do M45 sobre a cópia (ficha, seções 4, 5, 6 e 10), sempre em transação desfeita e sob a trava:
//   - os domínios da SAE lidos da cópia (a escala de resultado e a classificação das metas), cada rótulo interpretado
//     (1 a 5 e o "não se aplica"; aumentar para, manter em, diminuir para);
//   - o perfil que decide o cenário condicional da ficha (prescrição de cuidado por enfermeiro) e a consulta de
//     enfermagem (só contagens; abaixo de 5 vira "<5");
//   - o ciclo só SGH_ numa transação desfeita: o processo (versão 1) com o diagnóstico, o resultado e a intervenção; a
//     evolução; a revisão (versão 2) e a recusa da versão antiga; as atividades; a checagem não feita com o motivo, o
//     estorno e a checagem de novo; a suspensão; a terminologia carregada; a receita do enfermeiro; a vacina com o
//     evento na fila de saída; tudo relido pelas leituras das telas (com o corpus CP1252 nas respostas) e o
//     monitoramento da transação só com tabelas SGH_;
//   - o ROLLBACK conferido pelas contagens das tabelas SGH_ do teste (pelo usuário do teste) iguais antes e depois.
// Saída só com contagens, códigos e tempos (nenhum nome; dados sintéticos).
import { dominiosDaSae, terminologiaDasLinhas } from '@sgh/dominio-enfermagem';
import { EVENTO_VACINA_APLICADA, TERMINOLOGIA_SAE_SINTETICA } from '@sgh/contratos';
import {
  atendimentosExternosDoDia,
  atividadePorId,
  atividadesVigentes,
  carregarTerminologiaSaeSgh,
  checagemCuidadoPorId,
  checagensDosCuidados,
  checarCuidadoSgh,
  diaDaUltimaEntradaExterna,
  dominiosDaSaeLegado,
  ErroOperacao,
  escritasDaTransacao,
  estornarCuidadoSgh,
  evoluirSaeSgh,
  montarProcessoSae,
  perfilDaPrescricaoDeEnfermagem,
  prescreverCuidadoSgh,
  prescreverMedicamentoEnfermeiroSgh,
  provarRestricoesDaSae,
  receitasDoAtendimento,
  registrarSaeSgh,
  registrarVacinaSgh,
  saeDoAtendimento,
  somenteSgh,
  suspenderCuidadoSgh,
  terminologiaSaeCarregada,
  vacinasDoPaciente,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

const USUARIO = 'SGH.TESTE.M45';
const PACIENTE = 999_457_401;
const ATENDIMENTO = 999_457_402;
const VINCULO = 999_457_403;
/** O corpus CP1252 das respostas (acentos, cedilha, ordinal e travessão do CP1252). */
const CORPUS = 'Avaliação: pele íntegra, cooperação; nº 1 – “aspas” ç ã õ é';

const mascara = (n: number) => (n > 0 && n < 5 ? '<5' : String(n));

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo ?? 'sem-codigo';
    return /SGH_UQ_[A-Z_]+|SGH_CK_[A-Z_]+/.exec(String((e as Error).message))?.[0] ?? 'outro';
  }
}

describe.skipIf(!PODE_ESCREVER)('M45 etapa 4 na cópia (transação desfeita)', () => {
  let a: Ambiente;

  /** As linhas do usuário do teste nas tabelas SGH_ que o teste toca (só contagens). */
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const contar = async (tabela: string, usuario = USUARIO) =>
        Number(
          (
            await l.consultar(`SELECT COUNT(*) N FROM ${tabela} WHERE USUARIO = ?`, [usuario], { teto: 1 })
          )[0]?.['N'] ?? 0,
        );
      // A fila de saída não tem usuário: conta os eventos de vacina do estabelecimento do teste (o que
      // o conector do M34 leria e mandaria à RNDS se sobrasse depois do ROLLBACK).
      const fila = Number(
        (
          await l.consultar(
            `SELECT COUNT(*) N FROM SGH_OUTBOX WHERE TIPO = ? AND HOSPITAL = ?`,
            [EVENTO_VACINA_APLICADA, a.cod],
            { teto: 1 },
          )
        )[0]?.['N'] ?? 0,
      );
      return {
        filaDeSaidaVacina: fila,
        checagensDaProva: await contar('SGH_PEP_SAE_ATIVIDADE', 'SGH.PROVA'),
        sae: await contar('SGH_PEP_SAE'),
        itens: await contar('SGH_PEP_SAE_ITEM'),
        checagens: await contar('SGH_PEP_SAE_ATIVIDADE'),
        termos: await contar('SGH_PEP_SAE_TERMO'),
        receitas: await contar('SGH_PEP_PRESC_ENFERMEIRO'),
        vacinas: await contar('SGH_PEP_VACINA_APLICADA'),
      };
    });

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('os domínios da escala e das metas lidos da cópia, cada rótulo interpretado; o perfil (só contagens)', async () => {
    const inicio = Date.now();
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const d = await dominiosDaSaeLegado(l);
      const p = await perfilDaPrescricaoDeEnfermagem(l, { desde: new Date(Date.now() - 365 * 86_400_000) });
      return { d, p };
    });
    const dom = dominiosDaSae(r.d.escala, r.d.metas);
    console.log(
      JSON.stringify({
        escala: dom.escala.map((x) => x.valor),
        metas: dom.metas.map((x) => x.sentido),
        prescricoesDeCuidadoPorEnfermeiro: mascara(r.p.prescricoesDeCuidadoPorEnfermeiro),
        consultasDeEnfermagem: mascara(r.p.consultasDeEnfermagem),
        ms: Date.now() - inicio,
      }),
    );
    // 6 pontos (1 a 5 e o "não se aplica") e 3 metas (ficha, seção 3).
    expect(dom.escala).toHaveLength(6);
    expect(
      dom.escala
        .filter((x) => x.valor !== null)
        .map((x) => x.valor)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(dom.metas.map((x) => x.sentido).sort()).toEqual(['aumentar', 'diminuir', 'manter']);
  });

  it('a escolha da sala de vacina: os atendimentos externos de um dia lidos da cópia pelo índice da entrada (só contagens)', async () => {
    const inicio = Date.now();
    // O dia: o da última entrada externa da cópia (o retrato do banco pode ser de dias atrás).
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const dia = (await diaDaUltimaEntradaExterna(l)) ?? new Date().toISOString().slice(0, 10);
      return atendimentosExternosDoDia(l, { dia });
    });
    const ms = Date.now() - inicio;
    console.log(JSON.stringify({ externosDoDia: mascara(r.itens.length), cortada: r.cortada, ms }));
    expect(r.itens.length).toBeLessThanOrEqual(200);
    for (const x of r.itens) expect(x.atendimento).toBeGreaterThan(0);
    expect(ms).toBeLessThan(10_000);
  });

  it('o ciclo só SGH_: processo, evolução, revisão, cuidados, checagem, estorno, suspensão, terminologia, receita e vacina', async () => {
    const inicio = Date.now();
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e0) => {
      const e = somenteSgh(e0);
      const d = await dominiosDaSaeLegado(e0);
      const dom = dominiosDaSae(d.escala, d.metas);
      const ponto = (v: number) => dom.escala.find((x) => x.valor === v)!.codigo;
      const meta = (s: string) => dom.metas.find((x) => x.sentido === s)!.codigo;
      const base = {
        hospital: a.cod,
        paciente: PACIENTE,
        atendimento: ATENDIMENTO,
        vinculo: VINCULO,
        usuario: USUARIO,
      };
      const processo = (versaoVista: number, chave: string | null) =>
        registrarSaeSgh(e, {
          ...base,
          versaoVista,
          sistema: 'SINT',
          versaoTerminologia: 'SINT-2026.1',
          avaliacao: CORPUS,
          diagnosticos: [
            {
              codigo: 'S-D01',
              descricao: 'Sintético: risco de lesão da pele por pressão',
              caracteristicas: [],
              fatores: ['S-F011', 'S-F013'],
              resultados: [
                {
                  codigo: 'S-R01',
                  descricao: 'Integridade da pele preservada',
                  escalaAtual: ponto(3),
                  meta: meta('aumentar'),
                  escalaMeta: ponto(5),
                },
              ],
              intervencoes: [{ codigo: 'S-I01', descricao: 'Prevenção de lesão por pressão' }],
            },
          ],
          chave,
        });
      const v1 = await processo(0, 'm45-4-int-sae');
      const lido1 = await saeDoAtendimento(e0, a.cod, ATENDIMENTO);
      const resultado = lido1.itens.find((x) => x.tipo === 'resultado')!.id;
      const intervencao = lido1.itens.find((x) => x.tipo === 'intervencao')!.id;
      await evoluirSaeSgh(e, {
        ...base,
        sae: v1.id,
        nota: CORPUS,
        resultados: [
          { resultado, descricao: 'Integridade da pele preservada', escala: ponto(4), situacao: 'melhorou' },
        ],
        chave: 'm45-4-int-evolucao',
      });
      const cuidados = await prescreverCuidadoSgh(e, {
        ...base,
        sae: v1.id,
        atividades: [
          {
            intervencao,
            codigo: 'S-A011',
            descricao: 'Mudar o decúbito',
            frequenciaDia: 4,
            horarios: ['00:00', '06:00', '12:00', '18:00'],
            inicio: '2026-07-01T08:00',
            fim: null,
          },
        ],
        chave: 'm45-4-int-cuidados',
      });
      const atividade = cuidados.ids[0]!;
      const checar = (feita: boolean, chave: string) =>
        checarCuidadoSgh(e, {
          hospital: a.cod,
          atividade,
          atendimento: ATENDIMENTO,
          previsto: '2026-07-01T12:00',
          feita,
          motivo: feita ? null : 'Paciente no exame de imagem',
          horaReal: '2026-07-01T12:10',
          origemOffline: true,
          categoria: 'tecnico',
          vinculo: VINCULO,
          usuario: USUARIO,
          chave,
        });
      const c1 = await checar(false, 'm45-4-int-ato-1');
      const reenvio = await checar(false, 'm45-4-int-ato-1');
      const duplo = await codigo(checar(true, 'm45-4-int-ato-2'));
      await estornarCuidadoSgh(e, {
        hospital: a.cod,
        checagem: c1.id,
        atendimento: ATENDIMENTO,
        motivo: 'Checado no horário errado',
        categoria: 'enfermeiro',
        vinculo: VINCULO,
        usuario: USUARIO,
      });
      const c2 = await checar(true, 'm45-4-int-ato-3');
      const naoFeitaSemMotivo = await codigo(
        checarCuidadoSgh(e, {
          hospital: a.cod,
          atividade,
          atendimento: ATENDIMENTO,
          previsto: '2026-07-01T18:00',
          feita: false,
          motivo: null,
          horaReal: '2026-07-01T18:10',
          origemOffline: false,
          categoria: 'tecnico',
          vinculo: VINCULO,
          usuario: USUARIO,
          chave: null,
        }),
      );
      // As restrições do banco (0943): gravadas direto, sem a conferência da gravação.
      const prova = await provarRestricoesDaSae(e0, {
        hospital: a.cod,
        atividade,
        paciente: PACIENTE,
        atendimento: ATENDIMENTO,
      });
      await suspenderCuidadoSgh(e, {
        hospital: a.cod,
        atividade,
        atendimento: ATENDIMENTO,
        motivo: CORPUS,
        vinculo: VINCULO,
        usuario: USUARIO,
      });
      const v2 = await processo(1, null);
      const versaoAntiga = await codigo(processo(1, null));
      // As leituras das telas na mesma transação.
      const lido2 = await saeDoAtendimento(e0, a.cod, ATENDIMENTO);
      const p2 = montarProcessoSae(lido2.cabecalho!, lido2.itens, (_t, _d, c) => ({
        codigo: c,
        descricao: c,
      }));
      const vigentes = await atividadesVigentes(e0, a.cod, [ATENDIMENTO]);
      const daAtividade = await atividadePorId(e0, a.cod, atividade);
      const checs = await checagensDosCuidados(e0, {
        hospital: a.cod,
        atividades: [atividade],
        de: '2026-07-01T00:00',
        ate: '2026-07-02T00:00',
      });
      const porId = await checagemCuidadoPorId(e0, a.cod, c1.id);
      // A terminologia (DP-19), a receita e a vacina.
      await carregarTerminologiaSaeSgh(e, {
        hospital: a.cod,
        sistema: 'CIPE',
        versao: 'TESTE-M45-4',
        licenca: CORPUS,
        termos: [
          { tipo: 'diagnostico', codigo: 'X-D1', pai: null, descricao: CORPUS, risco: true },
          { tipo: 'fator', codigo: 'X-F1', pai: 'X-D1', descricao: 'Fator de teste', risco: false },
          { tipo: 'resultado', codigo: 'X-R1', pai: null, descricao: 'Resultado de teste', risco: false },
          { tipo: 'intervencao', codigo: 'X-I1', pai: null, descricao: 'Intervenção de teste', risco: false },
          { tipo: 'atividade', codigo: 'X-A1', pai: 'X-I1', descricao: 'Atividade de teste', risco: false },
        ],
        usuario: USUARIO,
      });
      const termos = await terminologiaSaeCarregada(e0, a.cod);
      const carregada = terminologiaDasLinhas(termos, TERMINOLOGIA_SAE_SINTETICA);
      const receita = await prescreverMedicamentoEnfermeiroSgh(e, {
        ...base,
        protocolo: 'PROT-SINT',
        ano: 2026,
        tipoProtocolo: 'institucional',
        modelo: 'retencao',
        listaVersao: 'ANEXO-II-SINT-1',
        segundoIdentificador: 'nascimento',
        coren: 'COREN-SINT 000000',
        categoria: 'Enfermeiro',
        itens: [{ medicamento: 'paracetamol', via: 'oral', posologia: CORPUS, quantidade: '10 comprimidos' }],
        impressao: 'a'.repeat(64),
        assinadaEm: '2026-07-01T10:00:00',
        chave: 'm45-4-int-receita',
      });
      const receitas = await receitasDoAtendimento(e0, a.cod, ATENDIMENTO);
      const vacina = {
        ...base,
        rede: a.nucleo.rede,
        imunobiologico: '99',
        nome: 'Vacina sintética',
        lote: 'LOTE-SINT-1',
        fabricante: null,
        validadeLote: '2027-01-31',
        dose: 'D1' as const,
        via: 'IM',
        local: 'DD',
        aplicadaEm: '2026-07-01T10:00',
        prazoEnvio: '2026-07-02T10:00',
        chaveDose: `${a.cod}:${PACIENTE}:99:D1`,
        chave: null,
      };
      const vac = await registrarVacinaSgh(e, vacina);
      const doseRepetida = await codigo(registrarVacinaSgh(e, vacina));
      const vacinas = await vacinasDoPaciente(e0, a.cod, PACIENTE);
      const escritas = await escritasDaTransacao(e0);
      return {
        versoes: [v1.versao, v2.versao],
        versaoAntiga,
        avaliacaoCp1252: p2.avaliacao === CORPUS,
        itensV1: lido1.itens.length,
        itensV2: lido2.itens.length,
        diagnosticoV2: p2.diagnosticos.map((x) => [
          x.codigo,
          x.fatores.length,
          x.resultados.length,
          x.intervencoes.length,
        ]),
        vigentesDaV2: vigentes.length,
        revisadoEm: daAtividade?.revisadoEm !== null,
        suspensaCp1252: daAtividade?.suspensa?.motivo === CORPUS,
        reenvio: reenvio.repetida && reenvio.id === c1.id,
        duplo,
        naoFeitaSemMotivo,
        prova,
        checagens: checs.itens.map((x) => [x.feita, x.estorno !== null, x.origemOffline]),
        estornoPorId: porId?.estorno !== null,
        segundaChecagem: c2.id > c1.id,
        terminologia: [
          carregada.sistema,
          carregada.versao,
          carregada.sintetica,
          carregada.diagnosticos.length,
          carregada.intervencoes[0]?.atividades.length,
        ],
        termoCp1252: carregada.diagnosticos[0]?.descricao === CORPUS,
        receita: receitas.find((x) => x.id === receita.id)?.itens[0]?.posologia === CORPUS,
        vacina: vacinas.find((x) => x.id === vac.id),
        evento: /^\d+$/.test(vac.evento),
        doseRepetida,
        tabelas: [...new Set(escritas.map((w) => w.tabela))].sort(),
      };
    });
    const depois = await retrato();
    console.log(
      JSON.stringify({
        ...r,
        vacina: r.vacina ? { evento: r.vacina.evento, prazo: r.vacina.prazoEnvio } : null,
        antes,
        depois,
        ms: Date.now() - inicio,
      }),
    );
    expect(depois).toEqual(antes);
    expect(r).toMatchObject({
      versoes: [1, 2],
      versaoAntiga: 'sae-mudou',
      avaliacaoCp1252: true,
      itensV1: 3,
      itensV2: 3,
      diagnosticoV2: [['S-D01', 2, 1, 1]],
      vigentesDaV2: 0,
      revisadoEm: true,
      suspensaCp1252: true,
      reenvio: true,
      duplo: 'ja-checado',
      naoFeitaSemMotivo: 'motivo-obrigatorio',
      prova: {
        naoFeitaSemMotivo: 'SGH_CK_PEP_SAE_ATIV_MOTIVO',
        estornoSemMotivo: 'SGH_CK_PEP_SAE_ATIV_MOTIVO',
      },
      checagens: [
        [false, true, true],
        [true, false, true],
      ],
      estornoPorId: true,
      segundaChecagem: true,
      terminologia: ['CIPE', 'TESTE-M45-4', false, 1, 1],
      termoCp1252: true,
      receita: true,
      evento: true,
      doseRepetida: 'dose-ja-registrada',
    });
    expect(r.vacina).toMatchObject({
      dose: 'D1',
      prazoEnvio: '2026-07-02T10:00',
      evento: 'pendente',
      entrega: null,
    });
    expect(r.tabelas.every((t) => t.startsWith('SGH_'))).toBe(true);
    expect(r.tabelas).toEqual(
      expect.arrayContaining([
        'SGH_OUTBOX',
        'SGH_PEP_PRESC_ENFERMEIRO',
        'SGH_PEP_SAE',
        'SGH_PEP_SAE_ATIVIDADE',
        'SGH_PEP_SAE_ITEM',
        'SGH_PEP_SAE_TERMO',
        'SGH_PEP_VACINA_APLICADA',
      ]),
    );
  });
});
