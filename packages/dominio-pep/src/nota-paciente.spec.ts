import { describe, expect, it } from 'vitest';
import {
  notaAlerta,
  notaVisivel,
  passoNota,
  situacaoExibidaNota,
  validarNovaNota,
  validarTextoPronto,
} from './nota-paciente.js';

const agora = new Date('2026-11-25T12:00:00Z');
const codigos = (f: { codigo: string }[]) => f.map((x) => x.codigo);
const dias = (n: number) => new Date(agora.getTime() + n * 86_400_000);
const base = {
  texto: 'Paciente prefere ser chamado pelo nome social',
  validaAte: null,
  tipoAtivo: true,
  predefinida: null,
  estabelecimento: 1,
  autor: 10,
};

describe('nota livre sobre o paciente', () => {
  it('nota nova válida passa sem falhas', () => {
    expect(validarNovaNota(base, agora)).toEqual([]);
    expect(validarNovaNota({ ...base, validaAte: dias(30) }, agora)).toEqual([]);
  });

  it('exige autor profissional, tipo ativo e texto', () => {
    expect(codigos(validarNovaNota({ ...base, autor: null, tipoAtivo: null, texto: '  ' }, agora))).toEqual([
      'usuario-sem-profissional',
      'tipo-invalido',
      'texto-obrigatorio',
    ]);
    expect(codigos(validarNovaNota({ ...base, tipoAtivo: false }, agora))).toEqual(['tipo-inativo']);
    expect(codigos(validarNovaNota({ ...base, texto: 'x'.repeat(4001) }, agora))).toEqual(['texto-longo']);
  });

  it('a validade é futura e de no máximo dois anos', () => {
    expect(codigos(validarNovaNota({ ...base, validaAte: agora }, agora))).toEqual(['validade-passada']);
    expect(codigos(validarNovaNota({ ...base, validaAte: dias(731) }, agora))).toEqual(['validade-longa']);
    expect(codigos(validarNovaNota({ ...base, validaAte: new Date('x') }, agora))).toEqual([
      'validade-invalida',
    ]);
  });

  it('o texto pronto precisa servir à nota, ao estabelecimento e ao autor', () => {
    const t = { ativo: true, aplicacao: 'nota_paciente', estabelecimentoId: null, profissionalId: null };
    expect(validarTextoPronto(t, 1, 10)).toEqual([]);
    expect(
      validarTextoPronto({ ...t, aplicacao: 'geral', estabelecimentoId: 1, profissionalId: 10 }, 1, 10),
    ).toEqual([]);
    expect(codigos(validarTextoPronto({ ...t, ativo: false }, 1, 10))).toEqual(['texto-pronto-inativo']);
    expect(codigos(validarTextoPronto({ ...t, aplicacao: 'receita' }, 1, 10))).toEqual([
      'texto-pronto-outra-aplicacao',
    ]);
    expect(codigos(validarTextoPronto({ ...t, estabelecimentoId: 2 }, 1, 10))).toEqual([
      'texto-pronto-outro-estabelecimento',
    ]);
    expect(codigos(validarTextoPronto({ ...t, profissionalId: 11 }, 1, 10))).toEqual([
      'texto-pronto-de-outro-profissional',
    ]);
    expect(codigos(validarNovaNota({ ...base, predefinida: { ...t, profissionalId: 11 } }, agora))).toEqual([
      'texto-pronto-de-outro-profissional',
    ]);
  });
});

describe('quem vê a nota', () => {
  const nota = { autorProfissionalId: 10, estabelecimentoId: 1 };
  it('o autor sempre; equipe no mesmo estabelecimento; todos na rede', () => {
    expect(notaVisivel({ ...nota, visibilidade: 'autor' }, { profissional: 10, estabelecimento: 2 })).toBe(
      true,
    );
    expect(notaVisivel({ ...nota, visibilidade: 'autor' }, { profissional: 11, estabelecimento: 1 })).toBe(
      false,
    );
    expect(notaVisivel({ ...nota, visibilidade: 'autor' }, { profissional: null, estabelecimento: 1 })).toBe(
      false,
    );
    expect(notaVisivel({ ...nota, visibilidade: 'equipe' }, { profissional: 11, estabelecimento: 1 })).toBe(
      true,
    );
    expect(notaVisivel({ ...nota, visibilidade: 'equipe' }, { profissional: 11, estabelecimento: 2 })).toBe(
      false,
    );
    expect(notaVisivel({ ...nota, visibilidade: 'todos' }, { profissional: null, estabelecimento: 2 })).toBe(
      true,
    );
  });
});

