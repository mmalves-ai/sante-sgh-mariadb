// C1-008 (F3.8, 07-FIN linha 63): na ficha do título a pagar, a alteração do título não pago e a devolução ao
// fornecedor. O gestor financeiro (SINT.FIN.GESTOR: lança o título e, pelo perfil, emite a nota de crédito ou débito)
// lança um título de 1.000,00 em uma parcela na porta do financeiro em MEMÓRIA, abre a ficha e altera: duas parcelas
// que não somam o valor avisam na hora e prendem o botão; somando, grava. Depois devolve ao fornecedor parte da parcela:
// o motivo segue a natureza da origem (fornecedor: crédito; hospital: débito) e o valor acima do saldo avisa na hora.
// A rota da alteração e as da nota (`/api/financeiro/pagar/alteracao`, `/api/financeiro/nota-cessao`) só existem no
// banco do cliente (na fonte sintética respondem 503), então este E2E as simula com um estado em memória que segue a
// regra do servidor (soma das parcelas, saldo da parcela, motivo da natureza) e a ficha relida mostra o efeito. O que
// fica no banco é provado nos contratos de efeito `aplicacao/alteracao-titulo-pagar.int.spec.ts` e
// `aplicacao/nota-cessao.int.spec.ts`. Massa SINTÉTICA. Axe nos passos.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

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
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: `urn:sgh:erro:${codigo}`, title: detail, status: 409, detail, codigo }),
  });
const ok = (rota: Route, mensagem: string) => json(rota, { mensagem, repetida: false, ids: {}, avisos: [] });

interface Parcela {
  id: number;
  parcela: number;
  vencimento: string;
  valor: number;
  saldo: number;
  situacao: string;
}

