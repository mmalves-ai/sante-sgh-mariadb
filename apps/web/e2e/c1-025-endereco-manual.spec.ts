// C1-025 (F3.1, 02-CAD linha 14): endereço manual na ficha complementar, pelo caminho da tela. O CEP digitado é
// conferido no cadastro de CEPs na hora; fora dele, a tela pede a espécie do logradouro (combo), o município (busca) e o
// logradouro, e o pedido só sai completo. A ficha complementar exige o banco próprio e o E2E roda com a fonte sintética:
// as respostas da API são simuladas com massa SINTÉTICA. O efeito no banco (espécie e município gravados, sem ligação
// à base postal; nada gravado quando falta a espécie ou o município) está no contrato de efeito
// (apps/api/src/modulos/cadastro/endereco-manual.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7302;
const CEP_FORA = '99999990';
const CEP_ACHADO = '01001000';

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

async function simular(page: Page, pedidos: Record<string, unknown>[]): Promise<void> {
  const contatos = { enderecos: [] as unknown[], telefones: [] as unknown[], emails: [] as unknown[] };
  await page.route('**/api/cadastros/ficha-complementar/tipos', (r) =>
    json(r, {
      endereco: [{ id: 1, descricao: 'Residencial' }],
      telefone: [{ id: 2, descricao: 'Celular' }],
      parentesco: [{ id: 3, descricao: 'Mãe' }],
      especieLogradouro: [
        { id: 51, descricao: 'Avenida' },
        { id: 52, descricao: 'Rua' },
      ],
    }),
  );
  await page.route('**/api/cadastros/ficha-complementar/municipios?*', (r) =>
    json(r, [{ id: 3106200, nome: 'BELO HORIZONTE SINTETICO', uf: 'MG' }]),
  );
  await page.route('**/api/cadastros/pacientes/cep/*', (r) =>
    r.request().url().endsWith(CEP_ACHADO)
      ? json(r, {
          cep: CEP_ACHADO,
          logradouro: 'Rua Sintetica',
          bairro: 'Centro',
          cidade: 'Sao Paulo',
          uf: 'SP',
        })
      : json(r, { type: 'about:blank', title: 'CEP não encontrado', status: 404 }, 404),
  );
  await page.route(`**/api/cadastros/pacientes/${PACIENTE}/**`, (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(`/api/cadastros/pacientes/${PACIENTE}/`, '');
    if (req.method() === 'GET') {
      if (caminho === 'contatos') return json(rota, contatos);
      if (caminho === 'responsaveis') return json(rota, { itens: [], pendencias: [] });
      return rota.fallback();
    }
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push({ caminho, ...corpo });
    if (caminho === 'enderecos') {
      contatos.enderecos.push({
        id: 61,
        tipo: 'Residencial',
        cep: String(corpo['cep']),
        logradouro: String(corpo['logradouro']),
        numero: String(corpo['numero']),
        complemento: null,
        bairro: null,
        principal: false,
        vigenciaInicio: null,
        vigenciaFim: null,
        vigente: true,
      });
      return json(rota, { id: 61 }, 201);
    }
    return json(rota, { id: 1 });
  });
}

test.describe('Endereço manual com espécie do logradouro @C1-025', () => {
  test('CEP fora do cadastro pede espécie, município e logradouro antes de sair; axe', async ({ page }) => {
    const pedidos: Record<string, unknown>[] = [];
    await entrar(page, 'SINT.RECEPCAO');
    await simular(page, pedidos);
    await page.goto(`/cadastros/pacientes/${PACIENTE}/contatos`);
    const form = page.getByTestId('form-endereco');
    await escolher(page.getByTestId('endereco-tipo'), { rotulo: 'Residencial' });

    // CEP do cadastro: a tela mostra o que a base postal dá e não pede município.
    await page.getByTestId('endereco-cep').fill(CEP_ACHADO);
    await expect(page.getByTestId('endereco-cep-achado')).toContainText('Rua Sintetica');
    await expect(page.getByTestId('endereco-municipio')).toHaveCount(0);

    // CEP fora do cadastro: endereço manual, os erros aparecem na hora e o pedido não sai.
    await page.getByTestId('endereco-cep').fill(CEP_FORA);
    await expect(page.getByTestId('endereco-manual-aviso')).toBeVisible();
    await page.getByTestId('endereco-numero').fill('15');
    await expect(form.getByRole('alert').filter({ hasText: 'espécie do logradouro' })).toBeVisible();
    await expect(form.getByRole('alert').filter({ hasText: 'município' })).toBeVisible();
    await expect(form.getByRole('button', { name: 'Incluir' })).toBeDisabled();

    await escolher(page.getByTestId('endereco-especie'), { rotulo: 'Rua' });
    await page.getByTestId('endereco-municipio-busca').fill('BELO');
    await escolher(page.getByTestId('endereco-municipio'), { rotulo: /BELO HORIZONTE SINTETICO/ });
    await page.getByTestId('endereco-logradouro').fill('DAS ACACIAS SINTETICAS');
    await expect(form.getByRole('alert')).toHaveCount(0);
    await form.getByRole('button', { name: 'Incluir' }).click();
    await expect(page.getByTestId('endereco-61')).toContainText('DAS ACACIAS SINTETICAS');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      caminho: 'enderecos',
      cep: CEP_FORA,
      especie: 52,
      municipio: 3106200,
      logradouro: 'DAS ACACIAS SINTETICAS',
      numero: '15',
    });
    await semViolacaoAxe(page, '/cadastros/pacientes/:id/contatos');
  });
});
