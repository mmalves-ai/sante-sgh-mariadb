import { describe, expect, it } from 'vitest';
import { ACOES_CLINICAS, acaoDoAtestado, categoriaDoCbo, podePraticar } from './matriz-acao.js';

describe('matriz ação × categoria (regra 2)', () => {
  it('categoria pelo CBO 2002', () => {
    expect(categoriaDoCbo('225125')).toBe('medico');
    expect(categoriaDoCbo('2251-25')).toBe('medico');
    expect(categoriaDoCbo('223505')).toBe('enfermagem');
    expect(categoriaDoCbo('322205')).toBe('enfermagem');
    expect(categoriaDoCbo('223605')).toBe('fisioterapia');
    expect(categoriaDoCbo('223710')).toBe('nutricao');
    expect(categoriaDoCbo('251510')).toBe('psicologia');
    expect(categoriaDoCbo('223810')).toBe('fonoaudiologia');
    expect(categoriaDoCbo('223208')).toBe('odontologia');
    expect(categoriaDoCbo('223405')).toBe('farmacia');
    expect(categoriaDoCbo('251605')).toBe('servico-social');
    expect(categoriaDoCbo('411010')).toBe('outros');
    expect(categoriaDoCbo('12')).toBeNull();
    expect(categoriaDoCbo(null)).toBeNull();
  });

  it('atestado médico, óbito e sumário de alta só por médico com conselho ativo', () => {
    const medico = { categoria: 'medico' as const, conselhoAtivo: true };
    const enfermeiro = { categoria: 'enfermagem' as const, conselhoAtivo: true };
    for (const a of ['atestado-medico', 'declaracao-obito', 'sumario-alta'] as const) {
      expect(podePraticar(medico, a).pode).toBe(true);
      const r = podePraticar(enfermeiro, a);
      expect(r.pode).toBe(false);
      expect(r.motivo).toMatch(/Só médico/);
    }
    expect(podePraticar({ categoria: 'medico', conselhoAtivo: false }, 'atestado-medico').motivo).toMatch(
      /conselho/,
    );
    expect(podePraticar({ categoria: null, conselhoAtivo: true }, 'receita').motivo).toMatch(/ocupação/);
  });

  it('receita e pedido de exame: médico e cirurgião-dentista', () => {
    expect(podePraticar({ categoria: 'odontologia', conselhoAtivo: true }, 'receita').pode).toBe(true);
    expect(podePraticar({ categoria: 'nutricao', conselhoAtivo: true }, 'pedido-exame').pode).toBe(false);
    expect(podePraticar({ categoria: 'odontologia', conselhoAtivo: true }, 'receita-controlada').pode).toBe(
      false,
    );
  });

  it('ações multiprofissionais para todas as categorias assistenciais, não para "outros"', () => {
    for (const c of ['enfermagem', 'fisioterapia', 'psicologia', 'nutricao'] as const)
      expect(podePraticar({ categoria: c, conselhoAtivo: true }, 'parecer-resposta').pode).toBe(true);
    expect(podePraticar({ categoria: 'outros', conselhoAtivo: true }, 'alergia').pode).toBe(false);
    for (const a of ACOES_CLINICAS)
      expect(podePraticar({ categoria: 'medico', conselhoAtivo: true }, a).pode).toBe(true);
  });

  it('ação do atestado pelo tipo', () => {
    expect(acaoDoAtestado('atestado')).toBe('atestado-medico');
    expect(acaoDoAtestado('declaracao')).toBe('declaracao-comparecimento');
    expect(acaoDoAtestado('requerimento')).toBe('requerimento');
  });
});
