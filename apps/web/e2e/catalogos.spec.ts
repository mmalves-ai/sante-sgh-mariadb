// E2E @M13 (ficha, seção 10) com axe-core: enviar uma competência SIGTAP sintética no leiaute oficial, ver a
// comparação com o banco, aprovar com a senha de novo e consultar o procedimento publicado e o histórico de
// competências; consultar um CID e um CEP; a carga de um catálogo cujo responsável é a carga externa (TUSS) não
// pode ser aprovada; o faturista sem a opção de importação não vê o envio. Sessão real sobre a fonte
// sintética de dev e a fonte dos catálogos EM MEMÓRIA (nada vai à cópia; nenhum dado real; nada é baixado).
import { expect, test, type Page } from '@playwright/test';
import { arquivoTbProcedimento } from '@sgh/dominio-catalogo';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, rotulosDoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function colar(page: Page, nome: string, conteudo: string): Promise<void> {
  await page.getByTestId('envio-nome').fill(nome);
  await page.getByTestId('envio-conteudo').fill(conteudo);
  await page.getByTestId('envio-adicionar').click();
  await expect(page.getByTestId('envio-lista')).toContainText(nome);
}

const COMPETENCIA = '202611';
const SIGTAP = arquivoTbProcedimento([
  {
    codigo: '0399990001',
    nome: 'CONSULTA SINTÉTICO',
    competencia: COMPETENCIA,
    valorSa: 14,
    complexidade: '2',
    sexo: 'I',
    financiamento: '06',
  },
  {
    codigo: '0399990002',
    nome: 'EXAME SINTÉTICO',
    competencia: COMPETENCIA,
    valorSa: 5.5,
    complexidade: '2',
    sexo: 'I',
    financiamento: '06',
  },
]);

