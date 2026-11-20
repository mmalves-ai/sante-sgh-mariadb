import { describe, expect, it, vi } from 'vitest';
import { buscaDaListaAtual, haBuscaDaLista } from '../atalhos/busca-da-lista.js';
import { esperar, montar } from '../testes/montar.js';
import SanteTabela from './SanteTabela.vue';
import type { ConsultaTabela, PaginaTabela } from './tabela.js';

type Linha = { id: number; nome: string };
const LINHAS: Linha[] = Array.from({ length: 237 }, (_, i) => ({
  id: i + 1,
  nome: `Item sintético ${i + 1}`,
}));

function servidor() {
  return vi.fn(async (c: ConsultaTabela): Promise<PaginaTabela<Linha>> => {
    let l = LINHAS.filter((x) => x.nome.includes(c.filtro));
    if (c.ordem?.direcao === 'desc') l = [...l].reverse();
    return { itens: l.slice(c.pagina * c.tamanho, (c.pagina + 1) * c.tamanho), total: l.length };
  });
}

const colunas = [
  { campo: 'id', rotulo: 'Código', ordenavel: true },
  { campo: 'nome', rotulo: 'Nome' },
];

describe('SanteTabela (regra 10: tudo no servidor, com teto)', () => {
  it('a primeira página vem do servidor, nunca a lista inteira', async () => {
    const carregar = servidor();
    const w = montar(SanteTabela, {
      props: { colunas, carregar, rotulo: 'Itens', chave: 'id', tamanhoPagina: 25 },
    });
    await esperar(20);
    expect(carregar).toHaveBeenCalledWith({ pagina: 0, tamanho: 25, ordem: null, filtro: '' });
    expect(w.findAll('tbody tr')).toHaveLength(25);
    expect(w.text()).toContain('237 registros');
    w.unmount();
  });

  it('o tamanho pedido nunca passa do teto', async () => {
    const carregar = servidor();
    const w = montar(SanteTabela, {
      props: { colunas, carregar, rotulo: 'Itens', chave: 'id', tamanhoPagina: 500, teto: 50 },
    });
    await esperar(20);
    expect(carregar.mock.calls[0]![0].tamanho).toBe(50);
    expect(w.text()).toContain('no máximo 50 por página');
    w.unmount();
  });

  it('ordenação e paginação pedem ao servidor', async () => {
    const carregar = servidor();
    const w = montar(SanteTabela, {
      props: { colunas, carregar, rotulo: 'Itens', chave: 'id', tamanhoPagina: 10 },
    });
    await esperar(20);
    await w.find('th[data-p-sortable-column="true"]').trigger('click');
    await esperar(20);
    expect(carregar.mock.calls.at(-1)![0].ordem).toEqual({ campo: 'id', direcao: 'asc' });
    await w.find('.p-paginator-next').trigger('click');
    await esperar(20);
    expect(carregar.mock.calls.at(-1)![0].pagina).toBe(1);
    w.unmount();
  });

  it('o filtro vai ao servidor depois de uma espera curta e volta à primeira página', async () => {
    const carregar = servidor();
    const w = montar(SanteTabela, {
      props: { colunas, carregar, rotulo: 'Itens', chave: 'id', tamanhoPagina: 10, esperaFiltroMs: 5 },
    });
    await esperar(20);
    await w.find('input[type="search"]').setValue('23');
    await esperar(30);
    expect(carregar.mock.calls.at(-1)![0]).toMatchObject({ filtro: '23', pagina: 0 });
    w.unmount();
  });

  it('registra a busca da lista para o atalho "/" e solta ao sair', async () => {
    const w = montar(SanteTabela, { props: { colunas, carregar: servidor(), rotulo: 'Itens', chave: 'id' } });
    await esperar(10);
    expect(haBuscaDaLista()).toBe(true);
    expect(buscaDaListaAtual()?.tagName).toBe('INPUT');
    w.unmount();
    expect(haBuscaDaLista()).toBe(false);
  });

  it('lista vazia mostra a mensagem', async () => {
    const carregar = vi.fn(async () => ({ itens: [], total: 0 }));
    const w = montar(SanteTabela, { props: { colunas, carregar, rotulo: 'Itens', chave: 'id' } });
    await esperar(20);
    expect(w.text()).toContain('Nenhum registro encontrado.');
    w.unmount();
  });
});

describe('SanteTabela: falha de carga (regra 15)', () => {
  it('erro do servidor: mensagem traduzida, sem dados antigos, evento erro e "Tentar de novo" relê', async () => {
    const ok = servidor();
    let falhar = false;
    const carregar = vi.fn(async (c: ConsultaTabela) => {
      if (falhar) throw new Error('falha sintética');
      return ok(c);
    });
    const erros: unknown[] = [];
    const w = montar(SanteTabela, {
      props: { colunas, carregar, rotulo: 'Itens', chave: 'id', onErro: (e: unknown) => erros.push(e) },
    });
    await esperar(20);
    expect(w.findAll('tbody tr').length).toBeGreaterThan(1);
    falhar = true;
    await (w.vm as unknown as { recarregar: () => Promise<void> }).recarregar();
    await esperar(5);
    expect(w.find('[data-testid="tabela-erro"]').text()).toContain('Não foi possível carregar os registros');
    expect(w.text()).not.toContain('Item sintético 1');
    expect(erros).toHaveLength(1);
    falhar = false;
    await w.find('[data-testid="tabela-erro"] button').trigger('click');
    await esperar(20);
    expect(w.find('[data-testid="tabela-erro"]').exists()).toBe(false);
    expect(w.text()).toContain('Item sintético 1');
    w.unmount();
  });
});
