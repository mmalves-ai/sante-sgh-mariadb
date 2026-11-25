// A carteira do cadastro do paciente na abertura do atendimento: o que a tela preenche (massa sintética).
import { describe, expect, it } from 'vitest';
import {
  type CarteiraDoCadastro,
  marcaDasCoberturas,
  motivoSemCarteira,
  preenchimentoDaCobertura,
} from './cobertura-abertura.js';

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

  it('proposta de convênio não aceito: vale outra carteira utilizável de convênio aceito, na ordem do servidor', () => {
    const itens = [
      carteira(900, 9, 'vigente'),
      carteira(901, 4, 'vencida'),
      carteira(902, 5, 'vigente'),
      carteira(903, 3, 'a_vencer'),
    ];
    // Sem convênio escolhido: a principal (900) é de convênio não aceito; entra a primeira utilizável e aceita.
    expect(preenchimentoDaCobertura({ itens, proposta: 900 }, '', ACEITOS)?.carteira).toBe(902);
    // Com convênio herdado do atendimento anterior: a carteira utilizável dele vem antes da ordem do servidor.
    expect(preenchimentoDaCobertura({ itens, proposta: 900 }, '', ACEITOS, '3')?.carteira).toBe(903);
    // O herdado sem carteira utilizável (vencida) não segura: volta à ordem do servidor.
    expect(preenchimentoDaCobertura({ itens, proposta: 900 }, '', ACEITOS, '4')?.carteira).toBe(902);
    // A proposta aceita vence o convênio herdado (o cadastro vence a herança).
    expect(preenchimentoDaCobertura({ itens, proposta: 902 }, '', ACEITOS, '3')?.carteira).toBe(902);
  });

  it('a marca da resposta muda com a carteira renovada ou corrigida e não muda na releitura igual', () => {
    const antes = { itens: [carteira(900, 3, 'vencida', { validade: '2026-03-31' })], proposta: null };
    const igual = { itens: [carteira(900, 3, 'vencida', { validade: '2026-03-31' })], proposta: null };
    expect(marcaDasCoberturas(igual)).toBe(marcaDasCoberturas(antes));
    // Renovada na ficha: mesma carteira, validade e situação novas, e passa a ser a proposta.
    const renovada = { itens: [carteira(900, 3, 'vigente')], proposta: 900 };
    expect(marcaDasCoberturas(renovada)).not.toBe(marcaDasCoberturas(antes));
    // Corrigida na ficha: mesmo id e mesma proposta, número ou plano diferente.
    const corrigida = { itens: [carteira(900, 3, 'vigente', { numeroCarteira: '00777' })], proposta: 900 };
    expect(marcaDasCoberturas(corrigida)).not.toBe(marcaDasCoberturas(renovada));
    expect(preenchimentoDaCobertura(corrigida, '3', ACEITOS)?.matricula).toBe('00777');
  });

  it('diz por que nenhuma carteira serve: sem vigor ou de convênio não aceito', () => {
    expect(motivoSemCarteira({ itens: [], proposta: null }, ACEITOS)).toBeNull();
    expect(motivoSemCarteira({ itens: [carteira(900, 3, 'vencida')], proposta: null }, ACEITOS)).toBe(
      'sem-vigor',
    );
    expect(motivoSemCarteira({ itens: [carteira(900, 9, 'vigente')], proposta: 900 }, ACEITOS)).toBe(
      'nao-aceita',
    );
    expect(
      motivoSemCarteira(
        { itens: [carteira(900, 9, 'vigente'), carteira(901, 4, 'a_vencer')], proposta: 900 },
        ACEITOS,
      ),
    ).toBeNull();
  });
});
