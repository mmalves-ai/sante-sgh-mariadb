// C1-108 (04-INT linha 80): comunicação da internação e da alta à operadora pelo serviço web, pelo caminho da tela. As
// rotas da comunicação exigem o banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as respostas da
// API da comunicação são simuladas pelo Playwright com massa SINTÉTICA. O que se prova é a tela: o atalho na lista de
// internados abre a comunicação da internação, a comunicação nasce pendente, sai pelo serviço web num clique (com a
// versão lida), mostra a situação da fila, o retorno ainda sem resposta avisa e o recibo aceito confirma com o
// protocolo. O efeito no banco (outbox, situação, protocolo, erro, reenvio e recusa) está no contrato de efeito
// (apps/api/src/modulos/adt/comunicacao-operadora-transmissao.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';

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

test.describe('C1-108 comunicação à operadora pelo serviço web @C1-108', () => {
  test('atalho dos internados, envio pelo serviço web e retorno confirmado', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const itens: Record<string, unknown>[] = [];
    let retornos = 0;
    await page.route('**/api/internacao/comunicacoes-operadora/**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      if (req.method() === 'GET') {
        if (url.pathname.endsWith('/mensagem')) return json(r, { xml: '<ans:mensagemTISS/>', problemas: [] });
        return json(r, { itens });
      }
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (/\/internacoes\/\d+$/.test(url.pathname)) {
        itens.unshift({
          id: 801,
          tipo: corpo['tipo'],
          situacao: 'pendente',
          protocolo: null,
          enviadoEm: null,
          respondidoEm: null,
          resposta: null,
          criadoEm: '2026-11-25T10:00:00.000Z',
          versao: 1,
          pelaIntegracao: false,
          situacaoEnvio: null,
        });
        return json(r, { id: 801 }, 201);
      }
      if (url.pathname.endsWith('/transmitir')) {
        Object.assign(itens[0]!, {
          situacao: 'enviada',
          enviadoEm: '2026-11-25T10:01:00.000Z',
          versao: 2,
          pelaIntegracao: true,
          situacaoEnvio: 'pendente',
        });
        return json(r, { id: 801, situacao: 'enviada', mensagem: 9001 });
      }
      if (url.pathname.endsWith('/retorno')) {
        retornos += 1;
        if (retornos === 1) return json(r, { id: 801, situacao: 'enviada', aguardando: true });
        Object.assign(itens[0]!, {
          situacao: 'confirmada',
          protocolo: 'PR-SINT-1',
          respondidoEm: '2026-11-25T10:05:00.000Z',
          versao: 3,
          situacaoEnvio: 'processada',
        });
        return json(r, { id: 801, situacao: 'confirmada', aguardando: false });
      }
      return json(r, { id: 801 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/internacao');
    await expect(page.getByTestId('tela-internados')).toBeVisible();
    const atalho = page.locator('[data-testid^="int-comunicacoes-"]').first();
    await expect(atalho).toBeVisible();
    const reg = ((await atalho.getAttribute('data-testid')) ?? '').replace('int-comunicacoes-', '');
    expect(reg).toMatch(/^\d+$/);
    await atalho.click();
    await expect(page).toHaveURL(new RegExp(`/internacao/${reg}/comunicacoes-operadora$`));
    await expect(page.getByTestId('tela-comunicacao-operadora')).toBeVisible();

    await page.getByTestId('com-op-registrar').click();
    await expect(page.getByTestId('com-op-internacao')).toContainText('Pendente');
    expect(pedidos[0]).toEqual({
      caminho: `/api/internacao/comunicacoes-operadora/internacoes/${reg}`,
      corpo: { tipo: 'internacao' },
    });

    await page.getByTestId('com-op-transmitir-801').click();
    await expect(page.getByTestId('com-op-envio-801')).toContainText('Serviço web: na fila');
    await expect(page.getByTestId('com-op-transmitir-801')).toHaveCount(0);
    expect(pedidos[1]).toEqual({
      caminho: '/api/internacao/comunicacoes-operadora/801/transmitir',
      corpo: { versao: 1 },
    });

    await page.getByTestId('com-op-retorno-801').click();
    await expect(page.getByTestId('com-op-problemas')).toContainText('A operadora ainda não respondeu.');
    await page.getByTestId('com-op-retorno-801').click();
    await expect(page.getByTestId('com-op-internacao')).toContainText('Confirmada');
    await expect(page.getByTestId('com-op-internacao')).toContainText('PR-SINT-1');
    await expect(page.getByTestId('com-op-retorno-801')).toHaveCount(0);
    expect(pedidos.filter((p) => p.caminho.endsWith('/retorno'))).toHaveLength(2);
    await expect(page.getByText('Sem permissão')).toHaveCount(0);
    await semViolacaoAxe(page, `/internacao/${reg}/comunicacoes-operadora`);
  });
});
