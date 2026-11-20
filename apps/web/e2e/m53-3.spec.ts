// E2E @M53.3 (ficha do M53, etapa F2: cálculo mensal; seções 6, 7, 8 regras 7 e 8 e 10 na parte da F2): com a folha
// desligada, a aba Cálculo da folha da competência fica em consulta (sem prévia nem cálculo) → o administrador registra as
// conferências e liga a folha, o cadastro de colaboradores, o ponto e o "Meu espaço" → o RH admite a colaboradora com
// login (se ela ainda não tiver vínculo) numa data antiga e importa o arquivo do relógio de uma competência fechada →
// a coordenação fecha o ponto → o departamento pessoal vê as pendências que barram (sem parâmetros, sem salário), registra
// a vigência dos parâmetros (valores da lei, rubrica de cada papel com busca) e o salário contratual → a prévia mostra os
// totais e a prova da soma sem gravar → o cálculo gravado (com a confirmação) mostra a prova relida, os encargos, a grade
// e a memória da colaboradora → o recálculo substitui o anterior (histórico) → quem só consulta vê o cálculo sem os
// botões e sem a aba de salários → a colaboradora abre o holerite pelo "Meu espaço" (sem os encargos da empresa) →
// recolher. Axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev; pessoas, ponto e folha em
// MEMÓRIA (nada vai à cópia); CPF SINTÉTICO.
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

