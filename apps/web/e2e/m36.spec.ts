// E2E @M36 (ficha, seções 7, 10 e 11): a homologação sobre a cópia nas três telas de coexistência — a rodada de
// conferência na tela de testes de assinatura (rodadas por onda e estabelecimento, versão do roteiro, o Serrano em
// bloqueio, o teste de invasão bloqueando a primeira liberação, a fila de cenários controlados, o filtro por rodada e as
// colunas de rodada e conferência), os triggers vistos no rastreamento × catálogo na conferência de gravação e a
// impressão da cópia × homologada × conferências × produção na verificação de schema. Painel versionado em
// docs/homologacao/homologacao.json; sessão sintética de dev; axe sem violação séria em cada tela.
import { expect, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

test.describe('Homologação sobre a cópia, cenários controlados e pentest @M36', () => {
  test('testes de assinatura: rodada de conferência, pentest, fila, filtro por rodada e colunas novas; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await page.goto('/administracao/coexistencia/assinaturas');
    const rodada = page.getByTestId('rodada-conferencia');
    await expect(rodada).toBeVisible();
    await expect(page.getByTestId('versao-roteiro')).toContainText('Versão do roteiro');
    await expect(page.getByTestId('linha-rodada').first()).toContainText('Onda 0');
    await expect(rodada).toContainText('HS-1');
    await expect(page.getByTestId('situacao-pentest')).toContainText('não iniciado');
    await expect(page.getByTestId('situacao-pentest')).toContainText('não pode ir à primeira liberação');
    await expect(page.getByTestId('fila-controlado')).toContainText('aguardam o cenário controlado');
    await expect(page.getByTestId('tabela-assinaturas')).toBeVisible();
    await semViolacaoAxe(page, '/administracao/coexistencia/assinaturas (rodada)');
    await escolher(page.getByTestId('filtro-rodada'), '0');
    const linhas = page.getByTestId('linha-operacao');
    await expect(linhas.first()).toBeVisible();
    const n = await linhas.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(50);
    for (const r of await page.getByTestId('rodada-operacao').allTextContents())
      expect(r).toContain('Onda 0');
    await expect(page.getByTestId('tabela-assinaturas')).toContainText('acesso.trocarSenha');
    await expect(page.getByTestId('tabela-assinaturas')).toContainText('sem registro');
    expect(externas).toEqual([]);
  });

  test('conferência de gravação: triggers vistos no rastreamento × catálogo; verificação de schema: impressões; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await page.goto('/administracao/coexistencia/gravacao');
    // o painel da homologação vem depois do da gravação (que lê os triggers no banco de cada estabelecimento)
    await expect(page.getByTestId('triggers-vistos')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('triggers-nenhum')).toContainText(
      'Nenhum cenário controlado capturado ainda',
    );
    await semViolacaoAxe(page, '/administracao/coexistencia/gravacao (triggers vistos)');
    await page.goto('/administracao/coexistencia/schema');
    const imp = page.getByTestId('impressoes-homologacao');
    await expect(imp).toBeVisible();
    await expect(imp).toContainText('pc');
    await expect(imp).toContainText('HS-1');
    await expect(imp).toContainText('sem leitura pela equipe de construção');
    await semViolacaoAxe(page, '/administracao/coexistencia/schema (impressões)');
    expect(externas).toEqual([]);
  });
});
