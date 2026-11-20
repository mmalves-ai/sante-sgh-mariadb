import { describe, expect, it } from 'vitest';
import { conferirGestao, mensagemRecusaGestao } from './segregacao-gestao.js';

const gestor = { login: 'SINT.GESTOR', perfis: ['gestor-acessos'] };
const auditor = { login: 'SINT.AUDITOR', perfis: ['auditor'] };

describe('segregação nas telas de acesso (regra 7)', () => {
  it('ninguém altera, bloqueia ou muda o escopo de si mesmo', () => {
    for (const acao of [
      'alterar-usuario',
      'bloquear-usuario',
      'desbloquear-usuario',
      'alterar-escopo',
    ] as const)
      expect(conferirGestao(gestor, acao, 'SINT.GESTOR')).toBe('a-si-mesmo');
    expect(conferirGestao(gestor, 'bloquear-usuario', 'SINT.USUARIO')).toBeNull();
    // Login com outra caixa é outro usuário (comparação exata).
    expect(conferirGestao(gestor, 'alterar-usuario', 'sint.gestor')).toBeNull();
    expect(conferirGestao(gestor, 'criar-usuario', 'SINT.GESTOR')).toBeNull();
  });
  it('o Auditor só consulta', () => {
    expect(conferirGestao(auditor, 'criar-usuario', 'X')).toBe('auditor-nao-altera');
    expect(conferirGestao(auditor, 'conceder-opcao', null)).toBe('auditor-nao-altera');
    expect(
      conferirGestao({ login: 'A', perfis: ['auditor', 'administrador-sistema'] }, 'conceder-opcao', null),
    ).toBeNull();
    expect(
      conferirGestao({ login: 'A', perfis: ['auditor', 'gestor-acessos'] }, 'conceder-opcao', null),
    ).toBeNull();
  });
  it('o termo, cada um aceita o próprio', () => {
    expect(conferirGestao(auditor, 'aceitar-termo', 'SINT.AUDITOR')).toBeNull();
  });
  it('mensagens de produto', () => {
    expect(mensagemRecusaGestao('auditor-nao-altera', 'criar-usuario')).toMatch(/auditoria só consulta/);
    expect(mensagemRecusaGestao('a-si-mesmo', 'bloquear-usuario')).toMatch(/bloqueia/);
    expect(mensagemRecusaGestao('a-si-mesmo', 'alterar-escopo')).toMatch(/próprio acesso/);
  });
});
