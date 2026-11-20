// E2E @M53.9 (ficha do M53, etapa F8: títulos e fatos contábeis; seções 4 a 10 na parte da F8; regras 6, 10 e 11): o
// administrador liga a folha, a interface com a folha externa, o cadastro de colaboradores e o ponto → o RH admite a
// colaboradora e importa o relógio de uma competência antiga → a coordenação fecha o ponto → o departamento pessoal gera o
// lote e importa o retorno conferido do simulador da folha externa → a integração abre pelo menu, sem de-para vigente →
// o de-para do líquido, do INSS e do FGTS com o credor por busca (só código e nome) e a classificação sugerida → a
// vigência gravada → a prévia do retorno: os três títulos, as parcelas impressas, a prova da soma, os fatos por centro e
// o resumo, sem gravar → lançar com a confirmação → a lista do ano com o lançamento e o detalhe com os títulos em aberto
// → o custo de pessoal da competência por centro (com a conta) → a mesma origem, na prévia de novo, sai com a pendência
// "já lançada" e sem o botão de lançar (regra 6). Axe sem violação séria em cada estado. Sessão real sobre a fonte
// sintética de dev; pessoas, ponto, folha e integração em MEMÓRIA (credores 9001–9005 sintéticos; nada vai à cópia);
// CPF SINTÉTICO. Roda numa execução própria (`pnpm e2e -- --grep @M53.9`, memória nova), como o @M53.7 (D-E2E-537): o
// lote leva todos os colaboradores com ponto fechado da competência.
import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';
import { simularFolhaExterna } from './folha-externa.js';

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

async function abrirFolha(page: Page, competencia: string): Promise<void> {
  await page.goto('/pessoas/folha');
  await expect(page.getByRole('heading', { level: 1, name: 'Folha de pagamento' })).toBeVisible();
  await expect(page.getByTestId('folha-filtros')).toBeVisible({ timeout: 30_000 });
  await escolher(page.getByTestId('folha-competencia'), {
    rotulo: `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`,
  });
  await page.getByTestId('folha-aba-interface').click();
}

/** Edita uma linha do de-para: o credor pela busca no servidor (termo → lista → escolha) e a classificação sugerida. */
async function dePara(page: Page, destino: string, termo: string, credor: number): Promise<void> {
  await page.getByTestId(`integracao-de-para-editar-${destino}`).click();
  const form = page.getByTestId('integracao-de-para-edicao');
  await expect(form).toBeVisible();
  await page.getByTestId('integracao-credor-termo').locator('input').first().fill(termo);
  await page.getByTestId('integracao-credor-buscar').click();
  await escolher(page.getByTestId('integracao-credor'), { rotulo: new RegExp(`^${credor}\\b`) });
  await page.getByTestId('integracao-de-para-aplicar').click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId(`integracao-de-para-${destino}`)).toContainText(String(credor));
}

