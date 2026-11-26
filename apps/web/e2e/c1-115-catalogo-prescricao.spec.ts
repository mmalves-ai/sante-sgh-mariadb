// E2E @C1-115 (F3.3, 03-PEP L106): o cadastro editável do catálogo da prescrição pelo caminho da tela
// (Cadastros > Cadastros clínicos e de prescrição). O administrador (SINT.ADMIN, que pode tudo) inclui uma frequência
// com a validação na hora pela regra do domínio (intervalo obrigatório, setores só com escopo), grava uma condição
// "se necessário" com o disparo pelo sinal vital, inclui um item não padronizado com unidade, via e justificativa e
// abre os complementos de um item para aceitar frequência e incluir sinônimo (o termo repetido é barrado na hora).
// Combos são SanteSelecao (nenhum <select> nativo). O cadastro só existe no banco do cliente (na fonte sintética a API
// responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato do servidor. O que fica
// no banco está no contrato de efeito apps/api/src/modulos/pep/prescricao-propria-cadastro.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';
const C = /\/api\/pep\/prescricao\/catalogo/;

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

function simular(page: Page) {
  const corpos: { url: string; corpo: Record<string, unknown> }[] = [];
  const apoio = {
    setores: [{ id: 11, nome: 'UTI sintética' }],
    vias: [{ id: 21, nome: 'Oral sintética' }],
    unidades: [{ id: 31, nome: 'cp · Comprimido sintético' }],
    tipos: [{ id: 41, nome: 'Medicamento sintético' }],
    parametros: [{ id: 51, nome: 'Temperatura sintética' }],
    frequencias: [{ id: 61, nome: 'De 8 em 8 horas sintética' }],
  };
  const comp = {
    item: { id: 71, versao: 1, descricao: 'Item sintético 71', padronizado: true, ativo: true },
    frequencias: [] as unknown[],
    setores: [],
    sinonimos: [{ id: 81, versao: 1, sequencia: 1, termo: 'apelido sintético', origemTermo: 'apelido' }],
    conflitos: [],
  };
  void page.route(C, async (r) => {
    const url = r.request().url();
    if (r.request().method() === 'GET') {
      if (url.endsWith('/apoio')) return json(r, apoio);
      if (url.endsWith('/frequencias')) return json(r, { frequencias: [] });
      if (url.endsWith('/condicoes')) return json(r, { condicoes: [] });
      if (url.includes('/complementos')) return json(r, comp);
      return json(r, {}, 404);
    }
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    corpos.push({ url, corpo });
    if (url.includes('/complementos') && corpo['tipo'] === 'frequencia')
      comp.frequencias.push({
        id: 91,
        versao: 1,
        frequencia: 61,
        nome: 'De 8 em 8 horas sintética',
        usoFrequente: false,
      });
    return json(r, { id: 900 + corpos.length, versao: 1 }, url.endsWith('/nao-padronizados') ? 201 : 200);
  });
  return corpos;
}

