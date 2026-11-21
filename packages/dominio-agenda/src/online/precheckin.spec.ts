// Pré-check-in (M50, etapa 2; ficha, regra 4: "pré-check-in só vira cadastro depois da conferência da recepção"): o que
// muda campo a campo, a alteração do cadastro só com o aprovado que muda (o endereço acompanha o CEP), o aprovado que
// não foi proposto e quando o paciente pode enviar.
import { describe, expect, it } from 'vitest';
import {
  alteracaoAprovada,
  aprovadosForaDoProposto,
  camposParaConferir,
  podeEnviarPreCheckin,
} from './precheckin.js';

const R = { hoje: '2026-10-25', hhmm: '10:00' };

describe('conferência', () => {
  const campos = camposParaConferir(
    {
      celular: '22999990000',
      email: 'a@b.test',
      cep: '28000000',
      logradouro: 'RUA A',
      numero: 10,
      bairro: null,
    },
    {
      celular: '22999990000',
      email: 'novo@b.test',
      cep: '28010000',
      logradouro: 'RUA B',
      numero: 20,
      bairro: 'CENTRO',
    },
  );
  it('mostra só o que foi proposto, com o que muda', () => {
    expect(campos.map((c) => [c.campo, c.muda])).toEqual([
      ['celular', false],
      ['email', true],
      ['cep', true],
      ['logradouro', true],
      ['numero', true],
      ['bairro', true],
    ]);
    expect(campos.find((c) => c.campo === 'bairro')?.atual).toBeNull();
  });
  it('a alteração só com o aprovado que muda; o CEP aprovado leva o endereço junto', () => {
    expect(alteracaoAprovada(campos, ['celular', 'email'])).toEqual({ email: 'novo@b.test' });
    expect(alteracaoAprovada(campos, ['cep'])).toEqual({
      cep: '28010000',
      logradouro: 'RUA B',
      numero: 20,
      bairro: 'CENTRO',
    });
    expect(alteracaoAprovada(campos, [])).toEqual({});
  });
  it('nada é aprovado fora do que o paciente mandou', () => {
    expect(aprovadosForaDoProposto(campos, ['email', 'telefone'])).toEqual(['telefone']);
  });
});

describe('quando o paciente pode enviar', () => {
  const m = { data: '2026-10-27', hora: '0900', estado: 'marcada' as const };
  const cfg = { ativa: true, precheckin: true };
  it('marcação aberta, agenda com pré-check-in, até 7 dias antes, antes do horário', () => {
    expect(podeEnviarPreCheckin(m, cfg, null, R)).toEqual({ pode: true, motivo: null });
    expect(podeEnviarPreCheckin(m, cfg, 'recusado', R).pode).toBe(true);
    expect(podeEnviarPreCheckin(m, cfg, 'conferido', R).motivo).toContain('conferido');
    expect(podeEnviarPreCheckin({ ...m, estado: 'atendida' }, cfg, null, R).pode).toBe(false);
    expect(podeEnviarPreCheckin(m, { ativa: true, precheckin: false }, null, R).motivo).toContain('recepção');
    expect(podeEnviarPreCheckin(m, null, null, R).pode).toBe(false);
    expect(podeEnviarPreCheckin({ ...m, data: '2026-10-25', hora: '0800' }, cfg, null, R).motivo).toBe(
      'O horário já passou.',
    );
    expect(podeEnviarPreCheckin({ ...m, data: '2026-11-10' }, cfg, null, R).motivo).toContain('7 dias');
  });
});
