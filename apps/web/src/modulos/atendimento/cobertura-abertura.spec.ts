// A carteira do cadastro do paciente na abertura do atendimento: o que a tela preenche (massa sintética).
import { describe, expect, it } from 'vitest';
import { type CarteiraDoCadastro, preenchimentoDaCobertura } from './cobertura-abertura.js';

const carteira = (id: number, fonte: number, situacaoNoDia: string, o: Partial<CarteiraDoCadastro> = {}) => ({
  id,
  fontePagadora: { id: fonte, nome: `FONTE SINTETICA ${fonte}` },
  plano: { id: fonte * 10, nome: `PLANO SINTETICO ${fonte}` },
  numeroCarteira: `00${id}`,
  validade: '2027-06-30',
  situacaoNoDia,
  ...o,
});
const ACEITOS = [3, 4, 5];

describe('carteira do cadastro na abertura do atendimento', () => {
  it('sem convênio escolhido, preenche convênio, plano, carteirinha e validade da proposta', () => {
    const r = preenchimentoDaCobertura(
      { itens: [carteira(900, 3, 'vigente'), carteira(901, 4, 'vigente')], proposta: 901 },
      '',
      ACEITOS,
    );
    expect(r).toEqual({
      carteira: 901,
      convenio: '4',
      matricula: '00901',
      plano: 'PLANO SINTETICO 4',
      validadeCarteira: '2027-06-30',
    });
  });

  it('sem proposta (nenhuma utilizável) não preenche nada', () => {
    const itens = [carteira(900, 3, 'vencida'), carteira(901, 4, 'encerrada'), carteira(902, 5, 'futura')];
    expect(preenchimentoDaCobertura({ itens, proposta: null }, '', ACEITOS)).toBeNull();
    // Nem com o convênio escolhido: vencida, encerrada e futura nunca preenchem.
    expect(preenchimentoDaCobertura({ itens, proposta: null }, '3', ACEITOS)).toBeNull();
    expect(preenchimentoDaCobertura({ itens, proposta: null }, '5', ACEITOS)).toBeNull();
  });

  it('a proposta de convênio que o estabelecimento não aceita não preenche', () => {
    const itens = [carteira(900, 9, 'vigente')];
    expect(preenchimentoDaCobertura({ itens, proposta: 900 }, '', ACEITOS)).toBeNull();
    expect(preenchimentoDaCobertura({ itens, proposta: 900 }, '9', ACEITOS)).toBeNull();
  });

  it('com o convênio escolhido (agendamento ou pessoa), usa a carteira utilizável desse convênio', () => {
    const itens = [
      carteira(900, 3, 'vigente'),
      carteira(901, 4, 'encerrada'),
      carteira(902, 4, 'a_vencer'),
      carteira(903, 4, 'vigente'),
    ];
    // A proposta é de outro convênio: vale a primeira utilizável do convênio escolhido, na ordem do servidor.
    expect(preenchimentoDaCobertura({ itens, proposta: 900 }, '4', ACEITOS)?.carteira).toBe(902);
    // A proposta é do convênio escolhido: ela vence a ordem.
    expect(preenchimentoDaCobertura({ itens, proposta: 903 }, '4', ACEITOS)?.carteira).toBe(903);
    // Convênio sem carteira no cadastro: nada a preencher.
    expect(preenchimentoDaCobertura({ itens, proposta: 900 }, '5', ACEITOS)).toBeNull();
  });

  it('carteira sem plano, número ou validade (particular) preenche só o convênio', () => {
    const itens = [carteira(900, 4, 'vigente', { plano: null, numeroCarteira: null, validade: null })];
    expect(preenchimentoDaCobertura({ itens, proposta: 900 }, '', ACEITOS)).toEqual({
      carteira: 900,
      convenio: '4',
      matricula: '',
      plano: '',
      validadeCarteira: '',
    });
  });
});
