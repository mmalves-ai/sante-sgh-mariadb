import { ARVORE_MENU, type ItemMenu } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  capitalizar,
  chaveDoEstado,
  chavesAcima,
  filtrarItens,
  gravarAbertos,
  itemDaTela,
  itensVisiveis,
  lerAbertos,
  menuHierarquico,
  menuPorArea,
  niveisDoItem,
  normalizar,
  todasAsChaves,
  type NoMenu,
} from './filtro-menu.js';

const item = (id: string, area: string, rota: string | null, permissao: string | null): ItemMenu => ({
  id,
  area,
  grupo: null,
  caminho: [id],
  titulo: id,
  selo: 'N',
  fase: 1,
  rota,
  permissao,
});

describe('menu filtrado (regra 12)', () => {
  it('item sem rota ou sem permissão não aparece; sem a permissão do usuário também não', () => {
    const arvore = [
      item('a', 'X', '/a', 'p.a.ler'),
      item('b', 'X', null, null),
      item('c', 'Y', '/c', 'p.c.ler'),
      item('d', 'Y', '/d', null),
    ];
    expect(itensVisiveis(arvore, new Set(['p.a.ler'])).map((i) => i.id)).toEqual(['a']);
    expect(itensVisiveis(arvore, new Set(['p.a.ler', 'p.c.ler'])).map((i) => i.id)).toEqual(['a', 'c']);
    expect(itensVisiveis(arvore, new Set())).toEqual([]);
  });

  it('com as permissões do M07, só as telas prontas aparecem (2 dos 408 itens)', () => {
    const visiveis = itensVisiveis(
      ARVORE_MENU,
      new Set([
        'acesso.inicio.ler',
        'acesso.preferencia.ler',
        'acesso.preferencia.editar',
        'acesso.sobre.ler',
      ]),
    );
    expect(visiveis.map((i) => i.rota)).toEqual(['/inicio', '/preferencias']);
    expect(menuPorArea(visiveis)).toEqual([{ area: 'INÍCIO', itens: visiveis }]);
  });

  it('área Técnico só com as permissões técnicas (perfil técnico ou acesso total)', () => {
    const administrativo = new Set(['acesso.inicio.ler', 'config.parametro.ler', 'config.dominio.ler']);
    expect(menuPorArea(itensVisiveis(ARVORE_MENU, administrativo)).map((a) => a.area)).toEqual([
      'INÍCIO',
      // M26: as modalidades de imagem e a configuração do portal são o CRUD genérico (config.dominio.ler).
      'DIAGNÓSTICO',
      // M28: os parâmetros e a numeração dos documentos do estoque (config.parametro.ler).
      'SUPRIMENTOS',
      // M32: os cadastros financeiros e as naturezas de operação são o CRUD genérico (config.dominio.ler).
      'FINANCEIRO',
      'PORTAIS',
      'CADASTROS',
      'ADMINISTRAÇÃO',
    ]);
    const tecnico = new Set([...administrativo, 'config.gravacao.ler', 'sistema.saude.ler']);
    expect(menuPorArea(itensVisiveis(ARVORE_MENU, tecnico)).at(-1)).toMatchObject({ area: 'TÉCNICO' });
  });

  it('perfil sem nenhuma permissão não vê nada', () => {
    expect(itensVisiveis(ARVORE_MENU, new Set())).toEqual([]);
  });
});

const comCaminho = (id: string, area: string, caminho: string[], grupo: string | null = null): ItemMenu => ({
  ...item(id, area, `/${id}`, `p.${id}`),
  grupo,
  caminho,
  titulo: caminho.at(-1)!,
});

