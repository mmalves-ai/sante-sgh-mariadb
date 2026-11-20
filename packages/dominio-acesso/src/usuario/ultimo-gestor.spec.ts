import { describe, expect, it } from 'vitest';
import { conferirUltimoGestor, type GestorAcessoAtivo, mensagemUltimoGestor } from './ultimo-gestor.js';

const g = (login: string, o: Partial<GestorAcessoAtivo> = {}): GestorAcessoAtivo => ({
  login,
  grupoAcessoTotal: false,
  papelGestor: false,
  concessoes: [],
  ...o,
});

describe('último gestor de acessos ativo (W1-01, parte 3c)', () => {
  const so = [g('ANA', { papelGestor: true }), g('BETO')];

  it('recusa bloquear o último gestor ativo', () => {
    expect(conferirUltimoGestor(so, { tipo: 'bloquear', login: 'ANA' })).toBe('ultimo-gestor-acessos');
    expect(conferirUltimoGestor(so, { tipo: 'bloquear', login: 'BETO' })).toBeNull();
  });

  it('recusa rebaixar: tirar do grupo de acesso total ou retirar o papel 0', () => {
    const master = [g('ANA', { grupoAcessoTotal: true })];
    expect(conferirUltimoGestor(master, { tipo: 'trocar-grupo', login: 'ANA', grupoNovo: 'MEDICOS' })).toBe(
      'ultimo-gestor-acessos',
    );
    // Continua no acesso total (chave sem acento e sem caixa): nada muda.
    expect(
      conferirUltimoGestor(master, { tipo: 'trocar-grupo', login: 'ANA', grupoNovo: ' master ' }),
    ).toBeNull();
    expect(conferirUltimoGestor(so, { tipo: 'retirar-papel', login: 'ANA', papel: 0 })).toBe(
      'ultimo-gestor-acessos',
    );
    // Outro papel não mexe na gestão de acessos.
    expect(conferirUltimoGestor(so, { tipo: 'retirar-papel', login: 'ANA', papel: 2 })).toBeNull();
  });

  it('recusa retirar a última concessão do perfil gestor-acessos', () => {
    const c = [g('ANA', { concessoes: ['7'] })];
    expect(conferirUltimoGestor(c, { tipo: 'retirar-perfil', concessao: '7' })).toBe('ultimo-gestor-acessos');
    expect(conferirUltimoGestor(c, { tipo: 'retirar-perfil', concessao: '8' })).toBeNull();
  });

  it('com outra fonte ou outro gestor, a ação passa', () => {
    // Perde o papel, mas segue gestor pela concessão nominal.
    expect(
      conferirUltimoGestor([g('ANA', { papelGestor: true, concessoes: ['7'] })], {
        tipo: 'retirar-papel',
        login: 'ANA',
        papel: 0,
      }),
    ).toBeNull();
    expect(
      conferirUltimoGestor([g('ANA', { papelGestor: true }), g('CAIO', { concessoes: ['9'] })], {
        tipo: 'bloquear',
        login: 'ANA',
      }),
    ).toBeNull();
  });

  it('sem gestor hoje, não recusa (a ação não piora); login com outra caixa é outra conta', () => {
    expect(conferirUltimoGestor([g('BETO')], { tipo: 'bloquear', login: 'BETO' })).toBeNull();
    expect(conferirUltimoGestor(so, { tipo: 'bloquear', login: 'ana' })).toBeNull();
  });

  it('a mensagem diz o que foi recusado e o que fazer', () => {
    expect(mensagemUltimoGestor({ tipo: 'bloquear', login: 'ANA' })).toMatch(
      /último gestor de acessos ativo/,
    );
    expect(mensagemUltimoGestor({ tipo: 'retirar-perfil', concessao: '7' })).toMatch(/retirar o perfil/);
  });
});
