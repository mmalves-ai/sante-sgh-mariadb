// E2E @C2-015 (05-SUP linha 22): devolução de compra ao fornecedor pelas rotas reais do módulo (o
// DevolucaoFornecedorController registrado no modulo.ts). O almoxarife abre a tela pelo menu (Suprimentos > Compras >
// Devolução ao fornecedor). A porta grava só no banco próprio: na sessão sintética de dev/ci (logins SINT.*, sem o
// núcleo), GET /api/suprimentos/devolucoes-fornecedor responde 503 e a tela mostra o erro sem inventar lista nem
// formulário (primeiro teste). O segundo teste simula as rotas (page.route com respostas sintéticas, sem depender do
// banco) e percorre o ciclo pela tela: busca da nota, quantidade acima do disponível recusada na hora, chave de NF-e
// inválida recusada na hora, "devolver tudo", motivo, prévia do que abate e do que fica pendente, e o corpo do POST
// conferido (com a Idempotency-Key). O efeito no MariaDB (devolução e itens, saída do estoque, nota de crédito aplicada
// e parcela abatida) está em apps/api/src/modulos/suprimentos/devolucao-fornecedor.int.spec.ts. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const B = '/api/suprimentos/devolucoes-fornecedor';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Abre a tela pelo menu e devolve o status da leitura da lista. */
async function abrirPeloMenu(page: Page): Promise<number> {
  const leitura = page.waitForResponse((r) => r.url().endsWith(B) && r.request().method() === 'GET');
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  await menu.getByRole('button', { name: /^Suprimentos/ }).click();
  const compras = menu.getByRole('button', { name: /^Compras/ });
  if ((await compras.getAttribute('aria-expanded')) !== 'true') await compras.click();
  await menu.getByRole('link', { name: 'Devolução ao fornecedor' }).click();
  await expect(page).toHaveURL(/\/suprimentos\/devolucoes-fornecedor$/);
  await expect(page.getByTestId('tela-suprimentos-devolucao-fornecedor')).toBeVisible();
  return (await leitura).status();
}

/** Chave de acesso sintética com o dígito verificador em módulo 11 (UF 35, AAMM 2611, CNPJ 0…01, modelo 55). */
function chaveSintetica(): string {
  const base = `352611${'1'.padStart(14, '0')}55001000000123100000001`;
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return `${base}${resto < 2 ? 0 : 11 - resto}`;
}

