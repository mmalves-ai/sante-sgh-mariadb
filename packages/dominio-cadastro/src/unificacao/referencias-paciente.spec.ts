import { describe, expect, it } from 'vitest';
import { planoDeUnificacao, REFERENCIAS_PACIENTE, tabelasDaUnificacao } from './referencias-paciente.js';

describe('unificação: referências ao paciente', () => {
  it('sem repetição; transfere alergia, cobertura, atendimento e marcação; mantém o registro da própria unificação', () => {
    const chaves = REFERENCIAS_PACIENTE.map((r) => `${r.tabela}.${r.coluna}`);
    expect(new Set(chaves).size).toBe(chaves.length);
    const t = tabelasDaUnificacao();
    for (const x of ['alergia_paciente', 'cobertura_paciente', 'atendimento', 'marcacao_horario']) expect(t).toContain(x);
    for (const x of ['unificacao_cadastro', 'paciente', 'paciente_versao', 'suspeita_duplicidade']) expect(t).not.toContain(x);
    expect(REFERENCIAS_PACIENTE.filter((r) => r.destino === 'manter').every((r) => r.motivo)).toBe(true);
  });
  it('referência do banco fora da lista vira recusa', () => {
    const p = planoDeUnificacao([
      { tabela: 'alergia_paciente', coluna: 'paciente_id' },
      { tabela: 'tabela_nova', coluna: 'paciente_id' },
    ]);
    expect(p.naoCobertas).toEqual(['tabela_nova.paciente_id']);
    expect(p.transferir.length).toBe(REFERENCIAS_PACIENTE.filter((r) => r.destino === 'transferir').length);
  });
});
