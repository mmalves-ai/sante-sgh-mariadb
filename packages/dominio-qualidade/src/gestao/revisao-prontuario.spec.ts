// W0-04 (M5): a comissão de revisão de prontuários. Sorteio reproduzível pela semente, revisão pelo checklist,
// pendência por item não conforme, aval e o percentual conforme por clínica (contas escritas no teste).
import { describe, expect, it } from 'vitest';
import {
  amostraSugerida,
  avaliarRevisao,
  conformidadePorClinica,
  descricaoPendencia,
  fnv1a32,
  recusaAval,
  recusaCancelamentoSorteio,
  recusaPublicacaoChecklist,
  recusaRespostaPendencia,
  recusaRevisao,
  sementeGerada,
  sortearAmostra,
  textoDoAval,
  universoCanonico,
} from './revisao-prontuario.js';

const universo = Array.from({ length: 40 }, (_, i) => ({ reg: 1000 + ((i * 7) % 40), clinica: 'X' }));

describe('sorteio reproduzível', () => {
  it('a mesma semente sobre o mesmo universo dá a mesma amostra, em qualquer ordem de entrada', () => {
    const a = sortearAmostra(universo, '2026-10-ABC', 8).map((x) => x.reg);
    const b = sortearAmostra([...universo].reverse(), '2026-10-ABC', 8).map((x) => x.reg);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(8);
    for (const r of a) expect(r).toBeGreaterThanOrEqual(1000);
    // outra semente, outra amostra
    expect(sortearAmostra(universo, '2026-10-XYZ', 8).map((x) => x.reg)).not.toEqual(a);
  });
  it('o valor exato da semente conhecida (o algoritmo não pode mudar sem quebrar a reprodução)', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(
      sortearAmostra([{ reg: 1 }, { reg: 2 }, { reg: 3 }, { reg: 4 }, { reg: 5 }], 'S1', 3).map((x) => x.reg),
    ).toEqual(
      sortearAmostra([{ reg: 5 }, { reg: 4 }, { reg: 3 }, { reg: 2 }, { reg: 1 }], 'S1', 3).map((x) => x.reg),
    );
  });
  it('amostra maior que o universo devolve o universo inteiro; o universo canônico é ordenado e sem repetição', () => {
    expect(sortearAmostra([{ reg: 2 }, { reg: 1 }], 'S', 5)).toHaveLength(2);
    expect(universoCanonico([3, 1, 2, 3])).toBe('1,2,3');
  });
  it('a amostra sugerida: 10%, ao menos 10, no máximo o teto; a semente gerada leva a competência', () => {
    expect(amostraSugerida(0)).toBe(0);
    expect(amostraSugerida(7)).toBe(7);
    expect(amostraSugerida(50)).toBe(10);
    expect(amostraSugerida(345)).toBe(35);
    expect(amostraSugerida(5000)).toBe(200);
    expect(sementeGerada('2026-10', 0.5)).toMatch(/^2026-10-[0-9A-Z]+$/);
  });
});

const CHK = [
  { codigo: 'evolucao-diaria', titulo: 'Evolução diária' },
  { codigo: 'sumario-alta', titulo: 'Sumário de alta' },
];