describe('vigência e alerta', () => {
  it('a ativa com validade passada aparece vencida e deixa de alertar', () => {
    expect(situacaoExibidaNota({ situacao: 'ativa', validaAte: null }, agora)).toBe('ativa');
    expect(situacaoExibidaNota({ situacao: 'ativa', validaAte: dias(-1) }, agora)).toBe('vencida');
    expect(situacaoExibidaNota({ situacao: 'encerrada', validaAte: dias(-1) }, agora)).toBe('encerrada');
    expect(notaAlerta({ situacao: 'ativa', validaAte: dias(1), exibeComoAlerta: true }, agora)).toBe(true);
    expect(notaAlerta({ situacao: 'ativa', validaAte: dias(-1), exibeComoAlerta: true }, agora)).toBe(false);
    expect(notaAlerta({ situacao: 'ativa', validaAte: null, exibeComoAlerta: false }, agora)).toBe(false);
    expect(notaAlerta({ situacao: 'cancelada', validaAte: null, exibeComoAlerta: true }, agora)).toBe(false);
  });
});

describe('passos da nota', () => {
  it('encerrar: quem vê a nota, só a ativa', () => {
    expect(passoNota({ acao: 'encerrar', situacao: 'ativa', ehAutor: false }, agora)).toEqual({
      falhas: [],
      situacaoNova: 'encerrada',
    });
    expect(
      codigos(passoNota({ acao: 'encerrar', situacao: 'encerrada', ehAutor: true }, agora).falhas),
    ).toEqual(['nota-encerrada']);
  });
  it('cancelar: só o autor, com motivo; a cancelada não muda mais', () => {
    expect(
      codigos(
        passoNota({ acao: 'cancelar', situacao: 'ativa', ehAutor: false, motivo: 'Escrita errada' }, agora)
          .falhas,
      ),
    ).toEqual(['nota-de-outro-autor']);
    expect(
      codigos(passoNota({ acao: 'cancelar', situacao: 'ativa', ehAutor: true, motivo: 'abc' }, agora).falhas),
    ).toEqual(['motivo-obrigatorio']);
    expect(
      passoNota({ acao: 'cancelar', situacao: 'encerrada', ehAutor: true, motivo: 'Paciente errado' }, agora),
    ).toEqual({ falhas: [], situacaoNova: 'cancelada' });
    expect(
      codigos(
        passoNota({ acao: 'cancelar', situacao: 'cancelada', ehAutor: true, motivo: 'De novo' }, agora)
          .falhas,
      ),
    ).toEqual(['nota-cancelada']);
  });
  it('prorrogar: só o autor, só a ativa, validade futura ou sem validade', () => {
    expect(
      passoNota({ acao: 'prorrogar', situacao: 'ativa', ehAutor: true, validaAte: dias(10) }, agora),
    ).toEqual({
      falhas: [],
      situacaoNova: 'ativa',
    });
    expect(
      passoNota({ acao: 'prorrogar', situacao: 'ativa', ehAutor: true, validaAte: null }, agora).falhas,
    ).toEqual([]);
    expect(
      codigos(
        passoNota({ acao: 'prorrogar', situacao: 'ativa', ehAutor: true, validaAte: dias(-1) }, agora).falhas,
      ),
    ).toEqual(['validade-passada']);
    expect(
      codigos(
        passoNota({ acao: 'prorrogar', situacao: 'encerrada', ehAutor: true, validaAte: dias(1) }, agora)
          .falhas,
      ),
    ).toEqual(['nota-encerrada']);
    expect(
      codigos(
        passoNota({ acao: 'prorrogar', situacao: 'ativa', ehAutor: false, validaAte: dias(1) }, agora).falhas,
      ),
    ).toEqual(['nota-de-outro-autor']);
  });
});
