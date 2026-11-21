// E2E @M41 (ficha, seções 7, 8 e 10; regras 1, 2 e 3 da onda): o painel "Efeito no estoque dos documentos do dia" na
// tela de saldos (o documento gravado aqui no dia, com o aberto em destaque; os documentos por tipo e local; os
// horários; o filtro de local com busca) e a conferência de saldo e preço médio sem divergência; a aba "Onda 3" do
// painel de migração (a regra 1 por local, os quatro setores na ordem, o registro de um item da onda); e a tela de
// chaves recusando ligar a dispensação com a unidade sem a prescrição eletrônica em uso. Sessão real sobre a fonte
// sintética de dev e as portas em MEMÓRIA (nada vai à cópia). A recusa por mês fechado na tela de saídas: a porta em
// memória não fecha o mês corrente (o fechamento só aceita mês terminado), então o aviso da competência e a recusa do
// servidor são simulados pela rota com o texto da regra; a recusa no banco real é o cenário `mes-fechado` da assinatura
// de `registrarSaida`. Da jornada do campo 10, o @M28 cobre a nota com lote → saldo e custo, a saída a internado → o
// lote no atendimento, a devolução → o aviso do estorno; o @M29, a fila → dispensação por horário → aceite → devolução.
// O item na conta depois da DISPENSAÇÃO não tem E2E: a conta não é lida em tela pela porta em memória e, no banco real,
// é lançada pela consolidação do outro sistema (D-MOTOR-28). axe em cada tela.
import { expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

/** POST da página com o CSRF da sessão e a Idempotency-Key, como a tela faz. */
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies(ORIGEM)).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return page.request.post(url, {
    data: data as Record<string, unknown>,
    headers: {
      'x-csrf': csrf,
      'idempotency-key': `e2e-m41-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

test.describe('Onda 3: efeito no estoque, conferência numérica, critério por setor e regra 1 @M41 @fase4', () => {
  test.setTimeout(240_000);

  test('efeito no estoque do documento do dia (aberto em destaque), filtro de local e conferência sem divergência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ALMOXARIFE');
    // A requisição gravada aqui no dia (aberta até o atendimento: o painel a destaca como não consolidada).
    const r = await postar(page, '/api/suprimentos/requisicoes', {
      destino: 2,
      local: 10,
      centroCusto: 101,
      localConsumo: 11,
      itens: [{ item: 5001, quantidade: 1 }],
    });
    expect(r.status(), await r.text()).toBe(200);
    const doc = (await r.json()).ids.doc as number;

    await page.goto('/suprimentos/saldos');
    const painel = page.getByTestId('painel-efeito-estoque');
    await expect(painel).toBeVisible();
    await expect(painel.getByTestId('onda3-resumo-alerta')).toContainText('sem o efeito esperado');
    const linha = painel.getByTestId(`onda3-efeito-saida-${doc}`);
    await expect(linha).toHaveClass(/destaque/);
    await expect(linha.getByTestId('alertas')).toContainText('Documento ainda não consolidado');
    await expect(painel.getByTestId('onda3-doc-saida-10')).toContainText('Saídas e requisições');
    await expect(painel.getByTestId('onda3-horario-CTI')).toBeVisible();
    await expect(painel.getByTestId('onda3-mes-fechado')).toContainText('Último mês fechado');
    await expect(painel).not.toContainText(/spdata|legado/i);
    await semViolacaoAxe(page, '/suprimentos/saldos (efeito no estoque)');

    // O filtro de local (lista com busca): o local 15 não tem a requisição do dia.
    await escolher(painel.getByTestId('onda3-local'), '15');
    await expect(painel.getByTestId(`onda3-efeito-saida-${doc}`)).toHaveCount(0);
    await escolher(painel.getByTestId('onda3-local'), '10');
    await expect(painel.getByTestId(`onda3-efeito-saida-${doc}`)).toBeVisible();

    // A conferência de saldo e preço médio: o lido na outra estação igual ao lido aqui → nenhuma diferença.
    const conf = painel.getByTestId('onda3-numerica');
    await expect(conf.getByTestId('onda3-num-5001-10')).toBeVisible();
    await conf.getByTestId('num-copiar').click();
    await conf.getByTestId('num-conferir').click();
    await expect(conf.getByTestId('num-resultado')).toContainText('nenhuma diferença');
    // Um saldo diferente aparece como diferença.
    await conf.getByTestId('onda3-num-5001-10').getByTestId('num-saldo').fill('99999');
    await conf.getByTestId('num-conferir').click();
    await expect(conf.getByTestId('num-resultado')).toContainText('diferença(s) encontrada(s)');
    await semViolacaoAxe(page, '/suprimentos/saldos (conferência numérica)');
    expect(externas).toEqual([]);
  });

  test('chaves: a dispensação diz antes e recusa ao ligar com a unidade sem a prescrição em uso (regra 1); axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    const linha = page.getByTestId('operacao-suprimentos.dispensarHorario');
    await expect(linha.getByTestId('bloqueio-operacao')).toContainText('2A');
    await linha.getByRole('button').click();
    const form = page.getByTestId('form-liberacao');
    await form.getByLabel('Justificativa').fill('Tentativa sintética de ligar a dispensação');
    await form.getByTestId('liberacao-senha').fill(SENHA);
    await form.getByTestId('liberacao-aplicar').click();
    await expect(form.getByTestId('recusa-liberacao')).toContainText('2A');
    await semViolacaoAxe(page, '/administracao/liberacao (regra 1)');
  });

  test('saída em mês fechado: o aviso da competência e a recusa em português, nada registrado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ALMOXARIFE');
    // A outra estação fechou a competência corrente (a porta em memória não fecha o mês corrente): o apoio e a
    // gravação respondem como o servidor responde com o mês fechado (código e texto da regra 9).
    let competencia = '';
    let gravou = 0;
    await page.route('**/api/suprimentos/apoio', async (route) => {
      const r = await route.fetch();
      const corpo = (await r.json()) as { competencia: { ano: number; mes: number } };
      competencia = `${String(corpo.competencia.mes).padStart(2, '0')}/${corpo.competencia.ano}`;
      await route.fulfill({ response: r, json: { ...corpo, mesFechado: true } });
    });
    await page.route('**/api/suprimentos/saidas', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      gravou += 1;
      return route.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Lançamento recusado',
          status: 422,
          codigo: 'mes-fechado',
          detail: `O mês ${competencia} já foi fechado no estoque: o lançamento não é aceito.`,
        }),
      });
    });
    await page.goto('/suprimentos/saidas');
    await expect(page.getByText('O mês do estoque está fechado')).toBeVisible();
    await escolher(page.getByTestId('saida-destino'), '2');
    await escolher(page.getByTestId('saida-local'), '10');
    await escolher(page.getByTestId('saida-cc'), '101');
    await page.getByTestId('saida-itens-busca-termo').fill('5001');
    await page.getByTestId('saida-itens-busca-buscar').click();
    await page.getByTestId('saida-itens-busca-opcao-5001').click();
    await page.getByTestId('saida-itens-qtde-5001').fill('1');
    await page.getByTestId('saida-gravar').click();
    await expect(page.getByTestId('recusa-suprimentos')).toContainText(
      `O mês ${competencia} já foi fechado no estoque`,
    );
    await expect(page.getByTestId('saida-mensagem')).toHaveCount(0);
    expect(gravou).toBe(1);
    await semViolacaoAxe(page, '/suprimentos/saidas (mês fechado)');
    await expect(page.locator('body')).not.toContainText(/SPDATA|legado|sistema atual/i);
    expect(externas).toEqual([]);
  });
});
