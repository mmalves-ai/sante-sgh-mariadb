// Regras da equipe assistencial no fim do atendimento, na equipe padrão do setor e na fila de pendências (03-PEP L94).
import { describe, expect, it } from 'vitest';
import {
  filaDePendenciasDaEquipe,
  type FuncaoEquipe,
  type MembroEquipe,
  MOTIVO_FIM_DO_ATENDIMENTO,
  padroesDoAtendimento,
  planoEquipePadrao,
  planoReaberturaEquipe,
  validarEquipePadrao,
} from './regras.js';

const membro = (p: Partial<MembroEquipe & { motivoSaida: string | null }>) => ({
  id: 1,
  profissional: 10,
  funcao: 1,
  responsavelPrincipal: false,
  recebeNotificacao: false,
  inicio: '2026-11-01T08:00:00',
  fim: null,
  motivoSaida: null,
  ...p,
});
const medica: FuncaoEquipe = { id: 1, categoria: 'medica', responsavelPrincipal: true, ativo: true };
const enf: FuncaoEquipe = { id: 2, categoria: 'enfermagem', responsavelPrincipal: false, ativo: true };

describe('reabertura da equipe no cancelamento da alta', () => {
  const fim = '2026-11-20T10:00:00';
  it('volta quem saiu junto com o fim do atendimento; quem saiu antes não volta', () => {
    const r = planoReaberturaEquipe('encerrada', fim, [
      membro({ id: 1, fim, motivoSaida: MOTIVO_FIM_DO_ATENDIMENTO }),
      membro({ id: 2, profissional: 11, fim: '2026-11-19T09:00:00', motivoSaida: 'Troca de plantão' }),
      membro({ id: 3, profissional: 12, fim, motivoSaida: 'Outro motivo' }),
    ]);
    expect(r).toEqual({ reabrir: true, membrosAVoltar: [1] });
  });
  it('equipe ativa não reabre', () => {
    expect(planoReaberturaEquipe('ativa', null, [membro({})])).toEqual({
      reabrir: false,
      membrosAVoltar: [],
    });
  });
  it('o responsável não volta se já há outro vigente', () => {
    const r = planoReaberturaEquipe('encerrada', fim, [
      membro({ id: 1, responsavelPrincipal: true, fim, motivoSaida: MOTIVO_FIM_DO_ATENDIMENTO }),
      membro({ id: 2, profissional: 20, responsavelPrincipal: true }),
    ]);
    expect(r.membrosAVoltar).toEqual([]);
  });
});

describe('equipe padrão do setor', () => {
  it('aceita a equipe válida e recusa sem alvo, vazia, repetida, dois responsáveis e responsável não médico', () => {
    expect(
      validarEquipePadrao({
        nome: 'UTI adulto',
        setor: 5,
        especialidade: null,
        membros: [
          { funcao: medica, profissional: 10, responsavel: true },
          { funcao: enf, profissional: null, responsavel: false },
        ],
      }),
    ).toEqual([]);
    const codigos = validarEquipePadrao({
      nome: 'x',
      setor: null,
      especialidade: null,
      membros: [
        { funcao: medica, profissional: 10, responsavel: true },
        { funcao: medica, profissional: 10, responsavel: false },
        { funcao: enf, profissional: 11, responsavel: true },
      ],
    }).map((e) => e.codigo);
    expect(codigos).toEqual([
      'nome-invalido',
      'padrao-sem-alvo',
      'membro-repetido',
      'responsavel-duplicado',
      'responsavel-nao-medico',
    ]);
    expect(
      validarEquipePadrao({ nome: 'Vazia', setor: 1, especialidade: null, membros: [] }).map((e) => e.codigo),
    ).toEqual(['padrao-vazio']);
  });
  it('as do setor vêm primeiro, depois as da especialidade; inativas ficam de fora', () => {
    const p = (id: number, setor: number | null, especialidade: number | null, ativo = true) => ({
      id,
      setor,
      especialidade,
      sugerir: true,
      ativo,
    });
    const r = padroesDoAtendimento([p(1, null, 7), p(2, 5, null), p(3, 5, null, false), p(4, 6, null)], 5, 7);
    expect(r.map((x) => x.id)).toEqual([2, 1]);
  });
  it('aplicar: inclui os nomeados que faltam, um só responsável, e diz por que ignorou', () => {
    const r = planoEquipePadrao(
      [membro({ id: 1, profissional: 10, funcao: 1, responsavelPrincipal: true })],
      [
        { sequencia: 1, funcao: 1, profissional: 10, responsavel: true },
        { sequencia: 2, funcao: 2, profissional: 11, responsavel: false },
        { sequencia: 3, funcao: 2, profissional: null, responsavel: false },
        { sequencia: 4, funcao: 1, profissional: 12, responsavel: true },
      ],
    );
    expect(r.incluir.map((m) => m.sequencia)).toEqual([2]);
    expect(r.ignorados).toEqual([
      { sequencia: 1, codigo: 'ja-na-equipe' },
      { sequencia: 3, codigo: 'funcao-sem-profissional' },
      { sequencia: 4, codigo: 'responsavel-duplicado' },
    ]);
  });
});

describe('fila de pendências pela equipe', () => {
  it('só os atendimentos em que o profissional é destinatário vigente, com o papel', () => {
    const fila = filaDePendenciasDaEquipe(
      [
        { atendimento: 1, membros: [membro({ profissional: 10, responsavelPrincipal: true })] },
        { atendimento: 2, membros: [membro({ profissional: 10, recebeNotificacao: true })] },
        { atendimento: 3, membros: [membro({ profissional: 10 })] },
        {
          atendimento: 4,
          membros: [membro({ profissional: 10, recebeNotificacao: true, fim: '2026-11-02' })],
        },
      ],
      [10],
    );
    expect(fila.map((f) => [f.atendimento, f.responsavel])).toEqual([
      [1, true],
      [2, false],
    ]);
  });
});
