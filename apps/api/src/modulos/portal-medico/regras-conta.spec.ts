// Regras da conta do médico externo (W0-10): o ato do hospital e a tradução da situação do modelo para a tela.
import { describe, expect, it } from 'vitest';
import { conferirAtoContaMedico, SITUACAO_DO_MODELO, situacaoDaTela } from './regras-conta.js';

const ato = (
  a: 'bloqueio' | 'desbloqueio' | 'encerramento',
  o: Partial<{ motivo: string; pendentes: number; decisao: 'retirar' | 'manter' | null }> = {},
) => ({
  ato: a,
  motivo: o.motivo ?? 'Motivo de teste',
  pedidosPendentes: o.pendentes ?? 0,
  decisaoPedidos: o.decisao ?? null,
});
const codigo = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { problema?: { codigo?: string } }).problema?.codigo ?? 'outro';
  }
};

describe('regras da conta do médico externo', () => {
  it('bloqueia a ativa, desbloqueia a bloqueada e encerra a que não está encerrada', () => {
    expect(conferirAtoContaMedico('ativo', ato('bloqueio'))).toBe('bloqueado');
    expect(conferirAtoContaMedico('bloqueado', ato('desbloqueio'))).toBe('ativo');
    expect(conferirAtoContaMedico('bloqueado', ato('encerramento'))).toBe('encerrado');
    expect(conferirAtoContaMedico('ativo', ato('encerramento', { pendentes: 2, decisao: 'manter' }))).toBe(
      'encerrado',
    );
  });

  it('recusa o ato sem efeito, sem motivo ou sem a decisão dos pedidos pendentes', () => {
    expect(codigo(() => conferirAtoContaMedico('bloqueado', ato('bloqueio')))).toBe('conta-nao-ativa');
    expect(codigo(() => conferirAtoContaMedico('ativo', ato('desbloqueio')))).toBe('conta-nao-bloqueada');
    expect(codigo(() => conferirAtoContaMedico('encerrado', ato('encerramento')))).toBe('conta-encerrada');
    expect(codigo(() => conferirAtoContaMedico('ativo', ato('bloqueio', { motivo: ' ab ' })))).toBe(
      'motivo-obrigatorio',
    );
    expect(codigo(() => conferirAtoContaMedico('ativo', ato('encerramento', { pendentes: 1 })))).toBe(
      'pedidos-pendentes',
    );
  });

  it('traduz a situação do modelo para a tela e de volta', () => {
    expect(situacaoDaTela('ativa')).toBe('ativo');
    expect(situacaoDaTela('suspensa')).toBe('bloqueado');
    expect(situacaoDaTela('encerrada')).toBe('encerrado');
    expect(situacaoDaTela('pendente')).toBeNull();
    expect(SITUACAO_DO_MODELO.bloqueado).toBe('bloqueada');
  });
});
