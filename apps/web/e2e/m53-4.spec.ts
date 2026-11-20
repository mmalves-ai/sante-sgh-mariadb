// E2E @M53.4 (ficha do M53, etapa F3: férias e 13º salário; seções 1, 6 a 8 na parte da F3): com a folha desligada, as
// abas Férias e 13º salário ficam em consulta (sem programar nem calcular) → o administrador liga a folha, o cadastro de
// colaboradores e o "Meu espaço" → o RH admite a colaboradora em 1º de janeiro de dois anos atrás → o departamento
// pessoal registra os parâmetros (com as rubricas dos papéis de férias e do 13º, com busca) e o salário → a aba Férias
// mostra os períodos aquisitivos com direito e saldo → programar com início no passado e numa sexta-feira volta com as
// duas recusas da CLT de uma vez, traduzidas → programar numa segunda-feira com a previsão do fim e do pagamento → a
// escala mostra a programação → prévia do recibo (memória e prova do líquido, sem gravar) → cálculo com a confirmação →
// recibo gravado e o aviso e recibo em PDF → cancelar com motivo → 13º do ano: prévia e cálculo da 1ª parcela, memória,
// e a parcela final (barrada antes de dezembro; em dezembro, com o desconto do adiantado) → quem só consulta a folha vê
// o 13º sem a grade e sem a aba Férias → a colaboradora abre "Minhas férias" pelo Meu espaço (sem valores) → recolher. Axe sem violação
// séria em cada estado. Sessão real sobre a fonte sintética de dev; pessoas e folha em MEMÓRIA (nada vai à cópia); CPF
// SINTÉTICO.
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