describe('checklist, revisão e pendência', () => {
  it('publicação: a primeira sem motivo; a seguinte com motivo e sobre a vigente lida', () => {
    expect(recusaPublicacaoChecklist({ vigente: null, lido: null, motivo: null })).toBeNull();
    const v = { id: 3, versao: 1 };
    expect(recusaPublicacaoChecklist({ vigente: v, lido: null, motivo: 'x'.repeat(12) })).toBe(
      'checklist-vigente-desatualizado',
    );
    expect(
      recusaPublicacaoChecklist({ vigente: v, lido: { id: 3, versao: 2 }, motivo: 'x'.repeat(12) }),
    ).toBe('checklist-vigente-desatualizado');
    expect(recusaPublicacaoChecklist({ vigente: v, lido: v, motivo: 'curto' })).toBe('motivo-obrigatorio');
    expect(
      recusaPublicacaoChecklist({ vigente: v, lido: v, motivo: 'Inclui o item do sumário.' }),
    ).toBeNull();
  });
  it('todos os itens, nenhum de fora; não conforme quando há item não conforme (cada um vira pendência)', () => {
    expect(
      avaliarRevisao(CHK, [{ item: 'evolucao-diaria', resultado: 'conforme', observacao: null }]),
    ).toEqual({
      ok: false,
      motivo: 'resposta-incompleta',
    });
    expect(
      avaliarRevisao(CHK, [
        { item: 'evolucao-diaria', resultado: 'conforme', observacao: null },
        { item: 'outro', resultado: 'conforme', observacao: null },
      ]),
    ).toEqual({ ok: false, motivo: 'item-fora-do-checklist' });
    const r = avaliarRevisao(CHK, [
      { item: 'evolucao-diaria', resultado: 'naoAplicavel', observacao: null },
      { item: 'sumario-alta', resultado: 'naoConforme', observacao: 'Sem orientações.' },
    ]);
    expect(r).toEqual({
      ok: true,
      avaliacao: {
        situacao: 'naoConforme',
        naoConformes: [{ item: 'sumario-alta', titulo: 'Sumário de alta', observacao: 'Sem orientações.' }],
      },
    });
    expect(descricaoPendencia('Sumário de alta', 'Sem orientações.')).toBe(
      'Item não conforme: Sumário de alta. Sem orientações.',
    );
    const ok = avaliarRevisao(CHK, [
      { item: 'evolucao-diaria', resultado: 'conforme', observacao: null },
      { item: 'sumario-alta', resultado: 'conforme', observacao: null },
    ]);
    expect(ok.ok && ok.avaliacao.situacao).toBe('conforme');
  });
  it('correção só antes do aval e com justificativa; aval só revisado e sem pendência aberta', () => {
    const base = {
      situacaoAtual: 'aRevisar' as const,
      avalEm: null,
      justificativa: null,
      sorteioCancelado: false,
    };
    expect(recusaRevisao(base)).toBeNull();
    expect(recusaRevisao({ ...base, situacaoAtual: 'conforme' })).toBe('justificativa-obrigatoria');
    expect(
      recusaRevisao({ ...base, situacaoAtual: 'conforme', justificativa: 'Item revisto na reunião.' }),
    ).toBeNull();
    expect(recusaRevisao({ ...base, avalEm: '2026-11-10T10:00:00' })).toBe('revisao-com-aval');
    expect(recusaRevisao({ ...base, sorteioCancelado: true })).toBe('sorteio-cancelado');
    expect(recusaAval({ situacao: 'aRevisar', avalEm: null, pendenciasAbertas: 0 })).toBe('nao-revisado');
    expect(recusaAval({ situacao: 'naoConforme', avalEm: null, pendenciasAbertas: 1 })).toBe(
      'pendencia-aberta',
    );
    expect(recusaAval({ situacao: 'naoConforme', avalEm: null, pendenciasAbertas: 0 })).toBeNull();
    expect(recusaAval({ situacao: 'conforme', avalEm: '2026-11-10T10:00:00', pendenciasAbertas: 0 })).toBe(
      'aval-ja-registrado',
    );
  });
  it('sorteio cancela só sem revisão; a pendência só pelo próprio profissional e aberta', () => {
    expect(recusaCancelamentoSorteio({ canceladoEm: null, revisados: 0 })).toBeNull();
    expect(recusaCancelamentoSorteio({ canceladoEm: null, revisados: 1 })).toBe('sorteio-com-revisao');
    expect(recusaCancelamentoSorteio({ canceladoEm: '2026-11-01T10:00:00', revisados: 0 })).toBe(
      'sorteio-cancelado',
    );
    expect(
      recusaRespostaPendencia({ situacao: 'aberta', profissionalLogin: 'SINT.MEDICO', login: 'sint.medico' }),
    ).toBeNull();
    expect(
      recusaRespostaPendencia({ situacao: 'aberta', profissionalLogin: 'OUTRO', login: 'SINT.MEDICO' }),
    ).toBe('pendencia-nao-e-sua');
    expect(
      recusaRespostaPendencia({ situacao: 'aberta', profissionalLogin: null, login: 'SINT.MEDICO' }),
    ).toBe('pendencia-nao-e-sua');
    expect(
      recusaRespostaPendencia({
        situacao: 'resolvida',
        profissionalLogin: 'SINT.MEDICO',
        login: 'SINT.MEDICO',
      }),
    ).toBe('pendencia-encerrada');
  });
});

describe('percentual conforme por clínica', () => {
  it('só os revisados, por clínica e no total, com a conta', () => {
    const r = conformidadePorClinica([
      { clinica: 'Clínica médica', situacao: 'conforme' },
      { clinica: 'Clínica médica', situacao: 'naoConforme' },
      { clinica: 'Clínica médica', situacao: 'conforme' },
      { clinica: 'Cirurgia geral', situacao: 'naoConforme' },
      { clinica: 'Cirurgia geral', situacao: 'aRevisar' },
    ]);
    expect(r.porClinica).toEqual([
      { clinica: 'Cirurgia geral', revisados: 1, conformes: 0, percentual: 0, conta: '0 ÷ 1 × 100 = 0%' },
      {
        clinica: 'Clínica médica',
        revisados: 3,
        conformes: 2,
        percentual: 66.67,
        conta: '2 ÷ 3 × 100 = 66,67%',
      },
    ]);
    expect(r.total).toMatchObject({ revisados: 4, conformes: 2, percentual: 50, conta: '2 ÷ 4 × 100 = 50%' });
    expect(conformidadePorClinica([]).total.percentual).toBeNull();
  });
  it('o texto do aval cabe no campo do SAME (60)', () => {
    const t = textoDoAval('2026-11-10T09:30:00', 'SINT.QUALIDADE');
    expect(t).toBe('Revisão de prontuário: aval 10/11/2026 SINT.QUALIDADE');
    expect(textoDoAval('2026-11-10T09:30:00', 'X'.repeat(31)).length).toBeLessThanOrEqual(60);
  });
});
