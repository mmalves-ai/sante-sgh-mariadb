// E2E @C1-132 (ficha docs/fases/fichas/F3.7-faturamento.md, 06-FAT linha 32): a competência de trabalho do faturista.
// Em /faturamento/competencias, o painel "Minha competência de trabalho" mostra que não há escolha (os filtros abrem no
// mês corrente); a competência futura e o período fora do mês são recusados na hora (botão desligado, aviso com o
// motivo), pela mesma regra do domínio do servidor; o mês anterior com período dentro dele é gravado (a Idempotency-Key
// e a versão vão no pedido) e passa a ser o padrão do filtro da competência do convênio. A rota da competência de
// trabalho é simulada pelo Playwright com estado SINTÉTICO (a porta em memória do TISS não a tem); o efeito no banco
// (inclusão, alteração com versão, recusas sem gravar, uma linha por módulo, trilha) está em
// apps/api/src/modulos/tiss/competencia-trabalho-propria.int.spec.ts.
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

/** AAAA-MM do mês `delta` meses depois do corrente (relógio do estabelecimento sintético). */
function mes(delta: number): string {
  const hoje = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [a, m] = hoje.split('-').map(Number) as [number, number];
  const i = a * 12 + (m - 1) + delta;
  return `${String(Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, '0')}`;
}

test.describe('competência de trabalho do faturista @C1-132', () => {
  test('sem escolha abre no mês corrente; futura e período fora do mês recusados na hora; a gravada vira o padrão', async ({
    page,
  }) => {
    const estado: {
      competencia: string | null;
      periodoInicio: string | null;
      periodoFim: string | null;
      versao: number | null;
    } = { competencia: null, periodoInicio: null, periodoFim: null, versao: null };
    const pedidos: { corpo: Record<string, unknown>; chave: string | null }[] = [];
    await page.route('**/api/tiss/competencia-trabalho**', async (r) => {
      if (r.request().method() === 'POST') {
        const corpo = r.request().postDataJSON() as Record<string, unknown>;
        pedidos.push({ corpo, chave: r.request().headers()['idempotency-key'] ?? null });
        estado.competencia = String(corpo['competencia']);
        estado.periodoInicio = (corpo['periodoInicio'] as string | null) ?? null;
        estado.periodoFim = (corpo['periodoFim'] as string | null) ?? null;
        estado.versao = (estado.versao ?? 0) + 1;
        return json(r, { id: 77, versao: estado.versao, competencia: estado.competencia });
      }
      return json(r, {
        modulo: 'fonte_pagadora',
        ...estado,
        alteradaEm: estado.versao ? new Date().toISOString() : null,
        padrao: estado.competencia ?? mes(0),
      });
    });

    await entrar(page, 'SINT.TISS');
    await page.goto('/faturamento/competencias');
    const painel = page.getByTestId('ct-minha-competencia');
    await expect(painel).toContainText('Sem competência de trabalho escolhida');
    await expect(page.getByTestId('cp-competencia')).toHaveValue(mes(0));
    await expect(page.getByTestId('ct-gravar')).toBeDisabled();

    // Competência futura: recusada na hora, sem pedido.
    await page.getByTestId('ct-competencia').fill(mes(1));
    await expect(page.getByTestId('ct-recusa')).toContainText('posterior ao mês corrente');
    await expect(page.getByTestId('ct-gravar')).toBeDisabled();

    // Mês anterior com o início do período fora dele: recusado na hora.
    const anterior = mes(-1);
    await page.getByTestId('ct-competencia').fill(anterior);
    await page.getByTestId('ct-inicio').fill(`${mes(0)}-01`);
    await expect(page.getByTestId('ct-recusa')).toContainText('dentro do mês da competência');
    await expect(page.getByTestId('ct-inicio')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('ct-gravar')).toBeDisabled();

    // Período dentro do mês: grava.
    await page.getByTestId('ct-inicio').fill(`${anterior}-01`);
    await page.getByTestId('ct-fim').fill(`${anterior}-15`);
    await expect(page.getByTestId('ct-recusa')).toHaveCount(0);
    await page.getByTestId('ct-gravar').click();
    await expect(page.getByTestId('ct-gravada')).toBeVisible();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.corpo).toMatchObject({
      modulo: 'fonte_pagadora',
      competencia: anterior,
      periodoInicio: `${anterior}-01`,
      periodoFim: `${anterior}-15`,
      versao: null,
    });
    expect(pedidos[0]!.chave).toBeTruthy();
    await expect(painel).toContainText(`competência ${anterior}`);
    await expect(page.getByTestId('cp-competencia')).toHaveValue(anterior);
    await semViolacaoAxe(page, '/faturamento/competencias (competência de trabalho)');

    // De volta à tela: o filtro já abre na competência de trabalho.
    await page.goto('/inicio');
    await page.goto('/faturamento/competencias');
    await expect(page.getByTestId('cp-competencia')).toHaveValue(anterior);
    await expect(page.getByTestId('ct-competencia')).toHaveValue(anterior);
  });
});
