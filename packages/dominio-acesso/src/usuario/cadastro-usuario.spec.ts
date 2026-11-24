import { describe, expect, it } from 'vitest';
import {
  conferirCriacaoUsuario,
  conferirEscopo,
  contaNova,
  planoAlteracaoUsuario,
  planoTrocaGrupo,
} from './cadastro-usuario.js';

describe('cadastro da conta (01-ADM L57 e L59)', () => {
  it('criar: login, CPF e grupo conferidos nessa ordem', () => {
    const ok = { loginEmUso: false, cpfEmUso: false, grupoAtivo: true };
    expect(conferirCriacaoUsuario(ok)).toBeNull();
    expect(conferirCriacaoUsuario({ ...ok, loginEmUso: true, cpfEmUso: true })).toBe('login-em-uso');
    expect(conferirCriacaoUsuario({ ...ok, cpfEmUso: true })).toBe('cpf-em-uso');
    expect(conferirCriacaoUsuario({ ...ok, grupoAtivo: null })).toBe('grupo-inexistente');
    expect(conferirCriacaoUsuario({ ...ok, grupoAtivo: false })).toBe('grupo-inativo');
  });

  it('conta nova: sem CPF nasce com a dispensa; sempre exige troca de senha', () => {
    expect(contaNova({ login: ' ana ', nomeCompleto: 'ANA ' })).toMatchObject({
      login: 'ana',
      nome: 'ANA',
      cpf: null,
      dispensa_cpf: true,
      exige_troca_senha: true,
      situacao: 'ativo',
    });
    expect(contaNova({ login: 'b', nomeCompleto: 'B', cpf: '12345678909' })).toMatchObject({
      cpf: '12345678909',
      dispensa_cpf: false,
    });
  });

  it('alterar: nome, CPF novo, justificativa só para trocar CPF já informado', () => {
    const base = {
      nomeAtual: 'A',
      nomeNovo: 'A',
      cpfAtual: null,
      cpfNovo: undefined,
      justificativa: undefined,
      cpfDeOutraConta: false,
    };
    expect(planoAlteracaoUsuario(base)).toEqual({ recusa: 'nada-mudou' });
    expect(planoAlteracaoUsuario({ ...base, nomeNovo: ' B ' })).toEqual({
      valores: { nome: 'B' },
      trocouCpf: false,
    });
    expect(planoAlteracaoUsuario({ ...base, cpfNovo: '12345678909' })).toEqual({
      valores: { cpf: '12345678909', dispensa_cpf: false },
      trocouCpf: true,
    });
    expect(planoAlteracaoUsuario({ ...base, cpfAtual: '11144477735', cpfNovo: '12345678909' })).toEqual({
      recusa: 'justificativa-obrigatoria',
    });
    expect(
      planoAlteracaoUsuario({
        ...base,
        cpfAtual: '11144477735',
        cpfNovo: '12345678909',
        justificativa: 'digitado errado no cadastro',
      }),
    ).toMatchObject({ trocouCpf: true });
    expect(planoAlteracaoUsuario({ ...base, cpfNovo: '12345678909', cpfDeOutraConta: true })).toEqual({
      recusa: 'cpf-em-uso',
    });
  });

  it('troca de grupo: fecha ontem, corrige a linha de hoje ou abre a primeira', () => {
    expect(planoTrocaGrupo(null, '2026-11-24')).toEqual({ modo: 'novo' });
    expect(planoTrocaGrupo('2026-11-24', '2026-11-24')).toEqual({ modo: 'corrigir' });
    expect(planoTrocaGrupo('2020-01-01', '2026-03-01')).toEqual({ modo: 'fechar', fim: '2026-02-28' });
  });

  it('escopo: item válido, sem repetir, e só retira o que tem', () => {
    expect(conferirEscopo({ conceder: true, entidadeValida: true, jaTem: false })).toBeNull();
    expect(conferirEscopo({ conceder: true, entidadeValida: false, jaTem: false })).toBe('valor-inexistente');
    expect(conferirEscopo({ conceder: true, entidadeValida: true, jaTem: true })).toBe('ja-concedido');
    expect(conferirEscopo({ conceder: false, entidadeValida: false, jaTem: false })).toBe('nao-concedido');
    expect(conferirEscopo({ conceder: false, entidadeValida: false, jaTem: true })).toBeNull();
  });
});
