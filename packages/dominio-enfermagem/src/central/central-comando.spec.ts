import { describe, expect, it } from 'vitest';
import {
  acaoDaApuracao,
  avaliarRegraRisco,
  type CriterioRisco,
  cumprimentoMetas,
  type FatosRisco,
  gravidadeDaOcorrencia,
  metaAtrasada,
  nivelDoAlerta,
  ocorrenciasDeRegraFora,
  ordemDoQuadro,
  percentualOcupacao,
  problemaDaNovaMeta,
  problemaDaPassagem,
  problemaDoDonoDaRegra,
  problemaDoEncerramentoMeta,
  problemasDaRegraRisco,
  problemasDoAlertaFluxo,
  type RegraRisco,
  regraVigente,
} from './central-comando.js';

const AGORA = '2026-11-25T12:00:00.000Z';
const crit = (x: Partial<CriterioRisco>): CriterioRisco => ({
  tipo: 'sinal_vital',
  exame: null,
  item: null,
  cid: null,
  parametroVital: null,
  valorMinimo: null,
  valorMaximo: null,
  permanenciaMinimaHoras: null,
  negado: false,
  ...x,
});
const regra = (x: Partial<RegraRisco>): RegraRisco => ({
  codigo: 'TEV-01',
  nome: 'Tromboembolismo sem profilaxia',
  gravidade: 'alta',
  sexo: 'ambos',
  idadeMinimaDias: null,
  idadeMaximaDias: null,
  combinacao: 'todos',
  janelaHoras: 24,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  criterios: [],
  ...x,
});
const fatos = (x: Partial<FatosRisco>): FatosRisco => ({
  sexo: 'feminino',
  idadeDias: 20_000,
  permanenciaHoras: 30,
  exames: [],
  itens: [],
  cids: [],
  sinais: [],
  ...x,
});

