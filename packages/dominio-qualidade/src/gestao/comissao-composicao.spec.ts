import { describe, expect, it } from 'vitest';
import {
  chaveDaPessoaNaComposicao,
  mudancaDaComposicao,
  nomeComparavel,
  papelDaFuncao,
  presentesDaReuniao,
  quorumAtingido,
  recusaAmostraSorteio,
} from './comissao-composicao.js';

describe('composição da comissão, quórum e amostra do sorteio', () => {
  it('papel pela função escrita, com e sem acento; o resto é membro', () => {
    expect(papelDaFuncao('Presidente')).toBe('presidente');
    expect(papelDaFuncao('Vice-presidente')).toBe('vice_presidente');
    expect(papelDaFuncao('vice presidente da comissão')).toBe('vice_presidente');
    expect(papelDaFuncao('Secretária')).toBe('secretario');
    expect(papelDaFuncao('MEMBRO EXECUTOR')).toBe('membro_executor');
    expect(papelDaFuncao('Consultora')).toBe('consultor');
    expect(papelDaFuncao('Enfermeira do NSP')).toBe('membro');
    expect(papelDaFuncao('Representante da presidência')).toBe('membro');
  });

  it('nome comparável sem caixa, acento nem espaços repetidos', () => {
    expect(nomeComparavel('  José  da   Silva ')).toBe(nomeComparavel('JOSE DA SILVA'));
  });

  it('quórum pelo mínimo da comissão ou pela maioria simples', () => {
    expect(quorumAtingido(3, 5, null)).toBe(true);
    expect(quorumAtingido(2, 4, null)).toBe(false);
    expect(quorumAtingido(2, 5, 2)).toBe(true);
    expect(quorumAtingido(1, 5, 2)).toBe(false);
    expect(quorumAtingido(0, 0, null)).toBe(false);
    expect(quorumAtingido(6, 5, null)).toBe(false);
    expect(() => quorumAtingido(-1, 5, null)).toThrow();
  });

  it('mudança da composição pela pessoa e pelo papel', () => {
    const atuais = [
      { id: 1, pessoa: 'u:10', papel: 'presidente' as const, funcao: 'Presidente' },
      { id: 2, pessoa: 'x:ana', papel: 'membro' as const, funcao: 'Enfermeira' },
      { id: 3, pessoa: 'p:7', papel: 'membro' as const, funcao: 'Médico' },
    ];
    const novos = [
      { pessoa: 'u:10', papel: 'presidente' as const, funcao: 'Presidente' },
      { pessoa: 'x:ana', papel: 'membro' as const, funcao: 'Enfermeira da UTI' },
      { pessoa: 'x:bia', papel: 'secretario' as const, funcao: 'Secretária' },
    ];
    const m = mudancaDaComposicao(atuais, novos);
    expect(m.mantidos.map((a) => a.id)).toEqual([1]);
    expect(m.funcaoTrocada.map((t) => [t.atual.id, t.nova.funcao])).toEqual([[2, 'Enfermeira da UTI']]);
    expect(m.encerrados.map((a) => a.id)).toEqual([3]);
    expect(m.incluidos.map((x) => x.pessoa)).toEqual(['x:bia']);
    expect(() => mudancaDaComposicao([], [novos[0]!, novos[0]!])).toThrow();
  });

  it('amostra do sorteio: vazia, maior que o universo e repetida recusam', () => {
    expect(recusaAmostraSorteio([], 10)).toBe('amostra-vazia');
    expect(recusaAmostraSorteio([{ reg: 1 }, { reg: 2 }], 1)).toBe('amostra-maior-que-universo');
    expect(recusaAmostraSorteio([{ reg: 1 }, { reg: 1 }], 5)).toBe('prontuario-repetido');
    expect(recusaAmostraSorteio([{ reg: 1 }, { reg: 2 }], 5)).toBeNull();
  });

  it('a conta já presente na composição por outra chave mantém a chave gravada (o mesmo papel primeiro)', () => {
    const atuais = [
      { pessoa: 'p:7', papel: 'membro' as const },
      { pessoa: 'p:7', papel: 'presidente' as const },
    ];
    expect(chaveDaPessoaNaComposicao('c:3', ['c:3', 'p:7'], 'presidente', atuais)).toBe('p:7');
    expect(chaveDaPessoaNaComposicao('c:3', ['p:7'], 'secretario', atuais)).toBe('p:7');
    expect(chaveDaPessoaNaComposicao('c:3', ['c:3'], 'membro', atuais)).toBe('c:3');
    expect(chaveDaPessoaNaComposicao('c:3', [], 'membro', [])).toBe('c:3');
  });

  it('presença por membro: posição da tela, sem repetir, vigente na data da reunião', () => {
    // A mesma pessoa em dois papéis e dois homônimos são linhas distintas: marcar uma não marca a outra.
    const tela = [
      { id: 1, nome: 'Ana' },
      { id: 2, nome: 'Ana' },
      { id: 3, nome: 'Bia' },
    ];
    const r = presentesDaReuniao([1], tela, tela);
    expect('presentes' in r && r.presentes.map((m) => m.id)).toEqual([2]);
    const ambos = presentesDaReuniao([0, 1], tela, tela);
    expect('presentes' in ambos && ambos.presentes.map((m) => m.id)).toEqual([1, 2]);
    expect(presentesDaReuniao([3], tela, tela)).toEqual({ recusa: 'presente-fora-da-composicao' });
    expect(presentesDaReuniao([-1], tela, tela)).toEqual({ recusa: 'presente-fora-da-composicao' });
    expect(presentesDaReuniao([0, 0], tela, tela)).toEqual({ recusa: 'presente-repetido' });
    // Quem entrou depois da data da reunião não pode estar presente nela.
    expect(presentesDaReuniao([2], tela, [{ id: 1 }, { id: 2 }])).toEqual({
      recusa: 'presente-fora-da-data',
    });
  });
});
