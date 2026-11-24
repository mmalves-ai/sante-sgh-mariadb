// E2E @M53.8 (ficha do M53, etapa F7: FGTS Digital e obrigações legais; seções 1, 4 a 8 na parte da F7; regras 3 e 7):
// o administrador liga a folha, o cadastro de colaboradores e o ponto → o RH admite o colaborador e importa o relógio da
// competência anterior → a coordenação fecha o ponto → o departamento pessoal calcula e fecha a folha → no eSocial, a
// ficha do colaborador com o NIS e o CBO, os parâmetros do empregador e o S-1200 aceito pelo retorno do lote → pelo menu,
// as Obrigações legais: sem parâmetros o FGTS Digital não é exigido → os parâmetros da empresa com os regimes em vigência
// (a SEFIP exigida também na competência, D-INT-REGIME-538) → o FGTS Digital apurado por trabalhador, com o eSocial
// aceito, gerado e entregue com a guia conciliada (a guia errada é recusada) → a SEFIP pela prévia, gerada com o aviso do
// leiaute não conferido, baixada (o arquivo de 360 posições), sem entrega e cancelada com motivo → o histórico do ano →
// quem só consulta vê as obrigações sem gerar, sem baixar e sem valores. Axe sem violação séria em cada estado. Sessão
// real sobre a fonte sintética de dev; pessoas, ponto, folha, eSocial e obrigações em MEMÓRIA (nada vai à cópia); CPF,
// NIS e CNPJ SINTÉTICOS; nenhum dado de pessoa. O Sante não transmite nada ao governo (regra 3). Roda numa execução
// própria (`pnpm e2e -- --grep @M53.8`, memória nova), como a M53.7 (D-E2E-537).
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
/** NIS (PIS/PASEP) sintético com o dígito verificador. */
function nis(base10: string): string {
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base10[i]) * p));
  const r = 11 - (s % 11);
  return `${base10}${r >= 10 ? 0 : r}`;
}

