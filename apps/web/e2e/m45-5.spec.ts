// E2E @M45.5 (ficha do M45, seções 7, 10 e 11; etapa 5): o cartão da nutrição na fila de trabalho; o paciente a triar
// vencido (em vermelho) triado pela nutricionista com o NRS-2002 (a prévia e o total calculado pelo sistema, fora do
// prazo); a terapia nutricional da EMTN (a meta pela dieta enteral prescrita e o acompanhamento do dia); o mapa de dietas
// de uma refeição com o jejum do bloco cirúrgico e a alergia alimentar, fechado no corte pela copa, as etiquetas de
// bandeja em ZPL e a refeição do acompanhante com direito legal; o serviço social com o parecer em CP1252 e a barreira
// social de alta, o parecer só para a categoria. axe sem violação séria nas telas e nos diálogos. Sessão real sobre a
// fonte sintética e a porta em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia).
import { expect, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PARECER =
  'Situação social — idosa que mora sozinha, ação nº 1: «sem cuidador» para a alta; família contatada.';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Nutrição, mapa de dietas e serviço social @M45 @M45.5 @fase5', () => {
  test.setTimeout(300_000);

  test('paciente a triar vencido → triagem NRS-2002; terapia da EMTN; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.NUTRI.CLINICA');
    // O cartão da nutrição na fila de trabalho, com as vencidas.
    await expect(page.getByTestId('resumo-nutricao')).toContainText('Vencidas: 3');
    await page.goto('/nutricao/triagem');
    await expect(page.getByTestId('tela-fila-nutricao')).toBeVisible();
    const maria = page.getByTestId('fila-950001');
    await expect(maria).toHaveAttribute('data-situacao', 'vencida');
    await expect(maria).toContainText('Vencida');
    await expect(page.getByTestId('fila-950004')).toContainText('NUTRIC');
    await semViolacaoAxe(page, '/nutricao/triagem');

    await page.getByTestId('triar-950001').click();
    const d = page.getByTestId('dialogo-triagem');
    await expect(d).toBeVisible();
    await d.getByRole('group', { name: 'Perdeu peso nos últimos 3 meses?' }).getByLabel('Sim').check();
    await d.getByRole('group', { name: 'Ingestão reduzida na última semana?' }).getByLabel('Sim').check();
    await d.getByRole('group', { name: 'Estado nutricional' }).getByLabel(/^2:/).check();
    await d.getByRole('group', { name: 'Gravidade da doença' }).getByLabel(/^1:/).check();
    // A prévia na tela soma o ponto da idade (78 anos); o sistema confere.
    await expect(d.getByTestId('triagem-previa')).toContainText('4 ponto(s)');
    await d.getByLabel('Peso (kg, opcional)').fill('52');
    await d.getByLabel('Altura (cm, opcional)').fill('160');
    await semViolacaoAxe(page, '/nutricao/triagem (triagem)');
    await d.getByTestId('triagem-gravar').click();
    await expect(page.getByTestId('triagem-gravada')).toContainText(
      'Triagem gravada: 4 ponto(s), Em risco nutricional.',
    );
    await expect(page.getByTestId('triagem-gravada')).toContainText('fora do prazo');
    await expect(maria).toHaveAttribute('data-situacao', 'triado');
    await expect(maria).toContainText('NRS-2002 4 ponto(s)');

    // A terapia nutricional da EMTN: a dieta enteral prescrita pela nutricionista, a meta e o dia.
    await page.goto('/nutricao/terapia/950004');
    await expect(page.getByTestId('terapia-dietas')).toContainText('DIETA ENTERAL');
    await expect(page.getByTestId('terapia-dietas')).toContainText('prescrita por nutricionista');
    await page.getByLabel('Peso de referência (kg)').fill('70');
    await page.getByTestId('meta-gravar').click();
    await expect(page.getByTestId('terapia-mensagem')).toContainText('1750 kcal');
    await expect(page.getByTestId('terapia-meta-vigente')).toContainText('1167 mL/dia');
    // W0-05 (revisão): o acompanhamento do dia fica na aba dele.
    await page.getByTestId('terapia-aba-acompanhamento').click();
    await page.getByLabel('Volume infundido (mL) — só se a checagem não traz').fill('1750');
    await page.getByTestId('acompanhamento-gravar').click();
    await expect(page.getByTestId('terapia-mensagem')).toContainText('150% da meta calórica');
    await expect(page.getByTestId('terapia-acompanhamentos')).toContainText('informado');
    await semViolacaoAxe(page, '/nutricao/terapia/950004');
    expect(externas).toEqual([]);
  });

  test('mapa de dietas com o jejum do bloco → fechar no corte → etiqueta ZPL → acompanhante; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.COPA');
    const o = await (await page.request.get('/api/nutricao/mapa/opcoes?unidade=2A')).json();
    // O almoço que já passou do corte e ainda está na janela do fechamento (até 24 h depois de servir): o de hoje,
    // depois do corte; antes dele, o de ontem (servido ontem, fecha até o horário de servir de hoje).
    const almoco = o.refeicoes.find((r: { codigo: number }) => r.codigo === 2);
    const ontem = new Date(Date.parse(`${o.hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const dia = o.agora.slice(11, 16) > almoco.corte ? o.hoje : ontem;
    const dataBr = `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
    await page.goto('/nutricao/mapa');
    await expect(page.getByTestId('tela-mapa-dietas')).toBeVisible();
    await escolher(page.getByTestId('mapa-unidade'), '2A');
    await escolher(page.getByTestId('mapa-refeicao'), '2');
    const campoData = page.getByTestId('mapa-filtros').locator('.sgh-data input').first();
    await campoData.fill(dataBr);
    await campoData.press('Tab');
    await page.getByTestId('mapa-abrir').click();
    await expect(page.getByTestId('mapa-corte')).toContainText('Passou do corte');
    // O jejum do bloco prevalece sobre a dieta oral; a alergia alimentar no mapa.
    await expect(page.getByTestId('mapa-950002')).toHaveAttribute('data-tipo', 'jejum');
    await expect(page.getByTestId('mapa-jejum-950002')).toContainText('Jejum para a cirurgia');
    await expect(page.getByTestId('mapa-950001')).toContainText('Leite');
    await expect(page.getByTestId('mapa-950001')).toContainText('Hipossódica');
    await expect(page.getByTestId('mapa-contagens')).toContainText('Jejum: 1');
    await semViolacaoAxe(page, '/nutricao/mapa');

    await page.getByTestId('mapa-fechar').click();
    await expect(page.getByTestId('mapa-mensagem')).toContainText('Mapa fechado');
    await expect(page.getByTestId('mapa-retrato')).toContainText('4 internado(s), 1 em jejum');
    await expect(page.getByTestId('mapa-fechar')).toHaveCount(0);

    await page.getByTestId('mapa-etiquetas').click();
    await expect(page.getByTestId('mapa-mensagem')).toContainText('3 etiqueta(s) gerada(s); 1 sem bandeja');
    const zpl = page.getByTestId('mapa-zpl');
    await zpl.locator('summary').click();
    await expect(zpl).toContainText('^XA');
    await expect(zpl).toContainText('MARIA SINTETICA DA SILVA');
    await expect(zpl).toContainText('ALERGIA ALIMENTAR: LEITE');
    await expect(zpl).not.toContainText('JOAO SINTETICO');
    await expect(page.getByTestId('mapa-baixar-etiquetas')).toBeVisible();

    // A refeição do acompanhante da pessoa idosa (direito legal conferido pelo nascimento).
    await page.getByTestId('acompanhante-950001').click();
    const dlg = page.getByTestId('dialogo-acompanhante');
    await expect(dlg).toBeVisible();
    await semViolacaoAxe(page, '/nutricao/mapa (acompanhante)');
    await dlg.getByTestId('acompanhante-gravar').click();
    await expect(page.getByTestId('mapa-mensagem')).toContainText('Refeição do acompanhante registrada.');
    await expect(page.getByTestId('mapa-950001')).toContainText('Pessoa idosa');
    expect(externas).toEqual([]);
  });

  test('serviço social: avaliação com a barreira social (CP1252); o parecer só para a categoria; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SOCIAL');
    await page.goto('/servico-social');
    await expect(page.getByTestId('tela-fila-social')).toBeVisible();
    await semViolacaoAxe(page, '/servico-social');
    await page.getByTestId('social-abrir-950005').click();
    await expect(page).toHaveURL(/\/servico-social\/950005$/);
    const f = page.getByTestId('form-social');
    await escolher(page.getByTestId('social-rede'), 'fragil');
    await f.getByLabel('Sem cuidador para os cuidados após a alta').check();
    await f.getByLabel('Contato e orientação à família').check();
    await expect(page.getByTestId('social-risco-calculado')).toContainText('médio');
    await f.getByLabel('Parecer social (só a assistente social lê)').fill(PARECER);
    await f.getByLabel('Orientações à equipe (a equipe vê)').fill('Avisar o serviço social antes da alta.');
    await page.getByTestId('social-com-barreira').check();
    await f.getByLabel('Barreira social (o que impede a alta)').fill('Sem cuidador para a alta');
    const prazo = f.locator('.sgh-data input').first();
    const hoje = new Date();
    const em3 = new Date(hoje.getTime() + 3 * 86_400_000);
    const br = (x: Date) =>
      `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
    await prazo.fill(br(em3));
    await prazo.press('Tab');
    await semViolacaoAxe(page, '/servico-social/950005 (registro)');
    await page.getByTestId('social-gravar').click();
    await expect(page.getByTestId('social-mensagem')).toContainText('a barreira social foi para o NIR');
    await expect(page.getByTestId('social-parecer')).toContainText(PARECER);
    await expect(page.getByTestId('social-barreiras')).toContainText('Sem cuidador para a alta');

    // A equipe com vínculo vê o registro e as orientações, sem o parecer (dado sensível).
    const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
    const nutri = await ctx.newPage();
    await entrar(nutri, 'SINT.NUTRI.CLINICA');
    await nutri.goto('/servico-social/950005');
    await expect(nutri.getByTestId('social-sigilo')).toContainText('restrito à categoria');
    await expect(nutri.getByTestId('tela-servico-social')).toContainText(
      'Avisar o serviço social antes da alta.',
    );
    await expect(nutri.getByTestId('tela-servico-social')).not.toContainText('mora sozinha');
    await semViolacaoAxe(nutri, '/servico-social/950005 (equipe)');
    await ctx.close();
    expect(externas).toEqual([]);
  });
});
