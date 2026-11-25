import { describe, expect, it } from 'vitest';
import {
  anotacaoVisivel,
  DESTINATARIOS_ANOTACAO_MAXIMO,
  normalizarDestinatarios,
  passoAnotacao,
  situacaoAnotacao,
  TEXTO_ANOTACAO_MAXIMO,
  validarNovaAnotacao,
} from './anotacao-administrativa.js';

const codigos = (f: { codigo: string }[]) => f.map((x) => x.codigo);
const base = {
  texto: 'Família aguarda a vaga da casa de apoio',
  categoriaAtiva: true,
  acesso: 'equipe' as const,
  destinatarios: [],
  destinatariosValidos: 0,
  atendimento: { doPaciente: true, doEstabelecimento: true },
};

describe('anotação administrativa do caso', () => {
  it('anotação válida passa sem falhas', () => {
    expect(validarNovaAnotacao(base)).toEqual([]);
    expect(
      validarNovaAnotacao({
        ...base,
        acesso: 'destinatarios',
        destinatarios: [2, 3],
        destinatariosValidos: 2,
      }),
    ).toEqual([]);
  });

  it('exige texto, categoria ativa e atendimento do paciente no estabelecimento', () => {
    expect(
      codigos(validarNovaAnotacao({ ...base, texto: '  ', categoriaAtiva: null, atendimento: null })),
    ).toEqual(['texto-obrigatorio', 'categoria-inexistente', 'atendimento-inexistente']);
    expect(
      codigos(
        validarNovaAnotacao({
          ...base,
          texto: 'x'.repeat(TEXTO_ANOTACAO_MAXIMO + 1),
          categoriaAtiva: false,
          atendimento: { doPaciente: false, doEstabelecimento: true },
        }),
      ),
    ).toEqual(['texto-longo', 'categoria-inativa', 'atendimento-de-outro-paciente']);
    expect(
      codigos(validarNovaAnotacao({ ...base, atendimento: { doPaciente: true, doEstabelecimento: false } })),
    ).toEqual(['atendimento-de-outro-estabelecimento']);
  });

  it('a anotação restrita exige destinatário, todos contas ativas e no máximo o teto', () => {
    expect(codigos(validarNovaAnotacao({ ...base, acesso: 'destinatarios' }))).toEqual([
      'destinatario-obrigatorio',
    ]);
    expect(codigos(validarNovaAnotacao({ ...base, destinatarios: [2, 3], destinatariosValidos: 1 }))).toEqual(
      ['destinatario-inexistente'],
    );
    const muitos = Array.from({ length: DESTINATARIOS_ANOTACAO_MAXIMO + 1 }, (_, i) => i + 1);
    expect(
      codigos(validarNovaAnotacao({ ...base, destinatarios: muitos, destinatariosValidos: muitos.length })),
    ).toEqual(['destinatarios-demais']);
  });

  it('normaliza os destinatários sem repetição e sem o autor', () => {
    expect(normalizarDestinatarios([3, 2, 3, 9], 9)).toEqual([3, 2]);
    expect(normalizarDestinatarios([4], null)).toEqual([4]);
  });

  it('quem lê: autor e destinatários sempre, equipe do estabelecimento, rede só em "todos"', () => {
    const a = { acesso: 'equipe', autorUsuarioId: 1, estabelecimentoId: 10, destinatarios: [2] };
    expect(anotacaoVisivel(a, { usuario: 5, estabelecimento: 10 })).toBe(true);
    expect(anotacaoVisivel(a, { usuario: 5, estabelecimento: 11 })).toBe(false);
    expect(anotacaoVisivel(a, { usuario: 2, estabelecimento: 11 })).toBe(true);
    const r = { ...a, acesso: 'destinatarios' };
    expect(anotacaoVisivel(r, { usuario: 5, estabelecimento: 10 })).toBe(false);
    expect(anotacaoVisivel(r, { usuario: 1, estabelecimento: 99 })).toBe(true);
    expect(anotacaoVisivel(r, { usuario: 2, estabelecimento: 10 })).toBe(true);
    expect(anotacaoVisivel(r, { usuario: null, estabelecimento: 10 })).toBe(false);
    expect(anotacaoVisivel({ ...a, acesso: 'todos' }, { usuario: null, estabelecimento: 99 })).toBe(true);
  });

  it('situação: cancelada só com a data do cancelamento', () => {
    expect(situacaoAnotacao(null)).toBe('ativa');
    expect(situacaoAnotacao('2026-11-25T10:00:00Z')).toBe('cancelada');
  });

  it('marcar como lida: só o destinatário, uma vez, e nunca na cancelada', () => {
    const p = {
      acao: 'marcar_lida' as const,
      cancelada: false,
      ehAutor: false,
      ehDestinatario: true,
      lida: false,
      motivo: null,
    };
    expect(passoAnotacao(p)).toEqual([]);
    expect(codigos(passoAnotacao({ ...p, ehDestinatario: false }))).toEqual(['nao-destinatario']);
    expect(codigos(passoAnotacao({ ...p, lida: true }))).toEqual(['ja-lida']);
    expect(codigos(passoAnotacao({ ...p, cancelada: true }))).toEqual(['anotacao-cancelada']);
  });

  it('cancelar: só o autor e com motivo', () => {
    const p = {
      acao: 'cancelar' as const,
      cancelada: false,
      ehAutor: true,
      ehDestinatario: false,
      lida: false,
      motivo: 'Lançada no caso errado',
    };
    expect(passoAnotacao(p)).toEqual([]);
    expect(codigos(passoAnotacao({ ...p, ehAutor: false, motivo: ' ab ' }))).toEqual([
      'so-autor-cancela',
      'motivo-obrigatorio',
    ]);
    expect(codigos(passoAnotacao({ ...p, motivo: 'x'.repeat(301) }))).toEqual(['motivo-longo']);
    expect(codigos(passoAnotacao({ ...p, cancelada: true }))).toEqual(['anotacao-cancelada']);
  });
});