test.describe('folha de pagamento, etapa F2: cálculo mensal @M53.3', () => {
  test.setTimeout(480_000);

  test('desligado → ligar → admitir → ponto fechado → pendências → parâmetros → salário → prévia → calcular → memória → recalcular → consulta → holerite → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    // Competência de oito meses atrás: as colaboradoras dos outros cenários entram depois, então só esta vai no cálculo.
    const ref = new Date(hoje.getFullYear(), hoje.getMonth() - 8, 1);
    const comp = `${ref.getFullYear()}-${p2(ref.getMonth() + 1)}`;
    const rotuloComp = `${comp.slice(5, 7)}/${comp.slice(0, 4)}`;
    const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
    const de = `${comp}-01`;
    const ate = `${comp}-${p2(ultimo)}`;
    const admissao = new Date(hoje.getFullYear(), hoje.getMonth() - 9, 1);
    const sufixo = Date.now().toString(36).toUpperCase();

    // Folha desligada: a aba Cálculo abre (é a primeira) e fica em consulta, sem prévia nem cálculo.
    await entrar(page, 'SINT.DP.FOLHA');
    await (await itemDoMenu(page, 'Folha de pagamento')).click();
    await expect(page).toHaveURL(/\/pessoas\/folha$/);
    await expect(page.getByTestId('folha-calculo')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-aba-calculo')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('folha-calculo-calcular')).toHaveCount(0);
    await expect(page.getByTestId('folha-calculo-previa')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (cálculo desligado)');

    // O administrador registra as conferências e liga a folha, o cadastro de colaboradores, o ponto e o Meu espaço.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M53.3)');
    await ligar(page, 'pessoas.ponto', 'Conferência sintética do RH e do setor-piloto (E2E M53.3)');
    await ligar(page, 'pessoas.autoatendimento', 'Conferência sintética do RH e do DPO (E2E M53.3)');
    await ligar(page, 'pessoas.folha', 'Conferência sintética do departamento pessoal (E2E M53.3)');

    // A colaboradora com login: admitida aqui numa data antiga se ainda não tiver vínculo. Se outro cenário da mesma
    // rodada já a admitiu (hoje ou há poucos meses), o cálculo vai para uma colaboradora sem login, e o holerite da
    // colaboradora com login diz que a competência não foi calculada para ela.
    await entrar(page, 'SINT.COLAB.PONTO');
    await page.goto('/pessoas/meu');
    await expect(page.getByTestId('tela-meu-espaco')).toBeVisible();
    await expect(page.getByTestId('meu-vinculo').or(page.getByTestId('meu-sem-vinculo'))).toBeVisible({
      timeout: 30_000,
    });
    const comLogin = await page.getByTestId('meu-sem-vinculo').isVisible();
    const doc = comLogin ? cpf('900520006') : cpf(`9005330${String(Date.now() % 100).padStart(2, '0')}`);
    const nome = `COLABORADORA CALCULO E2E ${sufixo}`;

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

    // O RH importa o arquivo do relógio da competência (quatro marcações, oito horas num dia; NSR próprios do cenário, que o
    // relógio sintético é o mesmo dos outros cenários e a marcação repetida não entra de novo).
    await page.goto('/pessoas/ponto');
    await expect(page.getByTestId('form-importar-afd')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('ponto-arquivo').setInputFiles({
      name: 'afd-calculo-e2e.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        afd(
          de,
          ate,
          [
            [5301, `${comp}-02T07:00`],
            [5302, `${comp}-02T11:00`],
            [5303, `${comp}-02T12:00`],
            [5304, `${comp}-02T16:00`],
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
    await expect(page.getByTestId('ponto-tabela-painel')).toContainText(nome);
    await page.getByRole('link', { name: `Abrir o espelho de ${nome}` }).click();
    await expect(page.getByTestId('tela-espelho-ponto')).toBeVisible({ timeout: 30_000 });
    const espelho = page.url().replace(/\d{4}-\d{2}(\/?)$/, `${comp}$1`);

    // A coordenação fecha o ponto da competência (o cálculo só usa o ponto fechado).
    await entrar(page, 'SINT.PONTO');
    await page.goto(espelho);
    await expect(page.getByTestId('tela-espelho-ponto')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`dia-${comp}-02`)).toBeVisible();
    await page.getByTestId('periodo-fechar').click();
    await expect(page.getByTestId('espelho-aviso')).toContainText('Período fechado');

    // O departamento pessoal pede a prévia: sem parâmetros e sem salário, o cálculo é barrado com o que falta.
    await entrar(page, 'SINT.DP.FOLHA');
    await abrirFolha(page, comp);
    await expect(page.getByTestId('folha-calculo-nenhum')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('folha-calculo-previa').click();
    const pend = page.getByTestId('folha-calculo-pendencias');
    await expect(pend).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-calculo-pendencia-sem-parametros')).toBeVisible();
    await expect(page.getByTestId('folha-calculo-pendencia-sem-salario')).toBeVisible();
    await expect(page.getByTestId('folha-calculo-pendencia-ponto-nao-fechado')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (pendências do cálculo)');

    // Parâmetros: a primeira vigência parte dos valores da lei (D-PARAMDEF-533); a rubrica de cada papel tem busca.
    await page.getByTestId('folha-aba-parametros').click();
    await expect(page.getByTestId('folha-parametros')).toBeVisible();
    await expect(page.getByTestId('folha-parametro-nenhum')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('folha-parametro-novo').click();
    await expect(page.getByTestId('folha-parametro-form')).toBeVisible();
    await expect(campo(page, 'folha-parametro-campo-horaExtra50')).toHaveValue(/^50(,00)?$/);
    await expect(campo(page, 'folha-parametro-campo-divisor')).toHaveValue('220');
    await data(page, 'folha-parametro-inicio', admissao);
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-salario'), { rotulo: '1 · Salário base' });
    // As horas do dia sem escala contam como extra em descanso, com o descanso semanal sobre elas (rubrica sintética).
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-horaExtra100'), {
      rotulo: '3 · Horas extras 50%',
    });
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-dsrVariaveis'), {
      rotulo: '3 · Horas extras 50%',
    });
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-inss'), {
      rotulo: '4 · Desconto de INSS',
    });
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-irrf'), {
      rotulo: '4 · Desconto de INSS',
    });
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-fgts'), {
      rotulo: '5 · Base de cálculo do FGTS',
    });
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-faltas'), {
      rotulo: '4 · Desconto de INSS',
    });
    await escolher(page.getByTestId('folha-parametro-rubrica-campo-atrasos'), {
      rotulo: '4 · Desconto de INSS',
    });
    await semViolacaoAxe(page, '/pessoas/folha (nova vigência dos parâmetros)');
    await page.getByTestId('folha-parametro-gravar').click();
    await expect(page.getByTestId('folha-parametro-aviso')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-parametro-vigente')).toContainText(br(admissao));
    await expect(page.getByTestId('folha-parametro-rubrica-salario')).toContainText('Salário base');
    await expect(page.getByTestId('folha-parametro-rubrica-sobreaviso')).toContainText('Sem rubrica');

    // Salário contratual da colaboradora: busca, nova vigência desde a admissão.
    await page.getByTestId('folha-aba-salarios').click();
    await expect(page.getByTestId('folha-salarios')).toBeVisible();
    await campo(page, 'folha-salario-termo').fill(nome);
    await page.getByTestId('folha-salario-buscar').click();
    await page.getByTestId('folha-salario-achados').getByRole('button').first().click();
    await expect(page.getByTestId('folha-salario-colaborador')).toContainText(nome);
    await expect(page.getByTestId('folha-salario-nenhum')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('folha-salario-novo').click();
    await expect(page.getByTestId('folha-salario-form')).toBeVisible();
    await data(page, 'folha-salario-inicio', admissao);
    await campo(page, 'folha-salario-valor').fill('3000,00');
    await campo(page, 'folha-salario-motivo').fill('Salário de admissão (E2E M53.3)');
    await semViolacaoAxe(page, '/pessoas/folha (nova vigência do salário)');
    await page.getByTestId('folha-salario-gravar').click();
    await expect(page.getByTestId('folha-salario-aviso')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-salario-vigencias')).toContainText('3.000,00');
    await expect(page.getByTestId('folha-salario-em-vigor')).toBeVisible();

    // Prévia: totais e a prova da soma com as parcelas impressas, sem gravar (o histórico segue vazio).
    await page.getByTestId('folha-aba-calculo').click();
    await expect(page.getByTestId('folha-calculo')).toBeVisible();
    await page.getByTestId('folha-calculo-previa').click();
    await expect(page.getByTestId('folha-calculo-visto-previa')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-calculo-pendencias')).toHaveCount(0);
    await expect(page.getByTestId('folha-calculo-prova-situacao')).toContainText('A soma confere');
    await expect(page.getByTestId('folha-calculo-conta')).toContainText(
      /R\$ [\d.,]+ − R\$ [\d.,]+ = R\$ [\d.,]+/,
    );
    await expect(page.locator('[data-testid^="folha-calculo-colaborador-"]')).toHaveCount(1);
    await semViolacaoAxe(page, '/pessoas/folha (prévia do cálculo)');

    // Calcular com a confirmação: o cálculo gravado relê a prova da soma, os encargos e o custo de pessoal.
    await page.getByTestId('folha-calculo-calcular').click();
    await expect(page.getByTestId('folha-calculo-confirmacao')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/folha (confirmar o cálculo)');
    await page.getByTestId('folha-calculo-confirmar').click();
    await expect(page.getByTestId('folha-calculo-visto-vigente')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-calculo-prova-situacao')).toContainText('A soma confere');
    await expect(page.getByTestId('folha-calculo-conta-encargos')).toBeVisible();
    await expect(page.getByTestId('folha-calculo-conta-custo')).toBeVisible();
    await expect(page.locator('[data-testid^="folha-calculo-processo-"]')).toHaveCount(1);
    const liquido = (await page.getByTestId('folha-calculo-total-liquido').innerText()).trim();
    // O relatório de conferência em PDF/A (sem gerador no dev, o HTML do documento): totais, prova e grade por vínculo.
    const pdfConferencia = await page.request.get(
      (await page.getByTestId('folha-calculo-pdf').getAttribute('href')) ?? '',
    );
    expect(pdfConferencia.status()).toBe(200);
    expect(pdfConferencia.headers()['content-type']).toMatch(/application\/pdf|text\/html/);
    if (pdfConferencia.headers()['content-type']?.includes('html'))
      expect(await pdfConferencia.text()).toContain('A soma confere.');
    await semViolacaoAxe(page, '/pessoas/folha (cálculo gravado)');

    // A memória da colaboradora: as linhas com a conta de cada uma e a prova do líquido.
    await page.locator('[data-testid^="folha-calculo-memoria-"]').first().click();
    const memoria = page.getByTestId('folha-calculo-memoria');
    await expect(memoria).toBeVisible({ timeout: 30_000 });
    await expect(memoria.getByTestId('folha-calculo-linha-salario')).toContainText('3.000,00');
    await expect(memoria.getByTestId('folha-calculo-linha-inss')).toBeVisible();
    await expect(memoria.getByTestId('folha-calculo-memoria-prova')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/folha (memória do colaborador)');
    await page.keyboard.press('Escape');
    await expect(memoria).toHaveCount(0);

    // Recalcular: o novo processamento substitui o anterior, que fica no histórico.
    await page.getByTestId('folha-calculo-calcular').click();
    await expect(page.getByTestId('folha-calculo-confirmacao')).toContainText('substitui');
    await page.getByTestId('folha-calculo-confirmar').click();
    await expect(page.locator('[data-testid^="folha-calculo-processo-"]')).toHaveCount(2, {
      timeout: 30_000,
    });
    await expect(page.getByTestId('folha-calculo-historico')).toContainText('Substituído');
    await semViolacaoAxe(page, '/pessoas/folha (recálculo)');

    // Quem só consulta a folha vê o cálculo em vigor, sem os botões e sem a aba dos salários.
    await entrar(page, 'SINT.FOLHA.CONSULTA');
    await abrirFolha(page, comp);
    await expect(page.getByTestId('folha-calculo-visto-vigente')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-calculo-calcular')).toHaveCount(0);
    await expect(page.getByTestId('folha-calculo-previa')).toHaveCount(0);
    await expect(page.getByTestId('folha-aba-salarios')).toHaveCount(0);
    // D-PERM-SAL-533: sem a permissão do salário, nem a lista por colaborador, nem a memória, nem o PDF de conferência.
    await expect(page.getByTestId('folha-calculo-grade-oculta')).toBeVisible();
    await expect(
      page.getByTestId('folha-calculo-grade').locator('[data-testid^="folha-calculo-memoria-"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid^="folha-calculo-colaborador-"]')).toHaveCount(0);
    await expect(page.getByTestId('folha-calculo-pdf')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (cálculo em consulta)');

    // A colaboradora abre o holerite pelo Meu espaço: só o próprio, sem os encargos da empresa.
    await entrar(page, 'SINT.COLAB.PONTO');
    await page.goto('/pessoas/meu');
    await expect(page.getByTestId('meu-vinculo')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('meu-holerite').click();
    await expect(page).toHaveURL(/\/pessoas\/meu\/holerite/);
    await expect(page.getByTestId('tela-meu-holerite')).toBeVisible();
    await escolher(page.getByTestId('holerite-competencia'), { rotulo: rotuloComp });
    if (comLogin) {
      await expect(page.getByTestId('holerite-linhas')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('holerite-cabecalho')).toContainText(rotuloComp);
      await expect(page.getByTestId('holerite-linha-salario')).toContainText('3.000,00');
      await expect(page.getByTestId('holerite-linha-inssPatronal')).toHaveCount(0);
      await expect(page.getByTestId('holerite-linha-rat')).toHaveCount(0);
      await expect(page.getByTestId('holerite-liquido')).toContainText(liquido.replace(/^.*?(R\$)/, '$1'));
      const pdfHolerite = await page.request.get(
        (await page.getByTestId('holerite-pdf').getAttribute('href')) ?? '',
      );
      expect(pdfHolerite.status()).toBe(200);
      if (pdfHolerite.headers()['content-type']?.includes('html')) {
        const corpo = await pdfHolerite.text();
        expect(corpo).toContain(`Holerite ${rotuloComp}`);
        expect(corpo).not.toContain('INSS da empresa');
      }
    } else {
      await expect(page.getByTestId('holerite-nao-calculado')).toBeVisible({ timeout: 30_000 });
    }
    await semViolacaoAxe(page, '/pessoas/meu/holerite');
    // O holerite de outro vínculo é recusado mesmo pedido direto à API.
    const alheio = await page.request.get(`/api/pessoas/meu/holerite?competencia=${comp}&vinculo=999999`);
    expect(alheio.status()).toBe(403);

    // Recolher: desligar a folha (o cálculo gravado fica; a aba volta a consulta).
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.folha')).toBeVisible({ timeout: 30_000 });
    await chave(page, 'pessoas.folha', false, 'Recolher o E2E M53.3');
    await expect(page.getByTestId('recurso-pessoas.folha')).toContainText('Desligada');
    await entrar(page, 'SINT.DP.FOLHA');
    await abrirFolha(page, comp);
    await expect(page.getByTestId('folha-calculo-calcular')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