test.describe('@C1-115 cadastro editável do catálogo da prescrição', () => {
  test('frequência, condição se necessário, item não padronizado e complementos do item', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos = simular(page);
    await entrar(page, 'SINT.ADMIN');

    await page.goto('/cadastros/prescricao/frequencias');
    const fr = page.getByTestId('form-frequencia');
    await expect(fr).toBeVisible();
    await esperarSemSelectNativo(page.locator('body'));
    await fr.getByTestId('fr-codigo').getByRole('textbox').fill('6/6h sint');
    await fr.getByTestId('fr-descricao').getByRole('textbox').fill('De 6 em 6 horas sintética');
    await expect(page.getByTestId('fr-falta')).toContainText('intervalo');
    await expect(page.getByTestId('fr-salvar')).toBeDisabled();
    await fr.getByTestId('fr-intervalo').getByRole('textbox').fill('6');
    await escolher(fr.getByTestId('fr-escopo'), { rotulo: 'Só nos setores marcados' });
    await expect(page.getByTestId('fr-falta')).toContainText('setor');
    await page.getByTestId('fr-setores').getByLabel('UTI sintética').check();
    await expect(page.getByTestId('fr-falta')).toHaveCount(0);
    await page.getByTestId('fr-salvar').click();
    await expect(page.getByTestId('catalogo-aviso')).toContainText('Frequência gravada');
    expect(corpos.at(-1)?.corpo).toMatchObject({ tipo: 'intervalo', intervaloMinutos: 360, setores: [11] });

    const cd = page.getByTestId('form-condicao');
    await cd.getByTestId('cd-codigo').getByRole('textbox').fill('febre sint');
    await cd.getByTestId('cd-descricao').getByRole('textbox').fill('Febre sintética');
    await escolher(cd.getByTestId('cd-parametro'), { rotulo: 'Temperatura sintética' });
    await expect(page.getByTestId('cd-falta')).toBeVisible();
    await cd.getByTestId('cd-limiar').getByRole('textbox').fill('37,8');
    await page.getByTestId('cd-salvar').click();
    await expect(page.getByTestId('catalogo-aviso')).toContainText('Condição gravada');
    expect(corpos.at(-1)?.corpo).toMatchObject({ parametroVital: 51, limiar: 37.8 });

    await page.goto('/cadastros/prescricao/itens-nao-padronizados');
    const np = page.getByTestId('form-nao-padronizado');
    await np.getByTestId('np-descricao').getByRole('textbox').fill('Colírio sintético de casa');
    await escolher(np.getByTestId('np-tipo'), { rotulo: 'Medicamento sintético' });
    await escolher(np.getByTestId('np-unidade'), { rotulo: 'cp · Comprimido sintético' });
    await expect(page.getByTestId('np-falta')).toContainText('via');
    await escolher(np.getByTestId('np-via'), { rotulo: 'Oral sintética' });
    await page.getByTestId('np-somar-via').click();
    await np.getByTestId('np-justificativa').getByRole('textbox').fill('Paciente em uso domiciliar contínuo');
    await page.getByTestId('np-salvar').click();
    await expect(page.getByTestId('catalogo-aviso')).toContainText('não padronizado incluído');
    expect(corpos.at(-1)?.corpo).toMatchObject({ tipoItem: 41, unidade: 31, vias: [21] });

    await page.goto('/cadastros/prescricao/parametros-item');
    await page.getByTestId('cp-item').getByRole('textbox').fill('71');
    await page.getByTestId('cp-abrir').click();
    const painel = page.getByTestId('complementos-item');
    await expect(painel).toContainText('Item sintético 71');
    await escolher(painel.getByTestId('cp-frequencia'), { rotulo: 'De 8 em 8 horas sintética' });
    await page.getByTestId('cp-incluir-frequencia').click();
    await expect(painel).toContainText('De 8 em 8 horas sintética');
    await painel.getByTestId('cp-termo').getByRole('textbox').fill('APELIDO SINTÉTICO');
    await expect(page.getByTestId('cp-falta-sinonimo')).toBeVisible();
    await expect(page.getByTestId('cp-incluir-sinonimo')).toBeDisabled();
    await semViolacaoAxe(page, 'c1-115 catálogo da prescrição');
    expect(externas).toEqual([]);
  });

  test('perfil só de leitura consulta o catálogo sem os formulários de gravação', async ({ page }) => {
    const externas = vigiarExternas(page);
    const corpos = simular(page);
    // A sessão do administrador é reduzida às permissões de leitura das três seções (a tela esconde; o servidor recusa).
    await page.route(/\/api\/sessao(\?.*)?$/, async (r) => {
      if (r.request().method() !== 'GET') return r.continue();
      const real = await r.fetch();
      const sessao = (await real.json()) as Record<string, unknown>;
      return json(r, {
        ...sessao,
        permissoes: [
          'pep.cadastroPrescricao.ler',
          'pep.frequenciaDose.ler',
          'pep.itemNaoPadronizado.ler',
          'pep.parametroClinicoItem.ler',
        ],
      });
    });
    await entrar(page, 'SINT.ADMIN');

    await page.goto('/cadastros/prescricao/frequencias');
    await expect(page.getByTestId('catalogo-somente-leitura')).toBeVisible();
    await expect(page.getByTestId('form-frequencia')).toHaveCount(0);
    await expect(page.getByTestId('form-condicao')).toHaveCount(0);

    await page.goto('/cadastros/prescricao/itens-nao-padronizados');
    await expect(page.getByTestId('catalogo-somente-leitura')).toBeVisible();
    await expect(page.getByTestId('form-nao-padronizado')).toHaveCount(0);

    await page.goto('/cadastros/prescricao/parametros-item');
    await page.getByTestId('cp-item').getByRole('textbox').fill('71');
    await page.getByTestId('cp-abrir').click();
    const painel = page.getByTestId('complementos-item');
    await expect(painel).toContainText('apelido sintético');
    await expect(painel.getByTestId('cp-incluir-frequencia')).toHaveCount(0);
    await expect(painel.getByTestId('cp-incluir-sinonimo')).toHaveCount(0);
    await expect(painel.getByRole('button', { name: /Retirar/ })).toHaveCount(0);
    await expect(page.getByTestId('catalogo-somente-leitura')).toBeVisible();
    await semViolacaoAxe(page, 'c1-115 catálogo da prescrição só leitura');
    expect(corpos).toEqual([]);
    expect(externas).toEqual([]);
  });
});
