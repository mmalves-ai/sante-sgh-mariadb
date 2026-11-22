import type { Credenciamento } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { deveCredenciarTodosAoCriar, verificarCredenciamento } from './index.js';

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
});
