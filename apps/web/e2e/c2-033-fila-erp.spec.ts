// C2-033 (08-INTG linha 136): fila com o ERP corporativo, pelo caminho da tela. As rotas /api/integracoes/erp exigem o
// banco próprio, e o E2E roda com a fonte sintética (sem núcleo); por isso as respostas destas rotas são simuladas pelo
// Playwright com massa SINTÉTICA. O que se prova é a tela: o sistema vem escolhido quando há um só; o período invertido
// mostra o erro na hora e trava o botão; o lote gerado vai com tipo, sistema e período; o envio vai com a versão lida e
// o retorno de cada item (aceito com chave, rejeitado com mensagem) aparece nos itens; a conciliação vai com o total
// informado; o cancelamento pede o motivo (curto trava o botão). O efeito no banco (lote, itens, retorno idempotente,
// conciliação, cancelamento sem apagar) está no contrato de efeito
// apps/api/src/modulos/integracao/fila-erp-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarValor } from './combos.js';

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

const lote = (id: number, numero: string, situacao: string, extra: Record<string, unknown> = {}) => ({
  id,
  numero,
  tipo: 'estoque',
  situacao,
  sistema: 'erp-sint',
  sistemaNome: 'ERP Sintético',
  inicio: '2026-10-01',
  fim: '2026-10-31',
  quantidade: 2,
  erros: 0,
  valorTotal: 150.5,
  protocolo: null,
  geradoEm: '2026-11-25T10:00:00.000Z',
  enviadoEm: null,
  processadoEm: null,
  conciliadoEm: null,
  observacao: null,
  versao: 1,
  ...extra,
});
const item = (sequencia: number, situacao: string, chave: string | null, mensagem: string | null) => ({
  id: 900 + sequencia,
  sequencia,
  entidade: 'movimento_estoque',
  entidadeId: 50 + sequencia,
  documento: `MOV-${50 + sequencia}`,
  data: '2026-10-05',
  valor: sequencia === 1 ? 150.5 : 0,
  situacao,
  chaveExterna: chave,
  mensagem,
});

test.describe('C2-033 fila com o ERP corporativo @C2-033', () => {
  test('gera, envia, vê o retorno por item, concilia e cancela com motivo', async ({ page }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let lotes: Record<string, unknown>[] = [lote(41, 'ERP-41', 'gerado', { tipo: 'pagar', quantidade: 3 })];
    let itens = [item(1, 'pendente', null, null), item(2, 'pendente', null, null)];
    await page.route('**/api/integracoes/erp/**', (r) => {
      const req = r.request();
      const url = new URL(req.url());
      const c = url.pathname.replace('/api/integracoes/erp', '');
      if (req.method() === 'GET') {
        if (c === '/sistemas')
          return json(r, { itens: [{ codigo: 'erp-sint', nome: 'ERP Sintético', ativo: true }] });
        if (c === '/lotes') return json(r, { itens: lotes });
        const id = Number(c.split('/')[2]);
        return json(r, { lote: lotes.find((l) => l['id'] === id), itens });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      pedidos.push({ caminho: url.pathname, corpo });
      if (c === '/lotes') {
        lotes = [lote(42, 'ERP-42', 'gerado'), ...lotes];
        return json(r, { id: 42, numero: 'ERP-42', quantidade: 2, valorTotal: 150.5, jaExportados: 0 }, 201);
      }
      if (c === '/lotes/42/enviar') {
        lotes[0] = lote(42, 'ERP-42', 'processado_com_erro', {
          erros: 1,
          protocolo: 'SIM-ERP-42',
          versao: 3,
        });
        itens = [
          item(1, 'exportado', 'SIM-ERP-42-1', null),
          item(2, 'rejeitado', null, 'Valor zerado ou ausente.'),
        ];
        return json(r, {
          id: 42,
          situacao: 'processado_com_erro',
          alterados: 2,
          repetidos: 0,
          desconhecidos: [],
          conflitos: [],
        });
      }
      if (c === '/lotes/42/conciliar') {
        lotes[0] = lote(42, 'ERP-42', 'conciliado', { erros: 1, protocolo: 'SIM-ERP-42', versao: 4 });
        return json(r, { id: 42, exportados: 1, rejeitados: 1, valorExportado: 150.5 });
      }
      lotes[1] = { ...lotes[1]!, situacao: 'cancelado', versao: 2 };
      return json(r, { id: 41, ignorados: 3 });
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/admin/integracoes/erp');
    await expect(page.getByTestId('tela-fila-erp')).toBeVisible();
    await esperarValor(page.getByTestId('erp-sistema'), 'erp-sint');

    // Período invertido: o erro aparece na hora e o botão fica travado.
    await escolher(page.getByTestId('erp-tipo'), 'estoque');
    await page.getByTestId('erp-inicio').fill('2026-10-31');
    await page.getByTestId('erp-fim').fill('2026-10-01');
    await expect(page.getByTestId('erp-erro-periodo')).toBeVisible();
    await expect(page.getByTestId('erp-gerar')).toBeDisabled();
    await page.getByTestId('erp-inicio').fill('2026-10-01');
    await page.getByTestId('erp-fim').fill('2026-10-31');
    await page.getByTestId('erp-gerar').click();
    await expect(page.getByTestId('erp-aviso')).toContainText('ERP-42');
    expect(pedidos[0]).toMatchObject({
      caminho: '/api/integracoes/erp/lotes',
      corpo: { tipo: 'estoque', sistema: 'erp-sint', inicio: '2026-10-01', fim: '2026-10-31' },
    });

    await page.getByTestId('erp-enviar-42').click();
    await expect(page.getByTestId('erp-situacao-42')).toContainText('rejeições');
    expect(pedidos[1]).toMatchObject({
      caminho: '/api/integracoes/erp/lotes/42/enviar',
      corpo: { versao: 1 },
    });
    await page.getByTestId('erp-abrir-42').click();
    await expect(page.getByTestId('erp-item-42-1')).toContainText('SIM-ERP-42-1');
    await expect(page.getByTestId('erp-item-42-2')).toContainText('Valor zerado');

    await page.getByTestId('erp-conciliar-42').click();
    await page.getByTestId('erp-valor-informado').fill('150,50');
    await page.getByTestId('erp-confirmar-conciliacao').click();
    await expect(page.getByTestId('erp-situacao-42')).toContainText('Conciliado');
    expect(pedidos[2]).toMatchObject({
      caminho: '/api/integracoes/erp/lotes/42/conciliar',
      corpo: { versao: 3, valorInformado: 150.5 },
    });

    await page.getByTestId('erp-cancelar-41').click();
    await page.getByTestId('erp-motivo').fill('curto');
    await expect(page.getByTestId('erp-confirmar-cancelamento')).toBeDisabled();
    await page.getByTestId('erp-motivo').fill('Período reaberto pela controladoria');
    await page.getByTestId('erp-confirmar-cancelamento').click();
    await expect(page.getByTestId('erp-situacao-41')).toContainText('Cancelado');
    expect(pedidos[3]).toMatchObject({
      caminho: '/api/integracoes/erp/lotes/41/cancelar',
      corpo: { versao: 1, motivo: 'Período reaberto pela controladoria' },
    });
    await semViolacaoAxe(page, 'fila-erp');
  });
});
