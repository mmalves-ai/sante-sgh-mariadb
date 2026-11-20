// D-PROF-39, login único por profissional (pergunta do dono, 18/11/2026: "por que tem 3 logins?"): a regra que o
// executor, a memória da API e a tela usam. Dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  esquemaVincularLoginProfissional,
  loginsDistintosDoProfissional,
  mensagemOutroLoginNoProfissional,
  mensagemOutroLoginNoRegistro,
  outroLoginDoProfissional,
  outroLoginNoRegistro,
  RECUSA_OUTRO_LOGIN_NO_PROFISSIONAL,
} from './profissional.js';

describe('login único por profissional', () => {
  const UM = [{ registro: 15, login: 'SINT.PROF6' }];

  it('sem login ligado: liga qualquer login a qualquer registro', () => {
    expect(outroLoginDoProfissional([], 16, 'SINT.LIVRE1')).toBeNull();
  });

  it('recusa um SEGUNDO login em outro registro do mesmo profissional (devolve o que já está ligado)', () => {
    expect(outroLoginDoProfissional(UM, 16, 'sint.livre1')).toBe('SINT.PROF6');
    expect(RECUSA_OUTRO_LOGIN_NO_PROFISSIONAL).toBe('outro-login-no-profissional');
    expect(mensagemOutroLoginNoProfissional('SINT.PROF6')).toMatch(
      /já tem o login SINT\.PROF6 ligado a outra ocupação.*um login só/,
    );
  });

  it('trocar o login no MESMO registro, trocar a ocupação (o mesmo login em outro registro) e desligar podem', () => {
    expect(outroLoginDoProfissional(UM, 15, 'SINT.LIVRE1')).toBeNull();
    expect(outroLoginDoProfissional(UM, 16, ' sint.prof6 ')).toBeNull();
    expect(outroLoginDoProfissional(UM, 16, null)).toBeNull();
  });

  it('dado herdado: os logins distintos aparecem todos (a tela avisa); ligar um terceiro é recusado', () => {
    const herdado = [
      { registro: 18, login: 'SINT.PROF7' },
      { registro: 19, login: 'sint.prof8' },
      { registro: 20, login: 'SINT.PROF7' },
    ];
    expect(loginsDistintosDoProfissional(herdado)).toEqual(['SINT.PROF7', 'SINT.PROF8']);
    expect(outroLoginDoProfissional(herdado, 21, 'SINT.LIVRE1')).toBe('SINT.PROF7');
    expect(loginsDistintosDoProfissional([])).toEqual([]);
  });

  it('revisão: dois logins herdados no MESMO registro; trocar deixaria o outro lá (recusa) e o ligado por fora', () => {
    const mesmo = [
      { registro: 18, login: 'SINT.PROF7' },
      { registro: 18, login: 'sint.prof8' },
    ];
    // Trocar SINT.PROF7 por SINT.LIVRE1 no 18: SINT.PROF8 sobraria.
    expect(outroLoginNoRegistro(mesmo, 18, 'SINT.LIVRE1', 'sint.prof7')).toBe('SINT.PROF8');
    // Ficar só com um dos dois (ligar o próprio SINT.PROF8 no lugar do SINT.PROF7) não deixa outro.
    expect(outroLoginNoRegistro(mesmo, 18, 'SINT.PROF8', 'SINT.PROF7')).toBeNull();
    expect(outroLoginNoRegistro(mesmo, 19, 'SINT.LIVRE1', '')).toBeNull();
    expect(outroLoginNoRegistro(mesmo, 18, null, 'SINT.PROF7')).toBeNull();
    expect(mensagemOutroLoginNoRegistro('SINT.PROF8')).toMatch(/também tem o login SINT\.PROF8.*desligue/);
    // Ligar por fora da ficha (papel 4 em Usuários e Acessos, versão vazia): o outro herdado do registro recusa.
    expect(outroLoginNoRegistro(mesmo, 18, 'SINT.PROF7', '')).toBe('SINT.PROF8');
  });

  it('o contrato da gravação continua um registro por pedido (ligar, trocar o login, trocar a ocupação, desligar)', () => {
    const r = esquemaVincularLoginProfissional.parse({
      profissional: 7,
      registro: 16,
      login: 'sint.prof6',
      versao: '',
      justificativa: 'Troca da ocupação no teste',
    });
    expect(r.login).toBe('SINT.PROF6');
    expect(esquemaVincularLoginProfissional.safeParse({ ...r, registros: [15, 16] }).success).toBe(false);
  });
});
