// E2E @M12 (ficha, seção 10) com axe-core: abrir o contrato de um convênio sintético e percorrer as abas
// (código "a confirmar" com a legenda); consultar o valor vigente em duas datas; reajustar uma tabela
// sintética (com a senha de novo) e desfazer; o aviso da tabela compartilhada pede confirmação; importar um
// arquivo sintético e ver a comparação; usuário sem a permissão não vê os códigos de prestador. Sessão real
// sobre a fonte sintética de dev e a fonte de preços EM MEMÓRIA (nada vai à cópia; nenhum dado real).
import { expect, test, type Page } from '@playwright/test';
import { credenciaisNaResposta } from '@sgh/contratos';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

// Regra 8 sobre as respostas: os corpos JSON de convênios, faturamento e preços de cada teste passam pela
// conferência de credencial (a mesma lista da guarda do SQL em tools/verificadores).
const respostas: Promise<{ url: string; corpo: unknown }>[] = [];
test.beforeEach(({ page }) => {
  respostas.length = 0;
  page.on('response', (r) => {
    const url = new URL(r.url()).pathname;
    if (!/^\/api\/(?:cadastros\/convenios|faturamento|precos)/.test(url)) return;
    if (!(r.headers()['content-type'] ?? '').includes('json')) return;
    respostas.push(
      r.json().then(
        (corpo: unknown) => ({ url, corpo }),
        () => ({ url, corpo: null }),
      ),
    );
  });
});
test.afterEach(async () => {
  const lidas = await Promise.all(respostas);
  const achados = lidas.flatMap((r) => credenciaisNaResposta(r.corpo).map((a) => `${r.url} ${a.caminho}`));
  expect(achados).toEqual([]);
});

