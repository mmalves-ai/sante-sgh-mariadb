// E2E @M53.7 (ficha do M53, etapa F6: periódicos do eSocial e fechamento; seções 1, 4 a 10 na parte da F6): o
// administrador liga a folha, o cadastro de colaboradores e o ponto → o RH admite o colaborador e importa o relógio da
// competência anterior → a coordenação fecha o ponto → o departamento pessoal registra os parâmetros e o salário e
// calcula a folha → a aba Fechamento confere a competência (sem pendência, os totais e a prova da soma com as parcelas)
// e fecha com a data de pagamento → a lista do ano mostra o período fechado → no eSocial, a ficha do colaborador e os
// parâmetros do empregador → a aba Periódicos mostra a folha fechada e o S-1200/S-1210 esperados sem evento → gera o
// S-1200 e o S-1210 pela prévia conferida no leiaute e grava (o XML, que leva a remuneração, só no detalhe do evento) → monta o lote, envia ao coletor local e
// registra o retorno com os recibos → os dois ficam aceitos e o S-1299 segue barrado pelos recibos de autônomo do repasse
// (D-RPA-PER-537), com a pendência traduzida → a folha reaberta com motivo → quem só consulta a folha vê a lista sem
// fechar nem reabrir. Axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev; pessoas, ponto,
// folha e eSocial em MEMÓRIA (nada vai à cópia); CPF e CNPJ SINTÉTICOS; nenhum dado de pessoa. Roda numa execução
// própria (`pnpm e2e -- --grep @M53.7`, memória nova): a folha mensal da competência só calcula com o ponto fechado de
// todos os vínculos, e os cenários das outras etapas admitem colaboradores sem ponto nessa competência (D-E2E-537).
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

