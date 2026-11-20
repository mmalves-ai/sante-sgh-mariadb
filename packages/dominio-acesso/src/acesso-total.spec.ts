// ADR 0022: acesso total da plataforma (todas as permissões, sem segregação; o suporte nunca o tem) e o mapa
// grupo → perfil aprovado, que muda as permissões efetivas de todo o grupo.
import type { DeclaracaoPermissao } from '@sgh/contratos';
import { CATALOGO_DECLARADO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { conceder, concederAcessoTotal, indexarCatalogo, type ConcessoesLegado } from './concessao.js';
import { conferirSessaoComo, podeAcessoTotal, type ContaRegra } from './suporte.js';

const CATALOGO: DeclaracaoPermissao[] = [
  {
    codigo: 'pep.evolucao.ler',
    descricao: 'x',
    opcoesLegado: [10],
    concessaoPorPerfil: null,
    categoria: 'clinica',
  },
  { codigo: 'recepcao.cadastro.criar', descricao: 'x', opcoesLegado: [20], concessaoPorPerfil: null },
  {
    codigo: 'config.schema.ler',
    descricao: 'x',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'tecnica',
  },
  {
    codigo: 'auditoria.trilha.ler',
    descricao: 'x',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['auditor'],
    categoria: 'tecnica',
  },
  {
    codigo: 'acesso.inicio.ler',
    descricao: 'x',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  },
];

const base = (c: Partial<ConcessoesLegado> = {}): ConcessoesLegado => ({
  grupo: null,
  opcoesGrupo: [],
  opcoesPapel: [],
  papeis: [4],
  flags: [],
  conselho: false,
  ...c,
});

describe('acesso total da plataforma', () => {
  it('concede TODAS as permissões do catálogo, inclusive as das opções do legado e as clínicas', () => {
    const r = concederAcessoTotal(indexarCatalogo(CATALOGO));
    expect([...r.permissoes]).toEqual(CATALOGO.map((p) => p.codigo).sort());
    expect(r.retiradas).toEqual([]);
    expect(r.origens.get('pep.evolucao.ler')).toEqual([{ tipo: 'acesso-total' }]);
  });

  it('não aplica a segregação: gestor-acessos/auditor/clínica ficam todos', () => {
    // Um gestor de acessos com o perfil auditor perderia a trilha e a escrita; no acesso total, não.
    const comum = conceder({
      legado: base({ papeis: [0, 2], opcoesGrupo: [10] }),
      catalogo: CATALOGO,
      perfisConcedidos: [{ perfil: 'auditor', inicio: new Date(0), fim: null }],
    });
    expect(comum.retiradas.length).toBeGreaterThan(0);
    const total = concederAcessoTotal(indexarCatalogo(CATALOGO));
    expect(total.permissoes.has('auditoria.trilha.ler')).toBe(true);
    expect(total.permissoes.has('recepcao.cadastro.criar')).toBe(true);
  });

  it('com o catálogo declarado real: inclui acesso.perfil.gerir e as telas da Fase 0', () => {
    const total = concederAcessoTotal(indexarCatalogo(CATALOGO_DECLARADO));
    for (const p of [
      'acesso.perfil.gerir',
      'config.schema.ler',
      'sistema.saude.ler',
      'config.liberacao.editar',
    ])
      expect(total.permissoes.has(p)).toBe(true);
  });

  it('só a PLATAFORMA ativa tem acesso total; o suporte técnico nunca', () => {
    const plataforma: ContaRegra = { papel: 'PLATAFORMA', ativo: true, atribuicoes: [] };
    const suporte: ContaRegra = {
      papel: 'SUPORTE',
      ativo: true,
      atribuicoes: [{ rede: 'r', hospital: 'aa' }],
    };
    expect(podeAcessoTotal(plataforma)).toBe(true);
    expect(podeAcessoTotal(suporte)).toBe(false);
    expect(podeAcessoTotal({ ...plataforma, ativo: false })).toBe(false);
  });

  it('a guarda encerra a sessão de acesso total se a conta deixa de ser PLATAFORMA', () => {
    const sessao = {
      idConta: '1',
      atorTipo: 'plataforma' as const,
      rede: 'r',
      hospital: 'aa',
      expiraMs: 10_000,
      encerrada: false,
      modo: 'acesso-total' as const,
    };
    const ok = conferirSessaoComo({
      sessao,
      conta: { id: '1', papel: 'PLATAFORMA', ativo: true, atribuicoes: [] },
      configurados: ['aa'],
      agoraMs: 1,
    });
    expect(ok.valida).toBe(true);
    const virouSuporte = conferirSessaoComo({
      sessao,
      conta: { id: '1', papel: 'SUPORTE', ativo: true, atribuicoes: [{ rede: 'r', hospital: 'aa' }] },
      configurados: ['aa'],
      agoraMs: 1,
    });
    expect(virouSuporte).toEqual({ valida: false, motivo: 'funcao' });
  });
});

describe('mapa grupo → perfil aprovado (ADR 0022)', () => {
  it('aprovar muda as permissões efetivas de quem é do grupo; proposta não concede', () => {
    const legado = base({ grupo: 'DIRETOR_FINANCEIRO', opcoesGrupo: [20] });
    const antes = conceder({ legado, catalogo: CATALOGO });
    expect(antes.permissoes.has('config.schema.ler')).toBe(false);
    const depois = conceder({ legado, catalogo: CATALOGO, perfisDoGrupo: ['administrador-sistema'] });
    expect(depois.permissoes.has('config.schema.ler')).toBe(true);
    expect(depois.origensPerfis.get('administrador-sistema')).toEqual(['grupo']);
    expect(depois.origens.get('config.schema.ler')).toEqual([
      { tipo: 'perfil', perfil: 'administrador-sistema' },
    ]);
  });

  it('sem grupo ou painel: o mapa do grupo não vale', () => {
    const semGrupo = conceder({
      legado: base(),
      catalogo: CATALOGO,
      perfisDoGrupo: ['administrador-sistema'],
    });
    expect(semGrupo.permissoes.has('config.schema.ler')).toBe(false);
    const painel = conceder({
      legado: base({ grupo: 'PAINEIS' }),
      catalogo: CATALOGO,
      perfisDoGrupo: ['administrador-sistema'],
    });
    expect(painel.permissoes.has('config.schema.ler')).toBe(false);
  });

  it('o perfil vindo do grupo também passa pela segregação (clínico a perfil administrativo)', () => {
    const r = conceder({
      legado: base({ grupo: 'FATURAMENTO' }),
      catalogo: [
        ...CATALOGO,
        {
          codigo: 'pep.escala.ler',
          descricao: 'x',
          opcoesLegado: [],
          concessaoPorPerfil: 'por-perfil',
          perfis: ['administrador-sistema'],
          categoria: 'clinica',
        },
      ],
      perfisDoGrupo: ['administrador-sistema'],
    });
    expect(r.permissoes.has('pep.escala.ler')).toBe(false);
    expect(r.retiradas.some((x) => x.permissao === 'pep.escala.ler')).toBe(true);
  });
});