test.describe('financeiro: alterar o título a pagar e devolver ao fornecedor @C1-008 @F3.8', () => {
  test.setTimeout(180_000);

  test('alteração com parcelas conferidas na hora; devolução com motivo da origem e saldo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    const documento = String(800_000 + (Date.now() % 100_000));
    await entrar(page, 'SINT.FIN.GESTOR');
    await page.goto('/financeiro/pagar/titulos');
    await page.getByTestId('tp-novo').click();
    await page.getByTestId('tp-novo-credor').fill('5001');
    await page.getByTestId('tp-novo-documento').fill(documento);
    await page.getByTestId('tp-novo-valor').fill('1000');
    await page.getByTestId('tp-novo-quantas').fill('1');
    await escolher(page.getByTestId('tp-novo-classificacao'), '216.2.1');
    await page.getByTestId('tp-lancar').click();
    await expect(page.getByTestId('tp-mensagem')).toContainText('lançado');
    await page.getByTestId('tp-consultar').click();
    const abrir = page
      .getByTestId('tp-lista')
      .locator('tbody tr', { hasText: documento })
      .first()
      .locator('[data-testid^="tp-abrir-"]');
    const id = Number(((await abrir.getAttribute('data-testid')) ?? '').replace('tp-abrir-', ''));
    expect(id).toBeGreaterThan(0);

    // Estado da alteração e das notas: a ficha relida passa a mostrar o que foi gravado.
    let parcelas: Parcela[] | null = null;
    let referente: string | null = null;
    await page.route(`**/api/financeiro/pagar/titulos/${id}`, async (rota) => {
      const r = await rota.fetch();
      const base = (await r.json()) as Record<string, unknown> & { parcelas: Parcela[] };
      if (!parcelas) parcelas = base.parcelas.map((p) => ({ ...p, saldo: p.saldo ?? p.valor }));
      await json(rota, { ...base, parcelas, ...(referente === null ? {} : { referente }) });
    });
    await page.route('**/api/financeiro/pagar/alteracao/titulos/*', async (rota) => {
      const corpo = rota.request().postDataJSON() as Record<string, unknown>;
      corpos.push({ caminho: 'alteracao', corpo });
      const novas = corpo['parcelas'] as { parcela: number; vencimento: string; valor: number }[] | undefined;
      if (novas) {
        const soma = novas.reduce((s, p) => s + Math.round(p.valor * 100), 0);
        if (soma !== Math.round(Number(corpo['valorDocumento'] ?? 1000) * 100))
          return recusa(rota, 'parcelas-diferentes', 'As parcelas não somam o valor do documento.');
        parcelas = novas.map((p, i) => ({
          id: i === 0 ? id : id + 1000 + i,
          parcela: p.parcela,
          vencimento: p.vencimento,
          valor: p.valor,
          saldo: p.valor,
          situacao: 'aberto',
        }));
      }
      if (typeof corpo['referente'] === 'string') referente = corpo['referente'];
      return ok(rota, 'Título alterado; a alçada foi reaberta.');
    });
    const apoios = {
      motivos: [
        { id: 1, rotulo: 'DEVOLUCAO SINTETICA', natureza: 'credito' },
        { id: 2, rotulo: 'COBRANCA SINTETICA', natureza: 'debito' },
        { id: 3, rotulo: 'AJUSTE SINTETICO', natureza: 'ambos' },
      ],
      motivosCancelamento: [],
      tributos: [],
    };
    await page.route('**/api/financeiro/nota-cessao/**', async (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^.*\/nota-cessao/, '');
      if (req.method() === 'GET') return json(rota, caminho === '/apoios' ? apoios : []);
      const corpo = req.postDataJSON() as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      if (caminho !== '/notas/pagar') return recusa(rota, 'rota-inexistente', 'Rota não simulada.');
      const p = (parcelas ?? []).find((x) => x.id === corpo['parcela']);
      if (!p) return recusa(rota, 'parcela-inexistente', 'A parcela não existe.');
      const valor = Number(corpo['valorItens']);
      if (valor > p.saldo) return recusa(rota, 'acima-do-saldo', 'O ajuste passa do saldo da parcela.');
      p.saldo = Math.round((p.saldo - valor) * 100) / 100;
      return ok(rota, 'Nota 1 emitida e aplicada.');
    });

    await page.goto(`/financeiro/pagar/titulos/${id}`);
    await expect(page.getByTestId('tela-fin-titulo-pagar')).toBeVisible();
    await page.getByTestId('tpd-alterar').click();
    await expect(page.getByTestId('tpa-documento')).toHaveValue(documento);
    await expect(page.getByTestId('tpa-gravar')).toBeDisabled();

    // Duas parcelas que não somam o valor: aviso na hora e botão preso.
    await page.getByTestId('tpa-mais').click();
    await page.getByTestId('tpa-valor-1').fill('600');
    await page.getByTestId('tpa-venc-2').fill('2027-03-10');
    await page.getByTestId('tpa-valor-2').fill('300');
    await expect(page.getByTestId('tpa-aviso')).toContainText('900,00');
    await expect(page.getByTestId('tpa-gravar')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/pagar/titulos/:id (alteração travada)');

    // Somando 1.000,00, grava; a ficha relida mostra as duas parcelas.
    await page.getByTestId('tpa-valor-2').fill('400');
    await page.getByTestId('tpa-referente').fill('REFERENTE SINTETICO');
    await expect(page.getByTestId('tpa-soma')).toContainText('1.000,00');
    await expect(page.getByTestId('tpa-gravar')).toBeEnabled();
    await page.getByTestId('tpa-gravar').click();
    await expect(page.getByTestId('tpd-mensagem')).toContainText('alterado');
    const alteracao = corpos.find((c) => c.caminho === 'alteracao')?.corpo ?? {};
    expect(alteracao['parcelas']).toEqual([
      expect.objectContaining({ parcela: 1, valor: 600 }),
      { parcela: 2, vencimento: '2027-03-10', valor: 400 },
    ]);
    expect(alteracao['referente']).toBe('REFERENTE SINTETICO');
    expect(alteracao).not.toHaveProperty('documento');
    await expect(page.getByTestId('tpd-parcelas').locator('tbody tr')).toHaveCount(2);

    // Devolução ao fornecedor: o motivo segue a natureza; acima do saldo avisa; grava e abate.
    const devolucao = page.getByTestId('tdv-devolucao');
    await expect(devolucao).toBeVisible();
    await escolher(page.getByTestId('tdv-origem'), 'hospital');
    await expect(page.getByTestId('tdv-motivo')).not.toContainText('DEVOLUCAO SINTETICA');
    await escolher(page.getByTestId('tdv-origem'), 'fornecedor');
    await escolher(page.getByTestId('tdv-motivo'), '1');
    await page.getByTestId('tdv-valor').fill('600.01');
    await expect(page.getByTestId('tdv-aviso')).toContainText('600,00');
    await expect(page.getByTestId('tdv-gravar')).toBeDisabled();
    await page.getByTestId('tdv-valor').fill('150');
    await page.getByTestId('tdv-numero').fill('NCS-1');
    await semViolacaoAxe(page, '/financeiro/pagar/titulos/:id (devolução)');
    await page.getByTestId('tdv-gravar').click();
    await expect(page.getByTestId('tpd-mensagem')).toContainText('emitida e aplicada');
    expect(corpos.find((c) => c.caminho === '/notas/pagar')?.corpo).toMatchObject({
      parcela: id,
      direcao: 'recebida',
      natureza: 'credito',
      motivo: 1,
      valorItens: 150,
      numeroDocumento: 'NCS-1',
      aplicar: true,
    });
    await expect(page.getByTestId('tpd-parcelas')).toContainText('450,00');
    expect(externas).toEqual([]);
  });
});