describe('regra de risco clínico: validação', () => {
  it('recusa regra sem critério, faixa invertida, CID inválido e só critérios pela ausência', () => {
    expect(problemasDaRegraRisco(regra({}))).toContain('sem-criterio');
    expect(
      problemasDaRegraRisco(
        regra({ criterios: [crit({ parametroVital: 1, valorMinimo: 10, valorMaximo: 5 })] }),
      ),
    ).toEqual(['faixa-invertida']);
    expect(problemasDaRegraRisco(regra({ criterios: [crit({ tipo: 'diagnostico', cid: '21X' })] }))).toEqual([
      'cid-invalido',
    ]);
    expect(
      problemasDaRegraRisco(regra({ criterios: [crit({ tipo: 'medicamento', item: 3, negado: true })] })),
    ).toEqual(['so-negados']);
    expect(problemasDaRegraRisco(regra({ criterios: [crit({ tipo: 'exame' })] }))).toEqual([
      'criterio-sem-alvo',
    ]);
    expect(problemasDaRegraRisco(regra({ criterios: [crit({ tipo: 'dose', item: 2 })] }))).toEqual([
      'dose-sem-faixa',
    ]);
    expect(
      problemasDaRegraRisco(
        regra({
          codigo: 'x',
          idadeMinimaDias: 10,
          idadeMaximaDias: 5,
          vigenciaFim: '2025-01-01',
          janelaHoras: 0,
        }),
      ),
    ).toEqual(
      expect.arrayContaining(['codigo-invalido', 'idade-invertida', 'vigencia-invertida', 'janela-invalida']),
    );
    expect(
      problemasDaRegraRisco(
        regra({
          criterios: [
            crit({ tipo: 'diagnostico', cid: 'i21.9' }),
            crit({ tipo: 'permanencia', permanenciaMinimaHoras: 24 }),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe('apuração do risco por paciente', () => {
  const tev = regra({
    criterios: [
      crit({ tipo: 'permanencia', permanenciaMinimaHoras: 24 }),
      crit({ tipo: 'medicamento', item: 77, negado: true }),
    ],
  });

  it('acende pela presença e pela ausência ("todos"), com a evidência de cada critério', () => {
    const r = avaliarRegraRisco(tev, fatos({}), AGORA);
    expect(r.acende).toBe(true);
    expect(r.evidencia.map((e) => [e.tipo, e.negado])).toEqual([
      ['permanencia', false],
      ['medicamento', true],
    ]);
    // A profilaxia prescrita apaga o risco.
    expect(avaliarRegraRisco(tev, fatos({ itens: [{ item: 77, dose: 40, em: AGORA }] }), AGORA).acende).toBe(
      false,
    );
    // Menos de 24 horas internado: não acende.
    expect(avaliarRegraRisco(tev, fatos({ permanenciaHoras: 5 }), AGORA).acende).toBe(false);
  });

  it('sinal vital e exame só valem dentro da janela e da faixa; exame sem faixa vale pelo crítico', () => {
    const r = regra({
      combinacao: 'qualquer',
      janelaHoras: 6,
      criterios: [crit({ parametroVital: 5, valorMinimo: 120 }), crit({ tipo: 'exame', exame: 9 })],
    });
    const velho = '2026-11-25T01:00:00.000Z';
    expect(
      avaliarRegraRisco(r, fatos({ sinais: [{ parametro: 5, valor: 130, em: velho }] }), AGORA).acende,
    ).toBe(false);
    expect(
      avaliarRegraRisco(
        r,
        fatos({ sinais: [{ parametro: 5, valor: 130, em: '2026-11-25T10:00:00.000Z' }] }),
        AGORA,
      ).evidencia[0],
    ).toMatchObject({ tipo: 'sinal_vital', valor: 130 });
    expect(
      avaliarRegraRisco(r, fatos({ exames: [{ exame: 9, valor: 2, critico: false, em: AGORA }] }), AGORA)
        .acende,
    ).toBe(false);
    expect(
      avaliarRegraRisco(r, fatos({ exames: [{ exame: 9, valor: 2, critico: true, em: AGORA }] }), AGORA)
        .acende,
    ).toBe(true);
  });

  it('diagnóstico pelo prefixo do CID-10; dose pela faixa; público por sexo, idade e vigência', () => {
    const r = regra({ combinacao: 'qualquer', criterios: [crit({ tipo: 'diagnostico', cid: 'I21' })] });
    expect(avaliarRegraRisco(r, fatos({ cids: ['I21.9'] }), AGORA).acende).toBe(true);
    expect(avaliarRegraRisco(r, fatos({ cids: ['I10'] }), AGORA).acende).toBe(false);
    expect(avaliarRegraRisco({ ...r, sexo: 'masculino' }, fatos({ cids: ['I219'] }), AGORA).acende).toBe(
      false,
    );
    expect(avaliarRegraRisco({ ...r, idadeMaximaDias: 6570 }, fatos({ cids: ['I219'] }), AGORA).acende).toBe(
      false,
    );
    expect(
      avaliarRegraRisco({ ...r, vigenciaFim: '2026-11-24' }, fatos({ cids: ['I219'] }), AGORA).acende,
    ).toBe(false);
    const dose = regra({ criterios: [crit({ tipo: 'dose', item: 4, valorMinimo: 4 })] });
    expect(avaliarRegraRisco(dose, fatos({ itens: [{ item: 4, dose: 2, em: AGORA }] }), AGORA).acende).toBe(
      false,
    );
    expect(avaliarRegraRisco(dose, fatos({ itens: [{ item: 4, dose: 5, em: AGORA }] }), AGORA).acende).toBe(
      true,
    );
  });

  it('a apuração não duplica a ocorrência aberta e encerra a que deixou de ocorrer', () => {
    expect(acaoDaApuracao(true, false)).toBe('abrir');
    expect(acaoDaApuracao(true, true)).toBe('manter');
    expect(acaoDaApuracao(false, true)).toBe('encerrar');
    expect(acaoDaApuracao(false, false)).toBe('nada');
    expect(gravidadeDaOcorrencia('moderada')).toBe('media');
    expect(gravidadeDaOcorrencia('critica')).toBe('critica');
  });

  it('a ocorrência passa de aberta a reconhecida e a resolvida; encerrada não muda', () => {
    expect(problemaDaPassagem('aberta', 'reconhecer', null)).toBeNull();
    expect(problemaDaPassagem('reconhecida', 'reconhecer', null)).toBe('ja-reconhecida');
    expect(problemaDaPassagem('aberta', 'resolver', 'curto')).toBe('resolucao-curta');
    expect(problemaDaPassagem('reconhecida', 'descartar', 'falso positivo do exame')).toBeNull();
    expect(problemaDaPassagem('resolvida', 'resolver', 'qualquer coisa longa')).toBe('ja-encerrada');
  });
});

describe('dono da regra e encerramento pelo sistema', () => {
  it('vigência por dia, com o dia do fim ainda valendo', () => {
    const r = { vigenciaInicio: '2026-11-01', vigenciaFim: '2026-11-25' };
    expect(regraVigente(r, AGORA)).toBe(true);
    expect(regraVigente(r, '2026-11-26T00:10:00.000Z')).toBe(false);
    expect(regraVigente(r, '2026-10-31')).toBe(false);
    expect(regraVigente({ vigenciaInicio: '2026-01-01', vigenciaFim: null }, AGORA)).toBe(true);
    // O último dia da vigência ainda acende (antes comparava o instante com a data e perdia o dia do fim).
    const ultima = regra({
      vigenciaFim: '2026-11-25',
      criterios: [crit({ tipo: 'diagnostico', cid: 'I10' })],
    });
    expect(avaliarRegraRisco(ultima, fatos({ cids: ['I10'] }), AGORA).acende).toBe(true);
  });

  it('a regra da rede só com a permissão da rede', () => {
    expect(problemaDoDonoDaRegra(true, false)).toBe('regra-da-rede');
    expect(problemaDoDonoDaRegra(true, true)).toBeNull();
    expect(problemaDoDonoDaRegra(false, false)).toBeNull();
  });

  it('encerra só as ocorrências cuja regra saiu das vigentes', () => {
    const abertas = [
      { id: 1, regra: 10 },
      { id: 2, regra: 11 },
      { id: 3, regra: 10 },
    ];
    expect(ocorrenciasDeRegraFora(abertas, new Set([10]))).toEqual([2]);
    expect(ocorrenciasDeRegraFora(abertas, new Set())).toEqual([1, 2, 3]);
  });
});

describe('alertas de fluxo da unidade', () => {
  it('valida unidade, limites e indicador; o nível sobe na atenção e no crítico', () => {
    expect(
      problemasDoAlertaFluxo({
        tipo: 'ocupacao',
        unidadeLimite: 'minutos',
        limiteAtencao: 90,
        limiteCritico: 80,
        indicador: null,
      }),
    ).toEqual(['unidade-incoerente', 'atencao-acima-critico']);
    expect(
      problemasDoAlertaFluxo({
        tipo: 'indicador',
        unidadeLimite: 'percentual',
        limiteAtencao: null,
        limiteCritico: 120,
        indicador: null,
      }),
    ).toEqual(['indicador-obrigatorio', 'percentual-acima-100']);
    const a = { limiteAtencao: 85, limiteCritico: 95 };
    expect(nivelDoAlerta(a, 70)).toBe('normal');
    expect(nivelDoAlerta(a, 85)).toBe('atencao');
    expect(nivelDoAlerta(a, 96)).toBe('critico');
    expect(nivelDoAlerta(a, null)).toBe('sem_medida');
    expect(percentualOcupacao(9, 10)).toBe(90);
    expect(percentualOcupacao(0, 0)).toBeNull();
  });
});

describe('metas das 24 horas', () => {
  it('prazo dentro das próximas 24 horas; não cumprida e cancelada pedem justificativa; encerrada não muda', () => {
    expect(problemaDaNovaMeta('Sentar fora do leito', '2026-11-25T18:00:00.000Z', AGORA)).toBeNull();
    expect(problemaDaNovaMeta('ok', '2026-11-25T18:00:00.000Z', AGORA)).toBe('descricao-curta');
    expect(problemaDaNovaMeta('Sentar fora do leito', '2026-11-25T08:00:00.000Z', AGORA)).toBe(
      'prazo-passado',
    );
    expect(problemaDaNovaMeta('Sentar fora do leito', '2026-11-26T13:00:00.000Z', AGORA)).toBe('prazo-longe');
    expect(problemaDoEncerramentoMeta('pendente', 'cumprida', null)).toBeNull();
    expect(problemaDoEncerramentoMeta('pendente', 'nao_cumprida', 'dor')).toBe('justificativa-obrigatoria');
    expect(problemaDoEncerramentoMeta('cumprida', 'cancelada', 'mudou o plano do dia')).toBe(
      'meta-encerrada',
    );
    expect(metaAtrasada('pendente', '2026-11-25T11:00:00.000Z', AGORA)).toBe(true);
    expect(metaAtrasada('cumprida', '2026-11-25T11:00:00.000Z', AGORA)).toBe(false);
    expect(cumprimentoMetas(['cumprida', 'pendente', 'cancelada', 'nao_cumprida'])).toEqual({
      total: 3,
      cumpridas: 1,
      pendentes: 1,
      percentual: 33,
    });
  });

  it('o quadro põe primeiro o risco mais grave, depois as metas atrasadas e o escore de piora', () => {
    const l = (atendimento: number, x: object) => ({
      atendimento,
      maiorGravidade: null,
      riscosAbertos: 0,
      metasAtrasadas: 0,
      escorePiora: null,
      leito: null,
      ...x,
    });
    const ordem = [
      l(1, { escorePiora: 7 }),
      l(2, { maiorGravidade: 'critica', riscosAbertos: 1 }),
      l(3, { metasAtrasadas: 2 }),
      l(4, { maiorGravidade: 'media', riscosAbertos: 2 }),
    ]
      .sort(ordemDoQuadro)
      .map((x) => x.atendimento);
    expect(ordem).toEqual([2, 4, 3, 1]);
  });
});
