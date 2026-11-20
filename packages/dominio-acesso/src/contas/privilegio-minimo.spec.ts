// M59-F1, regra 4: plano de privilégios por módulo, desvios e os scripts aplicar/recolher.
import { describe, expect, it } from 'vitest';
import type { AlcanceModulo } from '@sgh/contratos';
import {
  compararPrivilegios,
  contaDoModulo,
  gerarScriptsPapeis,
  gerarScriptsRevogacao,
  papelDoModulo,
  planejarPrivilegios,
  PlanoPrivilegioRecusado,
  sufixoModulo,
} from './privilegio-minimo.js';

const ALCANCES: AlcanceModulo[] = [
  {
    modulo: 'agenda',
    objetos: { SIPACAGD: ['SELECT', 'INSERT', 'UPDATE'], SGH_TRILHA: ['INSERT', 'SELECT'] },
  },
  { modulo: 'faturamentoTiss', objetos: { TBCONVEN: ['SELECT'], SP_X: ['EXECUTE'], GEN_X: ['USAGE'] } },
];

describe('nomes por módulo', () => {
  it('camelCase vira identificador do banco; recusa módulo inválido ou longo', () => {
    expect(sufixoModulo('faturamentoTiss')).toBe('FATURAMENTO_TISS');
    expect(papelDoModulo('agenda')).toBe('SGH_MOD_AGENDA');
    expect(contaDoModulo('pep')).toBe('SGH_APP_PEP');
    expect(() => sufixoModulo('Agenda')).toThrow(/inválido/);
    expect(() => sufixoModulo(`a${'b'.repeat(60)}`)).toThrow(/longo/);
  });
});

describe('planejarPrivilegios', () => {
  it('um item por papel, objeto e ação, ordenado e sem repetição', () => {
    const p = planejarPrivilegios([...ALCANCES, { modulo: 'pep', objetos: { TBX: ['SELECT', 'SELECT'] } }]);
    expect(p.map((i) => `${i.titular}:${i.objeto}:${i.acao}`)).toEqual([
      'SGH_MOD_AGENDA:SGH_TRILHA:SELECT',
      'SGH_MOD_AGENDA:SGH_TRILHA:INSERT',
      'SGH_MOD_AGENDA:SIPACAGD:SELECT',
      'SGH_MOD_AGENDA:SIPACAGD:INSERT',
      'SGH_MOD_AGENDA:SIPACAGD:UPDATE',
      'SGH_MOD_FATURAMENTO_TISS:GEN_X:USAGE',
      'SGH_MOD_FATURAMENTO_TISS:SP_X:EXECUTE',
      'SGH_MOD_FATURAMENTO_TISS:TBCONVEN:SELECT',
      'SGH_MOD_PEP:TBX:SELECT',
    ]);
  });

  it('recusa trilha alterável, catálogo do servidor, identificador inválido, EXECUTE misturado e módulo repetido', () => {
    let erro: PlanoPrivilegioRecusado | null = null;
    try {
      planejarPrivilegios([
        {
          modulo: 'pep',
          objetos: { SGH_TRILHA: ['UPDATE'], SGH_TRILHA_CADEIA: ['DELETE'], 'x;drop': ['SELECT'] },
        },
        {
          modulo: 'pep',
          objetos: { RDB$RELATIONS: ['SELECT'], SP_Y: ['EXECUTE', 'SELECT'], GEN_Y: ['USAGE', 'INSERT'] },
        },
        { modulo: 'Ruim', objetos: {} },
      ]);
    } catch (e) {
      erro = e as PlanoPrivilegioRecusado;
    }
    expect(erro).toBeInstanceOf(PlanoPrivilegioRecusado);
    expect(erro?.motivos).toHaveLength(8);
    expect(erro?.message).toMatch(/só de inclusão/);
  });
});

describe('compararPrivilegios', () => {
  it('excesso (direto na conta do módulo ou fora do plano), falta e iguais; ignora titulares de fora', () => {
    const plano = planejarPrivilegios(ALCANCES);
    const reais = [
      ...plano.filter((i) => i.objeto !== 'SP_X'),
      { titular: 'SGH_MOD_AGENDA', objeto: 'SIPACAGD', acao: 'DELETE' as const },
      { titular: 'SGH_APP_AGENDA', objeto: 'TBUSERS', acao: 'SELECT' as const },
      { titular: 'EXCEL', objeto: 'TBUSERS', acao: 'SELECT' as const },
    ];
    const d = compararPrivilegios(plano, reais);
    expect(d.falta).toEqual([{ titular: 'SGH_MOD_FATURAMENTO_TISS', objeto: 'SP_X', acao: 'EXECUTE' }]);
    expect(d.excesso.map((i) => `${i.titular}:${i.objeto}:${i.acao}`)).toEqual([
      'SGH_APP_AGENDA:TBUSERS:SELECT',
      'SGH_MOD_AGENDA:SIPACAGD:DELETE',
    ]);
    expect(d.iguais).toBe(plano.length - 1);
  });
});

