// E2E @M55.1 (ficha do M55, fatia F1: manutenção e engenharia clínica; seções 7, 8 regras 1 a 3, 10 "abrir OS pelo
// celular → atender → encerrar; plano preventivo" e "Documento: OS e laudo em PDF/A" e 11 na parte da F1): o setor abre
// a OS pelo QR da etiqueta (`?abrir=<código>`) com o equipamento crítico parado (o alerta sobe e o setor é avisado) → o
// técnico assume → a chefia da manutenção conclui com a causa, os instantes do reparo, a volta ao uso e os custos → quem
// abriu aceita e a OS fica encerrada, com o documento da OS → na ficha do equipamento, a calibração vencida é registrada
// com o laudo e o laudo da execução fica para baixar → o painel do plano e os indicadores com as parcelas. Axe sem
// violação séria em cada estado. Sessão, setores, equipamentos e planos SINTÉTICOS em memória (nada vai à cópia).
import { expect, type Locator, type Page, test } from '@playwright/test';
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

const campo = (l: Locator) =>
  l.locator('xpath=self::input | self::textarea | .//input | .//textarea').first();
const p2 = (n: number) => String(n).padStart(2, '0');
/** O instante como o servidor (relógio local, minuto): a data DD/MM/AAAA e a hora HH:MM. */
const instante = (d: Date) => ({
  data: `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`,
  hora: `${p2(d.getHours())}:${p2(d.getMinutes())}`,
});
async function preencherInstante(c: Locator, i: { data: string; hora: string }): Promise<void> {
  const d = c.locator('.sgh-data input').first();
  await d.fill(i.data);
  await d.press('Tab');
  const h = c.locator('.sgh-hora input').first();
  await h.fill(i.hora);
  await h.press('Tab');
}
async function abrirOs(page: Page, id: number): Promise<Locator> {
  await page.goto(`/manutencao/os?os=${id}`);
  const d = page.getByTestId('os-detalhe');
  await expect(d).toBeVisible({ timeout: 30_000 });
  return d;
}

