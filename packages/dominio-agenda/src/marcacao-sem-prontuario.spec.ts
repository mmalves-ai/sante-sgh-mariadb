import { describe, expect, it } from 'vitest';
import { decidirPreCadastroDaMarcacao, ehCelular, nomeComparavel } from './marcacao-sem-prontuario.js';

const HOJE = '2026-11-24';
const pessoa = { nome: '  Maria  da Silva ', nascimento: '1980-05-10', telefone: '31999990000' };

describe('marcação sem prontuário (02-AGE 42 e 44)', () => {
  it('cria o pré-cadastro com o nome normalizado e o celular no campo certo', () => {
    expect(decidirPreCadastroDaMarcacao(pessoa, HOJE, [])).toEqual({
      ok: true,
      acao: 'criar',
      nome: 'MARIA DA SILVA',
      telefone: null,
      celular: '31999990000',
    });
    const fixo = decidirPreCadastroDaMarcacao({ ...pessoa, telefone: '3133330000' }, HOJE, []);
    expect(fixo).toMatchObject({ acao: 'criar', telefone: '3133330000', celular: null });
  });

  it('reaproveita o pendente da mesma pessoa (nome sem acento, nascimento e número), o mais antigo', () => {
    const pendentes = [
      { id: 9, nome: 'MARIA DA SILVA', nascimento: '1980-05-10', telefone: null, celular: '31999990000' },
      { id: 4, nome: 'Maria da Sílva', nascimento: '1980-05-10', telefone: '31999990000', celular: null },
      { id: 2, nome: 'MARIA DA SILVA', nascimento: '1981-05-10', telefone: null, celular: '31999990000' },
      { id: 1, nome: 'MARIA DA SILVA', nascimento: '1980-05-10', telefone: null, celular: '31988880000' },
    ];
    expect(decidirPreCadastroDaMarcacao(pessoa, HOJE, pendentes)).toEqual({
      ok: true,
      acao: 'reaproveitar',
      preCadastro: 4,
    });
  });

  it('recusa na hora: nascimento futuro, acima de 130 anos, nome curto e telefone sem DDD', () => {
    expect(decidirPreCadastroDaMarcacao({ ...pessoa, nascimento: '2026-11-25' }, HOJE, [])).toMatchObject({
      ok: false,
      codigo: 'nascimento-futuro',
      campo: 'nascimento',
    });
    expect(decidirPreCadastroDaMarcacao({ ...pessoa, nascimento: '1890-01-01' }, HOJE, [])).toMatchObject({
      ok: false,
      codigo: 'nascimento-improvavel',
    });
    expect(decidirPreCadastroDaMarcacao({ ...pessoa, nome: ' a ' }, HOJE, [])).toMatchObject({
      ok: false,
      codigo: 'nome-invalido',
    });
    expect(decidirPreCadastroDaMarcacao({ ...pessoa, telefone: '9999' }, HOJE, [])).toMatchObject({
      ok: false,
      codigo: 'telefone-invalido',
    });
    expect(decidirPreCadastroDaMarcacao({ ...pessoa, nascimento: HOJE }, HOJE, [])).toMatchObject({
      ok: true,
    });
  });

  it('regras auxiliares: celular pelo nono dígito, com ou sem o 55; nome comparável sem acento', () => {
    expect(ehCelular('31999990000')).toBe(true);
    expect(ehCelular('5531999990000')).toBe(true);
    expect(ehCelular('3133330000')).toBe(false);
    expect(nomeComparavel(' José  Conceição ')).toBe('JOSE CONCEICAO');
  });
});