describe('scripts', () => {
  it('papéis: aplicar cria, concede e liga a conta; recolher desfaz na ordem inversa; sem senha', () => {
    const s = gerarScriptsPapeis(planejarPrivilegios(ALCANCES), { hospital: 'pc', versao: '1' });
    expect(s.aplicar).toContain('CREATE ROLE "SGH_MOD_AGENDA";');
    expect(s.aplicar).toContain('GRANT INSERT ON "SIPACAGD" TO ROLE "SGH_MOD_AGENDA";');
    expect(s.aplicar).toContain('GRANT EXECUTE ON PROCEDURE "SP_X" TO ROLE "SGH_MOD_FATURAMENTO_TISS";');
    expect(s.aplicar).toContain('GRANT USAGE ON GENERATOR "GEN_X" TO ROLE "SGH_MOD_FATURAMENTO_TISS";');
    expect(s.aplicar).toContain('GRANT "SGH_MOD_AGENDA" TO USER "SGH_APP_AGENDA";');
    // Firebird 3 (o banco do hospital) não tem papel padrão: o pool do módulo informa o papel ao conectar.
    expect(s.aplicar).not.toContain('GRANT DEFAULT');
    expect(s.aplicar).not.toMatch(/PASSWORD '[^<]/);
    expect(s.aplicar).not.toMatch(/GRANT OPTION|SYSDBA/);
    expect(s.recolher).toContain('REVOKE "SGH_MOD_AGENDA" FROM USER "SGH_APP_AGENDA";');
    expect(s.recolher).toContain('REVOKE SELECT ON "TBCONVEN" FROM ROLE "SGH_MOD_FATURAMENTO_TISS";');
    expect(s.recolher.indexOf('DROP ROLE "SGH_MOD_FATURAMENTO_TISS"')).toBeLessThan(
      s.recolher.indexOf('DROP ROLE "SGH_MOD_AGENDA"'),
    );
    expect(s.aplicar.trimEnd().endsWith('COMMIT;')).toBe(true);
    // O isql recusa byte acima de 127 até em comentário (integração na cópia): os scripts saem só em ASCII.
    expect([...(s.aplicar + s.recolher)].every((c) => c === '\n' || (c >= ' ' && c <= '~'))).toBe(true);
  });

  it('revogação: só os privilégios da conta, recolher concede de volta; recusa o administrador', () => {
    const antes = [
      { titular: 'EXCEL', objeto: 'TBB', acao: 'SELECT' as const },
      { titular: 'EXCEL', objeto: 'TBA', acao: 'SELECT' as const },
      { titular: 'OUTRA', objeto: 'TBA', acao: 'SELECT' as const },
      { titular: 'EXCEL', objeto: 'SP_Z', acao: 'EXECUTE' as const },
    ];
    const s = gerarScriptsRevogacao('EXCEL', antes, {
      hospital: 'pc',
      versao: '1',
      autorizacao: 'revogação\nautorizada',
    });
    expect(s.aplicar.split('\n').filter((l) => l.startsWith('REVOKE'))).toEqual([
      'REVOKE EXECUTE ON PROCEDURE "SP_Z" FROM USER "EXCEL";',
      'REVOKE SELECT ON "TBA" FROM USER "EXCEL";',
      'REVOKE SELECT ON "TBB" FROM USER "EXCEL";',
    ]);
    expect(s.recolher.split('\n').filter((l) => l.startsWith('GRANT'))).toHaveLength(3);
    expect(s.aplicar.split('\n')[0]).toContain('autorizacao: revogacao autorizada');
    expect([...(s.aplicar + s.recolher)].every((c) => c === '\n' || (c >= ' ' && c <= '~'))).toBe(true);
    expect(() =>
      gerarScriptsRevogacao('SYSDBA', antes, { hospital: 'pc', versao: '1', autorizacao: 'x' }),
    ).toThrow();
    expect(() =>
      gerarScriptsRevogacao('a"b', antes, { hospital: 'pc', versao: '1', autorizacao: 'x' }),
    ).toThrow(/inválido/);
  });
});
