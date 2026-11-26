// E2E @C1-126 (09-AREA linha 79): entrada de produtos recebidos em doação pelas rotas reais do módulo (o
// EntradaDoacaoController registrado no modulo.ts de suprimentos). O almoxarife (SINT.ALMOXARIFE, o do E2E C2-038) abre
// a tela pela entrada por nota fiscal (link "Entrada por doação"). A porta grava só no banco próprio: na sessão
// sintética de dev/ci (logins SINT.*, sem o núcleo), GET /api/suprimentos/doacoes responde 503 e a tela mostra o erro
// sem inventar doação (primeiro teste). O segundo teste simula as rotas da doação (page.route com respostas sintéticas)
// e percorre a tela: o doador buscado no cadastro, o termo, a data futura recusada na hora, o item sem compra anterior
// pedindo o valor justo, o item rastreável pedindo os lotes que somam a quantidade, o aviso do valor justo distante do
// último preço, o total com as parcelas impressas e o POST com a Idempotency-Key. O efeito no MariaDB (nota_entrada
// com a doação, item com o critério, lote, movimento entrada_doacao e a parte doada do saldo) está em
// apps/api/src/modulos/suprimentos/entrada-doacao.int.spec.ts; a regra, em
// packages/dominio-suprimentos/src/doacao/entrada-doacao.spec.ts. Massa SINTÉTICA. Escrito, não rodado.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const B = '/api/suprimentos/doacoes';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Abre a tela pelo link da entrada por nota fiscal e devolve o status da leitura das doações recebidas. */
async function abrirPelaNota(page: Page): Promise<number> {
  await page.goto('/suprimentos/notas-fiscais');
  await expect(page.getByTestId('tela-suprimentos-notas')).toBeVisible();
  const leitura = page.waitForResponse(
    (r) => new URL(r.url()).pathname === B && r.request().method() === 'GET',
  );
  await page.getByTestId('nf-doacoes').click();
  await expect(page).toHaveURL(/\/suprimentos\/doacoes$/);
  await expect(page.getByTestId('tela-suprimentos-doacoes')).toBeVisible();
  return (await leitura).status();
}

