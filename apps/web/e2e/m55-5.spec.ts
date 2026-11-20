// E2E @M55.5 (ficha do M55, seção 10, na parte da etapa 5): contratualização SUS. O analista abre a tela pelo menu
// (Faturamento > Faturamento SUS > Contratualização SUS), cadastra o contrato com o gestor (esfera, vigência, CNES,
// habilitação, orçamento pré-fixado e um incentivo), confere os requisitos da regra 11, cadastra a meta quantitativa
// (grupo SIGTAP achado pela busca) e a qualitativa (indicador sim ou não), abre o painel produção × meta da competência
// fechada, registra a apuração das duas e confere o repasse por parte com as parcelas impressas; abre as tabelas de
// apoio. O perfil de consulta lê e não grava (nem a tela, nem a API). axe sem violação séria em cada tela.
// Sessão real sobre a fonte sintética de dev e a porta da contratualização em MEMÓRIA (procedimentos SIGTAP e produção
// SINTÉTICOS); nenhum dado de pessoa.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
/** A chave de idempotência da tentativa recusada (a consulta não cadastra). */
const CHAVE_RECUSA = ['e2e', 'm555', 'recusa'].join('-');

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const p2 = (x: number) => String(x).padStart(2, '0');
function dia(deslocamento: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
/** A competência anterior à atual no formato do campo mês (AAAA-MM): a última fechada. */
function competenciaAnteriorCampo(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
}

/** A linha do painel produção × meta da meta com esta descrição. */
function linhaDoPainel(page: Page, descricao: string): Locator {
  return page.locator('[data-testid^="ps-meta-"]').filter({ hasText: descricao });
}

async function apurar(page: Page, descricao: string, realizado?: string): Promise<void> {
  const linha = linhaDoPainel(page, descricao);
  await linha.locator('[data-testid^="ps-apurar-"]').click();
  if (realizado !== undefined) await linha.locator('[data-testid^="ps-realizado-campo-"]').fill(realizado);
  await linha.locator('[data-testid^="ps-confirmar-"]').click();
  await expect(page.getByTestId('cd-mensagem')).toBeVisible();
  await expect(linhaDoPainel(page, descricao).locator('[data-testid^="ps-apurar-"]')).toHaveCount(0);
}

async function corrigir(page: Page, descricao: string, antes: string, depois: string): Promise<void> {
  const linha = linhaDoPainel(page, descricao);
  await linha.locator('[data-testid^="ps-corrigir-"]').click();
  const campo = linha.locator('[data-testid^="ps-realizado-campo-"]');
  await expect(campo).toHaveValue(antes);
  await campo.fill(depois);
  await linha.locator('[data-testid^="ps-confirmar-"]').click();
  await expect(page.getByTestId('cd-mensagem')).toHaveText('Apuração do período corrigida.');
  await expect(linhaDoPainel(page, descricao).locator('[data-testid^="ps-corrigir-"]')).toBeEnabled();
}

test.describe('@M55.5 Contratualização SUS', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('o perfil de consulta lê a lista e não cadastra contrato (nem a tela, nem a API)', async ({
    page,
  }) => {
    await entrar(page, 'SINT.CONTRATUALIZACAO.CONSULTA');
    expect((await page.request.get('/api/faturamento/sus/contratualizacao')).status()).toBe(200);
    const recusa = await page.request.post('/api/faturamento/sus/contratualizacao/contratos', {
      headers: { 'Idempotency-Key': CHAVE_RECUSA },
      data: {
        numero: 'SUS-E2E-RECUSA',
        esfera: 2,
        gestor: 'Gestor sintético',
        objeto: 'Recusa sintética',
        inicio: dia(-30),
        fim: dia(300),
        valorPreMensalCentavos: 100,
        valorPosMensalCentavos: 0,
        chave: CHAVE_RECUSA,
      },
    });
    expect(recusa.status()).toBe(403);
    await page.goto('/faturamento/sus/contratualizacao');
    await expect(page.getByTestId('tela-contratualizacao')).toBeVisible();
    await expect(page.getByTestId('ct-fonte')).toBeVisible();
    await expect(page.getByTestId('ct-novo')).toBeDisabled();
    await semViolacaoAxe(page, 'contratualização em consulta');
  });

  test('contrato → metas quantitativa e qualitativa → painel → apuração → repasse; tabelas de apoio', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.CONTRATUALIZACAO');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu
      .getByRole('button', { name: /^Faturamento$|^Faturamento\b/ })
      .first()
      .click();
    const sus = menu.getByRole('button', { name: /^Faturamento SUS/ });
    if ((await sus.count()) > 0 && (await sus.first().getAttribute('aria-expanded')) !== 'true')
      await sus.first().click();
    await menu.getByRole('link', { name: 'Contratualização SUS' }).click();
    await expect(page).toHaveURL(/\/faturamento\/sus\/contratualizacao$/);
    const tela = page.getByTestId('tela-contratualizacao');
    await expect(tela.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('ct-desligado')).toHaveCount(0);
    await semViolacaoAxe(page, 'lista dos contratos SUS');

    // 1. Cadastro do contrato: esfera estadual, vigência que cobre a competência fechada, CNES (o do estabelecimento
    // quando sugerido), habilitação válida, R$ 100.000,00 pré-fixados por mês e um incentivo de R$ 5.000,00.
    const numero = `SUS-E2E-${Date.now() % 1_000_000}`;
    await page.getByTestId('ct-novo').click();
    await expect(page.getByTestId('cs-formulario')).toBeVisible();
    await page.getByTestId('cs-numero').fill(numero);
    await escolher(page.getByTestId('cs-esfera'), '2');
    await page.getByTestId('cs-gestor').fill('Secretaria Estadual de Saúde Sintética');
    await page
      .getByTestId('cs-objeto')
      .fill('Contratualização sintética de serviços ambulatoriais e hospitalares');
    await page.getByTestId('cs-inicio').fill(dia(-120));
    await page.getByTestId('cs-fim').fill(dia(240));
    const cnes = page.getByTestId('cs-cnes');
    if (!(await cnes.inputValue())) await cnes.fill('1234567');
    await page.getByTestId('cs-habilitacao').fill('Habilitação sintética de alta complexidade');
    await page.getByTestId('cs-hab-validade').fill(dia(365));
    await expect(page.getByTestId('cs-conflito')).toBeVisible();
    await page.getByTestId('cs-pre').fill('100.000,00');
    await page.getByTestId('cs-incentivo-adicionar').click();
    await page.getByTestId('cs-incentivo-0-nome').fill('Incentivo sintético de qualificação');
    await page.getByTestId('cs-incentivo-0-valor').fill('5.000,00');
    await expect(page.getByTestId('cs-faltam')).toHaveCount(0);
    await expect(page.getByTestId('cs-conflito')).toHaveCount(0);
    await semViolacaoAxe(page, 'cadastro do contrato SUS');
    await page.getByTestId('cs-gravar').click();
    const det = page.getByTestId('cd-contrato');
    await expect(det).toBeVisible();
    await expect(det.getByRole('heading').first()).toContainText(numero);
    await expect(page.getByTestId('cd-situacao')).toHaveText('Ativo');
    await expect(page.getByTestId('cd-requisitos')).toContainText('podem ser apuradas');
    await expect(page.getByTestId('cd-incentivos')).toContainText('5.000,00');
    await expect(page.getByTestId('cd-sem-metas')).toBeVisible();
    await semViolacaoAxe(page, 'contrato SUS aberto');

    // 2. Meta quantitativa mensal: grupo 03 (procedimentos clínicos) achado pela busca, 150 por competência.
    const anterior = competenciaAnteriorCampo();
    await page.getByTestId('cd-nova-meta').click();
    await expect(page.getByTestId('ms-formulario')).toBeVisible();
    await page.getByTestId('ms-descricao').fill('Procedimentos clínicos sintéticos');
    await page.getByTestId('ms-inicio').fill(anterior);
    await page.getByTestId('ms-termo').fill('Consulta');
    await page.getByTestId('ms-buscar').click();
    await escolher(page.getByTestId('ms-sigtap-achado'), '0301010072');
    await expect(page.getByTestId('ms-sigtap')).toHaveValue('03');
    await page.getByTestId('ms-valor').fill('150');
    await semViolacaoAxe(page, 'meta quantitativa');
    await page.getByTestId('ms-gravar').click();
    await expect(page.getByTestId('cd-lista-metas')).toContainText('Procedimentos clínicos sintéticos');

    // 3. Meta qualitativa mensal: indicador de qualidade da assistência, sim ou não (meta 1).
    await page.getByTestId('cd-nova-meta').click();
    await expect(page.getByTestId('ms-formulario')).toBeVisible();
    await escolher(page.getByTestId('ms-tipo'), 'qualitativa');
    await page.getByTestId('ms-descricao').fill('Comissão de prontuários sintética ativa');
    await page.getByTestId('ms-inicio').fill(anterior);
    await escolher(page.getByTestId('ms-indicador'), '2');
    await escolher(page.getByTestId('ms-formato'), '2');
    await escolher(page.getByTestId('ms-afericao'), '1');
    await page.getByTestId('ms-valor').fill('1');
    await expect(page.getByTestId('ms-faltam')).toHaveCount(0);
    await semViolacaoAxe(page, 'meta qualitativa');
    await page.getByTestId('ms-gravar').click();
    await expect(page.getByTestId('cd-lista-metas')).toContainText('Comissão de prontuários sintética ativa');

    // 4. Painel produção × meta da competência fechada: a quantitativa já tem o realizado da produção; a qualitativa
    // espera o resultado e o total do repasse fica pendente.
    const painel = page.getByTestId('ps-painel');
    await expect(painel).toBeVisible();
    await expect(page.getByTestId('ps-competencia')).toHaveValue(anterior);
    await expect(page.getByTestId('ps-fonte')).toBeVisible();
    const quanti = linhaDoPainel(page, 'Procedimentos clínicos sintéticos');
    await expect(quanti.locator('[data-testid^="ps-realizado-"]').first()).not.toContainText('Sem resultado');
    await expect(page.getByTestId('ps-total')).toContainText('Pendente');
    await semViolacaoAxe(page, 'painel produção × meta');

    // 5. Apuração: a quantitativa pela produção, a qualitativa com o resultado "sim" (1) → escore ótimo.
    await apurar(page, 'Procedimentos clínicos sintéticos');
    await apurar(page, 'Comissão de prontuários sintética ativa', '1');
    const quali = linhaDoPainel(page, 'Comissão de prontuários sintética ativa');
    await expect(quali.locator('[data-testid^="ps-escore-"]')).toHaveText('Ótimo');
    await expect(page.locator('[data-testid^="cd-apuracao-"]')).toHaveCount(2);

    // 5b. Correção da apuração registrada pela versão dela: a qualitativa reabre preenchida, passa a "não" (0) e a
    // linha muda de escore; depois volta a "sim". Continua uma apuração por meta (a correção substitui, não duplica).
    await corrigir(page, 'Comissão de prontuários sintética ativa', '1', '0');
    await expect(quali.locator('[data-testid^="ps-escore-"]')).not.toHaveText('Ótimo');
    await corrigir(page, 'Comissão de prontuários sintética ativa', '0', '1');
    await expect(quali.locator('[data-testid^="ps-escore-"]')).toHaveText('Ótimo');
    await expect(page.locator('[data-testid^="cd-apuracao-"]')).toHaveCount(2);

    // 6. Repasse por parte com as parcelas: as duas partes do pré-fixado e o total já sem pendência.
    const repasse = page.getByTestId('ps-repasse');
    await expect(repasse).toBeVisible();
    await expect(page.getByTestId('ps-parte-quantitativa')).toBeVisible();
    await expect(page.getByTestId('ps-parte-qualitativa')).toBeVisible();
    await expect(page.getByTestId('ps-total')).not.toContainText('Pendente');
    await expect(page.getByTestId('ps-total')).toContainText('R$');
    await semViolacaoAxe(page, 'repasse estimado');

    // 7. Tabelas de apoio com os nomes do produto (sem o nome das tabelas).
    await page.getByTestId('cd-voltar').click();
    await expect(page.getByTestId('ct-lista')).toContainText(numero);
    await page.getByTestId('ct-visao-dominios').click();
    const dominios = page.getByTestId('ds-dominios');
    await expect(dominios).toContainText('Escores');
    await expect(dominios).not.toContainText('CMESCORE');
    await semViolacaoAxe(page, 'tabelas de apoio');
    expect(externas).toEqual([]);
  });
});
