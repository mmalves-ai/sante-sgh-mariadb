// E2E @C2-006 (05-SADT linha 5): a restrição clínica do exame no pedido feito pela prescrição do prontuário. O médico
// escolhe o exame no atendimento e a tela mostra na hora o que a restrição decide (POST
// /api/sadt/pedidos/avaliar-prontuario/:paciente): o bloqueio sem exceção impede o envio; o bloqueio que aceita exceção pede a
// justificativa (10 caracteres ou mais) e só segue para quem pode autorizá-la; o alerta pede a confirmação. A tela de
// exames do setor não lança mais exame direto: o atalho leva ao pedido de exames (/sadt/pedido). axe sem violação séria.
// Sessão real sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS): a fonte sintética não tem o banco do
// cliente, então a resposta da avaliação é simulada pela rota interceptada; a gravação confere tudo de novo no banco
// (contrato de efeito em documentos-propria-operacoes-2.int.spec.ts). A recusa do paciente restrito e sem vínculo na
// avaliação está em pedido-prontuario.controller.spec.ts. Cada envio aqui confere que a tela leva o paciente na rota.
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

type Restricao = {
  regra: number;
  exame: number;
  tipo: 'bloqueio' | 'alerta';
  motivo: string;
  mensagem: string;
  permiteExcecao: boolean;
  excecao: number | null;
};

/** A resposta sintética da avaliação para os exames do corpo, pela regra dada a cada exame. */
async function simularAvaliacao(
  page: Page,
  regras: Record<number, Omit<Restricao, 'exame' | 'regra'>>,
  pode: boolean,
) {
  const corpos: unknown[] = [];
  await page.route('**/api/sadt/pedidos/avaliar-prontuario/*', async (r: Route) => {
    // O paciente vai na rota (o filtro do paciente com acesso restrito o lê); o atendimento, no corpo.
    expect(new URL(r.request().url()).pathname).toBe('/api/sadt/pedidos/avaliar-prontuario/1001');
    const corpo = r.request().postDataJSON() as { exames: number[] };
    corpos.push(corpo);
    const restricoes: Restricao[] = corpo.exames
      .filter((e) => regras[e])
      .map((e, i) => ({ regra: 900 + i, exame: e, ...regras[e]! }));
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        restricoes,
        segue: restricoes.length === 0,
        codigo: null,
        motivo: null,
        pedeJustificativa: restricoes.some(
          (x) => x.tipo === 'bloqueio' && x.permiteExcecao && x.excecao === null,
        ),
        podeAutorizarExcecao: pode,
      }),
    });
  });
  return corpos;
}

/** Abre o pedido e inclui o primeiro exame. O id vai para `exame.valor` ANTES do clique: a avaliação sai na hora. */
async function abrirPedido(page: Page, exame: { valor: number }): Promise<void> {
  await page.goto('/pep/paciente/1001/exames');
  await expect(page.getByTestId('form-pedido')).toBeVisible();
  const primeiro = page.locator('[data-testid^="incluir-exame-"]').first();
  exame.valor = Number((await primeiro.getAttribute('data-testid'))!.replace('incluir-exame-', ''));
  await primeiro.click();
}

