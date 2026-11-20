// Regra 1 (ficha do M47): a requisição nasce do item de hemoterapia, com urgência e termo; prazo e passagens.
import { describe, expect, it } from 'vitest';
import {
  conferirRequisicao,
  dispensaProvas,
  estadoDepoisDoAto,
  MENSAGENS_REQUISICAO,
  podeMudarRequisicao,
  prazoDaRequisicao,
  propostaDoItem,
  requisicaoAtrasada,
} from './requisicao.js';

const ITEM = {
  hemocomponente: 'ch',
  dose: 2,
  unidadeDose: 'BOLS',
  indicacao: '  Anemia   sintomática ',
  iniciarAgora: false,
  vigenteAte: '2026-10-25T12:00:00',
  suspenso: false,
};
const AGORA = '2026-10-24T10:00:00';

describe('proposta a partir do item', () => {
  it('hemocomponente, quantidade, indicação e urgência sugerida', () => {
    expect(propostaDoItem(ITEM)).toEqual({
      hemocomponente: 'CH',
      rotulo: 'Concentrado de hemácias',
      classe: 'hemacias',
      quantidadeBolsas: 2,
      volumeMl: null,
      urgencia: 'rotina',
      indicacao: 'Anemia sintomática',
    });
    const ml = propostaDoItem({
      ...ITEM,
      hemocomponente: 'PLC',
      dose: 250.4,
      unidadeDose: 'ml',
      iniciarAgora: true,
      indicacao: null,
    });
    expect(ml).toMatchObject({
      quantidadeBolsas: 1,
      volumeMl: 250,
      urgencia: 'urgente',
      indicacao: '',
      classe: 'plasma',
    });
    expect(propostaDoItem({ ...ITEM, hemocomponente: 'ZZ', dose: 99 })).toMatchObject({
      rotulo: 'ZZ',
      classe: 'outro',
      quantidadeBolsas: 20,
    });
    expect(propostaDoItem({ ...ITEM, dose: 0 }).quantidadeBolsas).toBe(1);
  });
});

describe('conferência da requisição (regra 1)', () => {
  const base = {
    item: ITEM,
    agora: AGORA,
    urgencia: 'rotina' as const,
    programadaPara: null,
    indicacao: 'Anemia sintomática',
    termoAssinado: true,
    justificativaUrgencia: null,
    requisicaoEmAberto: false,
  };

  it('com tudo em ordem, pode', () => {
    expect(conferirRequisicao(base)).toEqual([]);
  });

  it('item suspenso, prescrição vencida, sem indicação e requisição em aberto', () => {
    expect(
      conferirRequisicao({
        ...base,
        item: { ...ITEM, suspenso: true, vigenteAte: '2026-10-24T09:00:00' },
        indicacao: 'curta',
        requisicaoEmAberto: true,
      }),
    ).toEqual(['item-suspenso', 'prescricao-vencida', 'sem-indicacao', 'requisicao-em-aberto']);
    expect(conferirRequisicao({ ...base, item: { ...ITEM, vigenteAte: null } })).toEqual([]);
  });

  it('termo: obrigatório fora da extrema urgência; nela, a justificativa', () => {
    expect(conferirRequisicao({ ...base, termoAssinado: false })).toEqual(['sem-termo']);
    expect(conferirRequisicao({ ...base, termoAssinado: false, urgencia: 'extremaUrgencia' })).toEqual([
      'sem-justificativa-urgencia',
    ]);
    expect(
      conferirRequisicao({
        ...base,
        termoAssinado: false,
        urgencia: 'extremaUrgencia',
        justificativaUrgencia: 'Choque hemorrágico',
      }),
    ).toEqual([]);
  });

  it('programada exige dia e hora futuros', () => {
    expect(conferirRequisicao({ ...base, urgencia: 'programada' })).toEqual(['programada-no-passado']);
    expect(
      conferirRequisicao({ ...base, urgencia: 'programada', programadaPara: '2026-10-24T09:00:00' }),
    ).toEqual(['programada-no-passado']);
    expect(
      conferirRequisicao({ ...base, urgencia: 'programada', programadaPara: '2026-10-25T08:00:00' }),
    ).toEqual([]);
  });

  it('toda recusa tem texto sem citar o outro sistema', () => {
    for (const m of Object.values(MENSAGENS_REQUISICAO)) expect(m).not.toMatch(/SPDATA|legado/i);
  });
});

describe('prazo e atraso', () => {
  it('rotina 24 h, urgente 3 h, extrema imediata, programada no dia marcado', () => {
    expect(prazoDaRequisicao('rotina', '2026-10-24T10:00', null)).toBe('2026-10-25T10:00:00');
    expect(prazoDaRequisicao('urgente', '2026-10-24T10:00:00', null)).toBe('2026-10-24T13:00:00');
    expect(prazoDaRequisicao('extremaUrgencia', '2026-10-24T10:00:00', null)).toBe('2026-10-24T10:00:00');
    expect(prazoDaRequisicao('programada', '2026-10-24T10:00:00', '2026-10-26T07:00:00')).toBe(
      '2026-10-26T07:00:00',
    );
  });

  it('atrasada só aberta e com o prazo vencido', () => {
    expect(requisicaoAtrasada({ estado: 'requisitada', prazo: '2026-10-24T09:00:00', agora: AGORA })).toBe(
      true,
    );
    expect(requisicaoAtrasada({ estado: 'requisitada', prazo: '2026-10-24T11:00:00', agora: AGORA })).toBe(
      false,
    );
    expect(requisicaoAtrasada({ estado: 'atendida', prazo: '2026-10-24T09:00:00', agora: AGORA })).toBe(
      false,
    );
    expect(requisicaoAtrasada({ estado: 'cancelada', prazo: '2026-10-24T09:00:00', agora: AGORA })).toBe(
      false,
    );
    expect(requisicaoAtrasada({ estado: 'requisitada', prazo: null, agora: AGORA })).toBe(false);
  });
});

describe('passagens da requisição', () => {
  it('amostra antes do início, salvo na extrema urgência', () => {
    expect(podeMudarRequisicao('requisitada', 'emAtendimento', 'rotina')).toEqual({
      pode: false,
      motivo: expect.stringMatching(/amostra/),
    });
    expect(podeMudarRequisicao('requisitada', 'emAtendimento', 'extremaUrgencia').pode).toBe(true);
    expect(podeMudarRequisicao('requisitada', 'amostraColetada', 'rotina').pode).toBe(true);
    expect(podeMudarRequisicao('amostraColetada', 'emAtendimento', 'rotina').pode).toBe(true);
    expect(podeMudarRequisicao('emAtendimento', 'atendida', 'rotina').pode).toBe(true);
    expect(dispensaProvas('urgente')).toBe(false);
  });

  it('recusas com o motivo', () => {
    expect(podeMudarRequisicao('requisitada', 'requisitada', 'rotina').motivo).toMatch(/já está/);
    expect(podeMudarRequisicao('cancelada', 'requisitada', 'rotina').motivo).toMatch(/cancelada/);
    expect(podeMudarRequisicao('emAtendimento', 'cancelada', 'rotina').motivo).toMatch(
      /não é mais cancelável/,
    );
    expect(podeMudarRequisicao('atendida', 'requisitada', 'rotina').motivo).toMatch(/não permitida/);
  });

  it('atendida quando todas as bolsas foram transfundidas', () => {
    expect(estadoDepoisDoAto(2, 1)).toBe('emAtendimento');
    expect(estadoDepoisDoAto(2, 2)).toBe('atendida');
  });
});
