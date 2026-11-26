// E2E C3-013 (04-INT linha 78): a regulação estadual lê o de-para das situações aprovado pelo NIR. O cartão mostra a
// situação do pedido equivalente ao estado do NIR; o aviso conta as linhas do de-para ainda "a confirmar"; a regulação
// autorizada no pedido em análise refina a situação para "Regulado" sem mudar o estado do NIR; a regulação autorizada no
// pedido ainda não analisado deixa o pedido como está. axe sem violação séria. Sessão real sobre a fonte sintética e as
// portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia). Escrito, não rodado (roda na integração).
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaAba(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const p = await ctx.newPage();
  await entrar(p, login);
  return p;
}

let sequencia = 0;
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return (page.request as APIRequestContext).post(url, {
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-c3013-${Date.now()}-${++sequencia}` },
    data: data as object,
  });
}

async function solicitar(med: Page, paciente: number): Promise<number> {
  const s = await postar(med, '/api/nir/solicitacoes', {
    origem: 'eletiva',
    paciente,
    prioridade: 'urgente',
    perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
    clinica: 'M',
    justificativa: 'Indicação sintética: vaga regulada pela central (de-para)',
  });
  expect(s.status(), await s.text()).toBe(201);
  return Number((await s.json()).id);
}

async function registrar(page: Page, sol: number, numero: string, situacao?: string): Promise<void> {
  await page.getByTestId(`abrir-regulacao-${sol}`).click();
  await expect(page.getByTestId(`form-regulacao-${sol}`)).toBeVisible();
  const campo = page.getByLabel('Número da regulação');
  if (await campo.isEditable()) await campo.fill(numero);
  if (situacao) await escolher(page.getByTestId('reg-situacao'), situacao);
  await page.getByTestId('salvar-regulacao').click();
  await expect(page.getByTestId('regulacao-mensagem')).toContainText('registrada');
}

test.describe('C3-013: a regulação pelo de-para aprovado do NIR', () => {
  test('situação do pedido pelo de-para; autorizada em análise vira "Regulado"; fora do estado fica como está; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    const med = await novaAba(browser, 'SINT.MEDICO.NIR');
    const emAnalise = await solicitar(med, 1003);
    const naoAnalisada = await solicitar(med, 1004);
    await med.context().close();

    await entrar(page, 'SINT.INTERNACAO');
    const t = await postar(page, `/api/nir/solicitacoes/${emAnalise}/transicoes`, {
      acao: 'analisar',
      estadoVisto: 'solicitado',
    });
    expect(t.status(), await t.text()).toBe(200);

    await page.goto('/internacao/nir/regulacao');
    await expect(page.getByTestId('tela-regulacao')).toBeVisible();
    // A proposta do de-para tem linhas "a confirmar": o aviso conta quantas o registro não usa.
    await expect(page.getByTestId('regulacao-depara')).toContainText('a confirmar');
    const cartao = page.getByTestId(`regulacao-${emAnalise}`);
    await expect(cartao.getByTestId('regulacao-situacao-pedido')).toContainText('Situação do pedido:');
    await expect(cartao.getByTestId('regulacao-situacao-pedido')).not.toContainText('sem correspondente');
    await semViolacaoAxe(page, '/internacao/nir/regulacao (de-para)');

    // Solicitada e depois autorizada pela central: no pedido em análise, a situação vira "Regulado".
    // O rótulo da situação vem do cadastro do estabelecimento (na fonte sintética, em maiúsculas como no cadastro de
    // origem): a conferência é do nome da situação, sem depender da caixa.
    await registrar(page, emAnalise, 'rj-2026-013013');
    await expect(page.getByTestId('regulacao-mensagem')).toContainText(
      /Situação do pedido: Aguardando regulação\./i,
    );
    await registrar(page, emAnalise, 'rj-2026-013013', 'autorizada');
    await expect(page.getByTestId('regulacao-mensagem')).toContainText(/Situação do pedido: Regulado\./i);
    await expect(cartao.getByTestId('regulacao-vigente')).toContainText('Autorizada');
    // A regulação nunca move o estado do NIR: o pedido segue em análise na tela da regulação.
    const tela = await (await page.request.get('/api/nir/regulacao')).json();
    const linha = tela.solicitacoes.find((x: { solicitacao: number }) => x.solicitacao === emAnalise);
    expect(linha.estadoSolicitacao).toBe('em_analise');
    expect(tela.depara.aConfirmar).toBeGreaterThan(0);

    // O pedido ainda não analisado: a autorização não refina a situação (o de-para leva "Regulado" à análise).
    await registrar(page, naoAnalisada, 'rj-2026-013014', 'autorizada');
    await expect(page.getByTestId('regulacao-mensagem')).not.toContainText('Situação do pedido');
    await semViolacaoAxe(page, '/internacao/nir/regulacao (registrada)');
    expect(externas).toEqual([]);
  });
});