test.describe('folha de pagamento, etapa F8: títulos e fatos contábeis @M53.9', () => {
  test.setTimeout(480_000);

  test('ligar → admitir → ponto → lote e retorno conferido → de-para → prévia → lançar → lançamentos → custo → repetida; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    // Competência de dois meses atrás (a do @M53.1 é três; a do @M53.7, um): só esta colaboradora vai no lote.
    const ref = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
    const comp = `${ref.getFullYear()}-${p2(ref.getMonth() + 1)}`;
    const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
    const de = `${comp}-01`;
    const ate = `${comp}-${p2(ultimo)}`;
    const admissao = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);
    const doc = cpf(`9005390${String(Date.now() % 100).padStart(2, '0')}`);
    const nome = `COLABORADORA INTEGRACAO E2E ${Date.now().toString(36).toUpperCase()}`;

    // O administrador liga a folha (a integração vem atrás dela), a interface, o cadastro e o ponto.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'pessoas.folha', 'Conferência sintética do departamento pessoal (E2E M53.9)');
    await ligar(page, 'pessoas.folhaExterna', 'Conferência sintética da folha externa (E2E M53.9)');
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M53.9)');
    await ligar(page, 'pessoas.ponto', 'Conferência sintética do RH e do setor-piloto (E2E M53.9)');

    // O RH admite a colaboradora e importa o relógio da competência (oito horas num dia).
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
      name: 'afd-integracao-e2e.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(
        afd(
          de,
          ate,
          [
            [5391, `${comp}-02T07:00`],
            [5392, `${comp}-02T11:00`],
            [5393, `${comp}-02T12:00`],
            [5394, `${comp}-02T16:00`],
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

    // O departamento pessoal gera o lote e importa o retorno conferido da folha externa.
    await entrar(page, 'SINT.DP.FOLHA');
    await abrirFolha(page, comp);
    await page.getByTestId('folha-gerar').click();
    await page.getByTestId('folha-confirmar-gerar').click();
    const gerado = page.getByTestId('folha-gerado');
    await expect(gerado).toBeVisible({ timeout: 30_000 });
    const lote = Number(/Lote (\d+) gerado/.exec((await gerado.textContent()) ?? '')?.[1]);
    expect(lote).toBeGreaterThan(0);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`folha-baixar-${lote}`).click(),
    ]);
    const exportado = JSON.parse(await readFile(await download.path(), 'utf8')) as unknown;
    const retorno = simularFolhaExterna(exportado);
    await page.getByTestId(`folha-importar-${lote}`).click();
    await page.getByTestId('folha-arquivo-retorno').setInputFiles({
      name: 'retorno-integracao.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(retorno), 'utf8'),
    });
    await page.getByTestId('folha-enviar-retorno').click();
    await expect(page.getByTestId('folha-importacao')).toContainText('Conferido', { timeout: 30_000 });
    const inss = retorno.encargos.find((e) => e.tipo === 'inss')!.valor;
    const fgts = retorno.encargos.find((e) => e.tipo === 'fgts')!.valor;
    const liquido = retorno.colaboradores.reduce((s, c) => s + c.liquido, 0);
    const reais = (c: number) =>
      `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // A integração abre pelo menu; sem de-para vigente, a aba mostra as rotinas e a sugestão do perfil.
    const item = await itemDoMenu(page, 'Integração da folha com financeiro e contábil');
    await expect(item).toHaveAttribute('href', '/pessoas/folha/integracao', { timeout: 30_000 });
    await item.click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('tela-integracao-folha')).toBeVisible({ timeout: 30_000 });
    if ((await page.getByTestId('integracao-escolha-empresa').count()) > 0)
      await escolher(page.getByTestId('integracao-empresa'), { indice: 0 });
    await page.getByTestId('integracao-aba-dePara').click();
    await expect(page.getByTestId('integracao-de-para-sem-vigente')).toBeVisible({ timeout: 30_000 });
    // A rotina que o cadastro não integra ao financeiro não se edita (D-TELA-539): nenhuma das nove é assim aqui.
    await expect(page.getByTestId('integracao-de-para-liquido-mensal')).toContainText('Folha mensal');
    await semViolacaoAxe(page, '/pessoas/folha/integracao (de-para sem vigência)');

    // O de-para do líquido, do INSS e do FGTS (credor por busca; classificação sugerida pelo perfil).
    await dePara(page, 'liquido-mensal', 'BANCO', 9001);
    await semViolacaoAxe(page, '/pessoas/folha/integracao (de-para editado)');
    await dePara(page, 'inss', 'PREVIDENCIA', 9002);
    await dePara(page, 'fgts', 'FUNDO', 9003);
    await page.getByTestId('integracao-de-para-gravar').click();
    await expect(page.getByTestId('integracao-de-para-gravado')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('integracao-de-para-vigente')).toContainText('SINT.DP.FOLHA');

    // A prévia do retorno conferido: três títulos, as parcelas impressas, a prova da soma e os fatos (sem gravar).
    await page.getByTestId('integracao-aba-lancar').click();
    await expect(page.getByTestId('integracao-lancar')).toBeVisible();
    await escolher(page.getByTestId('integracao-ano'), String(ref.getFullYear()));
    // A origem sugerida é a mais nova ainda não lançada: o retorno conferido (registro próprio, não o lote enviado).
    const origemSugerida = page.getByTestId('integracao-origem');
    await expect(origemSugerida).toHaveAttribute('data-valor', /^interface:\d+$/, { timeout: 30_000 });
    const origem = (await origemSugerida.getAttribute('data-valor'))!;
    await page.getByTestId('integracao-previa').click();
    const previa = page.getByTestId('integracao-previa-resultado');
    await expect(previa).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('integracao-sem-pendencias')).toBeVisible();
    await expect(page.locator('tr[data-testid^="integracao-titulo-"]')).toHaveCount(3);
    await expect(page.getByTestId('integracao-titulo-liquido-mensal')).toContainText('9001');
    await expect(page.getByTestId('integracao-titulo-liquido-mensal')).toContainText(reais(liquido));
    await expect(page.getByTestId('integracao-titulo-inss')).toContainText(reais(inss));
    await expect(page.getByTestId('integracao-titulo-fgts')).toContainText(reais(fgts));
    await expect(page.getByTestId('integracao-parcelas').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('integracao-conta')).toContainText(reais(liquido + inss + fgts));
    await expect(page.getByTestId('integracao-soma')).toContainText(
      'A soma dos títulos fecha com o líquido mais os encargos.',
    );
    await expect(page.getByTestId('integracao-resumo')).toContainText(/[0-9a-f]{64}/);
    // A folha é lançada com atraso: os vencimentos sugeridos já passaram, a tela avisa e pede os novos (D-VENC-PREVIA-539).
    await expect(page.getByTestId('integracao-vencimento-antes')).toBeVisible();
    await expect(page.getByTestId('integracao-confirmar')).toBeDisabled();
    await semViolacaoAxe(page, '/pessoas/folha/integracao (prévia)');
    for (const [destino, dias] of [
      ['liquido-mensal', 3],
      ['inss', 5],
      ['fgts', 7],
    ] as const) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + dias);
      const c = page.getByTestId(`integracao-vencimento-${destino}`).locator('input').first();
      await c.fill(br(d));
      await c.press('Tab');
    }
    await expect(page.getByTestId('integracao-vencimento-antes')).toHaveCount(0);
    await expect(page.getByTestId('integracao-confirmar')).toBeEnabled();

    // Lançar com a confirmação: os títulos, o registro e o evento do custo numa transação só.
    await page.getByTestId('integracao-confirmar').click();
    const lancado = page.getByTestId('integracao-lancado');
    await expect(lancado).toBeVisible({ timeout: 30_000 });
    await expect(lancado).toContainText('Títulos lançados (lançamento');
    const lancamento = Number(/lançamento (\d+)/.exec((await lancado.textContent()) ?? '')?.[1]);
    expect(lancamento).toBeGreaterThan(0);
    await semViolacaoAxe(page, '/pessoas/folha/integracao (lançado)');

    // A lista do ano e o detalhe: os três títulos em aberto e a soma.
    await page.getByTestId('integracao-aba-lancamentos').click();
    await escolher(page.getByTestId('integracao-lancamentos-ano'), String(ref.getFullYear()));
    await expect(page.getByTestId(`integracao-lancamento-${lancamento}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`integracao-lancamento-${lancamento}`)).toContainText('SINT.DP.FOLHA');
    await page.getByTestId(`integracao-lancamento-detalhe-${lancamento}`).click();
    await expect(page.getByTestId('integracao-lancamento-detalhe')).toBeVisible();
    await expect(page.getByTestId('integracao-lancado-situacao-liquido-mensal')).toBeVisible();
    await expect(page.getByTestId('integracao-lancamento-soma')).toContainText(reais(liquido + inss + fgts));
    await semViolacaoAxe(page, '/pessoas/folha/integracao (detalhe do lançamento)');
    await page.getByTestId('integracao-lancamento-fechar').click();

    // O custo de pessoal da competência por centro de custo, com a conta.
    await page.getByTestId('integracao-aba-custo').click();
    await escolher(page.getByTestId('integracao-custo-periodo'), comp);
    await expect(page.getByTestId('integracao-custo-tabela')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('integracao-custo-conta')).toContainText('=');
    await semViolacaoAxe(page, '/pessoas/folha/integracao (custo de pessoal)');

    // Regra 6: a mesma origem, de novo, sai com a pendência e sem o botão de lançar.
    await page.getByTestId('integracao-aba-lancar').click();
    await escolher(page.getByTestId('integracao-ano'), String(ref.getFullYear()));
    await escolher(page.getByTestId('integracao-origem'), origem);
    await page.getByTestId('integracao-previa').click();
    await expect(page.getByTestId('integracao-pendencias')).toContainText(
      'Esta origem já tem títulos lançados.',
      {
        timeout: 30_000,
      },
    );
    await expect(page.getByTestId('integracao-confirmar')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha/integracao (origem já lançada)');

    expect(externas).toEqual([]);
  });
});