describe('menu hierárquico: área > níveis do caminho > item', () => {
  const itens = [
    comCaminho('pac', 'CADASTROS', ['Cadastros', 'Pacientes', 'Cadastro e busca de paciente']),
    comCaminho('uni', 'CADASTROS', ['Cadastros', 'Pacientes', 'Unificação de prontuários']),
    comCaminho('esp', 'CADASTROS', ['Cadastros', 'Especialidades']),
    comCaminho('ifa', 'CADASTROS', ['Cadastros', 'Fornecedores', 'Categorias']),
    comCaminho('mar', 'ATENDIMENTO AO PACIENTE', ['Agenda', 'Agenda ambulatorial', 'Marcação'], 'Agenda'),
    comCaminho('blo', 'ATENDIMENTO AO PACIENTE', ['Agenda', 'Agenda ambulatorial', 'Bloqueios'], 'Agenda'),
    comCaminho('ses', 'ATENDIMENTO AO PACIENTE', ['Agenda', 'Agenda de sessões'], 'Agenda'),
    comCaminho('rel', 'RELATÓRIOS E BI', ['Relatórios e BI', 'Indicadores hospitalares']),
  ];

  it('níveis do caminho sem a raiz que repete a área; com grupo, a raiz vira o segundo nível', () => {
    expect(niveisDoItem(itens[0]!)).toEqual(['Pacientes']);
    expect(niveisDoItem(itens[2]!)).toEqual([]);
    expect(niveisDoItem(itens[4]!)).toEqual(['Agenda', 'Agenda ambulatorial']);
  });

  it('agrupa em níveis na ordem da árvore, com contagem; nível de um item só sobe o item', () => {
    const [cadastros, atendimento, relatorios] = menuHierarquico(itens);
    expect(cadastros).toMatchObject({ chave: 'CADASTROS', rotulo: 'Cadastros', total: 4 });
    expect(
      cadastros!.filhos.map((n) => (n.tipo === 'ramo' ? `[${n.rotulo} ${n.total}]` : n.item.id)),
    ).toEqual(['[Pacientes 2]', 'esp', 'ifa']);
    // Área sem o nome no caminho: capitalização normal, sem as maiúsculas da árvore.
    expect(atendimento).toMatchObject({ rotulo: 'Atendimento ao paciente', total: 3 });
    const agenda = atendimento!.filhos[0]!;
    expect(agenda).toMatchObject({ tipo: 'ramo', chave: 'ATENDIMENTO AO PACIENTE/Agenda', total: 3 });
    if (agenda.tipo !== 'ramo') throw new Error('nível esperado');
    expect(agenda.filhos[0]).toMatchObject({
      tipo: 'ramo',
      chave: 'ATENDIMENTO AO PACIENTE/Agenda/Agenda ambulatorial',
      total: 2,
    });
    expect(agenda.filhos[1]).toMatchObject({ tipo: 'item', item: { id: 'ses' } });
    expect(relatorios!.rotulo).toBe('Relatórios e BI');
    expect(todasAsChaves([cadastros!, atendimento!])).toEqual([
      'CADASTROS',
      'CADASTROS/Pacientes',
      'ATENDIMENTO AO PACIENTE',
      'ATENDIMENTO AO PACIENTE/Agenda',
      'ATENDIMENTO AO PACIENTE/Agenda/Agenda ambulatorial',
    ]);
    expect(capitalizar('GESTÃO DE PESSOAS')).toBe('Gestão de pessoas');
  });

  it('a árvore real: todo item visível entra uma vez só, e nenhum nível fica com um item só', () => {
    const todos = ARVORE_MENU.filter((i) => i.rota !== null);
    const areas = menuHierarquico(todos);
    expect(areas.reduce((s, a) => s + a.total, 0)).toBe(todos.length);
    const andar = (nos: readonly NoMenu[]): void => {
      for (const n of nos)
        if (n.tipo === 'ramo') {
          expect(n.total).toBeGreaterThan(1);
          andar(n.filhos);
        }
    };
    for (const a of areas) andar(a.filhos);
  });

  it('filtro sem acento nem maiúsculas, no título e no caminho; todos os termos contam', () => {
    expect(normalizar('  Unificação   DE Prontuários ')).toBe('unificacao de prontuarios');
    expect(filtrarItens(itens, 'UNIFICACAO').map((i) => i.id)).toEqual(['uni']);
    expect(filtrarItens(itens, 'marcacao').map((i) => i.id)).toEqual(['mar']);
    expect(filtrarItens(itens, 'pacientes').map((i) => i.id)).toEqual(['pac', 'uni']);
    expect(filtrarItens(itens, 'ambulatorial bloq').map((i) => i.id)).toEqual(['blo']);
    expect(filtrarItens(itens, '   ')).toHaveLength(itens.length);
    expect(filtrarItens(itens, 'nada disso')).toEqual([]);
  });

  it('item da tela atual: exato, sem a consulta ou o prefixo mais longo; abre a área e os níveis acima', () => {
    const tela = [
      item('lista', 'X', '/pep/pacientes', 'p'),
      item('aba', 'X', '/pep/pacientes?aba=alergias', 'p'),
      item('cad', 'X', '/cadastros', 'p'),
      item('pac', 'X', '/cadastros/pacientes', 'p'),
    ];
    expect(itemDaTela(tela, '/pep/pacientes?aba=alergias')?.id).toBe('aba');
    expect(itemDaTela(tela, '/pep/pacientes?aba=outra')?.id).toBe('lista');
    expect(itemDaTela(tela, '/cadastros/pacientes/12')?.id).toBe('pac');
    expect(itemDaTela(tela, '/cadastrosx')).toBeNull();
    const areas = menuHierarquico(itens);
    expect(chavesAcima(itens[4]!, areas)).toEqual([
      'ATENDIMENTO AO PACIENTE',
      'ATENDIMENTO AO PACIENTE/Agenda',
      'ATENDIMENTO AO PACIENTE/Agenda/Agenda ambulatorial',
    ]);
    expect(chavesAcima(itens[2]!, areas)).toEqual(['CADASTROS']);
  });
});

describe('estado aberto lembrado por usuário', () => {
  const memoria = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      m,
    };
  };

  it('grava e lê por usuário, com a chave do login', () => {
    const a = memoria();
    gravarAbertos('rede:ANA', new Set(['CADASTROS', 'CADASTROS/Pacientes']), a);
    expect(a.m.has(chaveDoEstado('rede:ANA'))).toBe(true);
    // O login não fica em claro na chave (M35); usuários diferentes, chaves diferentes.
    expect(chaveDoEstado('rede:ANA')).not.toContain('ANA');
    expect(chaveDoEstado('rede:ANA')).not.toBe(chaveDoEstado('rede:BIA'));
    expect([...lerAbertos('rede:ANA', a)]).toEqual(['CADASTROS', 'CADASTROS/Pacientes']);
    expect(lerAbertos('rede:BETO', a).size).toBe(0);
  });

  it('armazenamento ausente, que falha ou com lixo: começa recolhido e não quebra', () => {
    const falha = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('cheio');
      },
    };
    expect(lerAbertos('u', falha).size).toBe(0);
    expect(() => gravarAbertos('u', new Set(['X']), falha)).not.toThrow();
    expect(lerAbertos('u', null).size).toBe(0);
    const lixo = memoria();
    lixo.setItem(chaveDoEstado('u'), '{não é json');
    expect(lerAbertos('u', lixo).size).toBe(0);
    lixo.setItem(chaveDoEstado('u'), JSON.stringify(['A', 3, null, 'B']));
    expect([...lerAbertos('u', lixo)]).toEqual(['A', 'B']);
  });
});