async function abrirObrigacoes(
  page: Page,
  aba: 'fgts' | 'arquivos' | 'parametros' | 'historico',
): Promise<void> {
  await page.goto(`/pessoas/obrigacoes?aba=${aba}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Obrigações legais' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('obrigacoes-escolha-empresa')).toHaveCount(0, { timeout: 30_000 });
}

test.describe('folha de pagamento, etapa F7: FGTS Digital e obrigações legais @M53.8', () => {
  test.setTimeout(600_000);
  test.use({ actionTimeout: 60_000 });

  test('ligar → admitir → ponto → fechar a folha → S-1200 aceito → parâmetros → FGTS Digital gerado e entregue → catálogo com a SEFIP encerrada e a geração recusada → histórico → consulta; axe', async ({
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
    const doc = cpf(`9005380${String(Date.now() % 100).padStart(2, '0')}`);
    const nome = `COLABORADOR OBRIGACOES E2E ${sufixo}`;

    // O administrador liga o cadastro de colaboradores, o ponto e a folha.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M53.8)');
    await ligar(page, 'pessoas.ponto', 'Conferência sintética do RH e do setor-piloto (E2E M53.8)');
    await ligar(page, 'pessoas.folha', 'Conferência sintética do departamento pessoal (E2E M53.8)');

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
      name: 'afd-obrigacoes-e2e.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        afd(
          de,
          ate,
          [
            [5381, `${comp}-02T07:00`],
            [5382, `${comp}-02T11:00`],
            [5383, `${comp}-02T12:00`],
            [5384, `${comp}-02T16:00`],
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
    await campo(page, 'folha-salario-motivo').fill('Salário de admissão (E2E M53.8)');
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
    await campo(page, 'esocial-ficha-cbo-cargo').fill('411010');
    await campo(page, 'esocial-ficha-nis').fill(
      nis(`120${String(Date.now() % 10_000_000).padStart(7, '0')}`),
    );
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

    // Lote com o S-1200, ao coletor local, e o retorno com o recibo: o FGTS Digital parte do evento aceito.
    await page.getByTestId('esocial-aba-eventos').click();
    await expect(page.getByTestId('esocial-eventos')).toBeVisible();
    const linhaEv = page.locator('tr[data-testid^="esocial-evento-"]', { hasText: 'S-1200' }).first();
    await expect(linhaEv).toBeVisible({ timeout: 30_000 });
    const idEv = /^esocial-evento-(\d+)$/.exec((await linhaEv.getAttribute('data-testid')) ?? '')?.[1] ?? '';
    expect(idEv).toMatch(/^\d+$/);
    await marcar(page, 'esocial-escolha-eventos', idEv);
    await page.getByTestId('esocial-montar-lote').click();
    await expect(page.getByTestId('esocial-eventos-aviso')).toContainText(
      /Lote \d+ montado com 1 evento\(s\)/,
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
    await campo(page, `esocial-retorno-recibo-${idEv}`).fill('1.1.0000000000000005380');
    await campo(page, `esocial-retorno-codigo-${idEv}`).fill('201');
    await campo(page, `esocial-retorno-descricao-${idEv}`).fill('Sucesso (E2E M53.8)');
    await page.getByTestId('esocial-retorno-gravar').click();
    await expect(page.getByTestId('esocial-lotes-aviso')).toContainText(
      `Retorno do lote ${idLote} registrado`,
      {
        timeout: 30_000,
      },
    );

    // Obrigações legais pelo menu: o aviso de que o Sante não transmite; sem parâmetros, o FGTS Digital não é exigido.
    await (await itemDoMenu(page, 'Obrigações legais')).click();
    await expect(page).toHaveURL(/\/pessoas\/obrigacoes/);
    await expect(page.getByTestId('tela-obrigacoes')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('obrigacoes-nao-transmite')).toBeVisible();
    await expect(page.getByTestId('obrigacoes-so-consulta')).toHaveCount(0);
    await expect(page.getByTestId('obrigacoes-fgts')).toBeVisible({ timeout: 30_000 });
    await escolher(page.getByTestId('obrigacoes-fgts-competencia'), comp);
    await expect(page.getByTestId('obrigacoes-fgts-nao-exigida')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('obrigacoes-fgts-gerar')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/obrigacoes (FGTS Digital sem parâmetros)');

    // Parâmetros da empresa: a vigência desde a competência, com os regimes da sugestão e a SEFIP exigida também na
    // competência (o regime é dado com vigência, nunca constante: regra 7); o CEP inválido é nomeado antes de gravar.
    await page.getByTestId('obrigacoes-aba-parametros').click();
    await expect(page.getByTestId('obrigacoes-parametros')).toBeVisible();
    await expect(page.getByTestId('obrigacoes-fontes')).toContainText('Portaria MTE 240/2024');
    await expect(
      page
        .getByTestId('obrigacoes-parametros-vazio')
        .or(page.locator('[data-testid^="obrigacoes-vigencia-"]').first()),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('obrigacoes-parametros-nova').click();
    await expect(page.getByTestId('obrigacoes-parametros-form')).toBeVisible();
    await escolher(page.getByTestId('obrigacoes-param-inicio'), comp);
    await campo(page, 'obrigacoes-param-razao').fill('HOSPITAL SINTETICO E2E');
    await campo(page, 'obrigacoes-param-natureza').fill('2062');
    await campo(page, 'obrigacoes-param-logradouro').fill('Rua Sintetica 100');
    await campo(page, 'obrigacoes-param-bairro').fill('Centro');
    await campo(page, 'obrigacoes-param-cep').fill('301');
    await campo(page, 'obrigacoes-param-cidade').fill('Belo Horizonte');
    await campo(page, 'obrigacoes-param-uf').fill('MG');
    await campo(page, 'obrigacoes-param-municipio').fill('3106200');
    await campo(page, 'obrigacoes-param-contato').fill('DP SINTETICO');
    await campo(page, 'obrigacoes-param-telefone').fill('(31) 3000-0000');
    await campo(page, 'obrigacoes-param-email').fill('dp@sintetico.invalid');
    await page.getByTestId('obrigacoes-param-sugestao').click();
    await campo(page, 'obrigacoes-param-sefip-ate').fill('');
    // O FGTS Digital com o leiaute conferido (a entrega exige, D-ENTREGA-538); a SEFIP fica não conferida.
    await escolher(page.getByTestId('obrigacoes-param-fgts-digital-conferido'), 'sim');
    await semViolacaoAxe(page, '/pessoas/obrigacoes (nova vigência dos parâmetros)');
    await page.getByTestId('obrigacoes-param-gravar').click();
    await expect(page.getByTestId('obrigacoes-param-invalido')).toContainText('CEP');
    await campo(page, 'obrigacoes-param-cep').fill('30130-000');
    await page.getByTestId('obrigacoes-param-gravar').click();
    await expect(page.getByTestId('obrigacoes-parametros-aviso')).toContainText(rotuloComp, {
      timeout: 30_000,
    });
    await expect(page.getByTestId(`obrigacoes-vigencia-${comp}-fgts-digital`)).toContainText(
      'FGTS Digital 1.0',
    );
    await expect(page.getByTestId(`obrigacoes-vigencia-${comp}-sefip`)).toContainText('Não conferido');

    // FGTS Digital: a apuração por trabalhador com o S-1200 aceito e a prova da soma; gera direto (a apuração é a
    // prévia) e registra a entrega com a guia conciliada (a errada volta recusada).
    await page.getByTestId('obrigacoes-aba-fgts').click();
    await escolher(page.getByTestId('obrigacoes-fgts-competencia'), comp);
    await expect(page.getByTestId('obrigacoes-fgts-tabela')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('obrigacoes-fgts-nao-exigida')).toHaveCount(0);
    const linhaFgts = page.locator('[data-testid^="obrigacoes-fgts-esocial-"]').first();
    await expect(linhaFgts).toHaveText('Aceito');
    await expect(page.getByTestId('obrigacoes-fgts-parcelas')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/obrigacoes (apuração do FGTS Digital)');
    await page.getByTestId('obrigacoes-fgts-gerar').click();
    await expect(page.getByTestId('obrigacoes-fgts-aviso')).toContainText('geração 1', { timeout: 30_000 });
    const cartaoFgts = page.locator('article[data-testid^="obrigacao-"]').first();
    await expect(cartaoFgts).toBeVisible();
    const idFgts = /^obrigacao-(\d+)$/.exec((await cartaoFgts.getAttribute('data-testid')) ?? '')?.[1] ?? '';
    expect(idFgts).toMatch(/^\d+$/);
    await expect(page.getByTestId(`obrigacao-${idFgts}-sha`)).toHaveText(/^[0-9a-f]{64}$/);
    await page.getByTestId(`obrigacao-${idFgts}-entregar`).click();
    const esperado = page.getByTestId('obrigacao-entrega-esperado');
    await expect(esperado).toBeVisible();
    const valor = /(\d{1,3}(?:\.\d{3})*,\d{2})/.exec(await esperado.innerText())?.[1] ?? '';
    expect(valor).not.toBe('');
    await campo(page, 'obrigacao-entrega-protocolo').fill('GUIA-E2E-538');
    await campo(page, 'obrigacao-entrega-guia').fill('1,00');
    await semViolacaoAxe(page, '/pessoas/obrigacoes (entrega do FGTS Digital)');
    await page.getByTestId('obrigacao-entrega-gravar').click();
    await expect(page.getByRole('dialog')).toContainText('não confere', { timeout: 30_000 });
    await campo(page, 'obrigacao-entrega-guia').fill(valor);
    await page.getByTestId('obrigacao-entrega-gravar').click();
    await expect(page.getByTestId('obrigacoes-fgts-aviso')).toContainText('Entrega', { timeout: 30_000 });
    await expect(page.getByTestId(`obrigacao-${idFgts}-situacao`)).toHaveText('Entregue');
    await expect(page.getByTestId(`obrigacao-${idFgts}-entrega`)).toContainText('GUIA-E2E-538');
    await expect(page.getByTestId('obrigacoes-fgts-gerar')).toHaveCount(0);

    // Catálogo oficial: a SEFIP está encerrada (com o ato da substituição) e fica só para consulta; a tela não
    // oferece a prévia nem a geração, e o servidor recusa a geração com 409 obrigacao-encerrada.
    await page.getByTestId('obrigacoes-aba-arquivos').click();
    await expect(page.getByTestId('obrigacoes-arquivos')).toBeVisible();
    await expect(page.getByTestId('obrigacoes-catalogo-fgts-digital-situacao')).toHaveText('Vigente', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('obrigacoes-catalogo-sefip-situacao')).toHaveText('Encerrada');
    await expect(page.getByTestId('obrigacoes-catalogo-sefip')).toContainText('substituída por');
    await expect(page.getByTestId('obrigacoes-catalogo-rais-situacao')).toHaveText('Encerrada');
    await escolher(page.getByTestId('obrigacoes-arquivos-tipo'), 'sefip');
    await escolher(page.getByTestId('obrigacoes-arquivos-periodo'), comp);
    await expect(page.getByTestId('obrigacoes-arquivos-encerrada')).toBeVisible();
    await expect(page.getByTestId('obrigacoes-arquivos-previa')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/obrigacoes (catálogo e SEFIP encerrada)');
    const recusa = await page.evaluate(
      async ({ periodo, id }) => {
        const empresa = ((await (await fetch(`/api/pessoas/obrigacoes/${id}`)).json()) as { empresa: number })
          .empresa;
        const csrf = /(?:^|;\s*)sgh_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? '';
        const r = await fetch('/api/pessoas/obrigacoes', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'x-csrf': csrf,
            'idempotency-key': `e2e-m53-8-sefip-${Date.now()}`,
          },
          body: JSON.stringify({ empresa, tipo: 'sefip', periodo, simular: false, recolhimento: null }),
        });
        return { status: r.status, corpo: await r.text() };
      },
      { periodo: comp, id: idFgts },
    );
    expect(recusa.status, recusa.corpo).toBe(409);
    expect(recusa.corpo).toContain('obrigacao-encerrada');

    // Histórico do ano: as duas gerações, com a situação.
    await page.getByTestId('obrigacoes-aba-historico').click();
    await expect(page.getByTestId('obrigacoes-historico')).toBeVisible();
    await escolher(page.getByTestId('obrigacoes-historico-ano'), comp.slice(0, 4));
    await expect(page.getByTestId(`obrigacoes-historico-${idFgts}`)).toContainText('Entregue', {
      timeout: 30_000,
    });
    await semViolacaoAxe(page, '/pessoas/obrigacoes (histórico)');

    // Quem só consulta (opção 415): as obrigações sem gerar, sem baixar e sem os valores.
    await entrar(page, 'SINT.OBRIGACAO.CONSULTA');
    await abrirObrigacoes(page, 'fgts');
    await expect(page.getByTestId('obrigacoes-so-consulta')).toBeVisible();
    await expect(page.getByTestId('obrigacoes-sem-valores')).toBeVisible();
    await escolher(page.getByTestId('obrigacoes-fgts-competencia'), comp);
    await expect(page.getByTestId(`obrigacao-${idFgts}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('obrigacoes-fgts-gerar')).toHaveCount(0);
    await expect(page.getByTestId('obrigacoes-fgts-tabela')).toHaveCount(0);
    await expect(page.getByTestId(`obrigacao-${idFgts}-baixar`)).toHaveCount(0);
    await expect(page.getByTestId(`obrigacao-${idFgts}-total-fgts`)).toHaveCount(0);
    await page.getByTestId('obrigacoes-aba-parametros').click();
    await expect(page.getByTestId(`obrigacoes-vigencia-${comp}-sefip`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('obrigacoes-parametros-nova')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/obrigacoes (consulta)');

    expect(externas).toEqual([]);
  });
});
