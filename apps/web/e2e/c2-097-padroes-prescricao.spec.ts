// E2E @C2-097 (F3.3, 03-PEP L107): protocolos, kits e receitas padrão editáveis e os favoritos do prescritor pelo
// caminho da tela. O administrador (SINT.ADMIN, que pode tudo) inclui um kit de solução: sem o diluente a regra do
// domínio trava o Salvar na hora; com o diluente grava. Depois grava um protocolo com um item do catálogo (busca por
// nome). No editor da prescrição, o médico (SINT.MEDICO) favorita o protocolo escolhido e o aplica em um clique pelo
// atalho; tirar dos favoritos desmarca. Também escolhe um kit pelo combo e o aplica (os itens entram marcados com o
// kit), favorita o kit e o último item incluído e aplica os dois pelos atalhos. Combos são SanteSelecao (nenhum <select> nativo). O cadastro e os favoritos
// só existem no banco do cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright
// com massa SINTÉTICA, no contrato do servidor. O que fica no banco está nos contratos de efeito
// apps/api/src/modulos/pep/prescricao-propria-protocolos.int.spec.ts, prescricao-propria-favoritos.int.spec.ts e
// prescricao-propria-gravacao.int.spec.ts (o item do kit grava o kit de origem).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';
const PADROES = /\/api\/pep\/prescricao\/padroes\//;
const FAVORITOS = /\/api\/pep\/prescricao\/favoritos/;
const PRODUTOS = /\/api\/pep\/prescricao\/produtos/;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}
const json = (r: Route, corpo: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

function simularPadroes(page: Page) {
  const corpos: { url: string; corpo: Record<string, unknown> }[] = [];
  void page.route(PRODUTOS, (r) =>
    json(r, [
      { produto: 701, nome: 'Soro fisiológico sintético 0,9%' },
      { produto: 702, nome: 'Dipirona sintética 1 g' },
    ]),
  );
  void page.route(PADROES, async (r) => {
    const url = r.request().url();
    if (r.request().method() === 'GET') {
      if (url.endsWith('/protocolos')) return json(r, { protocolos: [] });
      if (url.endsWith('/kits')) return json(r, { kits: [] });
      if (url.endsWith('/receitas')) return json(r, { receitas: [] });
      return json(r, {}, 404);
    }
    corpos.push({ url, corpo: r.request().postDataJSON() as Record<string, unknown> });
    return json(r, { id: 900 + corpos.length, versao: 1 });
  });
  return corpos;
}

function simularFavoritos(page: Page) {
  const favoritos: { id: number; tipo: string; alvo: number; rotulo: string; ordem: null }[] = [];
  const marcados: Record<string, unknown>[] = [];
  const desmarcados: string[] = [];
  void page.route(FAVORITOS, async (r) => {
    const url = r.request().url();
    if (r.request().method() === 'GET') return json(r, { favoritos });
    if (url.includes('/desmarcar')) {
      desmarcados.push(url);
      favoritos.splice(0, favoritos.length);
      return json(r, { id: 51 });
    }
    const corpo = r.request().postDataJSON() as { tipo: string; alvo: number; rotulo?: string };
    marcados.push(corpo);
    favoritos.push({ id: 51, tipo: corpo.tipo, alvo: corpo.alvo, rotulo: corpo.rotulo ?? '', ordem: null });
    return json(r, { id: 51 });
  });
  return { marcados, desmarcados };
}

const KIT = {
  id: 77,
  versao: 1,
  codigo: 'KIT-SINT-2',
  nome: 'Kit sintético de analgesia',
  tipoKit: 'medicamento',
  item: null,
  via: 3,
  frequencia: null,
  doseInicial: null,
  doseFinal: null,
  velocidade: null,
  unidadeInfusao: null,
  ativo: true,
  itens: [],
};
const sugestao = (produto: number) => ({
  tipo: 'medicamento',
  item: { produto },
  dose: 1,
  unidade: 'g',
  via: 'EV',
  frequencia: null,
});
function simularKit(page: Page) {
  const buscas: string[] = [];
  void page.route(PRODUTOS, (r) => {
    buscas.push(r.request().url());
    return json(r, [
      {
        produto: 702,
        nome: 'Dipirona sintética 1 g',
        unidade: 'g',
        padronizado: true,
        principiosAtivos: [],
        altoAlerta: false,
        controlado: false,
        antimicrobiano: false,
        doseMinima: null,
        doseMaxima: null,
      },
    ]);
  });
  void page.route(PADROES, (r) => {
    const url = r.request().url();
    if (url.endsWith('/kits')) return json(r, { kits: [KIT] });
    if (url.endsWith('/kits/77/aplicacao'))
      return json(r, {
        kit: 77,
        nome: KIT.nome,
        tipoKit: 'medicamento',
        forma: 'itens',
        problema: null,
        mensagem: null,
        revisar: [3],
        linhas: [
          {
            sequencia: 1,
            papel: 'principal',
            produto: 702,
            produtoNome: 'Dipirona sintética 1 g',
            dose: 1,
            unidade: 'g',
            principal: false,
          },
          {
            sequencia: 2,
            papel: 'componente',
            produto: 703,
            produtoNome: 'Ondansetrona sintética 4 mg',
            dose: 1,
            unidade: 'g',
            principal: false,
          },
        ],
        sugestoes: [sugestao(703), sugestao(702)],
      });
    return json(r, {}, 404);
  });
  return { buscas };
}

test.describe('@C2-097 padrões da prescrição e favoritos do prescritor', () => {
  test('kit de solução exige o diluente na hora; protocolo com item do catálogo grava', async ({ page }) => {
    const externas = vigiarExternas(page);
    const corpos = simularPadroes(page);
    await entrar(page, 'SINT.ADMIN');

    await page.goto('/cadastros/prescricao/kits');
    await expect(page.getByTestId('padroes-kits')).toBeVisible();
    await page.getByTestId('padrao-novo').click();
    const ed = page.getByTestId('padrao-edicao');
    await expect(ed).toBeVisible();
    await esperarSemSelectNativo(page.locator('body'));
    await ed.getByTestId('padrao-codigo').fill('KIT-SINT-1');
    await ed.getByTestId('padrao-nome').fill('Kit sintético de hidratação');
    await escolher(ed.getByTestId('padrao-tipo-kit'), 'solucao');
    await ed.getByTestId('padrao-item-catalogo-0').fill('Soro fisiológico sintético 0,9%');
    await ed.getByTestId('padrao-item-quantidade-0').fill('1');
    await escolher(ed.getByTestId('padrao-item-unidade-0'), { indice: 1 });
    await expect(page.getByTestId('padrao-problemas')).toContainText('diluente');
    await expect(page.getByTestId('padrao-salvar')).toBeDisabled();
    await escolher(ed.getByTestId('padrao-item-papel-0'), 'diluente');
    await expect(page.getByTestId('padrao-problemas')).toHaveCount(0);
    await page.getByTestId('padrao-salvar').click();
    await expect(page.getByTestId('padrao-aviso')).toBeVisible();
    expect(corpos.at(-1)?.url).toMatch(/\/padroes\/kits$/);
    expect(corpos.at(-1)?.corpo).toMatchObject({
      codigo: 'KIT-SINT-1',
      tipoKit: 'solucao',
      itens: [{ sequencia: 1, item: 701, papel: 'diluente', quantidade: 1 }],
    });

    await page.goto('/cadastros/prescricao/protocolos');
    await page.getByTestId('padrao-novo').click();
    await ed.getByTestId('padrao-codigo').fill('PROT-SINT-1');
    await expect(page.getByTestId('padrao-salvar')).toBeDisabled();
    await ed.getByTestId('padrao-nome').fill('Protocolo sintético de analgesia');
    await ed.getByTestId('padrao-idade-min').fill('18');
    await ed.getByTestId('padrao-item-catalogo-0').fill('Dipirona sintética 1 g');
    await ed.getByTestId('padrao-item-dose-0').fill('1');
    await expect(page.getByTestId('padrao-problemas')).toHaveCount(0);
    await page.getByTestId('padrao-salvar').click();
    await expect(page.getByTestId('padrao-aviso')).toBeVisible();
    expect(corpos.at(-1)?.url).toMatch(/\/padroes\/protocolos$/);
    expect(corpos.at(-1)?.corpo).toMatchObject({
      codigo: 'PROT-SINT-1',
      idadeMin: 18,
      itens: [{ sequencia: 1, tipoItem: 'medicamento', item: 702, dose: 1 }],
    });
    await semViolacaoAxe(page, 'c2-097 padrões da prescrição');
    expect(externas).toEqual([]);
  });

  test('favorito do prescritor: estrela no protocolo escolhido e aplicação em um clique', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const fav = simularFavoritos(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/prescricao/nova?montar=1');
    const protocolo = page.getByTestId('aplicar-protocolo');
    await expect(protocolo).toBeVisible();
    await expect(page.getByTestId('favoritos-vazio')).toBeVisible();
    await expect(page.getByTestId('favoritar-protocolo')).toBeDisabled();
    await escolher(protocolo.getByTestId('escolher-protocolo'), '1');
    await page.getByTestId('favoritar-protocolo').click();
    await expect.poll(() => fav.marcados.length).toBe(1);
    expect(fav.marcados[0]).toMatchObject({ tipo: 'protocolo_prescricao' });
    const atalho = page.getByTestId('atalhos-favoritos').locator('[data-testid^="favorito-"]');
    await expect(atalho).toHaveCount(1);
    await expect(page.getByTestId('favoritar-protocolo')).toBeDisabled();

    await atalho.click();
    await expect(page.getByTestId('aviso-protocolo')).toContainText('itens do protocolo incluídos');
    await expect(page.getByTestId('itens-prescricao').locator('tbody tr').first()).toBeVisible();
    await semViolacaoAxe(page, 'c2-097 favoritos no editor');

    await page.getByTestId('atalhos-favoritos').locator('[data-testid^="desmarcar-favorito-"]').click();
    await expect(page.getByTestId('favoritos-vazio')).toBeVisible();
    expect(fav.desmarcados).toHaveLength(1);
    expect(externas).toEqual([]);
  });

  test('kit no editor: aplicado pelo combo e pelo atalho; favorito do kit e do último item incluído', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const fav = simularFavoritos(page);
    const kit = simularKit(page);
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/prescricao/nova?montar=1');
    const barra = page.getByTestId('aplicar-kit');
    await expect(barra).toBeVisible();
    await esperarSemSelectNativo(page.locator('body'));
    await expect(page.getByTestId('favoritar-kit')).toBeDisabled();
    await expect(page.getByTestId('favoritar-item')).toBeDisabled();
    await escolher(barra.getByTestId('escolher-kit'), { rotulo: KIT.nome });
    await barra.getByTestId('botao-aplicar-kit').click();
    await expect(page.getByTestId('aviso-protocolo')).toContainText('2 item(ns) do kit');
    await expect(page.getByTestId('aviso-protocolo')).toContainText('1 item(ns) do kit ficam para completar');
    const linhas = page.getByTestId('itens-prescricao').locator('tbody tr');
    await expect(linhas).toHaveCount(2);

    await page.getByTestId('favoritar-kit').click();
    await expect.poll(() => fav.marcados.length).toBe(1);
    expect(fav.marcados[0]).toMatchObject({ tipo: 'kit_prescricao', alvo: 77, rotulo: KIT.nome });
    await page.getByTestId('favorito-kit_prescricao-77').click();
    await expect(linhas).toHaveCount(4);

    // O último item incluído (Dipirona, 702) vira favorito e, pelo atalho, fica escolhido no formulário.
    await page.getByTestId('favoritar-item').click();
    await expect.poll(() => fav.marcados.length).toBe(2);
    expect(fav.marcados[1]).toMatchObject({ tipo: 'item_prescritivel', alvo: 702 });
    await page.getByTestId('favorito-item_prescritivel-702').click();
    await expect.poll(() => kit.buscas.length).toBeGreaterThan(0);
    await semViolacaoAxe(page, 'c2-097 kit e favoritos no editor');
    expect(externas).toEqual([]);
  });
});