test.describe('Restrição clínica do exame no pedido do prontuário @C2-006 @F3.5', () => {
  test('o bloqueio que aceita exceção pede a justificativa; sem quem autorize, o envio fica travado', async ({
    page,
  }) => {
    await entrar(page, 'SINT.MEDICO');
    const exame = { valor: 0 };
    const corpos = await simularAvaliacao(
      page,
      new Proxy(
        {},
        {
          get: (_a, k) =>
            Number(k) === exame.valor
              ? {
                  tipo: 'bloqueio',
                  motivo: 'dia',
                  mensagem: 'Coleta só noutro dia, salvo exceção (sintético).',
                  permiteExcecao: true,
                  excecao: null,
                }
              : undefined,
        },
      ) as Record<number, Omit<Restricao, 'exame' | 'regra'>>,
      false,
    );
    await abrirPedido(page, exame);
    await expect(page.getByTestId('restricoes-pedido')).toBeVisible();
    await expect(page.getByTestId(`restricao-${exame.valor}-bloqueio`)).toContainText('salvo exceção');
    await expect(page.getByTestId('restricao-justificativa')).toBeVisible();
    await expect(page.getByTestId('restricao-sem-autorizacao')).toBeVisible();
    await page.getByTestId('restricao-justificativa').fill('Urgencia clinica sintetica');
    await expect(page.getByTestId('enviar-pedido')).toBeDisabled();
    expect(corpos.length).toBeGreaterThan(0);
    expect(corpos.at(-1)).toMatchObject({ exames: [exame.valor], confirmado: true });
    await semViolacaoAxe(page, '/pep/paciente/1001/exames (restrição com exceção)');
  });

  test('com quem autorize, a justificativa curta trava e a de 10 caracteres libera o envio', async ({
    page,
  }) => {
    await entrar(page, 'SINT.MEDICO');
    const exame = { valor: 0 };
    await simularAvaliacao(
      page,
      new Proxy(
        {},
        {
          get: (_a, k) =>
            Number(k) === exame.valor
              ? {
                  tipo: 'bloqueio',
                  motivo: 'idade',
                  mensagem: 'Idade fora da faixa, salvo exceção (sintético).',
                  permiteExcecao: true,
                  excecao: null,
                }
              : undefined,
        },
      ) as Record<number, Omit<Restricao, 'exame' | 'regra'>>,
      true,
    );
    await abrirPedido(page, exame);
    await expect(page.getByTestId('restricao-justificativa')).toBeVisible();
    await expect(page.getByTestId('restricao-sem-autorizacao')).toHaveCount(0);
    await page.getByTestId('restricao-justificativa').fill('curta');
    await expect(page.getByTestId('enviar-pedido')).toBeDisabled();
    await page.getByTestId('restricao-justificativa').fill('Urgencia clinica sintetica');
    await expect(page.getByTestId('enviar-pedido')).toBeEnabled();
  });

  test('o bloqueio sem exceção impede o envio; o alerta pede a confirmação', async ({ page }) => {
    await entrar(page, 'SINT.MEDICO');
    const exame = { valor: 0, tipo: 'bloqueio' as 'bloqueio' | 'alerta' };
    await simularAvaliacao(
      page,
      new Proxy(
        {},
        {
          get: (_a, k) =>
            Number(k) === exame.valor
              ? {
                  tipo: exame.tipo,
                  motivo: 'sexo',
                  mensagem: 'Exame não indicado para o sexo do paciente (sintético).',
                  permiteExcecao: false,
                  excecao: null,
                }
              : undefined,
        },
      ) as Record<number, Omit<Restricao, 'exame' | 'regra'>>,
      true,
    );
    await abrirPedido(page, exame);
    await expect(page.getByTestId('restricao-bloqueado')).toBeVisible();
    await expect(page.getByTestId('enviar-pedido')).toBeDisabled();
    // O mesmo exame como alerta: a confirmação aparece e o envio fica livre.
    exame.tipo = 'alerta';
    await page.goto('/pep/paciente/1001/exames');
    await page.getByTestId(`incluir-exame-${exame.valor}`).click();
    await expect(page.getByTestId(`restricao-${exame.valor}-alerta`)).toBeVisible();
    await expect(page.getByTestId('restricao-bloqueado')).toHaveCount(0);
    await expect(page.getByTestId('confirmar-avisos')).toBeVisible();
    await expect(page.getByTestId('enviar-pedido')).toBeEnabled();
    await semViolacaoAxe(page, '/pep/paciente/1001/exames (alerta)');
  });

  test('sem simulação, a gravação recusa o pedido bloqueado e o que pede justificativa, com o motivo da API', async ({
    page,
  }) => {
    // Sem rota interceptada: a avaliação na hora não tem o banco do cliente na fonte sintética, e a porta em memória do
    // pedido aplica a mesma decisaoDoPedido com as restrições sintéticas fixas (sódio só até 60 anos, sem exceção;
    // beta HCG só para o sexo feminino, com exceção). O paciente 1001 é masculino, de 1958.
    await entrar(page, 'SINT.MEDICO');
    await page.goto('/pep/paciente/1001/exames');
    await expect(page.getByTestId('form-pedido')).toBeVisible();
    await page.getByTestId('incluir-exame-503').click();
    const bloqueio = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/pep\/paciente\/1001\/exames/.test(r.url()),
    );
    await page.getByTestId('enviar-pedido').click();
    const b = await bloqueio;
    expect(b.status()).toBe(422);
    expect(((await b.json()) as { codigo?: string }).codigo).toBe('restricao-bloqueio');
    await expect(page.getByTestId('mensagem-erro')).toContainText('só até 60 anos');

    // O beta HCG: a regra por sexo aceita exceção, mas pede a justificativa (o aviso do catálogo é confirmado antes).
    await page.goto('/pep/paciente/1001/exames');
    await expect(page.getByTestId('form-pedido')).toBeVisible();
    await page.getByTestId('incluir-exame-504').click();
    await page.getByTestId('enviar-pedido').click();
    await page.getByTestId('confirmar-avisos').check();
    const justificativa = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        /\/api\/pep\/paciente\/1001\/exames/.test(r.url()) &&
        r.status() === 422,
    );
    await page.getByTestId('enviar-pedido').click();
    const j = await justificativa;
    expect(((await j.json()) as { codigo?: string }).codigo).toBe('restricao-justificativa');
    await expect(page.getByTestId('mensagem-erro')).toContainText('Informe a justificativa');
    await semViolacaoAxe(page, '/pep/paciente/1001/exames (recusa da restrição)');
  });

  test('a tela de exames do setor leva ao pedido de exames, sem lançamento direto', async ({ page }) => {
    // A recepção do setor de exames (o administrador da plataforma não tem permissão clínica nem do setor).
    await entrar(page, 'SINT.RECEPCAO.SADT');
    await page.goto('/sadt/exames');
    await expect(page.getByTestId('sadt-lancar')).toHaveCount(0);
    await page.getByTestId('sadt-lancar-pedido').click();
    await expect(page).toHaveURL(/\/sadt\/pedido$/);
  });
});
