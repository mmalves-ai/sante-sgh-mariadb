// M59-F1 (regra 4): a API não sobe em homologação ou produção com a conta da aplicação (ou a de um módulo) sendo o
// administrador do servidor ou a dos scripts SGH_. Em dev e CI não confere (a cópia de dev usa o administrador).
import { describe, expect, it } from 'vitest';
import { recusaDasContasDoBanco } from './partida.js';

const base = { ESTABELECIMENTOS: 'pc', FB_PC_SCRIPTS_USUARIO: 'SGH_SCRIPTS' };

describe('recusaDasContasDoBanco', () => {
  it('dev e CI: não confere', () => {
    expect(recusaDasContasDoBanco({ ...base, AMBIENTE: 'dev', FB_PC_USUARIO: 'SYSDBA' })).toBeNull();
    expect(recusaDasContasDoBanco({ ...base, AMBIENTE: 'ci', FB_PC_USUARIO: 'SYSDBA' })).toBeNull();
  });

  it('produção com conta própria: sobe', () => {
    expect(recusaDasContasDoBanco({ ...base, AMBIENTE: 'producao', FB_PC_USUARIO: 'SGH_APP' })).toBeNull();
  });

  it('produção com o administrador ou a conta dos scripts: recusa', () => {
    expect(recusaDasContasDoBanco({ ...base, AMBIENTE: 'producao', FB_PC_USUARIO: 'sysdba' })).toMatch(
      /pc: a aplicação não pode usar o administrador do servidor/,
    );
    expect(
      recusaDasContasDoBanco({ ...base, AMBIENTE: 'homologacao', FB_PC_USUARIO: 'SGH_SCRIPTS' }),
    ).toMatch(/conta dos scripts SGH_/);
  });

  it('a conta de um módulo também é conferida', () => {
    const r = recusaDasContasDoBanco({
      ...base,
      AMBIENTE: 'producao',
      FB_PC_USUARIO: 'SGH_APP',
      FB_PC_MOD_ACESSO_USUARIO: 'SYSDBA',
    });
    expect(r).toMatch(/FB_PC_MOD_ACESSO_USUARIO: o administrador do servidor é recusado \(regra 4\)/);
  });
});
