// E2E @C3-018 (F8, 04-HOT linha 142): composição nutricional dos alimentos pelo caminho da tela (`/nutricao/composicao`).
// A copa (SINT.COPA: hotelaria.mapaDieta.ler e .fechar) escolhe o grupo, busca o alimento pela busca remota do combo,
// vê os nutrientes por 100 g e na porção (150 g), recebe o aviso da porção fora da faixa e liga o alimento ao gênero do
// estoque com a versão lida. Combos SanteSelecao (nenhum <select> nativo). A composição só existe no banco do cliente
// (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato
// do servidor. O que fica no banco está no contrato de efeito
// (apps/api/src/modulos/nutricao/composicao-propria.int.spec.ts) e o carregador em catalogos/testes/test_taco.py.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { digitarNaBusca, escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const RESUMO = {
  id: 41,
  fonte: 'taco',
  codigo: '3',
  descricao: 'Arroz sintético cozido',
  grupo: 'Cereais sintéticos',
  energiaKcal: 128,
};
const NUTRIENTES = [
  { codigo: 'ENERC_KCAL', descricao: 'Energia', tipo: 'energia', unidade: 'kcal', quantidade100g: 128.3 },
  { codigo: 'PROCNT', descricao: 'Proteína', tipo: 'macronutriente', unidade: 'g', quantidade100g: 2.54 },
  { codigo: 'NA', descricao: 'Sódio', tipo: 'micronutriente', unidade: 'mg', quantidade100g: 1.2 },
];

function simular(page: Page) {
  const estado = {
    versao: 1,
    genero: null as null | { id: number; codigo: string; nome: string },
    corpos: [] as unknown[],
    buscas: [] as string[],
  };
  void page.route(/\/api\/nutricao\/composicao\/grupos$/, (r) =>
    json(r, { itens: [{ id: 7, descricao: 'Cereais sintéticos' }] }),
  );
  void page.route(/\/api\/nutricao\/composicao\/alimentos\?/, (r) => {
    estado.buscas.push(new URL(r.request().url()).search);
    return json(r, { itens: [RESUMO] });
  });
  void page.route(/\/api\/nutricao\/composicao\/alimentos\/41(\?.*)?$/, (r) => {
    const g = Number(new URL(r.request().url()).searchParams.get('porcao') ?? 100);
    const casas = (u: string) => (u === 'kcal' ? 0 : u === 'mg' ? 2 : 1);
    return json(r, {
      ...RESUMO,
      fonteNome: 'TACO',
      edicao: 'TACO 4a ed.',
      versao: estado.versao,
      genero: estado.genero,
      porcao: g,
      nutrientes: NUTRIENTES.map((n) => {
        const f = 10 ** casas(n.unidade);
        return { ...n, quantidadePorcao: Math.round((n.quantidade100g * g * f) / 100) / f };
      }),
    });
  });
  void page.route(/\/api\/nutricao\/composicao\/alimentos\/41\/genero$/, (r) => {
    const corpo = r.request().postDataJSON() as { genero: number | null; versao: number };
    estado.corpos.push(corpo);
    estado.versao += 1;
    estado.genero =
      corpo.genero === 30 ? { id: 30, codigo: 'G30', nome: 'Arroz sintético do estoque' } : null;
    return json(r, { alimento: 41, genero: corpo.genero });
  });
  void page.route(/\/api\/nutricao\/cardapio\/generos\?/, (r) =>
    json(r, {
      itens: [{ id: 30, codigo: 'G30', nome: 'Arroz sintético do estoque', unidade: 9, sigla: 'KG' }],
    }),
  );
  return estado;
}

test.describe('@C3-018 composição nutricional dos alimentos', () => {
  test('grupo → busca remota → nutrientes por 100 g e na porção → porção inválida → liga o gênero; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const estado = simular(page);
    await entrar(page, 'SINT.COPA');
    await page.goto('/nutricao/composicao');
    const tela = page.getByTestId('tela-composicao');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);

    await escolher(page.getByTestId('composicao-grupo'), { rotulo: 'Cereais sintéticos' });
    await digitarNaBusca(page.getByTestId('composicao-alimento'), 'arroz');
    await escolher(page.getByTestId('composicao-alimento'), { rotulo: '3 - Arroz sintético cozido' });
    expect(estado.buscas.some((s) => s.includes('termo=arroz') && s.includes('grupo=7'))).toBe(true);

    const detalhe = page.getByTestId('composicao-detalhe');
    await expect(detalhe).toContainText('TACO');
    await expect(page.getByTestId('nutriente-PROCNT')).toContainText('2,54');
    await expect(page.getByTestId('nutriente-PROCNT')).toContainText('2,5');
    await semViolacaoAxe(page, '/nutricao/composicao (100 g)');

    await page.getByTestId('composicao-porcao').locator('input').fill('150');
    await expect(page.getByTestId('nutriente-ENERC_KCAL')).toContainText('192');
    await expect(page.getByTestId('nutriente-NA')).toContainText('1,8');

    await page.getByTestId('composicao-porcao').locator('input').fill('0');
    await expect(page.getByTestId('composicao-porcao-erro')).toBeVisible();
    await page.getByTestId('composicao-porcao').locator('input').fill('150');
    await expect(page.getByTestId('composicao-porcao-erro')).toHaveCount(0);

    await expect(page.getByTestId('composicao-genero-ligado')).toContainText('Sem gênero');
    await digitarNaBusca(page.getByTestId('composicao-genero'), 'arroz');
    await escolher(page.getByTestId('composicao-genero'), { rotulo: 'G30 - Arroz sintético do estoque' });
    await page.getByTestId('composicao-ligar').click();
    await expect(page.getByTestId('composicao-aviso')).toBeVisible();
    await expect(page.getByTestId('composicao-genero-ligado')).toContainText('G30');
    expect(estado.corpos).toEqual([{ genero: 30, versao: 1 }]);
    await semViolacaoAxe(page, '/nutricao/composicao (gênero ligado)');
    expect(externas).toEqual([]);
  });
});
