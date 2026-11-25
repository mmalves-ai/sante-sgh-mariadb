// Valores habituais da abertura do atendimento (02-REC linha 31): escopo, convivência com a herança e o item que
// deixou de valer. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { aplicarPadraoAbertura, mudancasDoPadrao, resolverPadraoAbertura } from './padrao-abertura.js';

const item = (id: number, rotulo: string, vale = true) => ({ id, rotulo, vale });

describe('valores habituais da abertura', () => {
  it('o do usuário vence o do estabelecimento, campo a campo; campo sem valor fica de fora', () => {
    const r = resolverPadraoAbertura(
      { unidade: item(10, 'AMBULATORIO'), convenio: item(20, 'PARTICULAR') },
      { unidade: item(11, 'PRONTO ATENDIMENTO'), especialidade: item(30, 'CARDIOLOGIA'), convenio: null },
    );
    expect(r.campos).toEqual({
      unidade: { id: 11, rotulo: 'PRONTO ATENDIMENTO', origem: 'usuario' },
      convenio: { id: 20, rotulo: 'PARTICULAR', origem: 'estabelecimento' },
      especialidade: { id: 30, rotulo: 'CARDIOLOGIA', origem: 'usuario' },
    });
    expect(r.avisos).toEqual([]);
    expect(resolverPadraoAbertura(null, null)).toEqual({ campos: {}, avisos: [] });
  });

  it('o item que deixou de valer não entra: vale o do escopo seguinte, com aviso', () => {
    const r = resolverPadraoAbertura(
      { convenio: item(20, 'PARTICULAR'), unidade: item(10, 'AMBULATORIO', false) },
      { convenio: item(21, 'CONVENIO SUSPENSO', false) },
    );
    expect(r.campos).toEqual({ convenio: { id: 20, rotulo: 'PARTICULAR', origem: 'estabelecimento' } });
    expect(r.avisos).toEqual([
      'Unidade habitual do estabelecimento (AMBULATORIO) não está mais em uso: escolha outro valor.',
      'Convênio habitual dos seus valores habituais (CONVENIO SUSPENSO) não está mais em uso: escolha outro valor.',
    ]);
  });

  it('paciente sem atendimento anterior: a ficha recebe todos os valores habituais em vigor', () => {
    const v = resolverPadraoAbertura(
      { centroCusto: item(40, 'RECEPCAO') },
      { unidade: item(11, 'PA'), convenio: item(20, 'PARTICULAR'), especialidade: item(30, 'CLINICA') },
    );
    expect(aplicarPadraoAbertura(v, {})).toEqual({
      valores: { unidade: 11, centroCusto: 40, convenio: 20, especialidade: 30 },
      origens: {
        unidade: 'usuario',
        centroCusto: 'estabelecimento',
        convenio: 'usuario',
        especialidade: 'usuario',
      },
      avisos: [],
    });
  });

  it('o que veio do atendimento anterior do paciente fica: o hábito só completa o campo vazio', () => {
    const v = resolverPadraoAbertura(null, {
      unidade: item(11, 'PA'),
      convenio: item(20, 'PARTICULAR'),
      especialidade: item(30, 'CLINICA'),
    });
    const r = aplicarPadraoAbertura(v, { convenio: 306, matricula: 'X1', unidade: 0 });
    expect(r.valores).toEqual({ unidade: 11, especialidade: 30 });
    expect(r.origens).toEqual({ unidade: 'usuario', especialidade: 'usuario' });
  });

  it('com o profissional herdado, a especialidade habitual não entra (a especialidade é a dele)', () => {
    const v = resolverPadraoAbertura(null, { especialidade: item(30, 'CLINICA'), unidade: item(11, 'PA') });
    expect(aplicarPadraoAbertura(v, { profissional: 77 }).valores).toEqual({ unidade: 11 });
  });

  it('o aviso do item que deixou de valer só aparece para o campo que ficaria vazio', () => {
    const v = resolverPadraoAbertura(
      { convenio: item(20, 'PARTICULAR') },
      { convenio: item(21, 'SUSPENSO', false), unidade: item(12, 'ALA FECHADA', false) },
    );
    // O convênio foi coberto pelo estabelecimento: sem aviso; a unidade ficou vazia: aviso.
    expect(aplicarPadraoAbertura(v, {}).avisos).toEqual([
      'Unidade habitual dos seus valores habituais (ALA FECHADA) não está mais em uso: escolha outro valor.',
    ]);
    // A unidade veio do atendimento anterior: nenhum aviso.
    expect(aplicarPadraoAbertura(v, { unidade: 10 }).avisos).toEqual([]);
  });

  it('mudanças da gravação: só o campo informado e diferente; nulo limpa', () => {
    expect(
      mudancasDoPadrao({ unidade: 10, convenio: 20 }, { unidade: 10, convenio: null, especialidade: 30 }),
    ).toEqual([
      { campo: 'convenio', antes: 20, depois: null },
      { campo: 'especialidade', antes: null, depois: 30 },
    ]);
    expect(mudancasDoPadrao({}, { unidade: null })).toEqual([]);
    expect(mudancasDoPadrao({ unidade: 10 }, {})).toEqual([]);
  });
});
