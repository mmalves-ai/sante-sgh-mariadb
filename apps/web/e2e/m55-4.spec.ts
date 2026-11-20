// E2E @M55.4 (ficha do M55, seção 10, na parte da etapa 4, DP-13): o processo de pregão até a ata. O agente de
// contratação entra pelo menu (Suprimentos > Compras > Licitação e pregão), abre o termo de referência, emite o termo
// em PDF/A (regra 10), faz a pesquisa de preços com 3 preços, registra o parecer jurídico, publica o aviso com o prazo
// mínimo do art. 55, abre a sessão, registra as propostas, julga, emite a ata em PDF/A e registra a ata. A autoridade
// homologa uma dispensa por valor (o pregão espera o prazo de recurso) e o agente não homologa o que conduz. axe sem
// violação séria em cada tela. Sessão real sobre a fonte sintética de dev e a porta do processo em MEMÓRIA
// (fornecedores SINTÉTICOS 7001 a 7003); o PDF/A real e o Object Lock são provados pela integração
// (licitacao-documento.int.spec.ts: Gotenberg, S3 com trava e veraPDF). Nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const L = '/api/suprimentos/licitacoes';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dia(deslocamento: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function etapa(page: Page): Promise<string | null> {
  return page.getByTestId('lic-det-etapa').getAttribute('data-etapa');
}

async function avancar(page: Page, para: string): Promise<void> {
  await page.getByTestId('lic-det-aba-atos').click();
  await escolher(page.getByTestId('lic-etapa-para'), para);
  await page.getByTestId('lic-etapa-avancar').click();
  await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', para);
}

