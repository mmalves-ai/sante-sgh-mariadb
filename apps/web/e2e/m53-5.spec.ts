// E2E @M53.5 (ficha do M53, etapa F4: rescisão; seções 1, 6 a 8 na parte da F4): com a folha desligada, a aba Rescisão
// abre em consulta (sem calcular) → o administrador liga a folha e o cadastro de colaboradores → o RH admite o
// colaborador em 1º de janeiro de dois anos atrás → o departamento pessoal registra os parâmetros (com as rubricas dos
// papéis da rescisão, com busca) e o salário → o RH desliga o colaborador hoje, "Demissão sem justa causa" → a aba
// Rescisão mostra o desligado na fila com a modalidade sugerida → o formulário com a sugestão; o pagamento antes do
// desligamento volta recusado, traduzido → prévia com a apuração (aviso de 36 dias pela Lei 12.506, projeção e a conta
// da multa do FGTS sobre o saldo informado mais o FGTS desta rescisão), a memória e sem gravar → gravar com a confirmação → o histórico e o termo
// em PDF (sem nome nem CPF) → cancelar com motivo → quem só consulta a folha não vê a aba → recolher. Axe sem violação
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

// Rubricas sintéticas: os proventos de férias, do 13º e da rescisão na rubrica de provento, os descontos na de desconto (o servidor
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
  // F4 (rescisão): os proventos na rubrica de provento, o aviso descontado na de desconto.
  ['avisoIndenizado', PROVENTO],
  ['avisoDescontado', DESCONTO],
  ['indenizacao479', PROVENTO],
  ['feriasVencidas', PROVENTO],
  ['feriasVencidasDobra', PROVENTO],
  ['feriasProporcionais', PROVENTO],
  ['feriasAviso', PROVENTO],
  ['feriasRescisaoTerco', PROVENTO],
  ['decimoProporcional', PROVENTO],
  ['decimoAviso', PROVENTO],
];
/**
 * Registra uma vigência com todas as rubricas, tentando as datas na ordem: com outros cenários no mesmo servidor (o E2E
 * do M53.4 já registrou uma vigência no mesmo dia da admissão, sem os papéis da rescisão), a primeira data livre.
 */
async function vigenciaDosParametros(page: Page, inicios: readonly Date[]): Promise<boolean> {
  if (!(await page.getByTestId('folha-parametro-form').isVisible())) {
    await page.getByTestId('folha-parametro-novo').click();
    await expect(page.getByTestId('folha-parametro-form')).toBeVisible();
    for (const [papel, rotulo] of RUBRICAS)
      await escolher(page.getByTestId(`folha-parametro-rubrica-campo-${papel}`), { rotulo });
  }
  for (const inicio of inicios) {
    await data(page, 'folha-parametro-inicio', inicio);
    await page.getByTestId('folha-parametro-gravar').click();
    // A recusa (vigência repetida) aparece no alto da aba, com o formulário ainda aberto.
    const repetida = page.getByTestId('folha-parametros').getByTestId(/^recusa-(folha|pessoas)$/);
    await expect(page.getByTestId('folha-parametro-aviso').or(repetida)).toBeVisible({ timeout: 30_000 });
    if (await page.getByTestId('folha-parametro-aviso').isVisible()) return true;
  }
  return false;
}

