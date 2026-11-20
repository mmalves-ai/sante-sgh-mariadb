// E2E @M56.1 (ficha do M56, etapa F0; seções 7, 8 e 10 na parte da F0): as chaves da operadora própria nascem
// desligadas em Funcionalidades por estabelecimento (regra 1) → o gestor da operadora vê a situação do módulo e das
// partes em Envios à ANS, consulta os catálogos da ANS (grupos do SIP, procedimentos por grupo do SIP paginados por
// chave e a classificação) → os domínios da operadora no CRUD genérico: um travado só em consulta, um editável com
// inclusão → o administrador do hospital não vê a operadora (perfis próprios, D-PERM-56) → quem consulta os catálogos
// oficiais no hospital abre os catálogos da ANS pelo atalho de TISS/TUSS (D-ANS-HOSPITAL-56); axe sem violação séria. Sessão
// real sobre a fonte sintética de dev, catálogos da ANS e banco de domínios em MEMÓRIA (nada vai à cópia).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const ITEM = 'faturamento.operadora-propria-sgo-se-a-rede-tiver-plano';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('operadora própria, etapa F0: chaves desligadas, catálogos da ANS e domínios @M56.1', () => {
  test.setTimeout(240_000);

  test('funcionalidades desligadas → situação → catálogos da ANS → domínios (travado e editável) → sem perfil; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // Regra 1: o administrador vê a operadora e as 10 partes desligadas no estabelecimento.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    const modulo = page.getByTestId('recurso-operadora');
    // O painel monta a situação de todas as funcionalidades e operações: na VM carregada passa dos 5 s do padrão.
    await expect(modulo).toContainText('Operadora própria', { timeout: 30_000 });
    await expect(modulo).toContainText('Desligada');
    await expect(modulo).toContainText('Registro da operadora na ANS');
    for (const f of ['beneficiarios', 'cobranca', 'mensagens', 'rede', 'autorizacao', 'contas', 'ans'])
      await expect(page.getByTestId(`recurso-operadora.${f}`)).toContainText('Desligada');
    await expect(page.locator('[data-testid^="recurso-operadora"]')).toHaveCount(11);
    // O administrador do hospital não tem perfil da operadora: nem a tela nem o menu dela.
    await page.goto('/operadora/ans');
    await expect(page.getByTestId('tela-operadora-ans')).toHaveCount(0);

    // O gestor da operadora (perfis próprios concedidos nominalmente).
    await entrar(page, 'SINT.OPERADORA');
    await page.goto('/operadora/ans');
    await expect(page.getByRole('heading', { level: 1, name: 'Envios à ANS' })).toBeVisible();
    const chaves = page.getByTestId('operadora-chaves');
    await expect(chaves.locator('tbody tr')).toHaveCount(11);
    await expect(chaves.locator('td[data-situacao="desligada"]')).toHaveCount(11);
    await expect(page.getByTestId('operadora-modulo-desligado')).toBeVisible();
    // M56.7: com o módulo desligado, os envios dizem o motivo e não abrem (POL-3).
    await expect(page.getByTestId('ans-desligada')).toBeVisible();
    // Grupos do SIP: a lista com código e nome (aberta sob demanda).
    await expect(page.getByTestId('operadora-grupos-total')).toContainText('5 grupos do SIP');
    await page.getByTestId('operadora-grupos-total').click();
    const listaGrupos = page.getByTestId('operadora-grupos-lista');
    await expect(listaGrupos.locator('tbody tr')).toHaveCount(5);
    await expect(listaGrupos).toContainText('Terapias (sintético)');
    await semViolacaoAxe(page, '/operadora/ans');

    // Procedimentos do SIP: 200 por página, por chave; a segunda página fecha a lista.
    const tabela = page.getByTestId('operadora-procedimentos');
    await expect(tabela.locator('tbody tr')).toHaveCount(200);
    // O nome do procedimento vem da terminologia TUSS; o código fora dela diz isso.
    await expect(tabela.locator('tbody tr').first()).toContainText('Procedimento sintético 90000001');
    await expect(tabela.locator('tbody tr').nth(9)).toContainText('fora da terminologia TUSS');
    await page.getByTestId('operadora-sip-proxima').click();
    await expect(tabela.locator('tbody tr')).toHaveCount(50);
    await expect(page.getByTestId('operadora-sip-fim')).toContainText('Fim da lista');
    await page.getByTestId('operadora-sip-anterior').click();
    await expect(tabela.locator('tbody tr')).toHaveCount(200);
    // Filtro pelo grupo do SIP (combo com busca) e pelo código.
    await escolher(page.getByTestId('operadora-sip-grupo'), { rotulo: /^3 · Exames/ });
    await page.getByTestId('operadora-sip-filtrar').click();
    await expect(tabela.locator('tbody tr')).toHaveCount(50);
    await expect(tabela.locator('tbody tr').first()).toContainText('Exames (sintético)');
    await page.getByLabel('Código do procedimento').fill('90000003');
    await page.getByTestId('operadora-sip-filtrar').click();
    await expect(tabela.locator('tbody tr')).toHaveCount(1);
    await expect(tabela).toContainText('90000003');
    const classif = page.getByTestId('operadora-classificacoes');
    await expect(classif.locator('tbody tr')).toHaveCount(12);
    // Classificação: busca por trecho do nome e pelo código exato.
    await page.getByLabel('Código ou trecho do nome').fill('terapias');
    await page.getByTestId('operadora-class-buscar').click();
    await expect(classif.locator('tbody tr')).toHaveCount(6);
    await page.getByLabel('Código ou trecho do nome').fill('7');
    await page.getByTestId('operadora-class-buscar').click();
    await expect(classif.locator('tbody tr')).toHaveCount(1);
    await expect(classif).toContainText('classificação sintética 07');
    // Os domínios dos envios embutidos (CRUD genérico do grupo operadora).
    await expect(page.getByTestId('grupo-dominios-operadoraAns')).toContainText('Tipos de prestador IPERGS');

    // Domínios da operadora: o item abre o índice dos domínios do grupo.
    await page.goto(`/consultas/item/${ITEM}.dominios-da-operadora-e-do-plano-proprio`);
    await expect(page.getByTestId('dominio-operadora.tipoMensalidade')).toBeVisible();
    await expect(page.getByTestId('dominio-operadora.tipoCobranca')).toBeVisible();
    await semViolacaoAxe(page, 'domínios da operadora');
    // Travado (regra 6): os tipos de cobrança ao beneficiário só em consulta.
    await page.goto('/cadastros/dominios/operadora/tipoCobrancaBeneficiario');
    await expect(page.getByTestId('tabela-dominio')).toBeVisible();
    await expect(page.getByTestId('botao-incluir')).toHaveCount(0);
    // Editável: incluir um tipo de mensalidade (banco de domínios em memória).
    await page.goto('/cadastros/dominios/operadora/tipoMensalidade');
    await expect(page.getByRole('heading', { level: 1, name: 'Tipos de mensalidade' })).toBeVisible();
    const antes = await page.getByTestId('tabela-dominio').locator('tbody tr').count();
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    await form.getByLabel('Código').fill('77');
    await form.getByLabel('Descrição').fill('Mensalidade sintética E2E');
    await semViolacaoAxe(page, 'inclusão de tipo de mensalidade');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído com o código');
    await expect(page.getByTestId('tabela-dominio').locator('tbody tr')).toHaveCount(antes + 1);

    // D-ANS-HOSPITAL-56: quem consulta os catálogos oficiais no hospital (sem perfil da operadora) abre os catálogos da
    // ANS pelo atalho de TISS/TUSS, mas não a tela de Envios à ANS.
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/catalogos/tuss');
    await page.getByTestId('link-catalogos-ans').click();
    await expect(page).toHaveURL(/\/cadastros\/catalogos\/ans$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Catálogos da ANS' })).toBeVisible();
    await expect(page.getByTestId('operadora-procedimentos').locator('tbody tr')).toHaveCount(200);
    await expect(page.getByTestId('operadora-grupos-total')).toContainText('5 grupos do SIP');
    await semViolacaoAxe(page, '/cadastros/catalogos/ans');
    await page.goto('/operadora/ans');
    await expect(page.getByTestId('tela-operadora-ans')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
