// E2E @W0-05 (programa CRUD completo; critério de aceite 1): a inclusão, a alteração e a exclusão lógica da nutrição, do
// serviço social, da oncologia e do lactário pelo diálogo único de correção, sempre com o motivo obrigatório (menos de
// 5 letras não confirma) e, nas operações críticas, a senha de novo. A versão inativa continua visível (riscada, com
// quem, quando e o motivo) e a impressão da tela a mantém. axe sem violação séria nas telas e nos diálogos. Sessão real
// sobre a fonte sintética e as portas em MEMÓRIA (dados SINTÉTICOS; nada vai à cópia; nenhuma mensagem a paciente).
import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { ORIGEM, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function novaAba(browser: Browser, login: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: ORIGEM, timezoneId: 'America/Sao_Paulo' });
  const p = await ctx.newPage();
  await entrar(p, login);
  return p;
}

/**
 * O diálogo de correção: o motivo curto não confirma; com a senha (crítica), só confirma com ela; fecha ao gravar.
 * `antes` preenche os campos próprios da ação (no slot) antes do motivo.
 */
async function corrigir(
  page: Page,
  motivo: string,
  opcoes: { senha?: boolean; axe?: string; antes?: (f: Locator) => Promise<void> } = {},
): Promise<void> {
  const f = page.getByTestId('form-correcao');
  await expect(f).toBeVisible();
  if (opcoes.antes) await opcoes.antes(f);
  const confirmar = f.getByTestId('correcao-confirmar');
  await f.getByTestId('correcao-motivo').fill('abc');
  await expect(confirmar).toBeDisabled();
  await f.getByTestId('correcao-motivo').fill(motivo);
  if (opcoes.senha) {
    await expect(confirmar).toBeDisabled();
    await f.getByTestId('correcao-senha').fill(SENHA);
  }
  if (opcoes.axe) await semViolacaoAxe(page, opcoes.axe);
  await expect(confirmar).toBeEnabled();
  await confirmar.click();
  await expect(f).toHaveCount(0);
}

/** O instante civil "AAAA-MM-DDTHH:MM" `horas` antes de `agora` (o relógio do estabelecimento, lido da API). */
const antes = (agora: string, horas: number) =>
  new Date(Date.parse(`${agora}:00Z`) - horas * 3_600_000).toISOString().slice(0, 16);

