// E2E @C2-002 (F3.7, 06-FAT linha 1): as regras do acordo com a fonte pagadora na tela do contrato. Quem edita o
// contrato abre a aba das tabelas do convênio sintético, escolhe o tipo de regra no combo, vê a validação na hora (o
// percentual fora da faixa aparece no campo e nada é gravado), inclui um teto da conta que só alerta, vê a regra na
// lista como vigente e encerra a vigência numa data futura (nunca antes de hoje; nada se apaga). Fonte sintética;
// axe na seção. As regras do acordo gravam só no banco próprio (sem ele, a API responde 503), e o E2E roda na fonte
// sintética: a leitura e as duas gravações do convênio 305 são servidas pelo spec, com o estado da lista mantido aqui, e
// o corpo de cada gravação é conferido.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

const BASE = '**/api/cadastros/convenios/305/regras-acordo';
const json = (r: Route, corpo: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

interface Teto {
  id: number;
  versao: number;
  inicio: string;
  fim: string | null;
  vigente: boolean;
  abrangencia: string;
  plano: null;
  item: null;
  grupo: null;
  valorTeto: number | null;
  quantidadeMaxima: null;
  ocorrenciasMaximas: number | null;
  acao: string;
  excedenteFonte: null;
  excedentePlano: null;
}

/** Leitura e gravações das regras do convênio 305; devolve os corpos recebidos. */
async function servirRegras(page: Page): Promise<Record<string, unknown>[]> {
  const hoje = new Date().toISOString().slice(0, 10);
  const tetos: Teto[] = [];
  const corpos: Record<string, unknown>[] = [];
  const leitura = () => ({
    data: hoje,
    percentuais: [],
    descontosGrupo: [],
    viasAcesso: [],
    isentos: [],
    tetos,
    altoCusto: [],
  });
  await page.route(BASE, (r) => json(r, leitura()));
  await page.route(`${BASE}/teto`, (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    const e = r.request().postDataJSON() as Record<string, unknown>;
    corpos.push({ incluir: e });
    tetos.push({
      id: 71,
      versao: 1,
      inicio: String(e['vigenciaInicio']),
      fim: (e['vigenciaFim'] as string | null) ?? null,
      vigente: true,
      abrangencia: String(e['abrangencia']),
      plano: null,
      item: null,
      grupo: null,
      valorTeto: (e['valorTeto'] as number | null) ?? null,
      quantidadeMaxima: null,
      ocorrenciasMaximas: (e['ocorrenciasMaximas'] as number | null) ?? null,
      acao: String(e['acao']),
      excedenteFonte: null,
      excedentePlano: null,
    });
    return json(r, { id: 71, encerradas: 0 }, 201);
  });
  await page.route(`${BASE}/teto/71/encerramento`, (r) => {
    const e = r.request().postDataJSON() as Record<string, unknown>;
    corpos.push({ encerrar: e });
    const t = tetos.find((x) => x.id === 71);
    if (t) Object.assign(t, { fim: String(e['vigenciaFim']), versao: t.versao + 1 });
    return json(r, { id: 71 });
  });
  return corpos;
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Regras do acordo com a fonte pagadora @C2-002 @fase3', () => {
  test('validação na hora, incluir teto da conta e encerrar a vigência; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const corpos = await servirRegras(page);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/cadastros/convenios');
    await page.getByTestId('convenios-busca').fill('operadora alfa');
    await page.getByTestId('abrir-convenio-305').click();
    await expect(page.getByRole('heading', { level: 1, name: /Contrato do convênio 305/ })).toBeVisible();
    await page.getByTestId('aba-tabelas').click();
    const secao = page.getByTestId('regras-acordo');
    await expect(secao.getByRole('heading', { name: 'Regras do acordo' })).toBeVisible();
    await expect(secao).not.toContainText(/SPDATA|legado|sistema atual/i);

    // Validação na hora: percentual acima de 999 aparece no campo e o pedido não sai.
    let gravacoes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/regras-acordo\//.test(new URL(r.url()).pathname)) gravacoes++;
    });
    await page.getByTestId('regra-campo-percentual').fill('1000');
    await page.getByTestId('regra-campo-percentual').blur();
    await expect(page.getByTestId('regra-erro-percentual')).toContainText('0 a 999');
    await page.getByTestId('regra-incluir').click();
    expect(gravacoes).toBe(0);

    // Teto da conta que só alerta: não pede item, grupo nem acordo.
    await escolher(page.getByTestId('regras-tipo'), { rotulo: 'Teto de cobrança' });
    await escolher(page.getByTestId('regra-abrangencia'), { rotulo: 'Conta inteira' });
    await escolher(page.getByTestId('regra-acao'), { rotulo: 'Alertar' });
    await page.getByTestId('regra-campo-valorTeto').fill('0');
    await page.getByTestId('regra-campo-valorTeto').blur();
    await expect(page.getByTestId('regra-erro-valorTeto')).toBeVisible();
    await page.getByTestId('regra-campo-valorTeto').fill('25000');
    await expect(page.getByTestId('regra-erro-valorTeto')).toHaveCount(0);
    await semViolacaoAxe(page, 'contrato: regras do acordo');
    await page.getByTestId('regra-incluir').click();
    await expect(page.getByTestId('regras-mensagem')).toContainText('Regra incluída');
    const linha = page.getByTestId('regras-lista').locator('tbody tr', { hasText: 'R$ 25000.00' }).first();
    await expect(linha).toContainText('Conta inteira');
    await expect(linha).toContainText('vigente');
    expect(corpos[0]?.['incluir']).toMatchObject({
      abrangencia: 'conta',
      acao: 'alertar',
      valorTeto: 25000,
      itemId: null,
      grupoId: null,
    });

    // Encerrar numa data futura: o fim muda, a regra continua na lista (nada se apaga).
    await linha.locator('input[type="date"]').fill('2099-12-31');
    await linha.getByRole('button', { name: 'Encerrar' }).click();
    await expect(page.getByTestId('regras-mensagem')).toContainText('Vigência encerrada');
    await expect(
      page.getByTestId('regras-lista').locator('tbody tr', { hasText: 'R$ 25000.00' }).first(),
    ).toContainText('2099-12-31');
    expect(corpos[1]?.['encerrar']).toEqual({ versao: 1, vigenciaFim: '2099-12-31' });
    expect(externas).toEqual([]);
  });
});