// Arquivo do relógio (leiaute "003" da Portaria 671/2021) montado aqui, com o CRC-16/KERMIT de cada linha.
function crc16(t: string): string {
  let c = 0;
  for (let i = 0; i < t.length; i++) {
    c ^= t.charCodeAt(i) & 0xff;
    for (let b = 0; b < 8; b++) c = c & 1 ? (c >>> 1) ^ 0x8408 : c >>> 1;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}
const pad = (v: string, n: number) => v.slice(0, n).padEnd(n, ' ');
const comCrc = (corpo: string) => `${corpo}${crc16(corpo)}`;
function afd(de: string, ate: string, marcas: readonly [number, string][], doc: string): string {
  const cab = comCrc(
    `0000000001100000000000191${pad('', 14)}${pad('HOSPITAL SINTETICO E2E', 150)}${pad('00004000000000452', 17)}${de}${ate}${ate}T23:00:00-03000031${pad('00000000000191', 14)}${pad('RELOGIO SINTETICO', 30)}`,
  );
  const linhas = marcas.map(([nsr, q]) => comCrc(`${String(nsr).padStart(9, '0')}3${q}:00-03000${doc}`));
  const trailer = `999999999${'0'.repeat(9)}${String(marcas.length).padStart(9, '0')}${'0'.repeat(36)}9`;
  return [cab, ...linhas, trailer].join('\r\n');
}

async function chave(page: Page, recurso: string, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId('opcao-ligar').check();
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
  if (cartao.includes('Sem pré-requisito externo')) return chave(page, recurso, evidencia);
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
  await chave(page, recurso, evidencia);
}

const campo = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();
async function data(page: Page, id: string, d: Date): Promise<void> {
  const c = campo(page, id);
  await c.fill(br(d));
  await c.press('Tab');
}
const marcar = (page: Page, id: string, valor: string) =>
  page.getByTestId(id).locator(`input[type="checkbox"][data-valor="${valor}"]`).check();

async function abrirFolha(page: Page, competencia: string): Promise<void> {
  await page.goto('/pessoas/folha');
  await expect(page.getByRole('heading', { level: 1, name: 'Folha de pagamento' })).toBeVisible();
  await expect(page.getByTestId('folha-filtros')).toBeVisible({ timeout: 30_000 });
  await escolher(page.getByTestId('folha-competencia'), {
    rotulo: `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`,
  });
  await expect(page.getByTestId('folha-calculo')).toContainText(
    `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`,
    { timeout: 30_000 },
  );
}

async function abrirPeriodicos(page: Page, competencia: string): Promise<void> {
  await page.goto('/pessoas/esocial');
  await expect(page.getByRole('heading', { level: 1, name: 'eSocial' })).toBeVisible();
  await page.getByTestId('esocial-aba-periodicos').click();
  await expect(page.getByTestId('esocial-periodicos')).toBeVisible({ timeout: 30_000 });
  await escolher(page.getByTestId('esocial-periodicos-apuracao'), 'mensal');
  await escolher(page.getByTestId('esocial-periodicos-periodo'), competencia);
  await expect(page.getByTestId('esocial-periodicos-contagens')).toBeVisible({ timeout: 30_000 });
}

test.describe('folha de pagamento, etapa F6: periódicos do eSocial e fechamento @M53.7', () => {
  test.setTimeout(600_000);
  test.use({ actionTimeout: 60_000 });

  test('ligar → admitir → ponto → calcular → fechar a folha → ficha → S-1200 e S-1210 pela prévia → lote → retorno → S-1299 barrado pelo repasse → reabrir → consulta; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    // A competência anterior (já terminada): o fechamento só aceita período que acabou.
    const ref = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const comp = `${ref.getFullYear()}-${p2(ref.getMonth() + 1)}`;
    const rotuloComp = `${comp.slice(5, 7)}/${comp.slice(0, 4)}`;
    const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    const de = `${comp}-01`;
    const ate = `${comp}-${p2(ultimo.getDate())}`;
    const admissao = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
    const sufixo = Date.now().toString(36).toUpperCase();
    const doc = cpf(`9005370${String(Date.now() % 100).padStart(2, '0')}`);
    const nome = `COLABORADOR PERIODICOS E2E ${sufixo}`;

    // O administrador liga o cadastro de colaboradores, o ponto e a folha.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M53.7)');
    await ligar(page, 'pessoas.ponto', 'Conferência sintética do RH e do setor-piloto (E2E M53.7)');
    await ligar(page, 'pessoas.folha', 'Conferência sintética do departamento pessoal (E2E M53.7)');

    // O RH admite o colaborador antes da competência e importa o relógio dela.
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill(doc);
    await page.getByTestId('consultar-cpf').click();
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

    await page.goto('/pessoas/ponto');
    await expect(page.getByTestId('form-importar-afd')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('ponto-arquivo').setInputFiles({
      name: 'afd-periodicos-e2e.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        afd(
          de,
          ate,
          [
            [5371, `${comp}-02T07:00`],
            [5372, `${comp}-02T11:00`],
            [5373, `${comp}-02T12:00`],
            [5374, `${comp}-02T16:00`],
          ],
          doc,
        ),
        'latin1',
      ),
    });
    await page.getByTestId('ponto-importar').click();
    await expect(page.getByTestId('ponto-resultado-importacao')).toContainText(
      'Arquivo importado: 4 marcação(ões) nova(s)',
    );
    await page.getByRole('link', { name: `Abrir o espelho de ${nome}` }).click();
    await expect(page.getByTestId('tela-espelho-ponto')).toBeVisible({ timeout: 30_000 });
    const espelho = page.url().replace(/\d{4}-\d{2}(\/?)$/, `${comp}$1`);

    // A coordenação fecha o ponto da competência.
    await entrar(page, 'SINT.PONTO');
    await page.goto(espelho);
    await expect(page.getByTestId(`dia-${comp}-02`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('periodo-fechar').click();
    await expect(page.getByTestId('espelho-aviso')).toContainText('Período fechado');

    // O departamento pessoal registra os parâmetros e o salário e calcula a folha da competência.
    await entrar(page, 'SINT.DP.FOLHA');
    await (await itemDoMenu(page, 'Folha de pagamento')).click();
    await expect(page).toHaveURL(/\/pessoas\/folha$/);
    await abrirFolha(page, comp);
    await page.getByTestId('folha-aba-parametros').click();
    await expect(page.getByTestId('folha-parametros')).toBeVisible();
    await expect(
      page.getByTestId('folha-parametro-nenhum').or(page.getByTestId('folha-parametro-vigente')),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('folha-parametro-novo').click();
    await expect(page.getByTestId('folha-parametro-form')).toBeVisible();
    await data(page, 'folha-parametro-inicio', admissao);
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-salario'), { rotulo: '1 · Salário base' });
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-horaExtra100'), {
      rotulo: '3 · Horas extras 50%',
    });
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-dsrVariaveis'), {
      rotulo: '3 · Horas extras 50%',
    });
    for (const papel of ['inss', 'irrf', 'faltas', 'atrasos'])
      await escolher(page.getByTestId(`folha-parametro-rubrica-campo-${papel}`), {
        rotulo: '4 · Desconto de INSS',
      });
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-fgts'), {
      rotulo: '5 · Base de cálculo do FGTS',
    });
    await page.getByTestId('folha-parametro-gravar').click();
    await expect(page.getByTestId('folha-parametro-aviso')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('folha-aba-salarios').click();
    await expect(page.getByTestId('folha-salarios')).toBeVisible();
    await campo(page, 'folha-salario-termo').fill(nome);
    await page.getByTestId('folha-salario-buscar').click();
    await page.getByTestId('folha-salario-achados').getByRole('button').first().click();
    await expect(page.getByTestId('folha-salario-colaborador')).toContainText(nome);
    await page.getByTestId('folha-salario-novo').click();
    await data(page, 'folha-salario-inicio', admissao);
    await campo(page, 'folha-salario-valor').fill('3000,00');
    await campo(page, 'folha-salario-motivo').fill('Salário de admissão (E2E M53.7)');
    await page.getByTestId('folha-salario-gravar').click();
    await expect(page.getByTestId('folha-salario-aviso')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('folha-aba-calculo').click();
    await page.getByTestId('folha-calculo-calcular').click();
    await page.getByTestId('folha-calculo-confirmar').click();
    await expect(page.getByTestId('folha-calculo-visto-vigente')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-calculo-prova-situacao')).toContainText('A soma confere');
    const liquido = (await page.getByTestId('folha-calculo-total-liquido').innerText()).trim();

    // Aba Fechamento: sem a data de pagamento a prévia fica desabilitada; com ela, a conferência sem pendência mostra os
    // processamentos, os totais e a prova da soma com as parcelas.
    await page.getByTestId('folha-aba-fechamento').click();
    await expect(page.getByTestId('folha-fechamento')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-fechamento-so-consulta')).toHaveCount(0);
    await escolher(page.getByTestId('folha-fechamento-apuracao'), 'mensal');
    await escolher(page.getByTestId('folha-fechamento-periodo'), comp);
    await expect(
      page.getByTestId('folha-fechamento-vazio').or(page.getByTestId('folha-fechamento-lista')),
    ).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/folha (aba Fechamento)');
    await data(page, 'folha-fechamento-pagamento', ultimo);
    await page.getByTestId('folha-fechamento-previa').click();
    const conferencia = page.getByTestId('folha-fechamento-resultado');
    await expect(conferencia).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-fechamento-sem-pendencias')).toBeVisible();
    await expect(page.locator('[data-testid^="folha-fechamento-processo-"]')).toHaveCount(1);
    await expect(page.getByTestId('folha-fechamento-total-liquido')).toContainText(liquido);
    await expect(page.getByTestId('folha-fechamento-parcelas')).toBeVisible();
    await expect(page.getByTestId('folha-fechamento-conferencia-ok')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/folha (conferência do fechamento)');
    await page.getByTestId('folha-fechamento-fechar').click();
    await expect(page.getByTestId('folha-fechamento-aviso')).toContainText(
      new RegExp(`Período ${rotuloComp} fechado \\(fechamento \\d+\\)`),
      { timeout: 30_000 },
    );
    await escolher(page.getByTestId('folha-fechamento-ano'), comp.slice(0, 4));
    const linhaFech = page.locator('tr[data-testid^="folha-fechamento-linha-"]', { hasText: rotuloComp });
    await expect(linhaFech).toContainText('Fechado', { timeout: 30_000 });
    await expect(linhaFech).toContainText(br(ultimo));
    const idFech =
      /^folha-fechamento-linha-(\d+)$/.exec((await linhaFech.getAttribute('data-testid')) ?? '')?.[1] ?? '';
    expect(idFech).toMatch(/^\d+$/);
    await page.getByTestId(`folha-fechamento-detalhe-${idFech}`).click();
    await expect(page.getByTestId('folha-fechamento-detalhe')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-fechamento-resumo')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/folha (detalhe do fechamento)');
    await page.getByTestId('folha-fechamento-detalhe-fechar').click();
    await expect(page.getByTestId('folha-fechamento-detalhe')).toHaveCount(0);

    // Calcular de novo o período fechado volta recusado, traduzido.
    await page.getByTestId('folha-aba-calculo').click();
    await page.getByTestId('folha-calculo-calcular').click();
    await page.getByTestId('folha-calculo-confirmar').click();
    await expect(page.getByRole('dialog')).toContainText('reabra o fechamento', { timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('folha-calculo-confirmacao')).toHaveCount(0);

    // eSocial: a ficha do colaborador (os dados que o S-1200 leva e o cadastro não guarda).
    await page.goto('/pessoas/esocial');
    await expect(page.getByTestId('esocial-filtros')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('esocial-aba-fichas').click();
    await expect(page.getByTestId('esocial-ficha')).toBeVisible();
    await campo(page, 'esocial-ficha-colaborador-termo').fill(nome);
    await page.getByTestId('esocial-ficha-colaborador-buscar').click();
    await page.getByTestId('esocial-ficha-colaborador-achados').getByRole('button').first().click();
    await expect(page.getByTestId('esocial-ficha-form')).toBeVisible({ timeout: 30_000 });
    await data(page, 'esocial-ficha-nascimento', new Date(1990, 4, 15));
    await campo(page, 'esocial-ficha-logradouro').fill('Rua Sintetica');
    await campo(page, 'esocial-ficha-numero').fill('100');
    await campo(page, 'esocial-ficha-cep').fill('30130000');
    await campo(page, 'esocial-ficha-municipio').fill('3106200');
    await campo(page, 'esocial-ficha-uf').fill('MG');
    await campo(page, 'esocial-ficha-descricao-jornada').fill('Segunda a sexta, 8 horas');
    await page.getByTestId('esocial-ficha-gravar').click();
    await expect(page.getByTestId('esocial-ficha-aviso')).toBeVisible({ timeout: 30_000 });

    // Parâmetros do empregador com vigência desde a competência.
    await page.getByTestId('esocial-aba-parametros').click();
    await expect(page.getByTestId('esocial-parametros')).toBeVisible();
    await expect(
      page
        .getByTestId('esocial-parametros-vazio')
        .or(page.locator('[data-testid^="esocial-vigencia-"]').first()),
    ).toBeVisible({ timeout: 30_000 });
    if ((await page.getByTestId(`esocial-vigencia-${comp}`).count()) === 0) {
      await page.getByTestId('esocial-parametros-nova').click();
      await expect(page.getByTestId('esocial-parametros-form')).toBeVisible();
      await escolher(page.getByTestId('esocial-param-inicio'), comp);
      await campo(page, 'esocial-param-classTrib').fill('99');
      await campo(page, 'esocial-param-cnae').fill('8610101');
      await campo(page, 'esocial-param-fap').fill('1,0000');
      await campo(page, 'esocial-param-lotacao').fill('LOT01');
      await campo(page, 'esocial-param-fpas').fill('515');
      await campo(page, 'esocial-param-tercs').fill('0115');
      await campo(page, 'esocial-param-tabrubr').fill('SANTE');
      await page.getByTestId('esocial-param-gravar').click();
      await expect(page.getByTestId('esocial-parametros-aviso')).toBeVisible({ timeout: 30_000 });
    }

    // Aba Periódicos: a folha fechada, o S-1200 e o S-1210 esperados sem evento, o S-1299 barrado.
    await abrirPeriodicos(page, comp);
    await expect(page.getByTestId('esocial-periodicos-folha')).toContainText('SINT.DP.FOLHA');
    await expect(page.getByTestId('esocial-periodicos-situacao')).toContainText('Aberto');
    await expect(page.getByTestId('esocial-periodicos-remuneracao-esperados')).toHaveText('1');
    await expect(page.getByTestId('esocial-periodicos-remuneracao-sem-evento')).toHaveText('1');
    await expect(page.getByTestId('esocial-periodicos-pagamentos-esperados')).toHaveText('1');
    await expect(page.getByTestId('esocial-periodicos-pendencia-remuneracao-pendente')).toBeVisible();
    await expect(page.getByTestId('esocial-periodicos-gerarFechamento')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/esocial (periódicos, folha fechada)');

    // S-1200 pela prévia conferida no leiaute (sem o XML: leva a remuneração), nada gravado ainda; depois grava.
    const resultado = page.getByTestId('esocial-periodicos-resultado');
    await page.getByTestId('esocial-periodicos-gerarRemuneracao').click();
    await expect(resultado).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('esocial-periodicos-valido-0')).toContainText('leiaute oficial');
    await semViolacaoAxe(page, '/pessoas/esocial (prévia do S-1200)');
    await page.getByTestId('esocial-periodicos-gravar').click();
    await expect(page.getByTestId('esocial-periodicos-aviso')).toContainText('1 evento(s) gravado(s)', {
      timeout: 60_000,
    });
    await page.getByTestId('esocial-periodicos-resultado-fechar').click();
    await expect(resultado).toHaveCount(0);
    await expect(page.getByTestId('esocial-periodicos-remuneracao-sem-evento')).toHaveText('0', {
      timeout: 30_000,
    });

    // S-1210 do mês do pagamento (o último dia da competência): prévia e gravar.
    await page.getByTestId('esocial-periodicos-gerarPagamentos').click();
    await expect(resultado).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('esocial-periodicos-valido-0')).toContainText('leiaute oficial');
    await page.getByTestId('esocial-periodicos-gravar').click();
    await expect(page.getByTestId('esocial-periodicos-aviso')).toContainText('1 evento(s) gravado(s)', {
      timeout: 60_000,
    });
    await page.getByTestId('esocial-periodicos-resultado-fechar').click();

    // Lote com os dois, ao coletor local, e o retorno com os recibos.
    await page.getByTestId('esocial-aba-eventos').click();
    await expect(page.getByTestId('esocial-eventos')).toBeVisible();
    const idDe = async (codigo: string) => {
      const l = page.locator('tr[data-testid^="esocial-evento-"]', { hasText: codigo }).first();
      await expect(l).toBeVisible({ timeout: 30_000 });
      return /^esocial-evento-(\d+)$/.exec((await l.getAttribute('data-testid')) ?? '')?.[1] ?? '';
    };
    const ids = [await idDe('S-1200'), await idDe('S-1210')];
    // O detalhe do S-1200 gravado mostra o XML a quem gera (`pessoas.esocial.gerar`).
    await page.getByTestId(`esocial-evento-ver-${ids[0]}`).click();
    await expect(page.getByTestId('esocial-evento-xml')).toContainText('evtRemun', { timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/esocial (detalhe do S-1200)');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('esocial-evento-detalhe')).toHaveCount(0);
    for (const id of ids) {
      expect(id).toMatch(/^\d+$/);
      await marcar(page, 'esocial-escolha-eventos', id);
    }
    await expect(page.getByTestId('esocial-escolha-texto')).toContainText('2 evento(s)');
    await page.getByTestId('esocial-montar-lote').click();
    await expect(page.getByTestId('esocial-eventos-aviso')).toContainText(
      /Lote \d+ montado com 2 evento\(s\)/,
      {
        timeout: 30_000,
      },
    );
    const idLote =
      /Lote (\d+) montado/.exec(await page.getByTestId('esocial-eventos-aviso').innerText())?.[1] ?? '';
    await page.getByTestId('esocial-aba-lotes').click();
    await expect(page.getByTestId(`esocial-lote-${idLote}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`esocial-lote-enviar-${idLote}`).click();
    await page.getByTestId('confirmacao').getByRole('button').last().click();
    await expect(page.getByTestId('esocial-lotes-aviso')).toContainText(`Lote ${idLote} enviado`, {
      timeout: 30_000,
    });
    await page.getByTestId(`esocial-lote-retorno-${idLote}`).click();
    await expect(page.getByTestId('esocial-retorno-form')).toBeVisible();
    for (const [i, id] of ids.entries()) {
      await campo(page, `esocial-retorno-recibo-${id}`).fill(`1.1.000000000000000537${i}`);
      await campo(page, `esocial-retorno-codigo-${id}`).fill('201');
      await campo(page, `esocial-retorno-descricao-${id}`).fill('Sucesso (E2E M53.7)');
    }
    await page.getByTestId('esocial-retorno-gravar').click();
    await expect(page.getByTestId('esocial-lotes-aviso')).toContainText(
      `Retorno do lote ${idLote} registrado`,
      {
        timeout: 30_000,
      },
    );

    // Os dois aceitos; o S-1299 segue barrado pelos recibos de autônomo do repasse (D-RPA-PER-537), e a remuneração
    // aceita pode ser retificada.
    await abrirPeriodicos(page, comp);
    await expect(page.getByTestId('esocial-periodicos-remuneracao-aceitos')).toHaveText('1', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('esocial-periodicos-pagamentos-aceitos')).toHaveText('1');
    await expect(page.getByTestId('esocial-periodicos-pendencia-remuneracao-pendente')).toHaveCount(0);
    await expect(page.getByTestId('esocial-periodicos-repasse')).toBeVisible();
    await expect(page.getByTestId('esocial-periodicos-pendencia-repasse-sem-remuneracao')).toBeVisible();
    await expect(page.getByTestId('esocial-periodicos-gerarFechamento')).toHaveCount(0);
    await expect(page.getByTestId('esocial-periodicos-retificarRemuneracao')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/esocial (periódicos aceitos, S-1299 barrado)');

    // A folha reaberta com motivo (o link do painel leva ao fechamento).
    await page.getByTestId('esocial-periodicos-ir-folha').click();
    await expect(page).toHaveURL(/\/pessoas\/folha\?aba=fechamento/);
    await expect(page.getByTestId('folha-fechamento')).toBeVisible({ timeout: 30_000 });
    await escolher(page.getByTestId('folha-fechamento-ano'), comp.slice(0, 4));
    await page.getByTestId(`folha-fechamento-reabrir-${idFech}`).click();
    await expect(page.getByTestId('folha-fechamento-reabertura-form')).toBeVisible();
    await campo(page, 'folha-fechamento-reabertura-motivo').fill('Correção de rubrica (E2E M53.7)');
    await semViolacaoAxe(page, '/pessoas/folha (reabrir o período)');
    await page.getByTestId('folha-fechamento-reabertura-confirmar').click();
    await expect(page.getByTestId('folha-fechamento-aviso')).toContainText(`Período ${rotuloComp} reaberto`, {
      timeout: 30_000,
    });
    await expect(page.getByTestId(`folha-fechamento-situacao-${idFech}`)).toContainText('Reaberto');

    // Quem só consulta a folha vê a lista do ano, sem fechar nem reabrir.
    await entrar(page, 'SINT.FOLHA.CONSULTA');
    await page.goto('/pessoas/folha?aba=fechamento');
    await expect(page.getByTestId('folha-fechamento')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-fechamento-so-consulta')).toBeVisible();
    await expect(page.getByTestId('folha-fechamento-form')).toHaveCount(0);
    await escolher(page.getByTestId('folha-fechamento-ano'), comp.slice(0, 4));
    await expect(page.getByTestId(`folha-fechamento-linha-${idFech}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="folha-fechamento-reabrir-"]')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (fechamento em consulta)');

    expect(externas).toEqual([]);
  });
});