test.describe('CRUD da nutrição, do serviço social, da oncologia e do lactário @W0-05 @crud', () => {
  test.setTimeout(420_000);
  test.use({ actionTimeout: 30_000 });

  test('nutrição: triagem retificada e estornada; ficha EMTN com a meta alterada e o dia retificado e estornado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.NUTRI.CLINICA');
    await page.goto('/nutricao/triagem');
    await expect(page.getByTestId('tela-fila-nutricao')).toBeVisible();
    // A triagem da ANA (sem risco: nenhuma resposta "sim").
    await page.getByTestId('triar-950003').click();
    await page.getByTestId('triagem-gravar').click();
    await expect(page.getByTestId('triagem-gravada')).toContainText('Triagem gravada');
    const lista = (await (await page.request.get('/api/nutricao/internacoes/950003/triagens')).json()) as {
      itens: { id: number; situacao: string }[];
    };
    const original = Math.max(...lista.itens.filter((x) => x.situacao === 'ativo').map((x) => x.id));

    // O histórico: a autora retifica (nova versão com o motivo obrigatório).
    await page.getByTestId('historico-950003').click();
    const hist = page.getByTestId('triagens-historico');
    await expect(hist.getByTestId(`triagem-${original}`)).toHaveAttribute('data-situacao', 'ativo');
    await semViolacaoAxe(page, '/nutricao/triagem (histórico)');
    await hist.getByTestId(`triagem-retificar-${original}`).click();
    const d = page.getByTestId('dialogo-triagem');
    await d.getByRole('group', { name: 'Perdeu peso nos últimos 3 meses?' }).getByLabel('Sim').check();
    await d.getByRole('group', { name: 'Estado nutricional' }).getByLabel(/^1:/).check();
    await d.getByRole('group', { name: 'Gravidade da doença' }).getByLabel(/^1:/).check();
    await d.getByTestId('triagem-motivo').fill('abc');
    await expect(d.getByTestId('triagem-gravar')).toBeDisabled();
    await d.getByTestId('triagem-motivo').fill('Perda de peso relatada pela família depois da triagem');
    await semViolacaoAxe(page, '/nutricao/triagem (retificar)');
    await d.getByTestId('triagem-gravar').click();
    await expect(page.getByTestId('triagem-corrigida')).toBeVisible();
    const antiga = hist.getByTestId(`triagem-${original}`);
    await expect(antiga).toHaveAttribute('data-situacao', 'retificado');
    await expect(hist.getByTestId(`triagem-correcao-${original}`)).toContainText(
      'Perda de peso relatada pela família',
    );
    await expect(hist.getByTestId(`triagem-correcao-${original}`)).toContainText('SINT.NUTRI.CLINICA');
    const nova = hist.locator('article[data-situacao="ativo"]').filter({ hasText: 'Versão nova' }).first();
    await expect(nova).toContainText('2 ponto(s)');
    // O estorno da versão nova (o motivo obrigatório); as duas continuam visíveis e a impressão está à mão.
    await nova.getByRole('button', { name: 'Estornar' }).click();
    await corrigir(page, 'Triagem registrada no paciente errado do quarto', {
      axe: '/nutricao/triagem (estornar)',
    });
    await expect(hist.locator('article[data-situacao="estornado"]')).toHaveCount(1);
    await expect(hist.locator('article[data-situacao="estornado"]')).toContainText('Estornado em');
    await expect(antiga).toBeVisible();
    await expect(hist.getByTestId('triagens-imprimir')).toBeVisible();

    // A ficha EMTN: a meta alterada vira versão nova; o dia informado é retificado e depois estornado.
    await page.goto('/nutricao/terapia/950004');
    await expect(page.getByTestId('terapia-dietas')).toContainText('DIETA ENTERAL');
    // Sem meta vigente (rodado sozinho), registra a enteral antes (o formulário segue para as outras vias).
    if (await page.getByTestId('terapia-sem-meta').isVisible()) {
      await page.getByLabel('Peso de referência (kg)').fill('70');
      await page.getByTestId('meta-gravar').click();
      await expect(page.getByTestId('terapia-meta-vigente')).toBeVisible();
    }
    await page.getByTestId('meta-alterar').click();
    await corrigir(page, 'Reavaliação da EMTN: meta calórica reduzida', {
      antes: async (f) => {
        await f.getByLabel('Peso de referência (kg)').fill('68');
      },
      axe: '/nutricao/terapia/950004 (alterar a meta)',
    });
    await expect(page.getByTestId('terapia-versoes')).toContainText('Substituída');
    await expect(page.getByTestId('terapia-versoes')).toContainText('meta calórica reduzida');
    // O acompanhamento na aba dele; retificar e estornar só nos dias da própria autora.
    await page.getByTestId('terapia-aba-acompanhamento').click();
    const dias = page.getByTestId('terapia-acompanhamentos');
    const meus = page
      .locator('li[data-situacao="ativo"]')
      .filter({ has: page.getByTestId('acompanhamento-retificar') });
    if ((await meus.count()) === 0) {
      await page.getByLabel('Volume infundido (mL) — só se a checagem não traz').fill('1600');
      await page.getByTestId('acompanhamento-gravar').click();
      await expect(page.getByTestId('terapia-mensagem')).toContainText('% da meta calórica');
    }
    const ativos = await dias.locator('li[data-situacao="ativo"]').count();
    await meus.first().getByTestId('acompanhamento-retificar').click();
    await corrigir(page, 'Volume da bomba conferido no fim do plantão', {
      antes: async (f) => {
        await f.getByTestId('retificar-volume').fill('1500');
      },
    });
    await expect(dias.locator('li[data-situacao="retificado"]').first()).toContainText('Retificado');
    await expect(dias.locator('li[data-situacao="ativo"]')).toHaveCount(ativos);
    await dias
      .locator('li[data-situacao="ativo"]')
      .filter({ has: page.getByTestId('acompanhamento-estornar') })
      .first()
      .getByTestId('acompanhamento-estornar')
      .click();
    await corrigir(page, 'Registro do dia em duplicidade com a checagem');
    await expect(dias.locator('li[data-situacao="estornado"]').first()).toContainText('Estornado');
    await semViolacaoAxe(page, '/nutricao/terapia/950004 (correções)');
    // Revisão: encerrar a meta não some com nada: a meta encerrada (quem, quando, o motivo) nas versões e o histórico
    // do dia (o retificado e o estornado) continuam na ficha; o "Imprimir" está no cartão do paciente.
    await page.getByTestId('terapia-aba-meta').click();
    await page.getByTestId('meta-encerrar').click();
    await corrigir(page, 'Alta da terapia enteral: dieta oral plena', {
      axe: '/nutricao/terapia/950004 (encerrar a meta)',
    });
    await expect(page.getByTestId('terapia-sem-meta')).toBeVisible();
    const encerrada = page.getByTestId('terapia-versoes').locator('li[data-situacao="encerrada"]');
    await expect(encerrada).toContainText('Encerrada');
    await expect(encerrada).toContainText('dieta oral plena');
    await expect(encerrada).toContainText('SINT.NUTRI.CLINICA');
    await page.getByTestId('terapia-aba-acompanhamento').click();
    await expect(dias.locator('li[data-situacao="retificado"]').first()).toBeVisible();
    await expect(dias.locator('li[data-situacao="estornado"]').first()).toBeVisible();
    await expect(page.getByTestId('terapia-dia-sem-meta')).toBeVisible();
    await expect(page.getByTestId('terapia-imprimir')).toBeVisible();
    // A impressão junta as abas: na mídia de impressão, o histórico e as versões aparecem juntos e sem as ações.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('terapia-versoes')).toBeVisible();
    await expect(dias).toBeVisible();
    await expect(page.getByTestId('terapia-imprimir')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await semViolacaoAxe(page, '/nutricao/terapia/950004 (meta encerrada)');
    expect(externas).toEqual([]);
  });

  test('serviço social: adendo e estorno com o motivo, o estornado visível; acompanhante alterado com o histórico; axe', async ({
    page,
    browser,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.SOCIAL');
    await page.goto('/servico-social/950005');
    const f = page.getByTestId('form-social');
    await f
      .getByLabel('Parecer social (só a assistente social lê)')
      .fill('Avaliação social SINTÉTICA do W0-05: família presente e orientada.');
    await page.getByTestId('social-gravar').click();
    await expect(page.getByTestId('social-mensagem')).toBeVisible();
    const registro = page
      .locator('article[data-testid^="social-registro-"][data-situacao="ativo"]')
      .filter({ hasText: 'W0-05' })
      .first();
    const id = (await registro.getAttribute('data-testid'))!.replace('social-registro-', '');
    await page.getByTestId(`social-adendo-${id}`).click();
    await corrigir(page, 'Complemento depois do contato com a filha', {
      antes: async (dlg) => {
        await dlg.getByTestId('social-adendo-texto').getByRole('textbox').fill('A filha assume os cuidados.');
      },
      axe: '/servico-social/950005 (adendo)',
    });
    await expect(page.getByTestId('social-mensagem')).toBeVisible();
    await expect(page.getByTestId('tela-servico-social')).toContainText('A filha assume os cuidados.');
    await expect(page.getByTestId('tela-servico-social')).toContainText('Motivo do adendo');
    await page.getByTestId(`social-estornar-${id}`).click();
    await corrigir(page, 'Registro feito na internação errada');
    const estornado = page.getByTestId(`social-registro-${id}`);
    await expect(estornado).toHaveAttribute('data-situacao', 'estornado');
    await expect(page.getByTestId(`social-situacao-${id}`)).toContainText('Estornado');
    await expect(page.getByTestId(`social-correcao-${id}`)).toContainText(
      'Registro feito na internação errada',
    );
    await expect(page.getByTestId('social-imprimir')).toBeVisible();
    await semViolacaoAxe(page, '/servico-social/950005 (estornado)');

    // A copa altera a refeição do acompanhante (o valor anterior no histórico).
    const copa = await novaAba(browser, 'SINT.COPA');
    const o = await (await copa.request.get('/api/nutricao/mapa/opcoes?unidade=2A')).json();
    const almoco = o.refeicoes.find((r: { codigo: number }) => r.codigo === 2);
    const ontem = new Date(Date.parse(`${o.hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const dia = o.agora.slice(11, 16) > almoco.corte ? o.hoje : ontem;
    await copa.goto('/nutricao/mapa');
    await escolher(copa.getByTestId('mapa-unidade'), '2A');
    await escolher(copa.getByTestId('mapa-refeicao'), '2');
    const campoData = copa.getByTestId('mapa-filtros').locator('.sgh-data input').first();
    await campoData.fill(`${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`);
    await campoData.press('Tab');
    await copa.getByTestId('mapa-abrir').click();
    await copa.getByTestId('acompanhante-950001').click();
    const dlg = copa.getByTestId('dialogo-acompanhante');
    await expect(dlg).toBeVisible();
    // Sem o acompanhante vigente (rodado sozinho), registra antes; a leitura do vigente pode chegar depois do diálogo.
    const alterar = dlg.getByTestId('acompanhante-alterar');
    await expect(alterar.or(dlg.getByTestId('acompanhante-gravar'))).toBeVisible();
    if (!(await alterar.isVisible())) {
      await dlg.getByTestId('acompanhante-gravar').click();
      await expect(copa.getByTestId('mapa-mensagem')).toContainText('Refeição do acompanhante registrada.');
      await expect(dlg).toHaveCount(0);
      await copa.getByTestId('acompanhante-950001').click();
      await expect(dlg).toBeVisible();
    }
    await expect(alterar).toBeVisible({ timeout: 15_000 });
    await dlg.getByTestId('acompanhante-alterar').click();
    await corrigir(copa, 'Acompanhante almoça fora no fim de semana', {
      antes: async (fc) => {
        await fc.getByTestId('acompanhante-dieta').getByRole('textbox').fill('Dieta livre');
      },
      axe: '/nutricao/mapa (alterar o acompanhante)',
    });
    await expect(copa.getByTestId('mapa-mensagem')).toBeVisible();
    await copa.getByTestId('acompanhante-950001').click();
    await expect(copa.getByTestId('acompanhante-historico')).toContainText('Alterada');
    await expect(copa.getByTestId('acompanhante-historico')).toContainText('almoça fora');
    expect(externas).toEqual([]);
  });

  test('oncologia: ajustar, suspender, retomar, desfazer a ligação; revogar com a lista e a ciência (senha); cancelar (senha); inativar e reativar; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ESPECIALISTA');
    await page.goto('/pep/especialidades/oncologia/protocolos');
    await page.getByTestId('protocolos-aba-publicar').click();
    const p = page.getByTestId('form-protocolo');
    await p.getByLabel('Código do protocolo').fill('W005-ONC');
    await p.getByLabel('Nome do protocolo').fill('Paclitaxel semanal — SINTÉTICO');
    await escolher(p.getByLabel('Tipo de protocolo'), '3');
    await p.getByLabel('Fármaco 1 (nome genérico)').fill('Paclitaxel');
    await p.getByLabel('Dose do fármaco 1').fill('80');
    await p.getByLabel('Referência', { exact: true }).fill('Protocolo institucional SINTÉTICO W0-05');
    await p.getByTestId('protocolo-publicar').click();
    await expect(page.getByTestId('protocolo-mensagem')).toContainText('versão 1');
    const versao = page.getByTestId('protocolo-W005-ONC-v1');
    await expect(versao).toHaveAttribute('data-ofertavel', 'sim');

    // O ciclo 1, ligado à prescrição do dia previsto.
    await page.goto('/pep/especialidades/oncologia/950102');
    await page.getByTestId('onco-aba-novo').click();
    const c = page.getByTestId('form-ciclo');
    await escolher(page.getByTestId('ciclo-protocolo'), { rotulo: /W005-ONC v1/ });
    const amanha = await page.evaluate(() => {
      const d = new Date(Date.now() + 86_400_000);
      const p2 = (n: number) => String(n).padStart(2, '0');
      return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
    });
    const data = c.locator('.sgh-data input').first();
    await data.fill(amanha);
    await data.press('Tab');
    await c.getByLabel('Peso do dia (kg)').fill('70');
    await c.getByLabel('Altura (cm)').fill('170');
    await c.getByTestId('ciclo-gravar').click();
    await expect(page.getByTestId('ciclo-mensagem')).toContainText('superfície');
    const ciclo = page.locator('article[data-testid^="ciclo-"]').filter({ hasText: 'W005-ONC' }).first();
    const id = (await ciclo.getAttribute('data-testid'))!.replace('ciclo-', '');
    await expect(ciclo).toHaveAttribute('data-andamento', 'ativo');

    // Ajustar antes da validação: a redução recalcula a dose; a versão anterior fica visível, riscada e inativa.
    await page.getByTestId(`ciclo-ajustar-${id}`).click();
    await corrigir(page, 'Neutropenia no hemograma de ontem', {
      antes: async (f) => {
        await f.getByTestId('ajuste-reducao').fill('20');
        await f.getByTestId('ajuste-motivo-reducao').getByRole('textbox').fill('Neutropenia grau 2');
        // Revisão: o campo cru do diálogo (montado no body) tem o estilo do tema, não o do navegador.
        await expect(f.getByTestId('ajuste-reducao')).toHaveCSS('border-radius', '6px');
      },
      axe: '/pep/especialidades/oncologia/950102 (ajustar)',
    });
    await expect(ciclo).toContainText('redução de 20%');
    await expect(page.getByTestId(`ciclo-eventos-${id}`)).toContainText('Ciclo ajustado');
    const versoes = page.getByTestId(`ciclo-versoes-${id}`);
    await expect(versoes).toContainText('Versão anterior (inativa)');
    await expect(versoes).toContainText('redução de 0%');
    await expect(versoes).toContainText('Neutropenia no hemograma de ontem');
    await expect(versoes.locator('.cartao-registro.inativo')).toHaveCount(1);

    // A prescrição do dia ligada; com ela, mudar a redução é recusado dentro do diálogo (desfazer a ligação antes).
    await ciclo.getByRole('button', { name: 'Ligar a prescrição dos medicamentos' }).click();
    await ciclo.locator('[data-testid$="-990201"]').click();
    await expect(page.getByTestId(`ciclo-prescricoes-${id}`)).toContainText('990201');
    await page.getByTestId(`ciclo-ajustar-${id}`).click();
    const fa = page.getByTestId('form-correcao');
    await fa.getByTestId('ajuste-reducao').fill('25');
    await fa.getByTestId('correcao-motivo').fill('Nova redução depois de ligar a prescrição');
    await fa.getByTestId('correcao-confirmar').click();
    await expect(fa.getByTestId('correcao-erro')).toContainText('desfaça a ligação');
    await fa.getByRole('button', { name: 'Voltar' }).click();
    await expect(fa).toHaveCount(0);
    // Suspender (categoria e motivo) e retomar.
    await page.getByTestId(`ciclo-suspender-${id}`).click();
    await corrigir(page, 'Aguardar a recuperação medular', {
      antes: async (f) => {
        await escolher(f.getByTestId('ciclo-categoria'), 'toxicidade');
      },
    });
    await expect(ciclo).toHaveAttribute('data-andamento', 'suspenso');
    await expect(page.getByTestId(`ciclo-andamento-${id}`)).toContainText('Suspenso');
    await page.getByTestId(`ciclo-retomar-${id}`).click();
    await corrigir(page, 'Hemograma recuperado, liberado pela equipe');
    await expect(ciclo).toHaveAttribute('data-andamento', 'ativo');
    // Desfazer a ligação: só o vínculo sai; a prescrição continua (a prova na cópia está em packages/testes).
    await page.getByTestId(`ciclo-desligar-${id}-990201`).click();
    await corrigir(page, 'Prescrição ligada ao ciclo errado');
    await expect(page.getByTestId(`ciclo-prescricoes-${id}`)).toContainText('Nenhuma prescrição');
    await expect(page.getByTestId(`ciclo-eventos-${id}`)).toContainText('Ligação com a prescrição desfeita');

    // Revogar a versão: a lista dos ciclos em andamento, a ciência e a senha.
    await page.goto('/pep/especialidades/oncologia/protocolos');
    const vid = (await versao
      .locator('[data-testid^="protocolo-revogar-"]')
      .getAttribute('data-testid'))!.replace('protocolo-revogar-', '');
    await versao.getByTestId(`protocolo-revogar-${vid}`).click();
    const lista = page.getByTestId('revogar-ciclos');
    await expect(lista).toContainText('1 em andamento de 1');
    await expect(lista).toContainText('internação 950102');
    await corrigir(page, 'Esquema substituído pela diretriz nova do serviço', {
      senha: true,
      antes: async (f) => {
        await f.getByTestId('correcao-motivo').fill('Esquema substituído pela diretriz nova do serviço');
        await f.getByTestId('correcao-senha').fill(SENHA);
        // Sem a ciência dos ciclos em andamento, não confirma.
        await expect(f.getByTestId('correcao-confirmar')).toBeDisabled();
        await f.getByTestId('revogar-ciente').check();
        await f.getByTestId('correcao-senha').fill('');
      },
      axe: '/pep/especialidades/oncologia/protocolos (revogar)',
    });
    // Revogada, a versão sai dos oferecidos e fica na aba "Fora da oferta".
    await page.getByTestId('protocolos-aba-fora').click();
    await expect(page.getByTestId(`protocolo-revogada-${vid}`)).toBeVisible();
    await expect(versao).toHaveAttribute('data-ofertavel', 'nao');
    await expect(page.getByTestId(`protocolo-eventos-${vid}`)).toContainText('Versão revogada');
    // Inativar (senha) e reativar o protocolo: nada some.
    await page.getByTestId(`protocolo-inativar-${vid}`).click();
    await corrigir(page, 'Protocolo fora da padronização do hospital', { senha: true });
    await expect(page.getByTestId(`protocolo-inativo-${vid}`)).toBeVisible();
    await page.getByTestId(`protocolo-reativar-${vid}`).click();
    await corrigir(page, 'Protocolo volta à padronização após revisão');
    await expect(page.getByTestId(`protocolo-inativo-${vid}`)).toHaveCount(0);
    await expect(versao).toBeVisible();
    await expect(page.getByTestId('protocolos-imprimir')).toBeVisible();

    // O ciclo continua com a versão revogada; cancelar é crítico (senha) e o cancelado continua visível.
    await page.goto('/pep/especialidades/oncologia/950102');
    await expect(ciclo).toBeVisible();
    await page.getByTestId(`ciclo-cancelar-${id}`).click();
    await corrigir(page, 'Paciente optou por cuidados paliativos exclusivos', {
      senha: true,
      antes: async (f) => {
        await escolher(f.getByTestId('ciclo-categoria'), 'desistencia');
      },
      axe: '/pep/especialidades/oncologia/950102 (cancelar)',
    });
    await expect(ciclo).toHaveAttribute('data-andamento', 'cancelado');
    await expect(page.getByTestId(`ciclo-eventos-${id}`)).toContainText('Ciclo cancelado');
    await expect(page.getByTestId(`ciclo-eventos-${id}`)).toContainText('Desistência do paciente');
    await expect(page.getByTestId(`ciclo-cancelar-${id}`)).toHaveCount(0);
    await expect(page.getByTestId('onco-imprimir')).toBeVisible();
    await semViolacaoAxe(page, '/pep/especialidades/oncologia/950102 (cancelado)');
    expect(externas).toEqual([]);
  });

  test('lactário: alterar antes da conferência; depois só cancelar; a cancelada visível com o motivo e o histórico; axe', async ({
    browser,
  }) => {
    const lact = await novaAba(browser, 'SINT.LACTARIO');
    const externas = vigiarExternas(lact);
    await lact.goto('/nutricao/lactario');
    const o = lact.getByTestId('form-lactario');
    await escolher(lact.getByTestId('lactario-internacao'), { rotulo: /BEBE SINTETICO LACTARIO/ });
    await o.getByLabel('Fórmula').fill('Fórmula infantil W005');
    await o.getByLabel('Volume por porção (mL)').fill('60');
    const agora = ((await (await lact.request.get('/api/nutricao/lactario')).json()) as { lidoEm: string })
      .lidoEm;
    await o
      .getByLabel(/Horários das porções/)
      .fill(`${antes(agora, -1).slice(11, 16)}, ${antes(agora, -3).slice(11, 16)}`);
    await o.getByLabel('Preparo').fill(antes(agora, 0.2));
    await o.getByTestId('lactario-gravar').click();
    await expect(lact.getByTestId('lactario-mensagem')).toContainText('porção(ões) de 60 mL');
    const linha = lact
      .locator('tr[data-testid^="ordem-"]')
      .filter({ hasText: 'Fórmula infantil W005' })
      .first();
    const id = (await linha.getAttribute('data-testid'))!.replace('ordem-', '');

    // Antes da conferência: alterar (o valor anterior no histórico).
    await lact.getByTestId(`ordem-alterar-${id}`).click();
    await corrigir(lact, 'Volume ajustado pela prescrição da pediatria', {
      antes: async (f) => {
        await f.getByTestId('alterar-volume').fill('70');
        // Revisão: os campos crus do diálogo (número e data e hora) com o estilo do tema.
        await expect(f.getByTestId('alterar-volume')).toHaveCSS('border-radius', '6px');
        await expect(f.locator('#alt-preparo')).toHaveCSS('border-radius', '6px');
      },
      axe: '/nutricao/lactario (alterar)',
    });
    await expect(linha).toContainText('70 mL');
    await expect(lact.getByTestId(`ordem-historico-${id}`)).toContainText('Alterada');

    // Outra pessoa confere e emite a etiqueta; depois disso, só cancelar.
    const lact2 = await novaAba(browser, 'SINT.LACTARIO2');
    await lact2.goto('/nutricao/lactario');
    await lact2.getByTestId(`ordem-conferir-${id}`).click();
    await expect(lact2.getByTestId('lactario-mensagem')).toContainText('Ordem conferida');
    await lact2.getByTestId(`ordem-etiquetas-${id}`).click();
    await expect(lact2.getByTestId('lactario-mensagem')).toContainText('etiqueta(s)');
    await lact.reload();
    await expect(lact.getByTestId(`ordem-alterar-${id}`)).toHaveCount(0);
    await lact.getByTestId(`ordem-cancelar-${id}`).click();
    await expect(lact.getByTestId('correcao-alerta')).toContainText('etiqueta desta ordem já foi emitida');
    await corrigir(lact, 'Prescrição da fórmula suspensa pela pediatria', {
      axe: '/nutricao/lactario (cancelar)',
    });
    const cancelada = lact.getByTestId(`ordem-${id}`);
    await expect(cancelada).toHaveAttribute('data-situacao', 'cancelada');
    await expect(lact.getByTestId(`ordem-cancelada-${id}`)).toContainText('Cancelada');
    await expect(cancelada).toContainText('Prescrição da fórmula suspensa pela pediatria');
    await expect(lact.getByTestId(`ordem-cancelar-${id}`)).toHaveCount(0);
    const historico = lact.getByTestId(`ordem-historico-${id}`);
    await expect(historico).toContainText('Cancelada');
    await expect(historico).toContainText('Etiqueta emitida');
    await expect(historico).toContainText('Alterada');
    await expect(lact.getByTestId('lactario-imprimir')).toBeVisible();
    await semViolacaoAxe(lact, '/nutricao/lactario (cancelada)');
    expect(externas).toEqual([]);
  });
});