test.describe('manutenção, fatia F1: manutenção e engenharia clínica @M55.1', () => {
  test.setTimeout(300_000);

  test('OS pelo QR com o crítico parado → assumir → concluir → aceite e documento; plano com laudo; painel e indicadores; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);

    // 1. O setor (centro cirúrgico) chega pelo menu e abre a OS pelo QR da etiqueta do monitor (regra 1).
    await entrar(page, 'SINT.MANUTENCAO.SETOR');
    await (await itemDoMenu(page, 'Manutenção predial e engenharia clínica')).click();
    await expect(page).toHaveURL(/\/manutencao\/os$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('tela-manutencao-os')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('os-vazio').or(page.getByTestId('tabela-os'))).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('os-aba-todas')).toHaveCount(0);
    await semViolacaoAxe(page, '/manutencao/os (setor)');

    await page.goto('/manutencao/os?abrir=EQ-CC-001');
    const form = page.getByTestId('os-form-abrir');
    await expect(form).toBeVisible({ timeout: 30_000 });
    await expect(form.getByTestId('os-abrir-equipamento')).toContainText('Monitor multiparamétrico');
    await campo(form.getByTestId('os-abrir-descricao')).fill(
      'Não liga depois da queda de energia da sala 3.',
    );
    await form.getByTestId('os-abrir-parado').check();
    await semViolacaoAxe(page, '/manutencao/os (abertura pelo QR)');
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/manutencao/os') && r.request().method() === 'POST'),
      form.getByTestId('os-abrir-gravar').click(),
    ]);
    expect(resposta.status()).toBe(201);
    const aberta = (await resposta.json()) as { id: number; numero: string };
    const minutoDaAbertura = instante(new Date());
    await expect(page.getByTestId('os-criada')).toContainText(aberta.numero);
    await expect(page.getByTestId('os-criada-alerta')).toBeVisible();
    await semViolacaoAxe(page, '/manutencao/os (OS aberta com o alerta)');

    // 2. O técnico assume (o alerta do crítico parado na OS; o setor foi avisado na central).
    await entrar(page, 'SINT.MANUTENCAO.TECNICO');
    let d = await abrirOs(page, aberta.id);
    await expect(d.getByTestId('os-alerta-parado')).toBeVisible();
    await expect(d.getByTestId('os-prazo-atendimento')).toBeVisible();
    await d.getByTestId('os-acao-assumir').click();
    await expect(d.getByTestId('os-form-assumir')).toBeVisible();
    await semViolacaoAxe(page, '/manutencao/os (assumir)');
    await d.getByTestId('os-acao-gravar').click();
    await expect(d.getByTestId('os-mensagem')).toContainText('em atendimento', { timeout: 30_000 });
    await expect(d.getByTestId('os-situacao')).toContainText('Em atendimento');

    // 3. A chefia da manutenção conclui: causa, solução, reparo e volta ao uso no minuto da abertura, custos.
    await entrar(page, 'SINT.MANUTENCAO');
    d = await abrirOs(page, aberta.id);
    await d.getByTestId('os-acao-concluir').click();
    const fc = d.getByTestId('os-form-concluir');
    await expect(fc).toBeVisible();
    await escolher(fc.getByTestId('os-concluir-causa'), { rotulo: 'Falha de energia ou rede' });
    await preencherInstante(fc.getByTestId('os-concluir-inicio'), minutoDaAbertura);
    await preencherInstante(fc.getByTestId('os-concluir-fim'), minutoDaAbertura);
    await preencherInstante(fc.getByTestId('os-concluir-volta'), minutoDaAbertura);
    await campo(fc.getByTestId('os-concluir-pecas')).fill('123,45');
    await campo(fc.getByTestId('os-concluir-mao')).fill('50,00');
    await campo(fc.getByTestId('os-concluir-solucao')).fill('Troca da fonte de alimentação do monitor.');
    await semViolacaoAxe(page, '/manutencao/os (concluir)');
    await d.getByTestId('os-acao-gravar').click();
    await expect(d.getByTestId('os-situacao')).toContainText('Concluída', { timeout: 30_000 });
    await expect(d.getByTestId('os-custos')).toContainText('173,45');
    await expect(d.getByTestId('os-acao-aceitar')).toHaveCount(0);

    // 4. Quem abriu aceita e a OS fica encerrada; o documento da OS (PDF/A) está na tela.
    await entrar(page, 'SINT.MANUTENCAO.SETOR');
    d = await abrirOs(page, aberta.id);
    await d.getByTestId('os-acao-aceitar').click();
    await semViolacaoAxe(page, '/manutencao/os (aceite de quem abriu)');
    await d.getByTestId('os-acao-gravar').click();
    await expect(d.getByTestId('os-situacao')).toContainText('Encerrada', { timeout: 30_000 });
    await expect(d.getByTestId('os-historico')).toContainText('Concluída');
    const href = (await d.getByTestId('os-documento').getAttribute('href')) ?? '';
    expect(href).toBe(`/api/manutencao/os/${aberta.id}/documento`);
    const doc = await page.request.get(href);
    expect([200, 503]).toContain(doc.status());
    if (doc.status() === 200) expect(doc.headers()['content-type']).toContain('application/pdf');
    await semViolacaoAxe(page, '/manutencao/os (encerrada)');

    // 5. Equipamentos: a calibração vencida do monitor registrada com o laudo (regra 2) e o laudo para baixar.
    await entrar(page, 'SINT.MANUTENCAO');
    await page.goto('/manutencao/equipamentos');
    await expect(page.getByTestId('tela-manutencao-equipamentos')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('equipamento-9001')).toContainText('EQ-CC-001', { timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/equipamentos (lista)');
    await page.getByTestId('equipamento-abrir-9001').click();
    const ficha = page.getByTestId('equipamento-ficha');
    await expect(ficha).toBeVisible({ timeout: 30_000 });
    await expect(ficha.getByTestId('equipamento-etiqueta')).toBeVisible();
    await expect(ficha.getByTestId('plano-9201')).toContainText('Vencida');
    await semViolacaoAxe(page, '/manutencao/equipamentos (ficha com o plano)');
    await ficha.getByTestId('plano-registrar-9201').click();
    const fe = ficha.getByTestId('plano-form-execucao');
    await expect(fe).toBeVisible();
    await escolher(fe.getByTestId('execucao-resultado'), { rotulo: 'Aprovado' });
    await campo(fe.getByTestId('execucao-laudo')).fill('900');
    await campo(fe.getByTestId('execucao-certificado')).fill('CERT-PADRAO-SINT-1');
    await semViolacaoAxe(page, '/manutencao/equipamentos (execução com laudo)');
    await fe.getByTestId('execucao-gravar').click();
    await expect(ficha.getByTestId('equipamento-mensagem')).toBeVisible({ timeout: 30_000 });
    await expect(ficha.getByTestId('plano-9201')).toContainText('Em dia', { timeout: 30_000 });
    await ficha.getByTestId('plano-execucoes-9201').click();
    const execucoes = ficha.getByTestId('plano-execucoes');
    await expect(execucoes).toContainText('Aprovado', { timeout: 30_000 });
    const laudo = execucoes.locator('[data-testid^="execucao-laudo-pdf-"]').first();
    await expect(laudo).toHaveAttribute('href', /\/api\/manutencao\/equipamentos\/9001\/laudo\/\d+$/);
    const pdf = await page.request.get((await laudo.getAttribute('href')) ?? '');
    expect([200, 503]).toContain(pdf.status());
    await semViolacaoAxe(page, '/manutencao/equipamentos (execuções com o laudo)');

    // 6. O painel do plano e os indicadores com as parcelas impressas (regra 3).
    await page.getByTestId('equipamento-fechar').click();
    await page.getByTestId('equipamentos-aba-painel').click();
    await expect(page.getByTestId('painel-plano-resumo')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/equipamentos (painel do plano)');
    await page.getByTestId('equipamentos-aba-indicadores').click();
    await page.getByTestId('indicadores-calcular').click();
    await expect(page.getByTestId('indicadores-parcelas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('indicador-mttr')).toBeVisible();
    await semViolacaoAxe(page, '/manutencao/equipamentos (indicadores)');

    expect(externas).toEqual([]);
  });
});
