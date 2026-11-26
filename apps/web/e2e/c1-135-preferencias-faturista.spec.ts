// C1-135 (F3, 06-FAT linha 38): as preferências do faturista e os parâmetros vigentes do faturamento. A tela inicial
// se escolhe pelo combo do padrão da casa; o tamanho das listas é conferido na hora pela mesma regra do domínio que a
// API aplica (conferirPreferenciasFaturista); só o que mudou vai ao servidor, com Idempotency-Key.
// Fonte SINTÉTICA: GET /api/faturamento/parametros e POST /api/faturamento/preferencias são respondidos pelo próprio
// teste (page.route), porque o E2E roda sem banco próprio; o que fica no banco (vigência anterior fechada, histórico,
// só a própria conta, precedência usuário > estabelecimento > rede > padrão) é provado pelo contrato de efeito
// parametros-faturamento.int.spec.ts. Axe.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';
const CATALOGO = [
  { chave: 'faturamento.rotinaDiaria', tipo: 'booleano', padrao: 'true', preferencia: false },
  {
    chave: 'faturamento.preferencia.telaInicial',
    tipo: 'lista',
    padrao: 'contas',
    preferencia: true,
    opcoes: ['contas', 'worklist', 'guias', 'auditoria', 'glosas'],
  },
  {
    chave: 'faturamento.preferencia.itensPorPagina',
    tipo: 'inteiro',
    padrao: '50',
    minimo: 10,
    maximo: 200,
    preferencia: true,
  },
];

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Leitura e gravação sintéticas: a gravação devolve as chaves gravadas e a leitura seguinte já traz o novo valor. */
async function parametrosSinteticos(
  page: Page,
  pedidos: { corpo: unknown; chave: string | null }[],
): Promise<void> {
  const preferencias = { telaInicial: 'contas', itensPorPagina: 50, agruparPorPaciente: false };
  await page.route('**/api/faturamento/parametros', (rota) =>
    rota.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        parametros: {
          rotinaDiaria: true,
          rotinaDiariaHora: 2,
          prazoRecursoGlosaDias: 30,
          fechamentoDiaLimite: 5,
        },
        preferencias,
        catalogo: CATALOGO,
      }),
    }),
  );
  await page.route('**/api/faturamento/preferencias', async (rota) => {
    const corpo = rota.request().postDataJSON() as { preferencias: Record<string, string> };
    pedidos.push({ corpo, chave: rota.request().headers()['idempotency-key'] ?? null });
    const p = corpo.preferencias;
    if (p['faturamento.preferencia.telaInicial'])
      preferencias.telaInicial = p['faturamento.preferencia.telaInicial'];
    if (p['faturamento.preferencia.itensPorPagina'])
      preferencias.itensPorPagina = Number(p['faturamento.preferencia.itensPorPagina']);
    if (p['faturamento.preferencia.agruparPorPaciente'])
      preferencias.agruparPorPaciente = p['faturamento.preferencia.agruparPorPaciente'] === 'true';
    await rota.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ usuario: '1', gravados: Object.keys(p).join(',') }),
    });
  });
}

test.describe('faturamento: preferências do faturista @C1-135', () => {
  test.setTimeout(120_000);

  test('combo da tela inicial, validação na hora, grava só o que mudou e mostra os parâmetros; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const pedidos: { corpo: unknown; chave: string | null }[] = [];
    await parametrosSinteticos(page, pedidos);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/faturamento/preferencias');
    const tela = page.getByTestId('tela-preferencias-faturista');
    await expect(tela).toBeVisible();
    await esperarSemSelectNativo(tela);

    // Parâmetros do estabelecimento só para leitura.
    await expect(page.getByTestId('parametro-rotina-diaria')).toContainText('2h');
    await expect(page.getByTestId('parametro-prazo-recurso')).toContainText('30 dia');
    await expect(page.getByTestId('parametro-fechamento')).toContainText('dia 5');

    // Nada mudou: o botão fica desligado.
    const gravar = page.getByTestId('preferencias-gravar');
    await expect(page.getByTestId('preferencias-sem-mudanca')).toBeVisible();
    await expect(gravar).toBeDisabled();

    // Validação na hora: fora da faixa do catálogo.
    const itens = page.getByTestId('preferencias-itens-por-pagina');
    await itens.fill('500');
    await expect(page.getByTestId('preferencias-erro-itens')).toContainText('10 a 200');
    await expect(gravar).toBeDisabled();
    await itens.fill('100');
    await expect(page.getByTestId('preferencias-erro-itens')).toHaveCount(0);

    await escolher(page.getByTestId('preferencias-tela-inicial'), { rotulo: 'Glosas' });
    await esperarValor(page.getByTestId('preferencias-tela-inicial'), 'glosas');
    await page.getByTestId('preferencias-agrupar-paciente').check();
    await expect(gravar).toBeEnabled();
    await semViolacaoAxe(page, '/faturamento/preferencias');
    await gravar.click();
    await expect(page.getByTestId('preferencias-gravado')).toBeVisible();

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.chave).toBeTruthy();
    expect(pedidos[0]!.corpo).toEqual({
      preferencias: {
        'faturamento.preferencia.telaInicial': 'glosas',
        'faturamento.preferencia.itensPorPagina': '100',
        'faturamento.preferencia.agruparPorPaciente': 'true',
      },
    });
    // Recarregada, a tela mostra o gravado e volta a não ter mudança.
    await page.reload();
    await esperarValor(page.getByTestId('preferencias-tela-inicial'), 'glosas');
    await expect(itens).toHaveValue('100');
    await expect(gravar).toBeDisabled();
    expect(externas).toEqual([]);
  });
});
