import type { Credenciamento } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  deveCredenciarTodosAoCriar,
  profissionalCredenciavel,
  TIPOS_PROFISSIONAL_CREDENCIAVEIS,
  verificarCredenciamento,
} from './index.js';

const cred = (p: Partial<Credenciamento>): Credenciamento => ({
  id: 1,
  profissionalId: 101,
  profissionalNome: 'MEDICO SINTETICO',
  fontePagadoraId: 2,
  fontePagadoraNome: 'CONVENIO SINTETICO',
  estabelecimentoId: null,
  estabelecimentoNome: null,
  planoId: null,
  planoNome: null,
  credenciado: true,
  vigenciaInicio: '2026-01-01',
  vigenciaFim: null,
  versao: 1,
  ...p,
});
const base = {
  particular: false,
  profissionalId: 101,
  planoId: 31,
  planoSuperiorId: 30,
  data: '2026-11-22',
  opcoes: { fontePagadoraId: 2, bloqueiaSemCredenciamento: false, credenciaTodosAoCriar: false },
};

describe('credenciamento (decisões 25 e 26)', () => {
  it('credenciado no convênio inteiro, no plano superior ou no próprio plano', () => {
    expect(verificarCredenciamento({ ...base, credenciamentos: [cred({})] }).efeito).toBe('nenhum');
    expect(verificarCredenciamento({ ...base, credenciamentos: [cred({ planoId: 30 })] }).efeito).toBe(
      'nenhum',
    );
    expect(
      verificarCredenciamento({ ...base, credenciamentos: [cred({ planoId: 31, id: 9 })] }).credenciamentoId,
    ).toBe(9);
  });
  it('sem credenciamento: alerta por padrão, bloqueio quando o convênio pede', () => {
    expect(verificarCredenciamento({ ...base, credenciamentos: [] }).efeito).toBe('alerta');
    const b = verificarCredenciamento({
      ...base,
      credenciamentos: [cred({ planoId: 99 })],
      opcoes: { ...base.opcoes, bloqueiaSemCredenciamento: true },
    });
    expect([b.credenciado, b.efeito]).toEqual([false, 'bloqueio']);
  });
  it('plano desconhecido (marcação): credenciado só num plano do convênio alerta e nunca bloqueia', () => {
    const bloqueia = { ...base.opcoes, bloqueiaSemCredenciamento: true };
    const semPlano = { ...base, planoId: null, planoSuperiorId: null, opcoes: bloqueia };
    const v = verificarCredenciamento({
      ...semPlano,
      planoDesconhecido: true,
      credenciamentos: [cred({ planoId: 31, id: 7 })],
    });
    expect([v.efeito, v.credenciamentoId]).toEqual(['alerta', 7]);
    // Sem nenhum credenciamento, o bloqueio pedido pelo convênio continua.
    expect(
      verificarCredenciamento({ ...semPlano, planoDesconhecido: true, credenciamentos: [] }).efeito,
    ).toBe('bloqueio');
    // Credenciado no convênio inteiro: nada a avisar.
    expect(
      verificarCredenciamento({ ...semPlano, planoDesconhecido: true, credenciamentos: [cred({})] }).efeito,
    ).toBe('nenhum');
  });
  it('descredenciado no plano vence o credenciamento do convênio inteiro; vencido não vale', () => {
    const r = verificarCredenciamento({
      ...base,
      credenciamentos: [cred({ id: 1 }), cred({ id: 2, planoId: 31, credenciado: false })],
    });
    expect([r.efeito, r.credenciamentoId]).toEqual(['alerta', 2]);
    expect(
      verificarCredenciamento({ ...base, credenciamentos: [cred({ vigenciaFim: '2026-01-31' })] }).efeito,
    ).toBe('alerta');
  });
  it('particular e sem profissional não pedem credenciamento', () => {
    expect(verificarCredenciamento({ ...base, particular: true, credenciamentos: [] }).efeito).toBe('nenhum');
    expect(verificarCredenciamento({ ...base, profissionalId: null, credenciamentos: [] }).efeito).toBe(
      'nenhum',
    );
  });
  it('credenciar todos ao criar só quando a opção do convênio está ligada', () => {
    expect(deveCredenciarTodosAoCriar({ ...base.opcoes, credenciaTodosAoCriar: true }, false)).toBe(true);
    expect(deveCredenciarTodosAoCriar({ ...base.opcoes, credenciaTodosAoCriar: true }, true)).toBe(false);
    expect(deveCredenciarTodosAoCriar(null, false)).toBe(false);
  });
  it('no mesmo nível de plano, o credenciamento do estabelecimento vence; depois, o de maior id', () => {
    const geralDescredencia = cred({ id: 1, estabelecimentoId: 5, credenciado: false });
    const r = verificarCredenciamento({ ...base, credenciamentos: [geralDescredencia, cred({ id: 2 })] });
    expect([r.credenciado, r.efeito, r.credenciamentoId]).toEqual([false, 'alerta', 1]);
    expect(r.motivo).toBe(
      'O profissional está descredenciado neste convênio ou plano; o atendimento segue com alerta.',
    );
    const s = verificarCredenciamento({
      ...base,
      credenciamentos: [cred({ id: 3 }), cred({ id: 4, credenciado: false }), cred({ id: 2 })],
    });
    expect([s.efeito, s.credenciamentoId]).toEqual(['alerta', 4]);
    // Credenciamento de outro profissional ou que ainda não começou não vale.
    expect(
      verificarCredenciamento({
        ...base,
        credenciamentos: [cred({ profissionalId: 102 }), cred({ vigenciaInicio: '2026-12-01' })],
      }),
    ).toMatchObject({ credenciado: false, credenciamentoId: null });
  });
  it('plano desconhecido: o alerta aponta o credenciamento de plano mais recente, só entre os vigentes e ativos', () => {
    const semPlano = { ...base, planoId: null, planoSuperiorId: null, planoDesconhecido: true };
    const v = verificarCredenciamento({
      ...semPlano,
      credenciamentos: [
        cred({ id: 3, planoId: 31 }),
        cred({ id: 8, planoId: 32 }),
        cred({ id: 9, planoId: 33, credenciado: false }),
        cred({ id: 10, planoId: 34, vigenciaFim: '2026-10-31' }),
        cred({ id: 11, planoId: 35, profissionalId: 102 }),
        cred({ id: 5, planoId: 36 }),
      ],
    });
    expect([v.credenciado, v.efeito, v.credenciamentoId]).toEqual([false, 'alerta', 8]);
    // Com o plano do paciente informado, a regra do plano desconhecido não se aplica.
    const comPlano = verificarCredenciamento({
      ...base,
      planoId: 40,
      planoSuperiorId: null,
      planoDesconhecido: true,
      credenciamentos: [cred({ id: 3, planoId: 31 })],
      opcoes: { ...base.opcoes, bloqueiaSemCredenciamento: true },
    });
    expect([comPlano.efeito, comPlano.credenciamentoId]).toEqual(['bloqueio', null]);
    expect(comPlano.motivo).toBe(
      'O profissional não tem credenciamento vigente neste convênio ou plano; o convênio bloqueia o atendimento.',
    );
    // Só credenciamentos de plano descredenciados ou vencidos: segue a regra geral (sem opções, alerta).
    const sem = verificarCredenciamento({
      ...semPlano,
      opcoes: null,
      credenciamentos: [cred({ id: 9, planoId: 33, credenciado: false })],
    });
    expect([sem.efeito, sem.credenciamentoId]).toEqual(['alerta', null]);
  });
  it('em massa só entram os tipos que atendem pelo convênio', () => {
    for (const t of TIPOS_PROFISSIONAL_CREDENCIAVEIS) expect(profissionalCredenciavel(t)).toBe(true);
    expect(profissionalCredenciavel('administrativo')).toBe(false);
    expect(profissionalCredenciavel('assistencial')).toBe(false);
    expect(profissionalCredenciavel('')).toBe(false);
    expect(deveCredenciarTodosAoCriar({ ...base.opcoes, credenciaTodosAoCriar: false }, false)).toBe(false);
  });
});
