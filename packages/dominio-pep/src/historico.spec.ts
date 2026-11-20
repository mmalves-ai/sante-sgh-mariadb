// Regra 7 (MANTERHIST) e regra 10 (horários) da ficha do M22.
import type { CampoRegistro, RespostaRegistro } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { mostraHistorico, preencherPeloHistorico } from './historico.js';
import { conferirHorario, MENSAGENS_HORARIO } from './horarios.js';

const campo = (vinculo: number, manterHistorico: number, itens: CampoRegistro[] = []): CampoRegistro => ({
  linkId: `01.${vinculo}`,
  vinculo,
  componente: null,
  tipo: 'texto',
  titulo: 'x',
  obrigatorio: false,
  unidade: null,
  tamanhoMaximo: null,
  colunas: 12,
  opcoes: [],
  colunasGrade: [],
  habilitar: null,
  calcular: null,
  regraPendente: false,
  manterHistorico,
  ambiguo: false,
  itens,
});

describe('pré-preenchimento por MANTERHIST (regra 7; DP-28)', () => {
  const campos = [campo(1, 0, [campo(2, 1), campo(3, 2), campo(4, 3)])];
  const ultimas: RespostaRegistro[] = [2, 3, 4, 9].map((v) => ({
    vinculo: v,
    valor: { tipo: 'texto', texto: 'último' },
    autopreenchido: false,
    confirmado: true,
  }));
  it('só o nível 1 traz o valor, marcado e sem confirmação', () => {
    expect(preencherPeloHistorico(campos, ultimas)).toEqual([
      { vinculo: 2, valor: { tipo: 'texto', texto: 'último' }, autopreenchido: true, confirmado: false },
    ]);
  });
  it('2 e 3 só mostram o histórico a pedido', () => {
    expect([0, 1, 2, 3, 4].map((n) => mostraHistorico({ manterHistorico: n }))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('horário clínico × gravação (regra 10)', () => {
  const base = { agora: '2026-10-21T10:00:00', toleranciaMin: 15, permiteRetroativo: true };
  it('dentro da tolerância: sem justificativa', () => {
    expect(conferirHorario({ ...base, clinica: '2026-10-21T09:50' })).toEqual({
      ok: true,
      recusa: null,
      retroativo: false,
      minutos: 10,
    });
  });
  it('futuro recusa; retroativo exige justificativa e o cadastro que permite', () => {
    expect(conferirHorario({ ...base, clinica: '2026-10-21T10:05' }).recusa).toBe('horario-futuro');
    expect(conferirHorario({ ...base, clinica: '2026-10-21T08:00' }).recusa).toBe('justificativa-necessaria');
    expect(conferirHorario({ ...base, clinica: '2026-10-21T08:00', justificativa: 'curta' }).recusa).toBe(
      'justificativa-necessaria',
    );
    expect(
      conferirHorario({
        ...base,
        clinica: '2026-10-21T08:00',
        justificativa: 'registro feito depois do atendimento',
      }),
    ).toMatchObject({ ok: true, retroativo: true, minutos: 120 });
    expect(
      conferirHorario({
        ...base,
        clinica: '2026-10-21T08:00',
        permiteRetroativo: false,
        justificativa: 'x'.repeat(20),
      }).recusa,
    ).toBe('retroativo-nao-permitido');
    expect(conferirHorario({ ...base, clinica: 'ontem' }).recusa).toBe('horario-invalido');
    expect(MENSAGENS_HORARIO['horario-futuro']).toContain('futuro');
  });
});
