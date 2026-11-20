// W1-01 (parte 9c): regra da recertificação de acessos (campanha, itens, decisão, relatório). Dados sintéticos.
import { describe, expect, it } from 'vitest';
import {
  itensDaCampanhaRecert,
  prazoRecertPadrao,
  relatorioRecert,
  validarDecisaoRecert,
  validarNovaCampanhaRecert,
  type ContaRecertLida,
  type ItemRecert,
} from './recertificacao.js';

const HOJE = '2026-11-19';
const conta = (v: Partial<ContaRecertLida> & { login: string }): ContaRecertLida => ({
  grupo: 'ENFERMAGEM',
  ativo: true,
  bloqueado: false,
  setores: [],
  perfis: [],
  ...v,
});
const item = (v: Partial<ItemRecert> = {}): ItemRecert => ({
  login: 'SINT.A',
  grupo: 'ENFERMAGEM',
  perfis: ['faturista', 'recepcao'],
  decisao: null,
  acao: null,
  perfil: null,
  ...v,
});
const camp = (v: Record<string, unknown> = {}) => ({
  escopo: 'grupo' as const,
  alvo: 'ENFERMAGEM' as string | null,
  prazo: '2026-12-19',
  motivo: 'recertificação semestral da enfermagem',
  ...v,
});

describe('W1-01 (parte 9c): recertificação de acessos', () => {
  it('campanha: aceita a válida; recusa escopo, alvo, prazo (passado, hoje, > 90 dias, data inexistente) e motivo', () => {
    expect(validarNovaCampanhaRecert(camp(), HOJE)).toBeNull();
    expect(validarNovaCampanhaRecert(camp({ escopo: 'todos', alvo: null }), HOJE)).toBeNull();
    expect(prazoRecertPadrao(HOJE)).toBe('2026-12-19');
    const cod = (v: Record<string, unknown>) => validarNovaCampanhaRecert(camp(v) as never, HOJE)?.codigo;
    expect(cod({ escopo: 'unidade' })).toBe('escopo-invalido');
    expect(cod({ alvo: ' ' })).toBe('alvo-obrigatorio');
    expect(cod({ escopo: 'setor', alvo: null })).toBe('alvo-obrigatorio');
    expect(cod({ prazo: HOJE })).toBe('prazo-invalido');
    expect(cod({ prazo: '2026-11-01' })).toBe('prazo-invalido');
    expect(cod({ prazo: '2027-02-18' })).toBe('prazo-invalido');
    expect(cod({ prazo: '2027-02-17' })).toBeUndefined();
    expect(cod({ prazo: '2026-11-31' })).toBe('prazo-invalido');
    expect(cod({ prazo: '19/12/2026' })).toBe('prazo-invalido');
    expect(cod({ motivo: 'curto' })).toBe('motivo-curto');
  });

  it('itens: só contas ativas e livres do escopo (grupo, setor ou todas), com os perfis em ordem', () => {
    const contas = [
      conta({ login: 'SINT.C', perfis: ['recepcao', 'faturista'], setores: ['UTI'] }),
      conta({ login: 'SINT.A', grupo: 'enfermagem ' }),
      conta({ login: 'SINT.B', grupo: 'MEDICOS', setores: ['uti'] }),
      conta({ login: 'SINT.D', bloqueado: true }),
      conta({ login: 'SINT.E', ativo: false, setores: ['UTI'] }),
    ];
    expect(itensDaCampanhaRecert(contas, 'grupo', 'ENFERMAGEM').map((i) => i.login)).toEqual([
      'SINT.A',
      'SINT.C',
    ]);
    expect(itensDaCampanhaRecert(contas, 'setor', 'UTI').map((i) => i.login)).toEqual(['SINT.B', 'SINT.C']);
    expect(itensDaCampanhaRecert(contas, 'todos', null).map((i) => i.login)).toEqual([
      'SINT.A',
      'SINT.B',
      'SINT.C',
    ]);
    expect(itensDaCampanhaRecert(contas, 'grupo', 'ENFERMAGEM')[1]?.perfis).toEqual([
      'faturista',
      'recepcao',
    ]);
  });

  it('decisão: manter e retirar (bloqueio ou revogação) aceitos; recusas de campanha fechada, já decidido, a si, ação, motivo e perfil', () => {
    const manter = { decisao: 'manter' as const, acao: null, perfil: null, motivo: '' };
    const bloquear = {
      decisao: 'retirar' as const,
      acao: 'bloqueio' as const,
      perfil: null,
      motivo: 'saiu do setor em outubro',
    };
    const revogar = { ...bloquear, acao: 'revogacao' as const, perfil: 'faturista' };
    expect(validarDecisaoRecert('aberta', item(), manter, 'SINT.GESTOR')).toBeNull();
    expect(validarDecisaoRecert('aberta', item(), bloquear, 'SINT.GESTOR')).toBeNull();
    expect(validarDecisaoRecert('aberta', item(), revogar, 'SINT.GESTOR')).toBeNull();
    const cod = (...a: Parameters<typeof validarDecisaoRecert>) => validarDecisaoRecert(...a)?.codigo;
    expect(cod('encerrada', item(), manter, 'SINT.GESTOR')).toBe('campanha-fechada');
    expect(cod('cancelada', item(), manter, 'SINT.GESTOR')).toBe('campanha-fechada');
    expect(cod('aberta', item({ decisao: 'manter' }), bloquear, 'SINT.GESTOR')).toBe('ja-decidido');
    expect(cod('aberta', item(), manter, 'sint.a')).toBe('decidir-a-si');
    expect(cod('aberta', item(), { ...manter, acao: 'bloqueio' }, 'SINT.GESTOR')).toBe('acao-invalida');
    expect(cod('aberta', item(), { ...bloquear, acao: null }, 'SINT.GESTOR')).toBe('acao-invalida');
    expect(cod('aberta', item(), { ...bloquear, perfil: 'faturista' }, 'SINT.GESTOR')).toBe('acao-invalida');
    expect(cod('aberta', item(), { ...bloquear, motivo: 'curto' }, 'SINT.GESTOR')).toBe('motivo-curto');
    expect(cod('aberta', item(), { ...revogar, perfil: 'administrador' }, 'SINT.GESTOR')).toBe(
      'perfil-ausente',
    );
    expect(cod('aberta', item(), { ...revogar, perfil: null }, 'SINT.GESTOR')).toBe('perfil-ausente');
  });

  it('relatório: mantidas, bloqueadas, revogadas, pendentes, atrasadas só depois do prazo com a campanha aberta', () => {
    const itens = [
      { decisao: 'manter' as const, acao: null },
      { decisao: 'retirar' as const, acao: 'bloqueio' as const },
      { decisao: 'retirar' as const, acao: 'revogacao' as const },
      { decisao: null, acao: null },
    ];
    expect(relatorioRecert(itens, '2026-12-19', HOJE, 'aberta')).toEqual({
      total: 4,
      mantidas: 1,
      bloqueadas: 1,
      revogadas: 1,
      pendentes: 1,
      atrasadas: 0,
      percentual: 75,
    });
    expect(relatorioRecert(itens, '2026-11-18', HOJE, 'aberta').atrasadas).toBe(1);
    expect(relatorioRecert(itens, '2026-11-19', HOJE, 'aberta').atrasadas).toBe(0);
    expect(relatorioRecert(itens, '2026-11-18', HOJE, 'encerrada').atrasadas).toBe(0);
    expect(relatorioRecert([], '2026-12-19', HOJE, 'aberta').percentual).toBe(0);
  });
});
