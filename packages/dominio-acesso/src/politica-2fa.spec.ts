import { describe, expect, it } from 'vitest';
import {
  alcanca,
  avaliarPolitica2fa,
  conferirNovaLinha2fa,
  desfecho2faNoLogin,
  diaValido,
  GRUPOS_ONDA_1_2FA,
  type LinhaPolitica2fa,
  linhasDaOnda1,
  PERFIS_ONDA_1_2FA,
  podeRemoverSegundoFator,
  somarDias,
} from './politica-2fa.js';

const linha = (p: Partial<LinhaPolitica2fa> = {}): LinhaPolitica2fa => ({
  id: '1',
  alvo: 'perfil',
  valor: 'faturista',
  onda: 1,
  inicio: '2026-11-01',
  prazoAdesaoDias: 7,
  ativa: true,
  ...p,
});
const fat = { perfil: 'faturista', complementares: [], grupo: 'FATURAMENTO' };
const med = { perfil: 'medico', complementares: [], grupo: 'MEDICOS' };

describe('política do segundo fator (M59-F2, regra 3)', () => {
  it('onda 1 cobre administradores, gestores de acesso, auditores, faturamento e financeiro', () => {
    for (const p of ['administrador-sistema', 'gestor-acessos', 'auditor', 'faturista', 'financeiro']) {
      expect(PERFIS_ONDA_1_2FA).toContain(p);
    }
    expect(GRUPOS_ONDA_1_2FA).toContain('MASTER');
    const l = linhasDaOnda1();
    expect(l.filter((x) => x.alvo === 'grupo')).toHaveLength(GRUPOS_ONDA_1_2FA.length);
    expect(l.filter((x) => x.alvo === 'perfil')).toHaveLength(PERFIS_ONDA_1_2FA.length);
  });

  it('sem linha: opcional', () => {
    expect(avaliarPolitica2fa([], fat, '2026-11-05')).toEqual({
      exigencia: 'opcional',
      linha: null,
      prazoAdesaoAte: null,
    });
  });

  it('antes do início: opcional; no prazo: adesão; depois: obrigatório', () => {
    const l = [linha()];
    expect(avaliarPolitica2fa(l, fat, '2026-10-31').exigencia).toBe('opcional');
    expect(avaliarPolitica2fa(l, fat, '2026-11-01')).toEqual({
      exigencia: 'adesao',
      linha: '1',
      prazoAdesaoAte: '2026-11-07',
    });
    expect(avaliarPolitica2fa(l, fat, '2026-11-07').exigencia).toBe('adesao');
    expect(avaliarPolitica2fa(l, fat, '2026-11-08').exigencia).toBe('obrigatorio');
  });

  it('prazo zero: obrigatório desde o início', () => {
    expect(avaliarPolitica2fa([linha({ prazoAdesaoDias: 0 })], fat, '2026-11-01').exigencia).toBe(
      'obrigatorio',
    );
  });

  it('linha encerrada não conta (recolher)', () => {
    expect(avaliarPolitica2fa([linha({ ativa: false })], fat, '2026-12-01').exigencia).toBe('opcional');
  });

  it('linha com dia inválido é ignorada', () => {
    expect(avaliarPolitica2fa([linha({ inicio: '2026-02-30' })], fat, '2026-12-01').exigencia).toBe(
      'opcional',
    );
  });

  it('não alcança outro perfil; alcança por complementar, por grupo e "todos"', () => {
    expect(avaliarPolitica2fa([linha()], med, '2026-12-01').exigencia).toBe('opcional');
    expect(alcanca(linha({ valor: 'auditor' }), { ...med, complementares: ['auditor'] })).toBe(true);
    expect(alcanca(linha({ alvo: 'grupo', valor: 'MEDICOS' }), { ...med, grupo: 'MEDICOS   ' })).toBe(true);
    expect(alcanca(linha({ alvo: 'todos', valor: null }), med)).toBe(true);
    expect(alcanca(linha({ alvo: 'grupo', valor: '  ' }), med)).toBe(false);
    expect(alcanca(linha({ alvo: 'grupo', valor: 'MEDICOS' }), { ...med, grupo: null })).toBe(false);
  });

  it('duas linhas: vale a que exige mais', () => {
    const l = [
      linha({ id: 'a', inicio: '2026-11-10', prazoAdesaoDias: 30 }),
      linha({ id: 'b', alvo: 'grupo', valor: 'FATURAMENTO', inicio: '2026-11-01', prazoAdesaoDias: 3 }),
    ];
    expect(avaliarPolitica2fa(l, fat, '2026-11-02')).toMatchObject({ exigencia: 'adesao', linha: 'b' });
    expect(avaliarPolitica2fa(l, fat, '2026-11-12')).toMatchObject({ exigencia: 'obrigatorio', linha: 'b' });
    const ambas = [
      linha({ id: 'x', inicio: '2026-11-01', prazoAdesaoDias: 20 }),
      linha({ id: 'y', alvo: 'todos', valor: null, onda: 2, inicio: '2026-11-05', prazoAdesaoDias: 2 }),
    ];
    expect(avaliarPolitica2fa(ambas, fat, '2026-11-05')).toMatchObject({
      exigencia: 'adesao',
      linha: 'y',
      prazoAdesaoAte: '2026-11-06',
    });
  });

  it('desfecho no login', () => {
    const opc = avaliarPolitica2fa([], fat, '2026-11-01');
    const ade = avaliarPolitica2fa([linha()], fat, '2026-11-02');
    const obr = avaliarPolitica2fa([linha()], fat, '2026-12-02');
    expect(desfecho2faNoLogin('ativo', opc)).toEqual({ tipo: 'conferir-codigo' });
    expect(desfecho2faNoLogin('ativo', obr)).toEqual({ tipo: 'conferir-codigo' });
    expect(desfecho2faNoLogin('ausente', opc)).toEqual({ tipo: 'entrar' });
    expect(desfecho2faNoLogin('pendente', ade)).toEqual({
      tipo: 'entrar-e-cadastrar',
      prazoAdesaoAte: '2026-11-07',
    });
    expect(desfecho2faNoLogin('ausente', obr)).toEqual({ tipo: 'recusar' });
    expect(desfecho2faNoLogin('revogado', obr)).toEqual({ tipo: 'recusar' });
  });

  it('só remove o próprio segundo fator quando opcional', () => {
    expect(podeRemoverSegundoFator(avaliarPolitica2fa([], fat, '2026-11-01'))).toBe(true);
    expect(podeRemoverSegundoFator(avaliarPolitica2fa([linha()], fat, '2026-11-02'))).toBe(false);
  });

  it('confere a linha nova', () => {
    expect(conferirNovaLinha2fa(linha({ inicio: '2026-11-01' }), [], '2026-10-28')).toEqual([]);
    expect(conferirNovaLinha2fa(linha({ inicio: '2026-10-01' }), [], '2026-10-28')).toEqual([
      'O início não pode ser no passado.',
    ]);
    expect(conferirNovaLinha2fa(linha({ inicio: '2026-13-01' }), [], '2026-10-28')).toEqual([
      'Dia de início inválido.',
    ]);
    expect(conferirNovaLinha2fa(linha({ alvo: 'todos', valor: null, onda: 1 }), [], '2026-10-28')).toEqual([
      'A obrigatoriedade para todos é a onda 2.',
    ]);
    expect(conferirNovaLinha2fa(linha(), [linha()], '2026-10-28')).toEqual([
      'Já existe uma linha ativa para este alvo; encerre-a antes.',
    ]);
    expect(conferirNovaLinha2fa(linha(), [linha({ ativa: false })], '2026-10-28')).toEqual([]);
    expect(
      conferirNovaLinha2fa(
        linha({ alvo: 'todos', valor: null, onda: 2 }),
        [linha({ alvo: 'todos', valor: null })],
        '2026-10-28',
      ),
    ).toHaveLength(1);
  });

  it('dias civis', () => {
    expect(diaValido('2028-02-29')).toBe(true);
    expect(diaValido('2027-02-29')).toBe(false);
    expect(diaValido('ontem')).toBe(false);
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(() => somarDias('x', 1)).toThrow();
  });
});