test.describe('Catálogos oficiais e importadores @M13', () => {
  test('SIGTAP sintético: comparação, aprovação com a senha, consulta e histórico; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/catalogos');
    await expect(page.getByRole('heading', { level: 1, name: /Catálogos oficiais/ })).toBeVisible();
    await expect(page.getByTestId('responsavel-sigtap')).toHaveText('Importador deste sistema');
    await expect(page.getByTestId('responsavel-tuss')).toHaveText('Carga externa');
    await expect(page.getByTestId('janela-publicacao')).toContainText('22:00');
    await semViolacaoAxe(page, '/cadastros/catalogos');
    await escolher(page.getByTestId('envio-catalogo'), 'sigtap');
    await colar(page, 'tb_procedimento.txt', SIGTAP);
    await page.getByTestId('envio-preparar').click();
    await expect(page).toHaveURL(/\/cadastros\/catalogos\/cargas\/\d+/);
    await expect(page.getByTestId('situacao-carga')).toContainText('comparada');
    await expect(page.getByTestId('situacao-carga')).toContainText(COMPETENCIA);
    await expect(page.getByTestId('totais-carga')).toContainText('1 alterados');
    await expect(page.getByTestId('totais-carga')).toContainText('1 iguais');
    await escolher(page.getByTestId('filtro-comparacao'), 'alterado');
    await expect(page.getByTestId('tabela-linhas')).toContainText('0399990001');
    await semViolacaoAxe(page, 'carga: comparação');
    // Senha errada: recusada, nada publicado.
    await page
      .getByTestId('aprovar-justificativa')
      .locator('input, textarea')
      .first()
      .fill('competência nova E2E');
    await page.getByTestId('aprovar-senha').fill('errada');
    await page.getByTestId('carga-aprovar').click();
    await expect(page.getByTestId('recusa-carga')).toBeVisible();
    await expect(page.getByTestId('situacao-carga')).toContainText('comparada');
    await page.getByTestId('aprovar-senha').fill(SENHA);
    await page.getByTestId('carga-aprovar').click();
    await expect(page.getByTestId('mensagem-carga')).toContainText('Aprovação registrada');
    await expect(page.getByTestId('situacao-carga')).toContainText('publicada');
    // Consulta do procedimento publicado.
    await page.goto('/cadastros/catalogos/sigtap');
    await page.getByTestId('consulta-busca').fill('0399990001');
    await page.getByTestId('consulta-buscar').click();
    await expect(page.getByTestId('tabela-consulta')).toContainText('CONSULTA SINTÉTICO');
    await semViolacaoAxe(page, '/cadastros/catalogos/sigtap');
    // Histórico de competências: a nova e a anterior, cada uma na sua linha.
    await page.goto('/faturamento/sus/sigtap');
    await page.getByTestId('historico-procedimento').fill('0399990001');
    await page.getByTestId('historico-consultar').click();
    await expect(page.getByTestId(`competencia-${COMPETENCIA}`)).toContainText('14,00');
    await semViolacaoAxe(page, '/faturamento/sus/sigtap');
    expect(externas).toEqual([]);
  });

  test('consulta de um CID e de um CEP', async ({ page }) => {
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/catalogos/cid');
    await escolher(page.getByTestId('consulta-tabela'), 'cid10');
    await page.getByTestId('consulta-busca').fill('U991');
    await page.getByTestId('consulta-buscar').click();
    await expect(page.getByTestId('tabela-consulta')).toContainText('DOENCA SINTÉTICO 1');
    await semViolacaoAxe(page, '/cadastros/catalogos/cid');
    await page.goto('/cadastros/catalogos/enderecos');
    await escolher(page.getByTestId('consulta-tabela'), 'cep');
    // CEP digitado com hífen (formato usual).
    await page.getByTestId('consulta-busca').fill('99999-001');
    await page.getByTestId('consulta-buscar').click();
    await expect(page.getByTestId('tabela-consulta')).toContainText('99999001');
    await semViolacaoAxe(page, '/cadastros/catalogos/enderecos');
    // SIGTAP: seções (domínios, tabelas anteriores e descontinuadas) e o filtro de competência.
    await page.goto('/cadastros/catalogos/sigtap');
    // As 5 seções viram o prefixo do rótulo de cada opção ("Seção · Tabela"): o combo com busca não tem grupos.
    const secoes = async () =>
      new Set(
        (await rotulosDoCombo(page.getByTestId('consulta-tabela'))).map((r) => r.split(' · ')[0]!.trim()),
      ).size;
    await expect.poll(secoes).toBe(5);
    await escolher(page.getByTestId('consulta-tabela'), 'procedimento');
    await page.getByTestId('consulta-competencia').fill('202609');
    await page.getByTestId('consulta-buscar').click();
    await expect(page.getByTestId('tabela-consulta')).toBeVisible();
    await escolher(page.getByTestId('consulta-tabela'), 'tipoFinanciamento');
    await expect(page.getByText('Nada encontrado.')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/catalogos/sigtap');
  });

  test('TUSS com a carga externa: a carga é comparada, mas não pode ser aprovada; rejeitar', async ({
    page,
  }) => {
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/catalogos');
    await escolher(page.getByTestId('envio-catalogo'), 'tuss');
    await colar(page, 'TUSS24.csv', 'Código do Termo;Termo\n999999;OCUPACAO ANS SINTETICA NOVA');
    await page.getByTestId('envio-edicao').fill('4.02.00');
    await page.getByTestId('envio-preparar').click();
    await expect(page.getByTestId('situacao-carga')).toContainText('comparada');
    await expect(page.getByTestId('nao-publica')).toBeVisible();
    await page.getByTestId('aprovar-justificativa').locator('input, textarea').first().fill('tentativa E2E');
    await page.getByTestId('aprovar-senha').fill(SENHA);
    await page.getByTestId('carga-aprovar').click();
    await expect(page.getByTestId('recusa-carga')).toBeVisible();
    await expect(page.getByTestId('situacao-carga')).toContainText('comparada');
    await page.getByTestId('carga-motivo').fill('carga externa');
    await page.getByTestId('carga-encerrar').click();
    await expect(page.getByTestId('situacao-carga')).toContainText('rejeitada');
    await semViolacaoAxe(page, 'carga rejeitada');
  });

  test('faturista sem a opção de importação: não vê o envio de cargas', async ({ page }) => {
    await entrar(page, 'SINT.FATURISTA');
    await page.goto('/cadastros/catalogos');
    await expect(page.getByTestId('form-envio')).toHaveCount(0);
  });
});