test.describe('Convênios, contratos e tabelas de preço @M12', () => {
  test('contrato em abas, com o código "a confirmar"; axe em cada aba', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/convenios');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Convênios, operadoras, planos e classes' }),
    ).toBeVisible();
    await page.getByTestId('convenios-busca').fill('operadora alfa');
    await expect(page.getByTestId('abrir-convenio-305')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/convenios');
    await page.getByTestId('abrir-convenio-305').click();
    await expect(page.getByRole('heading', { level: 1, name: /Contrato do convênio 305/ })).toBeVisible();
    await expect(page.getByTestId('contrato-aceite')).toContainText('Aceita novo atendimento');
    for (const aba of [
      'cadastro',
      'tabelas',
      'modificadores',
      'faturabilidade',
      'pacotes',
      'tiss',
      'financeiro',
    ]) {
      await page.getByTestId(`aba-${aba}`).click();
      await expect(page.getByTestId(`painel-${aba}`)).toBeVisible();
      if (aba === 'tiss') await expect(page.getByTestId('a-confirmar').first()).toBeVisible();
      if (aba === 'cadastro' || aba === 'tiss') await semViolacaoAxe(page, `contrato: ${aba}`);
    }
    // Editar a aba financeiro com a senha de novo.
    await page.getByTestId('aba-financeiro').click();
    await page.getByTestId('editar-aba').click();
    await page.getByTestId('campo-prazoPagamentoDias').fill('60');
    await page
      .getByTestId('contrato-justificativa')
      .locator('input, textarea')
      .first()
      .fill('prazo novo do contrato');
    await page.getByTestId('contrato-senha').fill(SENHA);
    await semViolacaoAxe(page, 'contrato: edição');
    await page.getByTestId('salvar-aba').click();
    await expect(page.getByTestId('mensagem-contrato')).toContainText('Contrato alterado');
    await expect(page.getByTestId('campos-financeiro')).toContainText('60');
    expect(externas).toEqual([]);
  });

  test('valor vigente em duas datas', async ({ page }) => {
    await entrar(page, 'SINT.FATURISTA');
    await page.goto('/precos/consulta');
    await escolher(page.getByTestId('valor-convenio'), '305');
    await page.getByTestId('valor-item').fill('305004');
    await page.getByTestId('valor-data').fill('2025-06-01');
    await page.getByTestId('valor-consultar').click();
    await expect(page.getByTestId('valor-total')).toHaveText('110,00');
    await page.getByTestId('valor-data').fill('2026-06-01');
    await page.getByTestId('valor-consultar').click();
    await expect(page.getByTestId('valor-total')).toHaveText('130,00');
    await expect(page.getByTestId('resultado-valor')).toContainText('vigência 2026-01-15');
    await semViolacaoAxe(page, '/precos/consulta');
    // Modelo CH: o total é a soma dos componentes (regra da sante-api); o modelo fica só na explicação.
    await escolher(page.getByTestId('valor-convenio'), '53');
    await page.getByTestId('valor-item').fill('53001');
    await page.getByTestId('valor-consultar').click();
    await expect(page.getByTestId('valor-total')).toHaveText('109,25');
    await expect(page.getByTestId('valor-estimativa')).toContainText('6,25');
  });

  test('reajustar uma tabela sintética e desfazer; aviso da tabela compartilhada', async ({ page }) => {
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/precos/honorarios');
    await escolher(page.getByTestId('honorarios-tabela'), '305');
    await expect(page.getByTestId('total-305005')).toHaveText('140,00');
    await semViolacaoAxe(page, '/precos/honorarios');
    await page.getByTestId('selecionar-305005').check();
    await page.getByTestId('reajuste-percentual').fill('10');
    await page.getByTestId('reajuste-propor').click();
    await expect(page.getByTestId('proposta')).toContainText('1 item(ns), 1 mudam');
    await page
      .getByTestId('reajuste-justificativa')
      .locator('input, textarea')
      .first()
      .fill('reajuste sintético E2E');
    await page.getByTestId('reajuste-senha').fill(SENHA);
    await semViolacaoAxe(page, 'proposta de reajuste');
    await page.getByTestId('reajuste-aplicar').click();
    await expect(page.getByTestId('mensagem-honorarios')).toContainText('Reajuste gravado');
    await expect(page.getByTestId('total-305005')).toHaveText('154,00');
    await page.getByTestId('vigencias-305005').click();
    await expect(page.getByTestId('painel-vigencias')).toContainText('SINT.FATURAMENTO');
    await page.getByTestId('lista-lotes').getByRole('button', { name: 'Desfazer este lote' }).first().click();
    await page
      .getByTestId('desfazer-justificativa')
      .locator('input, textarea')
      .first()
      .fill('desfazer sintético E2E');
    await page.getByTestId('desfazer-senha').fill(SENHA);
    await page.getByTestId('desfazer-confirmar').click();
    await expect(page.getByTestId('mensagem-honorarios')).toContainText('Reajuste desfeito');
    await expect(page.getByTestId('total-305005')).toHaveText('140,00');
    // Tabela 10: compartilhada por SUS e Particular, pede a confirmação explícita.
    await escolher(page.getByTestId('honorarios-tabela'), '10');
    await expect(page.getByTestId('honorarios-modelo')).toContainText('compartilhada');
    await page.getByTestId('selecionar-10002').check();
    await page.getByTestId('reajuste-percentual').fill('3');
    await page.getByTestId('reajuste-propor').click();
    await expect(page.getByTestId('alertas')).toContainText('SUS SINTÉTICO');
    await expect(page.getByTestId('confirmar-tabelaCompartilhada')).toBeVisible();
    await page
      .getByTestId('reajuste-justificativa')
      .locator('input, textarea')
      .first()
      .fill('compartilhada sem confirmar');
    await page.getByTestId('reajuste-senha').fill(SENHA);
    await page.getByTestId('reajuste-aplicar').click();
    await expect(page.getByTestId('recusa-honorarios')).toContainText('usada por');
  });

  test('importar um arquivo sintético e ver a comparação', async ({ page }) => {
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/precos/importacoes');
    await escolher(page.getByTestId('importacao-tabela'), '306');
    await page.getByTestId('importacao-nome').fill('tabela-306-sintetica.csv');
    await page
      .getByTestId('importacao-conteudo')
      .fill('codigo;valor_ch\n306003;150,5\n306004;130\n888888;10\n');
    await page.getByTestId('importacao-preparar').click();
    await expect(page.getByTestId('mensagem-importacao')).toContainText('Comparada');
    await expect(page.getByTestId('detalhe-importacao')).toContainText('1 alterado(s)');
    await expect(page.getByTestId('tabela-comparacao')).toContainText('Novos');
    await expect(page.getByTestId('tabela-comparacao')).toContainText('Removidos');
    // O alterado mostra de quanto para quanto muda: o vigente, o do arquivo e a diferença.
    const alterado = page.getByTestId('linha-comparacao-306003');
    await expect(alterado).toContainText('PROCEDIMENTO SINTÉTICO 306-3');
    await expect(alterado.getByTestId('valor-atual')).toContainText('ch=120');
    await expect(alterado.getByTestId('valor-arquivo')).toContainText('ch=150,5');
    await expect(alterado.getByTestId('valor-diferenca')).toHaveText('+30,50');
    await expect(page.getByTestId('tabela-comparacao')).not.toContainText('SPDATA');
    await semViolacaoAxe(page, '/precos/importacoes');
  });

  test('plano do contrato: registrar, encerrar e desativar (nunca apagar)', async ({ page }) => {
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/convenios/306');
    await page.getByTestId('aba-cadastro').click();
    await page.getByTestId('novo-plano').click();
    await page.locator('#plano-nome').fill('PLANO SINTÉTICO E2E');
    await page.locator('#plano-inicio').fill('2026-01-01');
    await page
      .getByTestId('plano-justificativa')
      .locator('input, textarea')
      .first()
      .fill('plano sintético E2E');
    await page.getByTestId('plano-senha').fill(SENHA);
    await page.getByTestId('form-plano').getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByTestId('lista-planos')).toContainText('PLANO SINTÉTICO E2E');
    await page
      .getByTestId('lista-planos')
      .getByRole('button', { name: 'Corrigir ou encerrar' })
      .first()
      .click();
    const form = page.getByTestId('form-editar-plano');
    await form.getByLabel('Fim da vigência (encerrar o plano)').fill('2026-06-30');
    await form.getByLabel('Plano ativo').uncheck();
    await page
      .getByTestId('editar-plano-justificativa')
      .locator('input, textarea')
      .first()
      .fill('encerrar o plano sintético');
    await page.getByTestId('editar-plano-senha').fill(SENHA);
    await semViolacaoAxe(page, 'plano: encerrar');
    await form.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByTestId('mensagem-contrato')).toContainText('Plano alterado');
    await expect(page.getByTestId('lista-planos')).toContainText('2026-01-01 a 2026-06-30');
    await expect(page.getByTestId('lista-planos')).toContainText('inativo');
  });

  test('motor: credenciamento pelo profissional, portes pelo convênio, Unimed com busca; vigências de diária', async ({
    page,
  }) => {
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/faturamento/credenciamento');
    await page.getByTestId('motor-profissional').fill('sintético b');
    await page.getByTestId('motor-buscar').click();
    await expect(page.getByTestId('tabela-credenciamento')).toContainText('PROFISSIONAL SINTÉTICO B');
    await expect(page.getByTestId('tabela-credenciamento')).not.toContainText('PROFISSIONAL SINTÉTICO A');
    await page.goto('/faturamento/portes-terceiros');
    await escolher(page.getByTestId('motor-convenio'), '305');
    await expect(page.getByTestId('motor-tabela-porte')).toBeDisabled();
    await expect(page.getByTestId('tabela-portes')).toBeVisible();
    await page.getByTestId('unimed-busca').fill('hemograma');
    await page.getByTestId('unimed-busca').press('Enter');
    await expect(page.getByTestId('tabela-unimed')).toContainText('HEMOGRAMA SINTÉTICO');
    await expect(page.getByTestId('tabela-unimed')).not.toContainText('CONSULTA SINTÉTICA');
    await semViolacaoAxe(page, '/faturamento/portes-terceiros');
    await page.goto('/precos/diarias-taxas');
    await page.getByTestId('vigencias-100').click();
    await expect(page.getByTestId('painel-vigencias-valor')).toContainText('2025-01-01');
    await expect(page.getByTestId('painel-vigencias-valor')).toContainText('vigente');
    await semViolacaoAxe(page, 'diárias: vigências');
  });

  test('sem a permissão, não vê os códigos de prestador', async ({ page }) => {
    await entrar(page, 'SINT.FATURISTA');
    await page.goto('/cadastros/convenios/codigos-prestador');
    await expect(page).toHaveURL(/sem-permissao/);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/convenios/codigos-prestador');
    await expect(page.getByTestId('tabela-codigos')).toBeVisible();
    await expect(page.getByTestId('tabela-codigos')).not.toContainText(/senha/i);
    await semViolacaoAxe(page, '/cadastros/convenios/codigos-prestador');
  });
  test('telas de consulta (diárias, mat/med, motor de preços, saneamento, classificações); axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.FATURAMENTO');
    const telas: [string, string][] = [
      ['/precos/diarias-taxas', 'tabela-diarias'],
      ['/precos/matmed', 'tabela-matmed'],
      ['/faturamento/credenciamento', 'tabela-credenciamento'],
      ['/faturamento/de-para-exames', 'tabela-dePara'],
      ['/faturamento/portes-terceiros', 'tabela-portes'],
      ['/precos/saneamento', 'tabela-saneamento'],
    ];
    for (const [rota, tabela] of telas) {
      await page.goto(rota);
      await expect(page.getByTestId(tabela)).toBeVisible();
      await semViolacaoAxe(page, rota);
    }
    await page.goto('/cadastros/convenios/classificacoes-oncologicas');
    await expect(page.getByTestId('grupo-oncologia')).toBeVisible();
    await expect(page.getByTestId('dominio-convenio.classificacaoOncologica')).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/convenios/classificacoes-oncologicas');
    await page.getByTestId('dominio-convenio.faseOncologica').click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Fases oncológicas de operadora' }),
    ).toBeVisible();
    await semViolacaoAxe(page, '/cadastros/dominios/convenio/faseOncologica');
  });
});
