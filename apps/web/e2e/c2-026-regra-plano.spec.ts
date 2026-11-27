// E2E @C2-026 (F7, 02-CAD linha 24): a regra própria do plano da fonte pagadora na recepção. Quem edita o contrato abre
// a tela, escolhe a fonte sintética, vê a validação do domínio na hora (teto sem período e
// pendência sem motivo travam, sem pedido ao servidor), grava uma regra com início futuro (não muda as aberturas de
// hoje), vê a linha na tabela e encerra a vigência dela no mesmo dia (nada se apaga: a linha continua). A prévia da
// crítica da abertura (conta da supervisão da recepção) responde sem gravar. Fonte sintética; axe na tela.
// A regra do plano fica no banco do estabelecimento, e o E2E roda com a fonte sintética sem núcleo (503 sem banco). Por
// isso as rotas /api/atendimento/regras-plano são simuladas pelo Playwright com massa SINTÉTICA e estado em memória; o
// que se prova é a tela (validação na hora, corpo enviado, tabela, encerramento, prévia). O efeito no banco está no
// contrato de efeito apps/api/src/modulos/atendimento/regra-plano.int.spec.ts.
import { expect, test, type Page, type Route } from '@playwright/test';
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

const json = (route: Route, corpo: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const FONTE = { id: 7, rotulo: 'OPERADORA ALFA SINTETICA' };

/** Simula as rotas da regra do plano com estado em memória; devolve os corpos das gravações. */
async function simularRegrasPlano(page: Page): Promise<Record<string, unknown>[]> {
  const corpos: Record<string, unknown>[] = [];
  const regras: Record<string, unknown>[] = [];
  await page.route('**/api/atendimento/regras-plano**', async (route) => {
    const req = route.request();
    const caminho = new URL(req.url()).pathname;
    if (caminho.endsWith('/fontes')) return json(route, [FONTE]);
    if (caminho.endsWith('/servicos')) return json(route, []);
    if (caminho.endsWith('/previa')) {
      return json(route, {
        bloqueios: [],
        alertas: [{ codigo: 'carteira', campo: 'carteira', mensagem: 'Carteira fora do padrão do plano.' }],
        documentos: [],
        orientacao: null,
        regraId: null,
        atendimentosNoPeriodo: 0,
      });
    }
    if (req.method() === 'GET') {
      return json(route, { fonte: FONTE, hoje: '2026-11-26', planos: [], categorias: [], regras });
    }
    const corpo = req.postDataJSON() as Record<string, unknown>;
    corpos.push(corpo);
    if (corpo['acao'] === 'encerrar') {
      const r = regras.find((x) => x['id'] === corpo['id']);
      if (r) Object.assign(r, { vigenciaFim: corpo['vigenciaFim'], versao: Number(r['versao']) + 1 });
      return json(route, {
        ok: true,
        mensagem: 'Vigência da regra encerrada.',
        resultado: { id: corpo['id'], versao: 2 },
      });
    }
    const resto = { ...corpo };
    delete resto['acao'];
    delete resto['todasUnidades'];
    const id = 100 + regras.length;
    regras.push({
      ...resto,
      id,
      versao: 1,
      fontePagadoraId: corpo['fonteId'],
      estabelecimentoId: null,
      vigente: false,
    });
    return json(route, { ok: true, mensagem: 'Regra do plano gravada.', resultado: { id, versao: 1 } }, 201);
  });
  return corpos;
}

/** Uma data futura diferente a cada execução (a regra nova encerra a anterior da mesma chave na véspera). */
function dataFutura(): string {
  const d = new Date(Date.UTC(2091, 0, 1) + Math.floor(Math.random() * 3_000) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test.describe('Regra do plano da fonte pagadora na recepção @C2-026 @fase7', () => {
  test('validação na hora, regra gravada e encerrada, prévia sem gravar; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    const corpos = await simularRegrasPlano(page);
    await entrar(page, 'SINT.FATURAMENTO');
    await page.goto('/recepcao/atendimento/regras-plano');
    const tela = page.getByTestId('tela-regras-plano');
    await expect(tela.getByRole('heading', { level: 1, name: 'Regras do plano na recepção' })).toBeVisible();
    await expect(tela).not.toContainText(/SPDATA|legado|sistema atual/i);

    let gravacoes = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/atendimento/regras-plano') gravacoes++;
    });

    await escolher(page.getByTestId('rp-fonte'), { rotulo: /alfa/i });
    await expect(page.getByTestId('rp-form')).toBeVisible();

    // Teto sem período e pendência sem motivo: os erros aparecem no campo e o pedido não sai.
    await page.getByTestId('rp-campo-tetoAtendimentos').fill('4');
    await expect(page.getByTestId('rp-erro-tetoAtendimentos')).toContainText('teto e o período juntos');
    await escolher(page.getByTestId('rp-pendencia'), { rotulo: 'Alerta' });
    await expect(page.getByTestId('rp-erro-pendenciaMotivo')).toContainText('motivo da pendência');
    await page.getByTestId('rp-gravar').click({ force: true });
    expect(gravacoes).toBe(0);

    // Corrige: período do teto, motivo, carteira exigida com prefixo, início futuro.
    await page.getByTestId('rp-campo-tetoPeriodoDias').fill('30');
    await page.getByTestId('rp-campo-pendenciaMotivo').fill('Contrato em revisão de cobertura');
    await page.getByTestId('rp-exigeCarteira').click();
    await page.getByTestId('rp-campo-prefixoCarteira').fill('ALF');
    const inicio = dataFutura();
    await page.getByTestId('rp-campo-vigenciaInicio').fill(inicio);
    await expect(page.getByTestId('rp-erro-tetoAtendimentos')).toHaveCount(0);
    await expect(page.getByTestId('rp-erro-pendenciaMotivo')).toHaveCount(0);
    await expect(page.getByTestId('rp-erro-prefixoCarteira')).toHaveCount(0);
    await semViolacaoAxe(page, 'regras do plano na recepção');

    await page.getByTestId('rp-gravar').click();
    await expect(page.getByTestId('rp-mensagem')).toContainText('Regra do plano gravada');
    expect(gravacoes).toBe(1);
    expect(corpos[0]).toMatchObject({
      acao: 'incluir',
      fonteId: FONTE.id,
      tetoAtendimentos: 4,
      tetoPeriodoDias: 30,
      pendenciaMotivo: 'Contrato em revisão de cobertura',
      exigeCarteira: true,
      prefixoCarteira: 'ALF',
      vigenciaInicio: inicio,
    });
    const br = inicio.split('-').reverse().join('/');
    const linha = page.getByTestId('rp-tabela').locator('tr', { hasText: br }).first();
    await expect(linha).toContainText('4 em 30 dias');
    await expect(linha).toContainText('Contrato em revisão de cobertura');

    // Encerra a vigência no próprio início: a linha continua na tabela, com o fim.
    await linha.getByRole('button', { name: 'Encerrar' }).click();
    await page.getByTestId('rp-encerrar-data').fill(inicio);
    await page.getByTestId('rp-encerrar-confirmar').click();
    await expect(page.getByTestId('rp-mensagem')).toContainText('Vigência da regra encerrada');
    expect(gravacoes).toBe(2);
    expect(corpos[1]).toMatchObject({ acao: 'encerrar', fonteId: FONTE.id, versao: 1, vigenciaFim: inicio });
    await expect(page.getByTestId('rp-tabela').locator('tr', { hasText: `${br} a ${br}` })).toHaveCount(1);

    // A prévia da crítica é da supervisão da recepção (lê o contrato e abre atendimento); o faturamento edita o
    // contrato sem abrir atendimento e não vê a prévia (segregação). Troca de conta e confere sem gravar nada.
    await expect(page.getByTestId('rp-previa-carteira')).toHaveCount(0);
    await page.context().clearCookies();
    await entrar(page, 'SINT.RECEPCAO.SUPERVISAO');
    await page.goto('/recepcao/atendimento/regras-plano');
    await escolher(page.getByTestId('rp-fonte'), { rotulo: /alfa/i });
    await expect(page.getByTestId('rp-form')).toHaveCount(0);
    await page.getByTestId('rp-previa-carteira').fill('X1');
    await page.getByTestId('rp-previa-conferir').click();
    await expect(page.getByTestId('rp-previa-resultado')).toBeVisible();
    expect(gravacoes).toBe(2);
    expect(externas).toEqual([]);
  });
});