test.describe('@C1-126 Entrada por doação', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('pela nota fiscal; sem o banco do cliente, a lista mostra o erro e não inventa doação; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.ALMOXARIFE');
    const status = await abrirPelaNota(page);
    const tela = page.getByTestId('tela-suprimentos-doacoes');
    if (status === 503) {
      await expect(
        tela
          .getByTestId('doa-recebidas')
          .locator('[data-testid="mensagem-erro"], [data-testid="recusa-suprimentos"]')
          .first(),
      ).toBeVisible();
      await expect(tela.locator('[data-testid^="doa-recebida-"]')).toHaveCount(0);
    } else {
      expect(status).toBe(200);
    }
    await semViolacaoAxe(page, '/suprimentos/doacoes');
  });

  test('doação com doador, valor justo, último preço e lotes, validada na hora, com a API simulada; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const json = (rota: Route, corpo: unknown, status = 200) =>
      rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    const posts: { corpo: Record<string, unknown>; chave: string | null }[] = [];
    const recebidas: unknown[] = [];

    // O escopo do usuário ganha um local sintético que recebe entradas (tipo E).
    await page.route('**/api/suprimentos/apoio', async (rota) => {
      const r = await rota.fetch();
      const corpo = (await r.json()) as { escopo: { locais: unknown[] } | null };
      test.skip(!corpo.escopo, 'Sessão sem escopo de estoque.');
      corpo.escopo!.locais = [{ local: 9001, localNome: 'Almoxarifado sintético', tipos: ['E'] }];
      return json(rota, corpo);
    });
    const item = (codigo: number, nome: string, rastreavel: boolean) => ({
      codigo,
      nome,
      unidade: 'UN',
      rastreavel,
      controlado: false,
      antimicrobiano: false,
      consignado: false,
      ativo: true,
    });
    await page.route('**/api/suprimentos/itens**', (rota) =>
      json(rota, [item(71, 'Gaze sintética', false), item(72, 'Soro sintético', true)]),
    );
    await page.route(`**${B}**`, async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname === B) {
        const corpo = req.postDataJSON() as Record<string, unknown>;
        posts.push({ corpo, chave: req.headers()['idempotency-key'] ?? null });
        recebidas.unshift({
          id: 41,
          numero: 7,
          termo: 'TD-2026/1',
          recebidaEm: '2026-11-20',
          doador: 'Instituto Sintético',
          tipoDoador: 'empresa',
          local: 'Almoxarifado sintético',
          itens: 2,
          valorTotal: 170,
        });
        return json(rota, { id: 41, numero: 7, itens: 2, valorTotal: 170, avisos: [71] }, 201);
      }
      if (url.pathname === `${B}/doadores`) {
        expect(url.searchParams.get('termo')).toBe('instituto');
        return json(rota, [
          { tipo: 'empresa', id: 11, nome: 'Instituto Sintético', documento: '…0001' },
          { tipo: 'pessoa', id: 12, nome: 'Pessoa Sintética', documento: null },
        ]);
      }
      if (url.pathname === `${B}/itens/71`)
        return json(rota, { item: 71, nome: 'Gaze sintética', controlaLote: false, ultimoPreco: 2 });
      if (url.pathname === `${B}/itens/72`)
        return json(rota, { item: 72, nome: 'Soro sintético', controlaLote: true, ultimoPreco: null });
      if (url.pathname === B) return json(rota, recebidas);
      return rota.fallback();
    });

    await entrar(page, 'SINT.ALMOXARIFE');
    await abrirPelaNota(page);
    const tela = page.getByTestId('tela-suprimentos-doacoes');
    const form = tela.getByTestId('doa-form');
    await expect(tela.getByTestId('doa-recebidas')).toContainText('Nenhuma doação registrada ainda.');
    // Sem doador, termo nem itens: recusas na hora e o botão travado.
    await expect(form.getByTestId('doa-recusa-sem-doador')).toBeVisible();
    await expect(form.getByTestId('doa-registrar')).toBeDisabled();

    // ---------------- doador do cadastro
    await form.getByTestId('doa-doador-termo').fill('instituto');
    await form.getByTestId('doa-doador-buscar').click();
    await expect(form.getByTestId('doa-doadores')).toContainText('…0001');
    await form.getByTestId('doa-doador-empresa-11').click();
    await expect(form.getByTestId('doa-doador-escolhido')).toContainText('Instituto Sintético (empresa)');
    await expect(form.getByTestId('doa-recusa-sem-doador')).toHaveCount(0);

    // ---------------- termo, data e local
    await form.getByTestId('doa-termo').fill('TD-2026/1');
    await form.getByTestId('doa-data').fill('2099-01-01');
    await expect(form.getByTestId('doa-recusa-data-futura')).toBeVisible();
    await form.getByTestId('doa-data').fill('2026-11-20');
    await expect(form.getByTestId('doa-recusa-data-futura')).toHaveCount(0);
    await escolher(form.getByTestId('doa-local'), { rotulo: 'Almoxarifado sintético' });

    // ---------------- item com último preço: o critério vem pelo último preço de compra
    await form.getByTestId('doa-item-busca-termo').fill('sint');
    await form.getByTestId('doa-item-busca-buscar').click();
    await form.getByTestId('doa-item-busca-opcao-71').click();
    await expect(form.getByTestId('doa-item-71')).toContainText('R$ 2,00');
    await form.getByTestId('doa-item-71-quantidade').fill('10');
    await expect(form.getByTestId('doa-item-71-total')).toContainText('R$ 20,00');

    // ---------------- item rastreável nunca comprado: pede o valor justo e os lotes
    await form.getByTestId('doa-item-busca-termo').fill('soro');
    await form.getByTestId('doa-item-busca-buscar').click();
    await form.getByTestId('doa-item-busca-opcao-72').click();
    await form.getByTestId('doa-item-72-quantidade').fill('5');
    await expect(form.getByTestId('doa-recusa-sem-valor-justo')).toBeVisible();
    await form.getByTestId('doa-item-72-valor-justo').fill('10');
    await expect(form.getByTestId('doa-recusa-sem-valor-justo')).toHaveCount(0);
    await expect(form.getByTestId('doa-recusa-lotes')).toBeVisible();
    await form.getByTestId('doa-item-72-lote-0').fill('LS-1');
    await form.getByTestId('doa-item-72-validade-0').fill('2027-06-30');
    await form.getByTestId('doa-item-72-qtd-lote-0').fill('3');
    await expect(form.getByTestId('doa-recusa-lotes')).toBeVisible();
    await form.getByTestId('doa-item-72-incluir-lote').click();
    await form.getByTestId('doa-item-72-lote-1').fill('LS-2');
    await form.getByTestId('doa-item-72-validade-1').fill('2027-07-31');
    await form.getByTestId('doa-item-72-qtd-lote-1').fill('2');
    await expect(form.getByTestId('doa-recusa-lotes')).toHaveCount(0);

    // ---------------- valor justo da gaze bem acima do último preço: aviso, não recusa
    await escolher(form.getByTestId('doa-item-71-criterio'), { rotulo: 'Valor justo do termo' });
    await form.getByTestId('doa-item-71-valor-justo').fill('12');
    await expect(form.getByTestId('doa-item-71-aviso')).toBeVisible();
    await expect(form.getByTestId('doa-parcela-71')).toContainText(
      'Gaze sintética: 10 × R$ 12,00 = R$ 120,00',
    );
    await expect(form.getByTestId('doa-parcela-72')).toContainText('Soro sintético: 5 × R$ 10,00 = R$ 50,00');
    await expect(form.getByTestId('doa-total-valor')).toContainText('R$ 170,00');
    await expect(form.getByTestId('doa-recusas')).toHaveCount(0);
    await semViolacaoAxe(page, '/suprimentos/doacoes');

    // ---------------- gravação
    await form.getByTestId('doa-registrar').click();
    await expect(tela.getByTestId('doa-aviso')).toContainText('Doação nº 7 registrada');
    await expect(tela.getByTestId('doa-aviso')).toContainText('Valor justo a conferir em 1 item(ns)');
    await expect(tela.getByTestId('doa-recebida-41')).toContainText('TD-2026/1');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.chave).toMatch(/^[A-Za-z0-9._:-]{8,80}$/);
    expect(posts[0]!.corpo).toMatchObject({
      doador: { tipo: 'empresa', id: 11 },
      termo: 'TD-2026/1',
      recebidaEm: '2026-11-20',
      local: 9001,
      itens: [
        { item: 71, quantidade: 10, criterio: 'valor_justo', valorJusto: 12, lotes: [] },
        {
          item: 72,
          quantidade: 5,
          criterio: 'valor_justo',
          valorJusto: 10,
          lotes: [
            { lote: 'LS-1', validade: '2027-06-30', quantidade: 3 },
            { lote: 'LS-2', validade: '2027-07-31', quantidade: 2 },
          ],
        },
      ],
    });
    // O formulário volta limpo para o próximo termo.
    await expect(form.getByTestId('doa-itens')).toHaveCount(0);
  });
});
