import type { DeclaracaoPermissao } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { conceder, indexarCatalogo, perfisDoUsuario, type ConcessoesLegado } from './concessao.js';
import type { CorrespondenciaOrigem } from './mapa-origem.js';
import { destinoDoGrupo } from './mapa-grupos.js';

const CATALOGO: DeclaracaoPermissao[] = [
  {
    codigo: 'pep.evolucao.ler',
    descricao: 'x',
    concessaoPorPerfil: null,
    categoria: 'clinica',
  },
  {
    codigo: 'pep.evolucao.criar',
    descricao: 'x',
    concessaoPorPerfil: null,
    categoria: 'clinica',
  },
  { codigo: 'recepcao.cadastro.criar', descricao: 'x', concessaoPorPerfil: null },
  {
    codigo: 'suprimentos.pedido.aprovar',
    descricao: 'x',
    concessaoPorPerfil: null,
  },
  {
    codigo: 'acesso.inicio.ler',
    descricao: 'x',
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  },
  {
    codigo: 'config.schema.ler',
    descricao: 'x',
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
    categoria: 'tecnica',
  },
  {
    codigo: 'acesso.emergencia.solicitar',
    descricao: 'x',
    concessaoPorPerfil: 'por-perfil',
    perfis: ['assistencial-com-conselho'],
    categoria: 'clinica',
  },
  {
    codigo: 'pep.escala.ler',
    descricao: 'recurso novo, só pelo mapa',
    concessaoPorPerfil: 'por-perfil',
    perfis: [],
    categoria: 'clinica',
  },
];
/** Mapa do conector (origem → permissão) do catálogo de teste. */
const MAPA_ORIGEM: CorrespondenciaOrigem[] = [
  { tipo: 'opcao_menu', chave: '10', permissao: 'pep.evolucao.ler' },
  { tipo: 'opcao_menu', chave: '11', permissao: 'pep.evolucao.ler' },
  { tipo: 'opcao_menu', chave: '12', permissao: 'pep.evolucao.criar' },
  { tipo: 'opcao_menu', chave: '20', permissao: 'recepcao.cadastro.criar' },
  {
    tipo: 'marca_usuario',
    chave: 'GEUSERS.PERMITIR_AUTORIZAR_PEDIDO',
    permissao: 'suprimentos.pedido.aprovar',
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

describe('concessão direta (regra 1)', () => {
  it('opção do grupo (TBPERUSU), opção do papel e flag concedem; perder no legado é perder no novo', () => {
    const r = conceder({
      legado: base({
        grupo: 'MEDICOS',
        opcoesGrupo: [10],
        opcoesPapel: [12],
        flags: ['GEUSERS.PERMITIR_AUTORIZAR_PEDIDO'],
      }),
      catalogo: CATALOGO,
      mapaOrigem: MAPA_ORIGEM,
    });
    expect([...r.permissoes].sort()).toEqual([
      'acesso.inicio.ler',
      'pep.evolucao.criar',
      'pep.evolucao.ler',
      'suprimentos.pedido.aprovar',
    ]);
    expect(r.origens.get('pep.evolucao.ler')).toEqual([{ tipo: 'opcao-grupo', opcao: 10 }]);
    expect(r.origens.get('pep.evolucao.criar')).toEqual([{ tipo: 'opcao-papel', opcao: 12 }]);
    expect(r.origens.get('suprimentos.pedido.aprovar')).toEqual([
      { tipo: 'flag', flag: 'GEUSERS.PERMITIR_AUTORIZAR_PEDIDO' },
    ]);
    const depois = conceder({
      legado: base({ grupo: 'MEDICOS', opcoesGrupo: [] }),
      catalogo: CATALOGO,
      mapaOrigem: MAPA_ORIGEM,
    });
    expect(depois.permissoes.has('pep.evolucao.ler')).toBe(false);
  });

  it('recurso novo só por perfil complementar: papel SBIS, conselho e concessão vigente (regra 3)', () => {
    const admin = conceder({
      legado: base({ papeis: [1, 4] }),
      catalogo: CATALOGO,
      mapaOrigem: MAPA_ORIGEM,
    });
    expect(admin.permissoes.has('config.schema.ler')).toBe(true);
    expect(admin.perfis).toEqual(['administrador-sistema']);
    const medico = conceder({
      legado: base({ grupo: 'MEDICOS', conselho: true }),
      catalogo: CATALOGO,
      mapaOrigem: MAPA_ORIGEM,
    });
    expect(medico.permissoes.has('acesso.emergencia.solicitar')).toBe(true);
    const semConselho = conceder({
      legado: base({ grupo: 'MEDICOS', conselho: false }),
      catalogo: CATALOGO,
      mapaOrigem: MAPA_ORIGEM,
    });
    expect(semConselho.permissoes.has('acesso.emergencia.solicitar')).toBe(false);
    const agora = new Date('2026-10-20T12:00:00Z');
    const comConcessao = conceder({
      legado: base(),
      catalogo: CATALOGO,
      mapaOrigem: MAPA_ORIGEM,
      agora,
      perfisConcedidos: [
        { perfil: 'administrador-sistema', inicio: new Date('2026-10-01'), fim: null },
        { perfil: 'auditor', inicio: new Date('2026-11-01'), fim: null },
        { perfil: 'operador-backup', inicio: new Date('2026-01-01'), fim: new Date('2026-02-01') },
      ],
    });
    expect(comConcessao.perfis).toEqual(['administrador-sistema']);
    const mapa = conceder({
      legado: base({ grupo: 'MEDICOS', conselho: true }),
      catalogo: CATALOGO,
      mapaOrigem: MAPA_ORIGEM,
      mapaPerfis: [
        { perfil: 'assistencial-com-conselho', permissao: 'pep.escala.ler' },
        { perfil: 'assistencial-com-conselho', permissao: 'pep.evolucao.ler' }, // do legado: o mapa não concede
      ],
    });
    expect(mapa.permissoes.has('pep.escala.ler')).toBe(true);
    expect(mapa.origens.get('pep.evolucao.ler')).toBeUndefined();
  });

  it('painel não recebe os recursos de pessoa; o índice é reaproveitável', () => {
    const indice = indexarCatalogo(CATALOGO, [], MAPA_ORIGEM);
    const painel = conceder({ legado: base({ grupo: 'PAINEIS', opcoesGrupo: [20] }), catalogo: [], indice });
    expect([...painel.permissoes]).toEqual(['recepcao.cadastro.criar']);
    expect(
      perfisDoUsuario({ legado: base({ papeis: [0, 2, 3, 4] }), catalogo: [] }, destinoDoGrupo(null)),
    ).toEqual(['auditor', 'gestor-acessos', 'operador-backup']);
  });
});
