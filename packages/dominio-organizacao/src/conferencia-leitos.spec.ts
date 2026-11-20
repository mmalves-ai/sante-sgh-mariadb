import { describe, expect, it } from 'vitest';
import { conferirLeitos, leitoAtivo } from './conferencia-leitos.js';

describe('conferência dos dois modelos de leito (regra 13)', () => {
  it('leito a leito pela chave textual; externo não é divergência', () => {
    const r = conferirLeitos(
      {
        acomodacoes: [
          { bloco: '1', acomodacao: '101', nome: 'Apto 101' },
          { bloco: '1', acomodacao: '102', nome: 'Apto 102' },
          { bloco: '1', acomodacao: '103', nome: 'Apto 103' },
        ],
        leitos: [
          { bloco: '1', acomodacao: '101', leito: 'A', ativo: true, ramal: 10 },
          { bloco: '1', acomodacao: '101', leito: 'B', ativo: false, ramal: null },
          { bloco: '1', acomodacao: '102', leito: 'A', ativo: true, ramal: 20 },
          { bloco: '1', acomodacao: '103', leito: 'A', ativo: true, ramal: null },
        ],
      },
      {
        acomodacoes: [
          { bloco: '1', acomodacao: '101', tipoAtendimento: 'I', nome: 'Apto 101' },
          { bloco: '1', acomodacao: '102', tipoAtendimento: 'I', nome: 'Apartamento 102' },
          { bloco: '1', acomodacao: '104', tipoAtendimento: 'I', nome: 'Apto 104' },
          { bloco: null, acomodacao: 'PS', tipoAtendimento: 'E', nome: 'Pronto-socorro' },
        ],
        leitos: [
          { bloco: '1', acomodacao: '101', leito: 'A', tipoAtendimento: 'I', ativo: true, ramal: 10 },
          { bloco: '1', acomodacao: '101', leito: 'B', tipoAtendimento: 'I', ativo: true, ramal: null },
          { bloco: '1', acomodacao: '102', leito: 'A', tipoAtendimento: 'I', ativo: true, ramal: 21 },
          { bloco: '1', acomodacao: '104', leito: 'A', tipoAtendimento: 'I', ativo: true, ramal: null },
          { bloco: null, acomodacao: 'PS', leito: '01', tipoAtendimento: 'E', ativo: true, ramal: null },
        ],
      },
    );
    expect(r.contagens).toEqual({
      leitosCadastro: 4,
      leitosEspelho: 4,
      leitosEspelhoExterno: 1,
      acomodacoesCadastro: 3,
      acomodacoesEspelho: 3,
      acomodacoesEspelhoExterno: 1,
      iguais: 1,
    });
    expect(r.divergencias.map((d) => `${d.tipo} ${d.chave}`)).toEqual([
      'situacao-diferente 1|101|B',
      'nome-diferente 1|102',
      'ramal-diferente 1|102|A',
      'acomodacao-sem-espelho 1|103',
      'leito-sem-espelho 1|103|A',
      'espelho-sem-acomodacao 1|104',
      'espelho-sem-leito 1|104|A',
    ]);
    expect(r.porTipo['ramal-diferente']).toBe(1);
    expect(r.divergencias.every((d) => !/spdata|legado/i.test(d.orientacao))).toBe(true);
  });

  it('situação do leito: I inativo; A ou vazio ativo', () => {
    expect(leitoAtivo('I')).toBe(false);
    expect(leitoAtivo('A')).toBe(true);
    expect(leitoAtivo(null)).toBe(true);
    expect(leitoAtivo(' ')).toBe(true);
  });
});