function dv11(base: string, pesos: readonly number[]): number {
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base[i]) * p));
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
function cpf(base9: string): string {
  const d1 = dv11(base9, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv11(`${base9}${d1}`, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base9}${d1}${d2}`;
}
const p2 = (x: number) => String(x).padStart(2, '0');
const br = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;

async function chave(page: Page, recurso: string, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)', {
    timeout: 30_000,
  });
}
/** Registra a conferência e liga o recurso (se outro cenário já o ligou, segue). */
async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  await expect(page.getByTestId(`recurso-${recurso}`)).toBeVisible({ timeout: 30_000 });
  const cartao = await page.getByTestId(`recurso-${recurso}`).innerText();
  if (cartao.includes('Ligada')) return;
  if (cartao.includes('Sem pré-requisito externo')) return chave(page, recurso, true, evidencia);
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
  await chave(page, recurso, true, evidencia);
}

const campo = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();
async function data(page: Page, id: string, d: Date): Promise<void> {
  const c = campo(page, id);
  await c.fill(br(d));
  await c.press('Tab');
}

async function abrirFolha(page: Page): Promise<void> {
  await page.goto('/pessoas/folha');
  await expect(page.getByRole('heading', { level: 1, name: 'Folha de pagamento' })).toBeVisible();
  await expect(page.getByTestId('folha-filtros')).toBeVisible({ timeout: 30_000 });
}

// Rubricas sintéticas: os proventos de férias e do 13º na rubrica de provento, os descontos na de desconto (o servidor
// confere o tipo de cada papel); os papéis da folha mensal como no E2E do M53.3.
const PROVENTO = '1 · Salário base';
const DESCONTO = '4 · Desconto de INSS';
const RUBRICAS: readonly [string, string][] = [
  ['salario', PROVENTO],
  ['inss', DESCONTO],
  ['irrf', DESCONTO],
  ['fgts', '5 · Base de cálculo do FGTS'],
  ['feriasGozo', PROVENTO],
  ['feriasMedias', PROVENTO],
  ['feriasTerco', PROVENTO],
  ['abonoPecuniario', PROVENTO],
  ['abonoTerco', PROVENTO],
  ['feriasDobra', PROVENTO],
  ['inssFerias', DESCONTO],
  ['irrfFerias', DESCONTO],
  ['decimoAdiantamento', PROVENTO],
  ['decimoPrimeira', PROVENTO],
  ['decimoTerceiro', PROVENTO],
  ['decimoMedias', PROVENTO],
  ['decimoDesconto', DESCONTO],
  ['inssDecimo', DESCONTO],
  ['irrfDecimo', DESCONTO],
];
async function vigenciaDosParametros(page: Page, inicio: Date): Promise<void> {
  await page.getByTestId('folha-parametro-novo').click();
  await expect(page.getByTestId('folha-parametro-form')).toBeVisible();
  await data(page, 'folha-parametro-inicio', inicio);
  for (const [papel, rotulo] of RUBRICAS)
    await escolher(page.getByTestId(`folha-parametro-rubrica-campo-${papel}`), { rotulo });
  await page.getByTestId('folha-parametro-gravar').click();
  await expect(page.getByTestId('folha-parametro-aviso')).toBeVisible({ timeout: 30_000 });
}

test.describe('folha de pagamento, etapa F3: férias e 13º salário @M53.4', () => {
  test.setTimeout(900_000);

  test('desligado → ligar → admitir → parâmetros → salário → períodos → recusas → programar → escala → prévia → recibo → PDF → cancelar → 13º 1ª e final → consulta → Minhas férias → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    // Admitida em 1º de janeiro de dois anos atrás; o 13º é o do ano corrente (a tabela legal sintética de 2025 tem um
    // buraco de propósito, para a conferência das faixas).
    const admissao = new Date(hoje.getFullYear() - 2, 0, 1);
    const anoDecimo = hoje.getFullYear();
    // O 2º período aquisitivo (o ano passado inteiro) está completo e dentro do prazo de concessão.
    const periodo = `${hoje.getFullYear() - 1}-01-01`;
    // A última sexta-feira antes de hoje (recusada duas vezes: no passado e na véspera do descanso) e a primeira segunda
    // depois de 35 dias (fora do aviso curto de 30 dias).
    const sexta = new Date(
      hoje.getFullYear(),
      hoje.getMonth(),
      hoje.getDate() - ((hoje.getDay() + 2) % 7 || 7),
    );
    const segunda = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 35);
    while (segunda.getDay() !== 1) segunda.setDate(segunda.getDate() + 1);
    // Uma vigência nova (se outro cenário já registrou uma mais nova que a admissão) desde o mês anterior: a tela mostra a
    // vigência da competência escolhida, que abre na anterior a hoje.
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const sufixo = Date.now().toString(36).toUpperCase();

    // Folha desligada: as abas de férias e do 13º abrem em consulta, sem programar nem calcular.
    await entrar(page, 'SINT.DP.FOLHA');
    await (await itemDoMenu(page, 'Folha de pagamento')).click();
    await expect(page).toHaveURL(/\/pessoas\/folha$/);
    await expect(page.getByTestId('folha-filtros')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('folha-aba-ferias').click();
    await expect(page.getByTestId('folha-ferias')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="folha-ferias-programar-"]')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (férias desligadas)');
    await page.getByTestId('folha-aba-decimo').click();
    await expect(page.getByTestId('folha-decimo')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-decimo-calcular')).toHaveCount(0);
    await expect(page.getByTestId('folha-decimo-previa')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (13º desligado)');

    // O administrador registra as conferências e liga a folha, o cadastro de colaboradores e o Meu espaço.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M53.4)');
    await ligar(page, 'pessoas.autoatendimento', 'Conferência sintética do RH e do DPO (E2E M53.4)');
    await ligar(page, 'pessoas.folha', 'Conferência sintética do departamento pessoal (E2E M53.4)');

    // A colaboradora com login, se ainda não tiver vínculo; senão, uma colaboradora sem login (e "Minhas férias" mostra o
    // vínculo que a colaboradora com login já tem).
    await entrar(page, 'SINT.COLAB.PONTO');
    await page.goto('/pessoas/meu');
    await expect(page.getByTestId('tela-meu-espaco')).toBeVisible();
    await expect(page.getByTestId('meu-vinculo').or(page.getByTestId('meu-sem-vinculo'))).toBeVisible({
      timeout: 30_000,
    });
    const comLogin = await page.getByTestId('meu-sem-vinculo').isVisible();
    const doc = comLogin ? cpf('900520006') : cpf(`9005340${String(Date.now() % 100).padStart(2, '0')}`);
    const nome = `COLABORADORA FERIAS E2E ${sufixo}`;

    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill(doc);
    await page.getByTestId('consultar-cpf').click();
    if (comLogin) await expect(page.getByTestId('previa-usuario')).toContainText('SINT.COLAB.PONTO');
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(nome);
    await page.getByLabel('Data de admissão').fill(br(admissao));
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Auxiliar de departamento pessoal');
    await page.getByLabel('Carga semanal (horas)').fill('44');
    await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Recursos humanos/ });
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();

    // Parâmetros desde a admissão, com as rubricas de férias e do 13º; se outro cenário já registrou uma vigência mais
    // nova (sem esses papéis), uma vigência a partir do mês anterior também os leva.
    await entrar(page, 'SINT.DP.FOLHA');
    await abrirFolha(page);
    await page.getByTestId('folha-aba-parametros').click();
    await expect(page.getByTestId('folha-parametros')).toBeVisible();
    await expect(
      page.getByTestId('folha-parametro-nenhum').or(page.getByTestId('folha-parametro-vigente')),
    ).toBeVisible({ timeout: 30_000 });
    await vigenciaDosParametros(page, admissao);
    if (!(await page.getByTestId('folha-parametro-vigente').innerText()).includes(br(admissao)))
      await vigenciaDosParametros(page, inicioMes);
    await expect(page.getByTestId('folha-parametro-rubrica-feriasGozo')).toContainText('Salário base');
    await expect(page.getByTestId('folha-parametro-rubrica-inssDecimo')).toContainText('Desconto de INSS');
    await semViolacaoAxe(page, '/pessoas/folha (parâmetros com férias e 13º)');

    // Salário contratual desde a admissão.
    await page.getByTestId('folha-aba-salarios').click();
    await expect(page.getByTestId('folha-salarios')).toBeVisible();
    await campo(page, 'folha-salario-termo').fill(nome);
    await page.getByTestId('folha-salario-buscar').click();
    await page.getByTestId('folha-salario-achados').getByRole('button').first().click();
    await expect(page.getByTestId('folha-salario-colaborador')).toContainText(nome);
    await page.getByTestId('folha-salario-novo').click();
    await data(page, 'folha-salario-inicio', admissao);
    await campo(page, 'folha-salario-valor').fill('3000,00');
    await campo(page, 'folha-salario-motivo').fill('Salário de admissão (E2E M53.4)');
    await page.getByTestId('folha-salario-gravar').click();
    await expect(page.getByTestId('folha-salario-aviso')).toBeVisible({ timeout: 30_000 });

    // Aba Férias: a colaboradora pela busca; os períodos aquisitivos com direito e saldo.
    await page.getByTestId('folha-aba-ferias').click();
    await expect(page.getByTestId('folha-ferias')).toBeVisible({ timeout: 30_000 });
    await campo(page, 'folha-ferias-termo').fill(nome);
    await page.getByTestId('folha-ferias-buscar').click();
    await page.getByTestId('folha-ferias-achados').getByRole('button').first().click();
    await expect(page.getByTestId('folha-ferias-escolhido')).toContainText(nome);
    const linhaPeriodo = page.getByTestId(`folha-ferias-periodo-${periodo}`);
    await expect(linhaPeriodo).toBeVisible({ timeout: 30_000 });
    await expect(linhaPeriodo).toContainText('Aberto');
    await expect(linhaPeriodo).toContainText('30 d');
    await semViolacaoAxe(page, '/pessoas/folha (períodos aquisitivos)');

    // Programar no passado e numa sexta-feira: as duas recusas voltam de uma vez, traduzidas.
    await page.getByTestId(`folha-ferias-programar-${periodo}`).click();
    await expect(page.getByTestId('folha-ferias-form')).toBeVisible();
    await data(page, 'folha-ferias-inicio', sexta);
    await expect(page.getByTestId('folha-ferias-previsao')).toBeVisible();
    await page.getByTestId('folha-ferias-gravar').click();
    await expect(page.getByTestId('folha-ferias-recusas')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-ferias-recusa-inicio-no-passado')).toBeVisible();
    await expect(page.getByTestId('folha-ferias-recusa-vespera-de-descanso')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/folha (programação recusada)');

    // Numa segunda-feira: a previsão do fim e do pagamento, gravada.
    await data(page, 'folha-ferias-inicio', segunda);
    await expect(page.getByTestId('folha-ferias-previsao')).toContainText(br(segunda));
    await semViolacaoAxe(page, '/pessoas/folha (programar férias)');
    await page.getByTestId('folha-ferias-gravar').click();
    await expect(page.getByTestId('folha-ferias-aviso')).toContainText('Férias programadas', {
      timeout: 30_000,
    });
    const fracoes = page.getByTestId('folha-ferias-fracoes');
    await expect(fracoes).toContainText(br(segunda));
    await expect(fracoes).toContainText('Programada');
    await expect(page.getByTestId('folha-ferias-escala')).toContainText(br(segunda), { timeout: 30_000 });

    // Prévia do recibo: memória com o gozo e o terço e a prova do líquido, sem gravar.
    await page.locator('[data-testid^="folha-ferias-previa-"]').first().click();
    const recibo = page.getByTestId('folha-ferias-recibo');
    await expect(recibo.getByTestId('folha-ferias-recibo-memoria')).toBeVisible({ timeout: 30_000 });
    await expect(recibo.getByTestId('folha-ferias-recibo-pendencias')).toHaveCount(0);
    await expect(recibo.getByTestId('folha-ferias-recibo-linha-feriasGozo')).toContainText('3.000,00');
    await expect(recibo.getByTestId('folha-ferias-recibo-linha-feriasTerco')).toContainText('1.000,00');
    await expect(recibo.getByTestId('folha-ferias-recibo-prova')).toBeVisible();
    await expect(recibo.getByTestId('folha-ferias-recibo-numero')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (prévia do recibo de férias)');

    // Calcular com a confirmação: o recibo gravado com o número e o aviso e recibo em PDF/A (no dev, o HTML).
    await page.getByTestId('folha-ferias-calcular').click();
    await expect(page.getByTestId('folha-ferias-confirmacao')).toBeVisible();
    await page.getByTestId('folha-ferias-confirmar').click();
    await expect(recibo.getByTestId('folha-ferias-recibo-numero')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-ferias-aviso')).toContainText('Recibo de férias calculado');
    const pdf = await page.request.get(
      (await page.getByTestId('folha-ferias-recibo-pdf').getAttribute('href')) ?? '',
    );
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toMatch(/application\/pdf|text\/html/);
    if (pdf.headers()['content-type']?.includes('html')) {
      const corpo = await pdf.text();
      expect(corpo).toContain('Aviso de férias');
      expect(corpo).not.toContain(doc);
      expect(corpo).not.toContain(nome);
    }
    await semViolacaoAxe(page, '/pessoas/folha (recibo de férias calculado)');
    await page.keyboard.press('Escape');
    await expect(recibo).toHaveCount(0);
    await expect(fracoes).toContainText('Recibo calculado', { timeout: 30_000 });

    // Cancelar com motivo: o recibo é descartado e as férias saem do saldo programado.
    await page.locator('[data-testid^="folha-ferias-cancelar-"]').first().click();
    await campo(page, 'folha-ferias-motivo').fill('Colaboradora pediu outra data (E2E M53.4)');
    await semViolacaoAxe(page, '/pessoas/folha (cancelar férias)');
    await page.getByTestId('folha-ferias-confirmar-cancelamento').click();
    await expect(page.getByTestId('folha-ferias-aviso')).toContainText('Férias canceladas', {
      timeout: 30_000,
    });
    await expect(fracoes).toContainText('Cancelada');
    await expect(fracoes).toContainText('Colaboradora pediu outra data');

    // 13º do ano, 1ª parcela (pagamento padrão 30/11): prévia com a prova da soma, sem gravar; cálculo com a confirmação.
    await page.getByTestId('folha-aba-decimo').click();
    await expect(page.getByTestId('folha-decimo')).toBeVisible({ timeout: 30_000 });
    await escolher(page.getByTestId('folha-decimo-ano'), { rotulo: String(anoDecimo) });
    await page.getByTestId('folha-decimo-parcela').getByLabel('1ª parcela').check();
    await expect(campo(page, 'folha-decimo-pagamento')).toHaveValue(`30/11/${anoDecimo}`);
    await expect(page.getByTestId('folha-decimo-nenhum')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('folha-decimo-previa').click();
    await expect(
      page.getByTestId('folha-decimo-visto-previa').or(page.getByTestId('folha-decimo-pendencias')),
    ).toBeVisible({ timeout: 30_000 });
    if (await page.getByTestId('folha-decimo-pendencia-sem-salario').isVisible()) {
      // Rodando com o E2E do M53.1 (colaboradora admitida há 4 meses sem salário): o salário dela, para o 13º do ano.
      await semViolacaoAxe(page, '/pessoas/folha (pendências do 13º)');
      await page.getByTestId('folha-aba-salarios').click();
      await expect(page.getByTestId('folha-salarios')).toBeVisible();
      const buscarOutras = async () => {
        const trocar = page.getByRole('button', { name: 'Trocar o colaborador' });
        if (await trocar.isVisible()) await trocar.click();
        await campo(page, 'folha-salario-termo').fill('COLABORADORA FOLHA E2E');
        await page.getByTestId('folha-salario-buscar').click();
        await expect(page.getByTestId('folha-salario-achados')).toBeVisible({ timeout: 30_000 });
      };
      await buscarOutras();
      const ids = await page
        .locator('[data-testid^="folha-salario-escolher-"]')
        .evaluateAll((xs) => xs.map((x) => x.getAttribute('data-testid') ?? ''));
      for (const [i, id] of ids.entries()) {
        if (i > 0) await buscarOutras();
        await page.getByTestId(id).click();
        await expect(
          page.getByTestId('folha-salario-nenhum').or(page.getByTestId('folha-salario-vigencias')),
        ).toBeVisible({ timeout: 30_000 });
        if (!(await page.getByTestId('folha-salario-nenhum').isVisible())) continue;
        await page.getByTestId('folha-salario-novo').click();
        await data(page, 'folha-salario-inicio', hoje);
        await campo(page, 'folha-salario-valor').fill('2000,00');
        await campo(page, 'folha-salario-motivo').fill('Salário para o 13º (E2E M53.4)');
        await page.getByTestId('folha-salario-gravar').click();
        await expect(page.getByTestId('folha-salario-aviso')).toBeVisible({ timeout: 30_000 });
      }
      await page.getByTestId('folha-aba-decimo').click();
      await escolher(page.getByTestId('folha-decimo-ano'), { rotulo: String(anoDecimo) });
      await page.getByTestId('folha-decimo-previa').click();
    }
    await expect(page.getByTestId('folha-decimo-visto-previa')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-decimo-pendencias')).toHaveCount(0);
    await expect(page.getByTestId('folha-decimo-prova-situacao')).toContainText('A soma confere');
    await expect(page.getByTestId('folha-decimo-conta')).toContainText(
      /R\$ [\d.,]+ − R\$ [\d.,]+ = R\$ [\d.,]+/,
    );
    await expect(page.locator('[data-testid^="folha-decimo-colaborador-"]').first()).toBeVisible();
    await expect(page.getByTestId('folha-decimo-lista')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (prévia da 1ª parcela do 13º)');
    await page.getByTestId('folha-decimo-calcular').click();
    await expect(page.getByTestId('folha-decimo-confirmacao')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/folha (confirmar o 13º)');
    await page.getByTestId('folha-decimo-confirmar').click();
    await expect(page.getByTestId('folha-decimo-visto-gravado')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-decimo-aviso')).toContainText('13º calculado');
    await expect(page.locator('[data-testid^="folha-decimo-processo-"]')).toHaveCount(1);
    await expect(page.getByTestId('folha-decimo-prova-situacao')).toContainText('A soma confere');
    const pdfDecimo = await page.request.get(
      (await page.getByTestId('folha-decimo-pdf').getAttribute('href')) ?? '',
    );
    expect(pdfDecimo.status()).toBe(200);
    // A memória do colaborador: as linhas da parcela e a prova do líquido.
    await page.locator('[data-testid^="folha-decimo-memoria-"]').first().click();
    const memoria = page.getByTestId('folha-decimo-memoria');
    await expect(memoria).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-decimo-prova')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/folha (memória da 1ª parcela do 13º)');
    await page.keyboard.press('Escape');
    await expect(memoria).toHaveCount(0);

    // Parcela final (20/12): antes de dezembro, a prévia barra pela competência futura; em dezembro, o cálculo desconta o
    // adiantado da 1ª parcela.
    await page.getByTestId('folha-decimo-parcela').getByLabel('Parcela final').check();
    await expect(campo(page, 'folha-decimo-pagamento')).toHaveValue(`20/12/${anoDecimo}`);
    await page.getByTestId('folha-decimo-previa').click();
    if (hoje.getMonth() < 11) {
      await expect(page.getByTestId('folha-decimo-pendencia-competencia-futura')).toBeVisible({
        timeout: 30_000,
      });
      await semViolacaoAxe(page, '/pessoas/folha (parcela final antes de dezembro)');
    } else {
      await expect(page.getByTestId('folha-decimo-visto-previa')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('folha-decimo-calcular').click();
      await page.getByTestId('folha-decimo-confirmar').click();
      await expect(page.locator('[data-testid^="folha-decimo-processo-"]')).toHaveCount(2, {
        timeout: 30_000,
      });
      await page.locator('[data-testid^="folha-decimo-memoria-"]').first().click();
      await expect(memoria.getByTestId('folha-decimo-linha-decimoDesconto')).toBeVisible({
        timeout: 30_000,
      });
      await page.keyboard.press('Escape');
    }
    // Quem só consulta a folha: sem a aba Férias; o 13º gravado sem os botões e sem a grade por colaborador.
    await entrar(page, 'SINT.FOLHA.CONSULTA');
    await abrirFolha(page);
    await expect(page.getByTestId('folha-aba-ferias')).toHaveCount(0);
    await page.getByTestId('folha-aba-decimo').click();
    await expect(page.getByTestId('folha-decimo')).toBeVisible({ timeout: 30_000 });
    await escolher(page.getByTestId('folha-decimo-ano'), { rotulo: String(anoDecimo) });
    await expect(page.getByTestId('folha-decimo-lista')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-decimo-calcular')).toHaveCount(0);
    await page.locator('[data-testid^="folha-decimo-ver-"]').first().click();
    await expect(page.getByTestId('folha-decimo-grade-oculta')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-decimo-pdf')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (13º em consulta)');

    // A colaboradora abre "Minhas férias" pelo Meu espaço: datas, dias e saldo, sem valores.
    await entrar(page, 'SINT.COLAB.PONTO');
    await page.goto('/pessoas/meu');
    await expect(page.getByTestId('meu-vinculo')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('meu-ferias').click();
    await expect(page).toHaveURL(/\/pessoas\/meu\/ferias/);
    const minhas = page.getByTestId('tela-minhas-ferias');
    await expect(minhas).toBeVisible();
    if (comLogin) {
      await expect(page.getByTestId(`minhas-ferias-periodo-${periodo}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('minhas-ferias-fracoes')).toContainText('Cancelada');
    } else {
      await expect(
        page.getByTestId('minhas-ferias-periodos').or(page.getByTestId('minhas-ferias-sem-direito')),
      ).toBeVisible({ timeout: 30_000 });
    }
    await expect(minhas).not.toContainText('R$');
    await semViolacaoAxe(page, '/pessoas/meu/ferias');
    // As férias de outro vínculo são recusadas mesmo pedidas direto à API.
    const alheio = await page.request.get('/api/pessoas/meu/ferias?vinculo=999999');
    expect(alheio.status()).toBe(403);

    // Recolher: desligar a folha (os cálculos gravados ficam; as abas voltam a consulta).
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.folha')).toBeVisible({ timeout: 30_000 });
    await chave(page, 'pessoas.folha', false, 'Recolher o E2E M53.4');
    await expect(page.getByTestId('recurso-pessoas.folha')).toContainText('Desligada');
    await entrar(page, 'SINT.DP.FOLHA');
    await abrirFolha(page);
    await page.getByTestId('folha-aba-decimo').click();
    await expect(page.getByTestId('folha-decimo')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-decimo-calcular')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