async function emitirDocumento(page: Page, tipo: 'termo' | 'etapa' | 'ata', nome: string): Promise<void> {
  await page.getByTestId('lic-det-aba-resumo').click();
  const resposta = page.waitForResponse(
    (r) => r.url().endsWith('/documentos') && r.request().method() === 'POST',
  );
  await page.getByTestId(`lic-doc-${tipo}`).click();
  const r = await resposta;
  expect(r.status()).toBe(201);
  const corpo = (await r.json()) as { formato: string; conteudo: string; sha256: string };
  expect(corpo.formato).toBe('pdf');
  expect(Buffer.from(corpo.conteudo, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  expect(corpo.sha256).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId('lic-doc-emitido')).toContainText(`${nome} emitido`);
  await expect(page.getByTestId('lic-doc-abrir')).toHaveAttribute('href', /^blob:/);
}

test.describe('@M55.4 Licitação e pregão', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('pregão: termo → pesquisa (3 preços) → parecer → edital → aviso → sessão → propostas → julgado → ata', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.LICITACAO');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.getByRole('button', { name: /^Suprimentos/ }).click();
    const compras = menu.getByRole('button', { name: /^Compras/ });
    if ((await compras.count()) > 0 && (await compras.first().getAttribute('aria-expanded')) !== 'true')
      await compras.first().click();
    await menu.getByRole('link', { name: 'Licitação e pregão' }).click();
    await expect(page).toHaveURL(/\/suprimentos\/licitacao$/);
    const tela = page.getByTestId('tela-licitacao');
    await expect(tela.getByRole('heading', { level: 1 })).toHaveText('Licitação e pregão');
    await expect(page.getByTestId('lic-painel')).toBeVisible();
    await semViolacaoAxe(page, 'painel da licitação');

    // 1. Termo de referência: pregão eletrônico de bens, menor preço, um item, o agente pela busca.
    const numero = `PE-E2E-${Date.now() % 1_000_000}/2026`;
    await page.getByTestId('lic-novo').click();
    await expect(page.getByTestId('lic-formulario')).toBeVisible();
    await page.getByTestId('lic-numero').fill(numero);
    await page.getByTestId('lic-objeto').fill('Aquisição sintética de luvas de procedimento (teste)');
    await page
      .getByTestId('lic-justificativa')
      .fill('Reposição sintética do estoque do semestre para todos os setores (teste)');
    await page.getByTestId('lic-agente-termo').fill('SINT.LICITACAO');
    await page.getByTestId('lic-agente-buscar').click();
    await escolher(page.getByTestId('lic-agente'), 'SINT.LICITACAO');
    await page.getByTestId('lic-item-desc-1').fill('Luva de procedimento M (sintético)');
    await page.getByTestId('lic-item-un-1').fill('CX');
    await page.getByTestId('lic-item-qtd-1').fill('100');
    await semViolacaoAxe(page, 'termo de referência');
    await page.getByTestId('lic-gravar').click();
    await expect(page.getByTestId('lic-det-painel')).toBeVisible();
    await expect(page.getByTestId('lic-det-painel').getByRole('heading').first()).toContainText(numero);
    expect(await etapa(page)).toBe('planejamento');
    await expect(page.getByTestId('lic-doc-ata')).toBeDisabled();
    await emitirDocumento(page, 'termo', 'Termo de referência');
    await semViolacaoAxe(page, 'processo aberto');

    // 2. Pesquisa de preços: 3 preços do painel oficial (o mínimo do estabelecimento); a mediana fica gravada.
    await avancar(page, 'pesquisa');
    await page.getByTestId('lic-det-aba-pesquisa').click();
    for (const valor of ['9,00', '10,00', '12,00']) {
      await escolher(page.getByTestId('lic-preco-item'), { indice: 0 });
      await escolher(page.getByTestId('lic-preco-fonte'), 'painel');
      await page.getByTestId('lic-preco-ref').fill('Painel de preços (sintético)');
      await page.getByTestId('lic-preco-valor').fill(valor);
      await page.getByTestId('lic-preco-data').fill(dia(-30));
      await page.getByTestId('lic-preco-registrar').click();
      await expect(page.getByTestId('lic-det-mensagem')).toContainText(/preço/i);
    }
    await expect(page.getByTestId('lic-precos-1')).toContainText('12,00');
    await expect(page.getByTestId('lic-conta-total')).toContainText('1.000,00');
    await semViolacaoAxe(page, 'pesquisa de preços');

    // 3. Edital e parecer jurídico favorável (antes da publicação, art. 53).
    await avancar(page, 'edital');
    await escolher(page.getByTestId('lic-ato-tipo'), 'parecer');
    await page.getByTestId('lic-ato-data').fill(dia(-26));
    await escolher(page.getByTestId('lic-ato-parecer'), 'favoravel');
    await page.getByTestId('lic-ato-desc').fill('Edital conforme a lei (sintético)');
    await page.getByTestId('lic-ato-registrar').click();
    await expect(page.getByTestId('lic-det-mensagem')).toContainText('Parecer jurídico registrado');

    // 4. Aviso publicado com a abertura depois do prazo mínimo do art. 55 (8 dias úteis para bens no menor preço).
    await page.getByTestId('lic-det-aba-atos').click();
    await escolher(page.getByTestId('lic-etapa-para'), 'publicado');
    await page.getByTestId('lic-data-pub').fill(dia(-25));
    await expect(page.getByTestId('lic-prazo-minimo')).toContainText('8 dias úteis');
    await page.getByTestId('lic-data-abertura').fill(dia(-2));
    await escolher(page.getByTestId('lic-veiculo'), 'pncp');
    await page.getByTestId('lic-ref-pub').fill('Controle sintético 0001');
    await semViolacaoAxe(page, 'publicação do aviso');
    await page.getByTestId('lic-etapa-avancar').click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'publicado');
    await emitirDocumento(page, 'etapa', 'Registro da etapa');

    // 5. Sessão: duas propostas de fornecedores sintéticos; o menor preço vence.
    await avancar(page, 'sessao');
    await page.getByTestId('lic-det-aba-sessao').click();
    for (const [fornecedor, valor] of [
      ['7001', '9,50'],
      ['7002', '10,00'],
    ] as const) {
      await escolher(page.getByTestId('lic-proposta-item'), { indice: 0 });
      await page.getByTestId('lic-proposta-fornecedor-termo').fill('Sint');
      await page.getByTestId('lic-proposta-fornecedor-buscar').click();
      await escolher(page.getByTestId('lic-proposta-fornecedor'), fornecedor);
      await page.getByTestId('lic-proposta-valor').fill(valor);
      await page.getByTestId('lic-proposta-registrar').click();
      await expect(page.getByTestId('lic-det-mensagem')).toContainText(/proposta/i);
    }
    await expect(page.getByTestId('lic-julg-item-1')).toContainText('ALFA');
    await semViolacaoAxe(page, 'sessão e julgamento');
    await page.getByTestId('lic-julgar').click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'julgado');

    // 6. A ata do julgamento em PDF/A e o registro da ata; a homologação espera o prazo de recurso.
    await emitirDocumento(page, 'ata', 'Ata do julgamento');
    await expect(page.getByTestId('lic-det-acao-homologar')).toHaveAttribute('data-pode', 'false');
    await page.getByTestId('lic-det-aba-atos').click();
    await escolher(page.getByTestId('lic-ato-tipo'), 'ata');
    await page.getByTestId('lic-ato-data').fill(dia(0));
    await page.getByTestId('lic-ato-ref').fill('Ata sintética 1');
    await page.getByTestId('lic-ato-desc').fill('Ata da sessão pública do pregão (sintético)');
    await page.getByTestId('lic-ato-registrar').click();
    await expect(page.getByTestId('lic-det-mensagem')).toContainText('Ata registrada');
    await page.getByTestId('lic-det-aba-historico').click();
    await expect(page.getByTestId('lic-det-evento-ata')).toBeVisible();
    await semViolacaoAxe(page, 'histórico do processo');
    expect(externas).toEqual([]);
  });

  test('dispensa por valor: o agente não homologa o que conduz; a autoridade homologa', async ({ page }) => {
    await entrar(page, 'SINT.LICITACAO');
    let seq = 0;
    const chave = () => `e2e-m554-${Date.now().toString(36)}-${++seq}`;
    const post = async (url: string, data: Record<string, unknown>, esperado = 201) => {
      const k = chave();
      const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
      const r = await page.request.post(url, {
        headers: { 'x-csrf': csrf, 'Idempotency-Key': k },
        data: { ...data, chave: k },
      });
      expect(r.status(), await r.text()).toBe(esperado);
      return (await r.json()) as Record<string, unknown>;
    };
    const versao = async (id: number) =>
      ((await (await page.request.get(`${L}/${id}`)).json()) as { versao: number }).versao;
    const numero = `DL-E2E-${Date.now() % 1_000_000}/2026`;
    const id = (
      await post(L, {
        numero,
        regime: 'lei-14133',
        modalidade: 'dispensa',
        fundamento: 'art. 75, II',
        natureza: 'servico-comum',
        objeto: 'Serviço sintético de calibração de equipamentos (teste)',
        justificativa: 'Calibração anual sintética dos equipamentos do setor (teste)',
        agente: 'SINT.LICITACAO',
        itens: [{ descricao: 'Calibração sintética', unidade: 'UN', quantidade: 1 }],
      })
    ).id as number;
    await post(`${L}/${id}/etapas`, { versao: await versao(id), para: 'pesquisa' });
    const item = ((await (await page.request.get(`${L}/${id}`)).json()) as { itensDetalhe: { id: number }[] })
      .itensDetalhe[0]!.id;
    await post(`${L}/${id}/precos`, {
      versao: await versao(id),
      item,
      fonte: 'fornecedor',
      referencia: 'Cotação sintética',
      valor: 5000,
      data: dia(-1),
      fornecedor: 7001,
    });
    await post(`${L}/${id}/etapas`, {
      versao: await versao(id),
      para: 'sessao',
      justificativaPesquisa: 'Prestador único credenciado (sintético)',
    });
    await post(`${L}/${id}/propostas`, { versao: await versao(id), item, fornecedor: 7001, valor: 4800 });
    await post(`${L}/${id}/etapas`, { versao: await versao(id), para: 'julgado' });
    // O agente não tem a permissão de homologar (e, se tivesse, a segregação de funções recusaria).
    await post(`${L}/${id}/homologacao`, { versao: await versao(id), observacao: null }, 403);

    await entrar(page, 'SINT.AUTORIDADE');
    await page.goto('/suprimentos/licitacao');
    await page.getByTestId('lic-f-termo').fill(numero);
    await page.getByTestId('lic-f-aplicar').click();
    await page.getByTestId(`lic-abrir-${id}`).click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'julgado');
    await page.getByTestId('lic-det-aba-autoridade').click();
    await expect(page.getByTestId('lic-autoridade')).toBeVisible();
    await semViolacaoAxe(page, 'autoridade');
    await page.getByTestId('lic-hom-obs').fill('Homologação sintética da dispensa (teste)');
    await page.getByTestId('lic-homologar').click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'homologado');
    await expect(page.getByTestId('lic-det-mensagem')).toContainText('Processo homologado');
    await emitirDocumento(page, 'ata', 'Ata do julgamento');
    await semViolacaoAxe(page, 'processo homologado');
  });
});