test.describe('@C2-015 Devolução de compra ao fornecedor', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('pelo menu; sem o banco do cliente, a tela mostra o erro e não oferece gravação; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.ALMOXARIFE');
    const status = await abrirPeloMenu(page);
    const tela = page.getByTestId('tela-suprimentos-devolucao-fornecedor');
    if (status === 503) {
      await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
      await expect(tela.getByTestId('devf-lista')).toHaveCount(0);
      await expect(tela.getByTestId('devf-registrar')).toHaveCount(0);
    } else {
      expect(status).toBe(200);
    }
    await semViolacaoAxe(page, '/suprimentos/devolucoes-fornecedor');
  });

  test('ciclo pela tela com a API simulada: nota, validação na hora, devolver tudo, prévia e POST; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const json = (rota: Route, corpo: unknown, status = 200) =>
      rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    const devolucoes: Record<string, unknown>[] = [];
    const posts: { corpo: Record<string, unknown>; chave: string | null }[] = [];
    const nota = {
      id: 501,
      numero: 77,
      documento: 'NF 9001/1',
      fornecedor: 'Distribuidora sintética',
      entradaEm: '2026-11-10',
      local: 3,
      localNome: 'Almoxarifado sintético',
      situacao: 'confirmada',
      saldoAPagar: 50,
      itens: [
        {
          notaItem: 9101,
          item: 41,
          nome: 'Luva sintética',
          recebida: 10,
          jaDevolvida: 2,
          disponivel: 8,
          custoUnitario: 5,
          lotes: 'L-SINT-1',
        },
        {
          notaItem: 9102,
          item: 42,
          nome: 'Seringa sintética',
          recebida: 4,
          jaDevolvida: 0,
          disponivel: 4,
          custoUnitario: 2.5,
          lotes: 'L-SINT-2',
        },
      ],
    };
    await page.route(`**${B}**`, async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname === B) {
        const corpo = req.postDataJSON() as Record<string, unknown>;
        posts.push({ corpo, chave: req.headers()['idempotency-key'] ?? null });
        devolucoes.unshift({
          id: 1,
          numero: 'DEV-2026-000001',
          tipo: 'total',
          fornecedor: nota.fornecedor,
          documentoEntrada: nota.documento,
          devolvidaEm: '2026-11-25',
          motivo: 'Avaria sintética',
          numeroNotaFiscal: corpo['numeroNotaFiscal'] ?? null,
          itens: 2,
          valorTotal: 50,
          valorAbatido: 50,
          creditoPendente: 0,
          situacao: 'registrada',
        });
        return json(
          rota,
          {
            id: 1,
            numero: 'DEV-2026-000001',
            tipo: 'total',
            valorTotal: 50,
            valorAbatido: 50,
            creditoPendente: 0,
            notasCredito: '31',
          },
          201,
        );
      }
      if (url.pathname === `${B}/motivos`)
        return json(rota, [{ id: 5, codigo: 'AVA', descricao: 'Avaria sintética', tipoFiscal: 'devolucao' }]);
      if (url.pathname === `${B}/notas`)
        return json(rota, [
          {
            id: nota.id,
            numero: nota.numero,
            documento: nota.documento,
            fornecedor: nota.fornecedor,
            entradaEm: nota.entradaEm,
            valorTotal: 60,
            itensDisponiveis: 2,
          },
        ]);
      if (url.pathname === `${B}/notas/${nota.id}`) return json(rota, nota);
      if (url.pathname === B) return json(rota, devolucoes);
      return rota.fallback();
    });

    await entrar(page, 'SINT.ALMOXARIFE');
    await abrirPeloMenu(page);
    const tela = page.getByTestId('tela-suprimentos-devolucao-fornecedor');
    await expect(tela.getByText('Nenhuma devolução registrada.')).toBeVisible();

    await tela.getByTestId('devf-busca-termo').fill('9001');
    await tela.getByTestId('devf-busca').getByRole('button', { name: 'Buscar' }).click();
    await tela.getByTestId('devf-escolher-501').click();
    await expect(tela.getByTestId('devf-nota')).toContainText('NF 9001/1');
    await expect(tela.getByTestId('devf-saldo')).toContainText('50,00');

    // Validação na hora: acima do disponível e chave inválida travam o registro.
    await tela.getByTestId('devf-q-9101').fill('9');
    await expect(tela.getByText('Passa do disponível (8).')).toBeVisible();
    await expect(tela.getByTestId('devf-registrar')).toBeDisabled();
    await tela.getByTestId('devf-nf-chave').fill('1'.repeat(44));
    await expect(tela.getByTestId('devf-chave-invalida')).toBeVisible();

    await tela.getByTestId('devf-tudo').click();
    await expect(tela.getByTestId('devf-q-9101')).toHaveValue('8');
    await expect(tela.getByTestId('devf-q-9102')).toHaveValue('4');
    await tela.getByTestId('devf-nf-chave').fill(chaveSintetica());
    await expect(tela.getByTestId('devf-chave-invalida')).toHaveCount(0);
    await tela.getByTestId('devf-nf-numero').fill('123');
    await escolher(tela.getByTestId('devf-motivo'), 'Avaria sintética');
    // 8 × 5 + 4 × 2,50 = 50,00: abate tudo no saldo a pagar de 50,00.
    await expect(tela.getByTestId('devf-resumo')).toContainText('50,00');
    await expect(tela.getByTestId('devf-resumo')).toContainText('fica pendente: R$ 0,00');
    await tela.getByTestId('devf-abater').uncheck();
    await expect(tela.getByTestId('devf-resumo')).toContainText('fica pendente: R$ 50,00');
    await tela.getByTestId('devf-abater').check();

    await semViolacaoAxe(page, '/suprimentos/devolucoes-fornecedor');
    await tela.getByTestId('devf-registrar').click();
    await expect(tela.getByTestId('devf-aviso')).toContainText('DEV-2026-000001');
    await expect(tela.getByTestId('devf-lista')).toContainText('DEV-2026-000001');

    expect(posts).toHaveLength(1);
    expect(posts[0]!.chave).toMatch(/^[A-Za-z0-9._:-]{8,80}$/);
    expect(posts[0]!.corpo).toMatchObject({
      nota: 501,
      motivo: 5,
      abaterContasPagar: true,
      numeroNotaFiscal: '123',
      chaveAcesso: chaveSintetica(),
      itens: [
        { notaItem: 9101, quantidade: 8 },
        { notaItem: 9102, quantidade: 4 },
      ],
    });
  });
});
