// E2E @M58.4: a fachada da API de integração. Lote 02-07 (ADR 0003): os E2E @M58.1, @M58.2, @M58.3 e @M58.5 (desligamento,
// ensaios do motor e do UTF-8 e janela em produção do sistema de origem) saíram com a convivência.
import { expect, test, type Page } from '@playwright/test';
import { FACHADA_TOKEN_E2E } from './ambiente.js';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

// E2E @M58.4 (ficha do M58, seção 7 e regras 8 e 9; etapa 4, fachada da API de integração da Hal-AI): o administrador
// abre o painel pelo menu (necessidade, estado, prontidão do UTF-8, motor em dois tempos, superfícies e as 78
// operações com filtro); o teste faz as vezes do Squad com a chave sintética: fachada desligada (503), ligada pela tela
// com a senha de novo (senha errada recusada), convênios servidos no contrato da API original, escrita desligada por
// padrão (403), ligada pela tela com o aviso, e a ação em dois tempos (a proposta não grava; a confirmação é de uso
// único). Porta da fachada EM MEMÓRIA (convênios sintéticos; nada vai à cópia). axe em cada estado.
test.describe('Fachada da API de integração da Hal-AI @M58.4 @fase7', () => {
  test.setTimeout(180_000);

  test('painel pelo menu, filtros, configurar com senha e a fachada no contrato da API original; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // O caminho-base leva o estabelecimento da sessão (na fonte sintética, o do painel; em produção, pc).
    let base = '';
    const chave = { authorization: `Bearer ${FACHADA_TOKEN_E2E}` };
    const squad = async (metodo: 'GET' | 'POST', caminho: string, corpo?: unknown) => {
      const r = await page.request.fetch(`${base}${caminho}`, {
        method: metodo,
        headers: chave,
        ...(corpo === undefined ? {} : { data: corpo }),
      });
      return { status: r.status(), corpo: (await r.json()) as Record<string, unknown> };
    };

    await entrar(page, 'SINT.ONDA5');
    await (await itemDoMenu(page, 'Fachada sante-api para quando o modelo evoluir')).click();
    await expect(page).toHaveURL(/\/administracao\/integracoes\/fachada$/);
    const tela = page.getByTestId('tela-fachada');
    await expect(tela).toBeVisible();
    await expect(page.getByTestId('cartao-necessidade')).toBeVisible();
    const painel = (await (await page.request.get('/api/administracao/integracoes/fachada')).json()) as {
      hospital: string;
    };
    base = `/api/fachada/sante-api/${painel.hospital}`;
    await expect(page.getByTestId('estado-ligada')).toHaveText('Desligada');
    await expect(page.getByTestId('estado-escrita')).toHaveText('Desligada');
    await expect(page.getByTestId('cartao-prontidao')).toBeVisible();
    await expect(page.getByTestId('cartao-motor')).toContainText('15 minutos');
    await expect(page.getByTestId('superficies-total')).toContainText('78');
    await expect(page.getByTestId('filtro-contagem')).toHaveText('Mostrando 78 de 78 operações');
    await expect(tela).not.toContainText(/SPDATA|legado|sistema atual|integracao\.fachada/i);
    await semViolacaoAxe(page, '/administracao/integracoes/fachada');

    // Com a fachada desligada, toda operação aparece desligada (filtro pelo modo).
    await escolher(page.getByTestId('filtro-modo'), 'desligada');
    await expect(page.getByTestId('filtro-contagem')).toHaveText('Mostrando 78 de 78 operações');
    await escolher(page.getByTestId('filtro-modo'), '');

    // O Squad, com a fachada desligada: 503 no envelope da API original; sem chave: 401.
    const desligada = await squad('GET', '/convenios');
    expect(desligada.status).toBe(503);
    expect(desligada.corpo).toMatchObject({ status: 'error', codigo: 'fachada_desligada' });
    expect((await page.request.get(`${base}/convenios`)).status()).toBe(401);

    // Ligar a fachada (crítico: justificativa e senha de novo; a senha errada é recusada).
    const form = page.getByTestId('form-fachada');
    await escolher(form.getByTestId('fachada-parametro'), 'integracao.fachada.ligada');
    await form.getByTestId('fachada-sim').check();
    await form.getByLabel(/^Justificativa/).fill('ensaio sintético da fachada');
    await form.getByTestId('fachada-senha').fill('senha-errada-1');
    await form.getByTestId('fachada-gravar').click();
    await expect(page.getByTestId('recusa-fachada')).toBeVisible();
    await expect(page.getByTestId('estado-ligada')).toHaveText('Desligada');
    await form.getByTestId('fachada-senha').fill(SENHA);
    await form.getByTestId('fachada-gravar').click();
    await expect(page.getByTestId('fachada-gravado')).toContainText('Configuração gravada: Fachada ligada.');
    await expect(page.getByTestId('estado-ligada')).toHaveText('Ligada');
    await semViolacaoAxe(page, '/administracao/integracoes/fachada (ligada)');

    // Servida no contrato da API original (a configuração tem cache curto; espera a leitura nova).
    await expect.poll(async () => (await squad('GET', '/convenios')).status, { timeout: 30_000 }).toBe(200);
    const lista = await squad('GET', '/convenios?q=sintetico');
    expect(JSON.stringify(lista.corpo)).toContain('CONVENIO SINTETICO UM');
    expect((await squad('GET', '/convenios/20')).corpo).toMatchObject({ nome: 'CONVENIO SINTETICO UM' });

    // Escrita desligada por padrão: a ação é recusada (403) sem proposta.
    const fechada = await squad('POST', '/acoes/convenios/situacao', { convenio: 20, operacao: 'suspender' });
    expect(fechada.status).toBe(403);
    expect(fechada.corpo).toMatchObject({ codigo: 'acoes_desabilitadas' });

    // Ligar a escrita mostra o aviso e pede a senha de novo.
    await escolher(form.getByTestId('fachada-parametro'), 'integracao.fachada.escrita');
    await form.getByTestId('fachada-sim').check();
    await expect(page.getByTestId('fachada-aviso-escrita')).toBeVisible();
    await form.getByLabel(/^Justificativa/).fill('ensaio sintético da escrita');
    await form.getByTestId('fachada-senha').fill(SENHA);
    await form.getByTestId('fachada-gravar').click();
    await expect(page.getByTestId('fachada-gravado')).toContainText('Escrita ligada');
    await expect(page.getByTestId('estado-escrita')).toHaveText('Ligada');

    // Filtros (escrita ligada): só as ações servidas (situação do convênio, confirmar e o estado do motor).
    await escolher(page.getByTestId('filtro-superficie'), 'acoes');
    await escolher(page.getByTestId('filtro-modo'), 'servida');
    await expect(page.getByTestId('filtro-contagem')).toHaveText('Mostrando 3 de 78 operações');
    await expect(page.getByTestId('operacao-POST /acoes/convenios/situacao')).toContainText(
      'convenio.alterarSituacao',
    );
    await page.getByLabel('Caminho contém').fill('confirmar');
    await expect(page.getByTestId('filtro-contagem')).toHaveText('Mostrando 1 de 78 operações');
    await page.getByLabel('Caminho contém').fill('');
    await escolher(page.getByTestId('filtro-superficie'), '');
    await escolher(page.getByTestId('filtro-modo'), '');

    // Dois tempos: a proposta não grava; a confirmação grava uma vez; a segunda confirmação é recusada.
    await expect
      .poll(async () => (await squad('GET', '/acoes/status')).corpo['habilitada'], { timeout: 30_000 })
      .toBe(true);
    const proposta = await squad('POST', '/acoes/convenios/situacao', {
      convenio: 20,
      operacao: 'suspender',
    });
    expect(proposta.status).toBe(200);
    expect(proposta.corpo).toMatchObject({ aplicada: false });
    const propostaId = proposta.corpo['propostaId'] as string;
    expect((await squad('GET', '/convenios/20')).corpo).toMatchObject({ ativo: true });
    const confirmada = await squad('POST', '/acoes/confirmar', { propostaId });
    expect(confirmada.status).toBe(200);
    expect(confirmada.corpo).toMatchObject({ aplicada: true, situacaoAtual: 'I' });
    expect((await squad('POST', '/acoes/confirmar', { propostaId })).status).toBeGreaterThanOrEqual(400);

    // O painel mede o uso por operação.
    await page.reload();
    await page.getByLabel('Caminho contém').fill('/acoes/confirmar');
    await expect(page.getByTestId('operacao-POST /acoes/confirmar')).toBeVisible();
    await expect(page.getByTestId('cartao-motor')).toContainText('Propostas pendentes: 0');
    await semViolacaoAxe(page, '/administracao/integracoes/fachada (uso medido)');
    expect(externas).toEqual([]);
  });
});
