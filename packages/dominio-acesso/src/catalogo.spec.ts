import { describe, expect, it } from 'vitest';
import {
  camelo,
  construirCatalogo,
  normalizarTitulo,
  verboDoTitulo,
  type ModuloArvore,
  type OpcaoArvore,
} from './catalogo.js';
import { provarGrupos } from './prova-grupos.js';

const mod = (
  id: number,
  executavel: string | null,
  sistema = 'SGH',
  nome = `Módulo ${id}`,
): ModuloArvore => ({
  id,
  sistema,
  executavel,
  nome,
});
let seq = 0;
const op = (
  modulo: number,
  indice: number,
  nivel: number,
  titulo: string,
  ativo = true,
  id = ++seq,
): OpcaoArvore => ({
  id,
  modulo,
  indice,
  nivel,
  ativo,
  nome: titulo.replace(/\s/g, ''),
  titulo,
});

describe('catálogo gerado da árvore do legado (regra 2)', () => {
  it('normaliza títulos e monta camelCase (romanos em maiúsculas, número no início)', () => {
    expect(normalizarTitulo(' Novo(a) Atendimento ')).toBe('novo atendimento');
    expect(camelo('Modelo II')).toBe('modeloII');
    expect(camelo('Prescrição geral')).toBe('prescricaoGeral');
    expect(camelo('')).toBe('geral');
    expect(camelo('2ª via')).toBe('n2Via');
  });

  it('converte Incluir, Alterar, Excluir e Consultar; no PEP alterar é retificar', () => {
    expect(verboDoTitulo('Incluir', 'recepcao')).toBe('criar');
    expect(verboDoTitulo('Alterar', 'recepcao')).toBe('editar');
    expect(verboDoTitulo('Alterar', 'pep')).toBe('retificar');
    expect(verboDoTitulo('Excluir', 'cadastro')).toBe('inativar');
    expect(verboDoTitulo('Consultar', 'pep')).toBe('ler');
    expect(verboDoTitulo('Fechar conta', 'faturamento')).toBeNull();
  });

  it('reconstrói a árvore por INDICE e NIVEL, agrupa as recepções, deixa de fora inativas e SGO/SGS', () => {
    seq = 0;
    const modulos = [
      mod(23, 'sghpep'),
      mod(7, 'sghpint'),
      mod(8, 'sghpext'),
      mod(-2, 'sgospd', 'SGO'),
      mod(99, 'xpto'),
    ];
    const opcoes = [
      op(23, 0, 0, 'P.E.P.'),
      op(23, 1, 1, 'Evolução'),
      op(23, 2, 2, 'Incluir'),
      op(23, 3, 2, 'Alterar'),
      op(23, 4, 2, 'Corrigir'),
      op(23, 5, 2, 'Consultar'),
      op(23, 6, 2, 'Imprimir', false),
      op(23, 7, 1, 'Configurações'),
      op(23, 8, 3, 'Salto de nível'),
      op(7, 0, 0, 'Recepção interna'),
      op(7, 1, 1, 'Cadastro de pacientes'),
      op(7, 2, 2, 'Incluir'),
      op(8, 0, 0, 'Recepção externa'),
      op(8, 1, 1, 'Cadastro de pacientes'),
      op(8, 2, 2, 'Incluir'),
      op(-2, 0, 0, 'Abertura SGO'),
      op(99, 0, 0, 'Sem destino'),
    ];
    const c = construirCatalogo(opcoes, modulos);
    expect(c.contagens).toMatchObject({ opcoes: 17, ativas: 16, modulos: 5, saltosDeNivel: 1 });
    expect(c.exclusoes.map((e) => e.motivo).sort()).toEqual([
      'modulo-sem-destino',
      'opcao-inativa',
      'sistema-sgo-sgs',
    ]);
    const codigos = c.permissoes.map((p) => p.codigo);
    expect(codigos).toEqual(
      expect.arrayContaining([
        'pep.modulo.acessar',
        'pep.evolucao.acessar',
        'pep.evolucao.criar',
        'pep.evolucao.retificar',
        'pep.evolucao.corrigir', // sinônimo ao lado do canônico não vira o mesmo verbo
        'pep.evolucao.ler',
        'recepcao.cadastroDePacientes.criar',
      ]),
    );
    const cadastro = c.permissoes.find((p) => p.codigo === 'recepcao.cadastroDePacientes.criar');
    expect(cadastro?.modulosLegado).toEqual([7, 8]);
    expect(cadastro?.categoria).toBe('administrativa');
    expect(c.permissoes.find((p) => p.codigo === 'pep.evolucao.ler')?.categoria).toBe('clinica');
    expect(c.permissoes.find((p) => p.codigo === 'pep.evolucao.ler')?.escopos).toEqual([
      'unidade',
      'vinculo',
    ]);
    expect(c.permissoes.find((p) => p.codigo.startsWith('pep.configuracoes'))?.categoria).toBe(
      'administrativa',
    );
    expect(c.permissoes.find((p) => p.codigo === 'pep.evolucao.criar')?.criticidade).toBe('normal');
    expect(c.arvore.get(3)?.pai).toBe(2);
  });

  it('prova dos grupos: ganho por agrupamento de executável e perda por inativa são justificados; o resto não', () => {
    seq = 0;
    const modulos = [mod(7, 'sghpint'), mod(8, 'sghpext'), mod(23, 'sghpep')];
    const opcoes = [
      op(7, 0, 0, 'Recepção interna'),
      op(7, 1, 1, 'Cadastro'),
      op(7, 2, 2, 'Incluir'),
      op(8, 0, 0, 'Recepção externa'),
      op(8, 1, 1, 'Cadastro'),
      op(8, 2, 2, 'Incluir'),
      op(23, 0, 0, 'PEP'),
      op(23, 1, 1, 'Velha', false),
    ];
    const c = construirCatalogo(opcoes, modulos);
    const r = provarGrupos(c, opcoes, [
      ['RECEPCAO', 3],
      ['RECEPCAO', 8],
      ['PEP', 7],
      ['PEP', 8],
      ['PEP', 999],
    ]);
    expect(r.gruposComPermissao).toBe(2);
    const rec = r.grupos.find((g) => g.grupo === 'RECEPCAO');
    expect(rec).toMatchObject({ ganhosJustificados: 1, naoJustificadas: 0 }); // ganha a de 6 (mesma função)
    const pep = r.grupos.find((g) => g.grupo === 'PEP');
    expect(pep).toMatchObject({ perdasJustificadas: 1, naoJustificadas: 1 });
    expect(pep?.motivos).toMatchObject({ 'opcao-inativa': 1, 'opcao-inexistente': 1 });
    expect(r.naoJustificadas).toBe(1);
  });

  it('recurso longo vira um resumo estável de até 60 caracteres', () => {
    seq = 0;
    const longo = 'Um título muito longo para caber no código da permissão do catálogo gerado';
    const c = construirCatalogo(
      [op(23, 0, 0, 'PEP'), op(23, 1, 1, longo), op(23, 2, 2, 'Consultar')],
      [mod(23, 'sghpep')],
    );
    const p = c.permissoes.find((x) => x.codigo.endsWith('.ler'));
    expect(p && (p.codigo.split('.')[1] ?? '').length).toBeLessThanOrEqual(60);
    const outra = construirCatalogo(
      [op(23, 0, 0, 'PEP'), op(23, 1, 1, longo), op(23, 2, 2, 'Consultar')],
      [mod(23, 'sghpep')],
    );
    expect(outra.permissoes.map((x) => x.codigo)).toEqual(c.permissoes.map((x) => x.codigo));
  });
});
