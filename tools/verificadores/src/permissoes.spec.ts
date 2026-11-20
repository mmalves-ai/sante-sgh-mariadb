// pnpm permissoes:verificar (ficha do M06, regra 11 e critério de aceite): rota sem permissão e permissão
// sem opcoesLegado nem mapeamento reprovam; a prova dos 42 grupos sobre o retrato tem 0 diferença não
// justificada; o repositório inteiro passa.
import { describe, expect, it } from 'vitest';
import {
  conferirCatalogo,
  conferirControlador,
  conferirRotas,
  conferirRotasTela,
  provaEMapa,
} from './permissoes.ts';
import { lerRetrato } from './permissoes-dados.ts';
import { CATALOGO_DECLARADO } from '@sgh/contratos';
import { CATALOGO_LEGADO } from '@sgh/contratos/catalogo-legado';
import { conceder, construirCatalogo, indexarCatalogo } from '@sgh/dominio-acesso';

describe('permissoes:verificar', () => {
  it('handler sem @Permissao nem @Publica reprova; com um deles (ou na classe) passa', () => {
    const ruim = `@Controller('x')\nexport class X {\n  @Get('a')\n  a() {}\n\n  @Get('b')\n  @Permissao('x.y.ler')\n  b() {}\n}\n`;
    const r = conferirControlador('/tmp/x.controller.ts', ruim);
    expect(r.achados.map((a) => a.regra)).toEqual(['rota-sem-permissao']);
    expect(r.citadas).toEqual(['x.y.ler']);
    const classe = `@Controller('x')\n@Publica('motivo')\nexport class X {\n  @Get('a')\n  a() {}\n}\n`;
    expect(conferirControlador('/tmp/x.ts', classe).achados).toEqual([]);
    expect(conferirControlador('/tmp/y.ts', 'export const nada = 1;\n').achados).toEqual([]);
  });

  it('rota da tela sem meta.permissao nem publica reprova', () => {
    const t = `export const r = [\n  {\n    path: '/a',\n    component: () => import('./A.vue'),\n    meta: { permissao: 'a.b.ler' },\n  },\n  {\n    path: '/b',\n    component: () => import('./B.vue'),\n  },\n];\n`;
    const r = conferirRotasTela('/tmp/rotas.ts', t);
    expect(r.citadas).toEqual(['a.b.ler']);
    expect(r.achados).toHaveLength(1);
  });

  it('permissão sem opcoesLegado nem mapeamento, código fora do formato ou repetido reprova', () => {
    const a = conferirCatalogo([
      { codigo: 'a.b.ler', descricao: 'x', opcoesLegado: [], concessaoPorPerfil: null },
      { codigo: 'a.b.ler', descricao: 'x', opcoesLegado: [1], concessaoPorPerfil: null },
      { codigo: 'ABC', descricao: 'x', opcoesLegado: [1], concessaoPorPerfil: null },
      { codigo: 'c.d.ler', descricao: 'x', opcoesLegado: [], concessaoPorPerfil: 'por-perfil' },
      {
        codigo: 'pep.e.ler',
        descricao: 'x',
        opcoesLegado: [1],
        concessaoPorPerfil: null,
        escopos: ['convenio'],
      },
    ]);
    expect(a.map((x) => x.regra).sort()).toEqual([
      'escopos',
      'formato',
      'repetida',
      'sem-mapeamento',
      'sem-mapeamento',
    ]);
  });

  it('repositório: 0 rota sem permissão, 0 permissão sem mapeamento, 0 diferença não justificada nos 42 grupos', () => {
    const catalogo = [...CATALOGO_LEGADO, ...CATALOGO_DECLARADO];
    expect(conferirCatalogo(catalogo)).toEqual([]);
    expect(conferirRotas(new Set(catalogo.map((p) => p.codigo))).achados).toEqual([]);
    const p = provaEMapa(lerRetrato('pc')!);
    expect(p.achados).toEqual([]);
    expect(p.linhas.join('\n')).toMatch(/42 grupos, 39 com permissões/);
    expect(p.linhas.join('\n')).toMatch(/diferenças não justificadas: 0/);
  });

  it('M44.2: o grupo dos médicos do retrato pede o leito, vê a fila e registra a alta prevista (só com as opções dele)', () => {
    const r = lerRetrato('pc')!;
    const c = construirCatalogo(r.opcoes, r.modulos);
    const indice = indexarCatalogo([...c.permissoes, ...CATALOGO_DECLARADO]);
    for (const grupo of ['MEDICOS', 'MEDICOS_SUPERVISÃO']) {
      const opcoesGrupo = r.permissoesGrupos.filter(([g]) => g === grupo).map(([, o]) => o);
      expect(opcoesGrupo.length).toBeGreaterThan(0);
      const { permissoes } = conceder({
        legado: { grupo, opcoesGrupo, opcoesPapel: [], papeis: [], flags: [], conselho: true },
        catalogo: [],
        indice,
      });
      for (const p of [
        'internacao.solicitacaoLeito.criar',
        'internacao.solicitacaoLeito.ler',
        'internacao.altaPrevista.ler',
        'internacao.altaPrevista.editar',
      ])
        expect(permissoes.has(p), `${grupo}: ${p}`).toBe(true);
      // Operar a fila e reservar seguem do NIR (o médico não tem o Controle Central de Leitos).
      expect(permissoes.has('internacao.reservaLeito.criar'), grupo).toBe(false);
    }
  });
});