test.describe('folha de pagamento, etapa F4: rescisão @M53.5', () => {
  test.setTimeout(900_000);

  test('desligada → ligar → admitir → parâmetros → salário → desligar → fila → recusa → prévia → gravar → termo PDF → cancelar → consulta → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
    // Admitido em 1º de janeiro de dois anos atrás: 2 anos completos, aviso de 30 + 3 × 2 = 36 dias (Lei 12.506/2011).
    const admissao = new Date(hoje.getFullYear() - 2, 0, 1);
    const sufixo = Date.now().toString(36).toUpperCase();
    const doc = cpf(`9005350${String(Date.now() % 100).padStart(2, '0')}`);
    const nome = `COLABORADOR RESCISAO E2E ${sufixo}`;

    // Folha desligada: a aba Rescisão abre em consulta, sem calcular.
    await entrar(page, 'SINT.DP.FOLHA');
    await (await itemDoMenu(page, 'Folha de pagamento')).click();
    await expect(page).toHaveURL(/\/pessoas\/folha$/);
    await expect(page.getByTestId('folha-filtros')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('folha-aba-rescisao').click();
    await expect(page.getByTestId('folha-rescisao')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-rescisao-fila')).toBeVisible();
    await expect(page.locator('[data-testid^="folha-rescisao-calcular-"]')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (rescisão desligada)');

    // O administrador liga a folha e o cadastro de colaboradores.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M53.5)');
    await ligar(page, 'pessoas.folha', 'Conferência sintética do departamento pessoal (E2E M53.5)');

    // O RH admite o colaborador (CPF sintético sem login).
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill(doc);
    await page.getByTestId('consultar-cpf').click();
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(nome);
    await page.getByLabel('Data de admissão').fill(br(admissao));
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Auxiliar administrativo');
    await page.getByLabel('Carga semanal (horas)').fill('44');
    await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Recursos humanos/ });
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();
    await page.getByTestId('abrir-ficha-admitido').click();
    await expect(page.getByTestId('tela-ficha-colaborador')).toBeVisible();
    const vinculo = /\/pessoas\/colaboradores\/(\d+)/.exec(page.url())?.[1] ?? '';
    expect(vinculo).toMatch(/^\d+$/);

    // Parâmetros desde a admissão com as rubricas da rescisão (e, se outro cenário já registrou uma vigência mais nova,
    // uma a partir do mês anterior) e o salário contratual.
    await entrar(page, 'SINT.DP.FOLHA');
    await abrirFolha(page);
    await page.getByTestId('folha-aba-parametros').click();
    await expect(page.getByTestId('folha-parametros')).toBeVisible();
    await expect(
      page.getByTestId('folha-parametro-nenhum').or(page.getByTestId('folha-parametro-vigente')),
    ).toBeVisible({ timeout: 30_000 });
    // Desde a admissão; se a data já tem vigência (outro cenário), um dia do mês anterior ainda livre (a mais nova: a
    // tela mostra a da competência anterior a hoje, e a rescisão usa a do mês do desligamento).
    const rescisaoNaVigente = async () => {
      const r = page.getByTestId('folha-parametro-rubrica-avisoIndenizado');
      return (await r.count()) > 0 && (await r.innerText()).includes('Salário base');
    };
    if (!(await vigenciaDosParametros(page, [admissao])) || !(await rescisaoNaVigente()))
      expect(
        await vigenciaDosParametros(
          page,
          Array.from({ length: 8 }, (_, k) => new Date(hoje.getFullYear(), hoje.getMonth() - 1, 2 + k)),
        ),
      ).toBe(true);
    await expect(page.getByTestId('folha-parametro-rubrica-avisoIndenizado')).toContainText('Salário base');
    await expect(page.getByTestId('folha-parametro-rubrica-avisoDescontado')).toContainText(
      'Desconto de INSS',
    );
    await semViolacaoAxe(page, '/pessoas/folha (parâmetros com a rescisão)');
    await page.getByTestId('folha-aba-salarios').click();
    await expect(page.getByTestId('folha-salarios')).toBeVisible();
    await campo(page, 'folha-salario-termo').fill(nome);
    await page.getByTestId('folha-salario-buscar').click();
    await page.getByTestId('folha-salario-achados').getByRole('button').first().click();
    await expect(page.getByTestId('folha-salario-colaborador')).toContainText(nome);
    await page.getByTestId('folha-salario-novo').click();
    await data(page, 'folha-salario-inicio', admissao);
    await campo(page, 'folha-salario-valor').fill('3000,00');
    await campo(page, 'folha-salario-motivo').fill('Salário de admissão (E2E M53.5)');
    await page.getByTestId('folha-salario-gravar').click();
    await expect(page.getByTestId('folha-salario-aviso')).toBeVisible({ timeout: 30_000 });

    // O RH desliga o colaborador hoje, sem justa causa (com a senha).
    await entrar(page, 'SINT.RH');
    await page.goto(`/pessoas/colaboradores/${vinculo}`);
    await expect(page.getByTestId('tela-ficha-colaborador')).toBeVisible();
    await page.getByTestId('abrir-desligamento').click();
    const fx = page.getByTestId('form-desligamento');
    await escolher(page.getByTestId('desligamento-tipo'), { rotulo: 'Demissão sem justa causa' });
    await fx.getByLabel('Motivo').fill('Dispensa sem justa causa do colaborador sintético (E2E M53.5)');
    await fx.getByTestId('desligamento-senha').fill(SENHA);
    await page.getByTestId('desligamento-confirmar').click();
    await expect(page.getByTestId('resultado-desligamento')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('fechar-desligamento').click();
    await expect(page.getByTestId('ficha-estado')).toContainText('Desligado');

    // A fila dos desligados (padrão: do dia 1 do mês anterior até hoje) com a modalidade sugerida.
    await entrar(page, 'SINT.DP.FOLHA');
    await abrirFolha(page);
    await page.getByTestId('folha-aba-rescisao').click();
    const linha = page.getByTestId(`folha-rescisao-desligado-${vinculo}`);
    await expect(linha).toBeVisible({ timeout: 30_000 });
    await expect(linha).toContainText(br(hoje));
    await expect(linha).toContainText('Dispensa sem justa causa');
    await expect(linha).toContainText('A calcular');
    await semViolacaoAxe(page, '/pessoas/folha (fila dos desligados)');

    // O formulário com a sugestão; o pagamento antes do desligamento volta recusado pelo servidor, traduzido.
    await page.getByTestId(`folha-rescisao-calcular-${vinculo}`).click();
    const form = page.getByTestId('folha-rescisao-form');
    await expect(form).toBeVisible();
    await expect(page.getByTestId('folha-rescisao-sugerida')).toContainText('Dispensa sem justa causa');
    await campo(page, 'folha-rescisao-saldo').fill('10000,00');
    await data(page, 'folha-rescisao-pagamento', ontem);
    await page.getByTestId('folha-rescisao-previa').click();
    await expect(page.getByTestId('folha-rescisao-recusa-pagamento-antes')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/folha (rescisão recusada)');

    // Prévia com o pagamento em hoje: a apuração (aviso, projeção, multa com as parcelas), a memória e sem número.
    await data(page, 'folha-rescisao-pagamento', hoje);
    await semViolacaoAxe(page, '/pessoas/folha (formulário da rescisão)');
    await page.getByTestId('folha-rescisao-previa').click();
    const termo = page.getByTestId('folha-rescisao-termo-calculado');
    const apuracao = termo.getByTestId('folha-rescisao-apuracao');
    await expect(apuracao).toBeVisible({ timeout: 30_000 });
    await expect(apuracao).toContainText(
      '36 dia(s) devidos (2 ano(s) completo(s) de serviço), 36 indenizado(s)',
    );
    await expect(apuracao).toContainText(`Projeção do contrato: ${br(hoje)} + 36 dia(s)`);
    // A multa sobre o saldo informado mais o FGTS desta rescisão, com as duas parcelas impressas (D-MULTA-535).
    await expect(apuracao).toContainText(
      /\(R\$ 10\.000,00 \+ R\$ [\d.,]+\) × 40% = R\$ [\d.,]+ \(saldo do extrato\)/,
    );
    const espacos = (x: string) => x.replace(/\s+/g, ' ');
    const multa = /× 40% = (R\$ [\d.,]+)/.exec(espacos(await apuracao.innerText()))?.[1] ?? '';
    expect(multa).not.toBe('');
    await expect(termo.getByTestId('folha-rescisao-pendencias')).toHaveCount(0);
    await expect(termo.getByTestId('folha-rescisao-linha-avisoIndenizado')).toBeVisible();
    await expect(termo.getByTestId('folha-rescisao-linha-decimoProporcional')).toBeVisible();
    await expect(termo.getByTestId('folha-rescisao-numero')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (prévia da rescisão)');

    // Gravar com a confirmação: o número do cálculo e o termo em PDF/A (no dev, o HTML) sem nome nem CPF.
    await page.getByTestId('folha-rescisao-gravar').click();
    await expect(page.getByTestId('folha-rescisao-confirmacao')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/folha (confirmar a rescisão)');
    await page.getByTestId('folha-rescisao-confirmar').click();
    await expect(termo.getByTestId('folha-rescisao-numero')).toBeVisible({ timeout: 30_000 });
    const pdf = await page.request.get(
      (await page.getByTestId('folha-rescisao-pdf').getAttribute('href')) ?? '',
    );
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toMatch(/application\/pdf|text\/html/);
    if (pdf.headers()['content-type']?.includes('html')) {
      const corpo = espacos(await pdf.text());
      expect(corpo).toContain('Termo de rescisão do contrato de trabalho');
      expect(corpo).toContain('Dispensa sem justa causa');
      expect(corpo).toContain(`× 40% = ${multa}`);
      expect(corpo).not.toContain(doc);
      expect(corpo).not.toContain(nome);
    }
    await semViolacaoAxe(page, '/pessoas/folha (rescisão gravada)');
    await page.keyboard.press('Escape');
    await expect(termo).toHaveCount(0);
    await expect(linha).toContainText('Calculada', { timeout: 30_000 });
    const historico = page.getByTestId('folha-rescisao-historico');
    const item = historico.locator('[data-testid^="folha-rescisao-item-"]', { hasText: br(hoje) }).first();
    await expect(item).toContainText('Dispensa sem justa causa');
    await expect(item).toContainText(multa);

    // Cancelar com motivo: a rescisão fica no histórico como cancelada e o desligado volta à fila como pendente.
    await item.locator('[data-testid^="folha-rescisao-cancelar-"]').click();
    await campo(page, 'folha-rescisao-motivo').fill('Cálculo refeito com o extrato novo (E2E M53.5)');
    await semViolacaoAxe(page, '/pessoas/folha (cancelar a rescisão)');
    await page.getByTestId('folha-rescisao-confirmar-cancelamento').click();
    await expect(page.getByTestId('folha-rescisao-aviso')).toBeVisible({ timeout: 30_000 });
    await expect(historico).toContainText('Cálculo refeito com o extrato novo', { timeout: 30_000 });
    await expect(linha).toContainText('A calcular', { timeout: 30_000 });

    // Quem só consulta a folha não tem a aba Rescisão.
    await entrar(page, 'SINT.FOLHA.CONSULTA');
    await abrirFolha(page);
    await expect(page.getByTestId('folha-aba-rescisao')).toHaveCount(0);

    // Recolher: desligar a folha (as rescisões gravadas ficam; a aba volta à consulta).
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.folha')).toBeVisible({ timeout: 30_000 });
    await chave(page, 'pessoas.folha', false, 'Recolher o E2E M53.5');
    await expect(page.getByTestId('recurso-pessoas.folha')).toContainText('Desligada');
    await entrar(page, 'SINT.DP.FOLHA');
    await abrirFolha(page);
    await page.getByTestId('folha-aba-rescisao').click();
    await expect(linha).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="folha-rescisao-calcular-"]')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
