// E2E @M51.1 (ficha do M51, seção 10, na parte da etapa 1): o faturista SUS abre a CIHA pelo menu, abre a competência,
// roda a crítica, vê o atendimento sem equivalente SIGTAP, registra o equivalente (a correção do de-para da CIHA) e roda
// a crítica de novo (a bloqueante vira "corrigida"), justifica o aviso, gera a CIHA e baixa o arquivo com o hash
// conferido; fecha e reabre a competência com justificativa. O BPA aparece desligado (DP-35); quem não tem a
// permissão não lê; o faturista com escopo parcial não gera. axe sem violação séria. Sessão real sobre a fonte
// sintética de dev e a porta em MEMÓRIA (massa sintética); nenhum dado de pessoa.
import { createHash } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

/** Uma competência passada diferente a cada rodada (a porta em memória guarda as competências do servidor no ar). */
function competenciaDaRodada(): string {
  const n = Math.floor(Date.now() / 1000) % 180;
  const ano = 2010 + Math.floor(n / 12);
  return `${ano}${String((n % 12) + 1).padStart(2, '0')}`;
}

test.describe('@M51.1 Faturamento SUS: competência, crítica e CIHA', () => {
  test.describe.configure({ timeout: 300_000 });

  test('sem a permissão do faturamento SUS: a API recusa; com escopo parcial: lê, mas não gera', async ({
    page,
  }) => {
    await entrar(page, 'SINT.DIRETORIA.REDE');
    expect((await page.request.get('/api/sus/competencias')).status()).toBe(403);
    await entrar(page, 'SINT.SUS.ESCOPO');
    const r = await page.request.get('/api/sus/competencias?instrumento=ciha');
    expect(r.status()).toBe(200);
    expect((await r.json()).escopoParcial).toBe(true);
    await page.goto('/faturamento/sus/ciha');
    await expect(page.getByTestId('tela-ciha')).toBeVisible();
  });

  test('abrir → crítica → equivalente SIGTAP → crítica de novo → gerar a CIHA com hash → fechar e reabrir', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const competencia = competenciaDaRodada();
    await entrar(page, 'SINT.FATURISTA.SUS');
    // Pelo menu: Faturamento > Faturamento SUS > CIHA.
    await (await itemDoMenu(page, 'CIHA')).click();
    await expect(page).toHaveURL(/\/faturamento\/sus\/ciha$/);
    await expect(page.getByTestId('ciha-fonte-do-envio')).toContainText('para conferência');
    await semViolacaoAxe(page, 'CIHA');

    // A tela das competências: o BPA desligado por estabelecimento (DP-35).
    await page.goto('/faturamento/sus/competencias?instrumento=bpa');
    await expect(page.getByTestId('instrumento-sus-desligado')).toBeVisible();
    await escolher(page.getByTestId('filtro-instrumento-sus'), 'ciha');
    await expect(page.getByTestId('instrumento-sus-desligado')).toHaveCount(0);

    // Abrir a competência e rodar a crítica.
    await page.getByLabel('Nova competência').fill(competencia);
    await page.getByTestId('botao-abrir-competencia-sus').click();
    await expect(page.getByTestId('mensagem-sus')).toContainText(`Competência ${competencia} aberta`);
    const linha = page.getByTestId(`competencia-sus-${competencia}`);
    await linha.getByTestId(`criticar-${competencia}`).click();
    await expect(page.getByTestId('mensagem-sus')).toContainText('1 críticas bloqueantes');
    const criticas = page.getByTestId('criticas-sus');
    // O procedimento do hospital aparece com o código na tabela, o nome e a tabela (não o ID interno).
    await expect(criticas.getByTestId('critica-sus-sem-sigtap')).toContainText(
      '40801012 ELETROCARDIOGRAMA SINTETICO (1 TABELA SINTETICA A)',
    );
    await expect(criticas.getByTestId('critica-sus-item-sem-sigtap')).toBeVisible();
    // Nada de pessoa na tela: só chaves de conta e códigos.
    await expect(page.getByTestId('tela-competencias-sus')).not.toContainText('PACIENTE SINTETICO');
    await semViolacaoAxe(page, 'Competência SUS e críticas');

    // O equivalente SIGTAP do procedimento sem equivalente (a correção do de-para da CIHA).
    await criticas
      .getByTestId('critica-sus-sem-sigtap')
      .getByRole('button', { name: 'Registrar o equivalente SIGTAP' })
      .click();
    const form = page.getByTestId('form-equivalencia-sus');
    await expect(form.getByTestId('equivalencia-procedimento-nome')).toContainText(
      '40801012 ELETROCARDIOGRAMA SINTETICO (1 TABELA SINTETICA A)',
    );
    await expect(form.getByTestId('botao-gravar-equivalencia')).toBeDisabled();
    // O código SIGTAP se escolhe pela busca no servidor (código ou nome), com o nome à vista antes de gravar.
    await form.getByLabel('Buscar na tabela SIGTAP (código ou nome)').fill('inexistente');
    await form.getByTestId('botao-buscar-sigtap').click();
    await expect(form).toContainText('Nada encontrado.');
    await form.getByLabel('Buscar na tabela SIGTAP (código ou nome)').fill('eletrocardio');
    await form.getByTestId('botao-buscar-sigtap').click();
    await expect(form.getByTestId('equivalencia-sigtap-nome')).toContainText(
      '0211020036 PROCEDIMENTO SINTETICO DE ELETROCARDIOGRAFIA',
    );
    await semViolacaoAxe(page, 'Equivalência SIGTAP com a busca');
    await form.getByTestId('botao-gravar-equivalencia').click();
    await expect(page.getByTestId('mensagem-sus')).toContainText('Equivalência registrada');
    await linha.getByTestId(`criticar-${competencia}`).click();
    await expect(page.getByTestId('mensagem-sus')).toContainText('0 críticas bloqueantes');
    await expect(page.getByTestId('mensagem-sus')).toContainText('1 corrigidas');
    await escolher(page.getByTestId('filtro-situacao-critica-sus'), 'corrigida');
    await expect(criticas.getByTestId('critica-sus-sem-sigtap')).toContainText('Corrigida na origem');
    await escolher(page.getByTestId('filtro-situacao-critica-sus'), 'aberta');

    // Com o aviso aberto, a competência não fecha (ficha, seção 5: "fechamento com críticas tratadas").
    await expect(linha.getByTestId(`fechar-${competencia}`)).toBeDisabled();

    // Justificar o aviso que fica.
    await criticas
      .getByTestId('critica-sus-item-sem-sigtap')
      .getByRole('button', { name: 'Justificar aviso' })
      .click();
    await page
      .getByTestId('form-justificativa-sus')
      .getByRole('textbox')
      .fill('Material sem procedimento SIGTAP equivalente');
    await page.getByTestId('botao-confirmar-justificativa').click();
    await expect(page.getByTestId('mensagem-sus')).toContainText('Aviso justificado');

    // Gerar a CIHA e baixar o arquivo conferindo o hash.
    await page.getByRole('link', { name: 'Ir para a exportação da CIHA' }).click();
    await expect(page).toHaveURL(/\/faturamento\/sus\/ciha$/);
    await escolher(page.getByTestId('ciha-competencia'), competencia);
    await expect(page.getByTestId('ciha-resumo')).toContainText('Pronta para gerar');
    await page.getByTestId('botao-gerar-ciha').click();
    await expect(page.getByTestId('mensagem-ciha')).toContainText('Arquivo gerado');
    const tabela = page.getByTestId('tabela-arquivos-ciha');
    await expect(tabela).toContainText('Leiaute CIHA01 1.0.4.0');
    const hash = ((await tabela.getByTestId('hash-arquivo-ciha').first().textContent()) ?? '').trim();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const href =
      (await tabela
        .getByRole('link', { name: /^CIHA_/ })
        .first()
        .getAttribute('href')) ?? '';
    const arquivo = await page.request.get(href);
    expect(arquivo.status()).toBe(200);
    expect(arquivo.headers()['x-sgh-sha256']).toBe(hash);
    const corpo = await arquivo.body();
    expect(createHash('sha256').update(corpo).digest('hex')).toBe(hash);
    expect(corpo.toString('ascii').split('\r\n')[0]).toMatch(/^1\d{7}1\.0\.4\.0$/);
    await semViolacaoAxe(page, 'CIHA com arquivo');

    // As equivalências: os nomes dos dois procedimentos, a busca no servidor e o "Alterar" com o equivalente atual.
    await page.getByLabel('Buscar nas equivalências (código ou nome)').fill('eletro');
    await page.getByTestId('botao-filtrar-equivalencias').click();
    const eq = page.getByTestId('tabela-equivalencias-sus').getByTestId('equivalencia-sus-7001');
    await expect(eq).toContainText('40801012 ELETROCARDIOGRAMA SINTETICO');
    await expect(eq).toContainText('0211020036 PROCEDIMENTO SINTETICO DE ELETROCARDIOGRAFIA');
    await eq.getByTestId('alterar-equivalencia-7001').click();
    await expect(page.getByTestId('form-equivalencia-sus').getByTestId('equivalencia-atual')).toContainText(
      'Equivalente atual: 0211020036',
    );
    await page.getByTestId('form-equivalencia-sus').getByRole('button', { name: 'Cancelar' }).click();

    // Fechar e reabrir (supervisor, com justificativa).
    await page.goto(`/faturamento/sus/competencias?instrumento=ciha&competencia=${competencia}`);
    await page.getByTestId(`fechar-${competencia}`).click();
    await expect(page.getByTestId('mensagem-sus')).toContainText(`Competência ${competencia} fechada`);
    await expect(page.getByTestId(`competencia-sus-${competencia}`)).toContainText('Fechada');
    await page.getByTestId(`reabrir-${competencia}`).click();
    await page
      .getByTestId('form-justificativa-sus')
      .getByRole('textbox')
      .fill('Reabertura para conferência do arquivo');
    await page.getByTestId('botao-confirmar-justificativa').click();
    await expect(page.getByTestId('mensagem-sus')).toContainText(`Competência ${competencia} reaberta`);
    await expect(page.getByTestId(`competencia-sus-${competencia}`)).toContainText('Aberta');

    // Exportação só em arquivo (regra 9): nenhuma requisição externa.
    expect(externas).toEqual([]);
  });
});
