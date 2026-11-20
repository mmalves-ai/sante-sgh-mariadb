import type { DeclaracaoPermissao } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { conceder, type ConcessoesLegado } from './concessao.js';
import { aplicarSegregacao, podeConceder } from './segregacao.js';
import { destinoDoGrupo } from './mapa-grupos.js';

const CATALOGO: DeclaracaoPermissao[] = [
  {
    codigo: 'pep.evolucao.ler',
    descricao: 'x',
    opcoesLegado: [1],
    concessaoPorPerfil: null,
    categoria: 'clinica',
  },
  {
    codigo: 'pep.evolucao.criar',
    descricao: 'x',
    opcoesLegado: [2],
    concessaoPorPerfil: null,
    categoria: 'clinica',
  },
  { codigo: 'faturamento.conta.fechar', descricao: 'x', opcoesLegado: [3], concessaoPorPerfil: null },
  { codigo: 'faturamento.conta.ler', descricao: 'x', opcoesLegado: [4], concessaoPorPerfil: null },
  {
    codigo: 'acesso.senha.trocar',
    descricao: 'x',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  },
  {
    codigo: 'acesso.perfil.conceder',
    descricao: 'x',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
  },
  {
    codigo: 'sadt.laudo.criar',
    descricao: 'x',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema', 'gestor-acessos'],
    categoria: 'clinica',
  },
  {
    codigo: 'auditoria.trilha.ler',
    descricao: 'x',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor', 'gestor-acessos'],
  },
];
const legado = (c: Partial<ConcessoesLegado>): ConcessoesLegado => ({
  grupo: null,
  opcoesGrupo: [1, 2, 3, 4],
  opcoesPapel: [],
  papeis: [4],
  flags: [],
  conselho: false,
  ...c,
});

describe('segregação nas telas do novo (regra 9)', () => {
  it('Gestor de acessos não lê a trilha', () => {
    const r = conceder({ legado: legado({ papeis: [0] }), catalogo: CATALOGO });
    expect(r.permissoes.has('auditoria.trilha.ler')).toBe(false);
    expect(r.retiradas).toContainEqual({
      permissao: 'auditoria.trilha.ler',
      motivo: 'gestor-acessos-nao-le-trilha',
    });
  });

  it('Auditor: recurso novo de escrita retirado; o que o legado concede e o autosserviço ficam (regra 4)', () => {
    const r = conceder({ legado: legado({ papeis: [2], grupo: 'MEDICOS' }), catalogo: CATALOGO });
    expect(r.permissoes.has('auditoria.trilha.ler')).toBe(true);
    expect(r.permissoes.has('pep.evolucao.ler')).toBe(true);
    // Escrita só de perfil do novo: retirada.
    expect(r.retiradas).toContainEqual({
      permissao: 'acesso.perfil.conceder',
      motivo: 'auditor-nao-altera',
    });
    // Autosserviço (senha vencida não pode prender o Auditor) e concessão do legado: mantidos.
    expect(r.permissoes.has('acesso.senha.trocar')).toBe(true);
    expect(r.permissoes.has('pep.evolucao.criar')).toBe(true);
    expect(r.permissoes.has('faturamento.conta.fechar')).toBe(true);
    expect(r.conflitos.map((x) => x.permissao)).toEqual(
      expect.arrayContaining(['pep.evolucao.criar', 'faturamento.conta.fechar', 'acesso.senha.trocar']),
    );
  });

  it('perfil administrativo: o que o legado concede fica (conflito à revisão); clínico só de perfil sai', () => {
    const r = conceder({ legado: legado({ grupo: 'FATURAMENTO', papeis: [0] }), catalogo: CATALOGO });
    expect(r.permissoes.has('pep.evolucao.ler')).toBe(true);
    expect(r.permissoes.has('faturamento.conta.fechar')).toBe(true);
    expect(r.conflitos).toContainEqual({
      permissao: 'pep.evolucao.ler',
      motivo: 'perfil-administrativo-sem-dado-clinico',
    });
    expect(r.permissoes.has('sadt.laudo.criar')).toBe(false);
    expect(r.retiradas).toContainEqual({
      permissao: 'sadt.laudo.criar',
      motivo: 'perfil-administrativo-sem-dado-clinico',
    });
  });

  it('Administrador do sistema sem perfil assistencial: clínico só de perfil sai; o do legado fica', () => {
    const semPerfil = conceder({ legado: legado({ papeis: [1], grupo: 'MASTER' }), catalogo: CATALOGO });
    expect(semPerfil.permissoes.has('sadt.laudo.criar')).toBe(false);
    expect(semPerfil.retiradas.map((x) => x.motivo)).toContain('administrador-sem-perfil-assistencial');
    expect(semPerfil.permissoes.has('pep.evolucao.ler')).toBe(true);
    expect(semPerfil.conflitos.map((x) => x.motivo)).toContain('administrador-sem-perfil-assistencial');
    const medico = conceder({ legado: legado({ papeis: [1], grupo: 'MEDICOS' }), catalogo: CATALOGO });
    expect(medico.permissoes.has('sadt.laudo.criar')).toBe(true);
  });

  it('ninguém concede a si; só o Gestor de acessos concede', () => {
    expect(podeConceder({ login: 'A', perfis: ['gestor-acessos'] }, { login: 'A' })).toEqual({
      pode: false,
      motivo: 'ninguem-concede-a-si',
    });
    expect(podeConceder({ login: 'A', perfis: ['administrador-sistema'] }, { login: 'B' }).pode).toBe(false);
    expect(podeConceder({ login: 'A', perfis: ['gestor-acessos'] }, { login: 'B' }).pode).toBe(true);
  });

  it('sem categoria declarada conta como administrativa', () => {
    const r = aplicarSegregacao(new Set(['x.y.ler']), {
      perfis: [],
      destino: destinoDoGrupo('FATURAMENTO'),
      categorias: new Map(),
    });
    expect([...r.permissoes]).toEqual(['x.y.ler']);
  });
});
