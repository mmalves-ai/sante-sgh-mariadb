// E2E @M53.1 (ficha do M53, etapa F0: exportação para folha externa; seções 7, 8 e 10 na parte da F0): com a interface
// desligada, a tela da folha fica em consulta (sem gerar) → o administrador registra a conferência do departamento pessoal
// e liga o cadastro de colaboradores, o ponto e a interface com a folha externa → o RH admite a colaboradora sintética e
// importa o arquivo do relógio de uma competência antiga (só ela está na folha daquela competência) → a coordenação fecha
// o ponto → o departamento pessoal registra um afastamento (e cancela outro, que fica na lista como cancelado), gera o lote
// com a confirmação (contagem e soma), baixa o arquivo (o código de conferência é o SHA-256 do conteúdo baixado), importa
// o retorno do simulador da folha externa ("Conferido", com a conta dos títulos) e um com o líquido alterado ("Com
// divergência", com o vínculo e os dois números; os títulos ficam barrados) → quem só consulta vê os lotes sem os botões →
// recolher. Axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev; gestão de pessoas, ponto e
// folha em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO.
import { createHash } from 'node:crypto';
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

async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId('recurso-pessoas.folhaExterna')).toBeVisible({ timeout: 30_000 });
}
async function prerequisito(page: Page, recurso: string, evidencia: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible({ timeout: 30_000 });
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

async function abrirFolha(page: Page, competencia: string): Promise<void> {
  await page.goto('/pessoas/folha');
  await expect(page.getByRole('heading', { level: 1, name: 'Folha de pagamento' })).toBeVisible();
  await expect(page.getByTestId('folha-filtros')).toBeVisible({ timeout: 30_000 });
  await escolher(page.getByTestId('folha-competencia'), {
    rotulo: `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`,
  });
  // A folha da competência abre na aba Cálculo (M53.3, D-ABA-533): a interface fica na aba dela.
  await page.getByTestId('folha-aba-interface').click();
  await expect(page.getByTestId('folha-lotes')).toContainText(
    `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`,
  );
}

async function importarRetorno(page: Page, lote: number, nome: string, conteudo: unknown): Promise<void> {
  await page.getByTestId(`folha-importar-${lote}`).click();
  await expect(page.getByTestId('folha-form-retorno')).toBeVisible();
  await page.getByTestId('folha-arquivo-retorno').setInputFiles({
    name: nome,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(conteudo), 'utf8'),
  });
  await page.getByTestId('folha-enviar-retorno').click();
  await expect(page.getByTestId('folha-importacao')).toBeVisible({ timeout: 30_000 });
}

test.describe('folha de pagamento, etapa F0: interface com a folha externa @M53.1', () => {
  test.setTimeout(420_000);

  test('desligado → ligar → admitir → ponto fechado → afastamento → gerar → baixar → retorno conferido e divergente → consulta → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    // Competência de três meses atrás: as colaboradoras dos outros cenários entram depois, então só esta vai no lote.
    const ref = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);
    const comp = `${ref.getFullYear()}-${p2(ref.getMonth() + 1)}`;
    const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
    const de = `${comp}-01`;
    const ate = `${comp}-${p2(ultimo)}`;
    const admissao = new Date(hoje.getFullYear(), hoje.getMonth() - 4, 1);
    const doc = cpf('900531007');
    const nome = `COLABORADORA FOLHA E2E ${Date.now().toString(36).toUpperCase()}`;

    // Interface desligada: o item do menu abre a tela, que fica em consulta (sem gerar o lote).
    await entrar(page, 'SINT.DP.FOLHA');
    const item = await itemDoMenu(page, 'Folha de pagamento');
    await expect(item).toHaveAttribute('href', '/pessoas/folha');
    await item.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Folha de pagamento' })).toBeVisible();
    await page.getByTestId('folha-aba-interface').click();
    await expect(page.getByTestId('folha-gravacao-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-gerar')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/folha (desligada)');

    // O administrador registra as conferências e liga a interface, o cadastro de colaboradores e o ponto.
    await abrirLiberacao(page);
    await prerequisito(
      page,
      'pessoas.folhaExterna',
      'Conferência sintética do departamento pessoal (E2E M53.1)',
    );
    await chave(page, 'pessoas.folhaExterna', true, 'Interface sintética do E2E M53.1');
    await prerequisito(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M53.1)');
    await chave(page, 'pessoas.colaborador', true, 'Colaboradora sintética do E2E M53.1');
    await prerequisito(page, 'pessoas.ponto', 'Conferência sintética do RH e do setor-piloto (E2E M53.1)');
    await chave(page, 'pessoas.ponto', true, 'Ponto sintético do E2E M53.1');

    // O RH admite a colaboradora e importa o arquivo do relógio da competência (quatro marcações, oito horas).
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
    const arquivoRelogio = afd(
      de,
      ate,
      [
        [1, `${comp}-02T07:00`],
        [2, `${comp}-02T11:00`],
        [3, `${comp}-02T12:00`],
        [4, `${comp}-02T16:00`],
      ],
      doc,
    );
    await page.getByTestId('ponto-arquivo').setInputFiles({
      name: 'afd-folha-e2e.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(arquivoRelogio, 'latin1'),
    });
    await page.getByTestId('ponto-importar').click();
    await expect(page.getByTestId('ponto-resultado-importacao')).toContainText(
      'Arquivo importado: 4 marcação(ões) nova(s)',
    );
    await expect(page.getByTestId('ponto-tabela-painel')).toContainText(nome);
    await page.getByRole('link', { name: `Abrir o espelho de ${nome}` }).click();
    await expect(page.getByTestId('tela-espelho-ponto')).toBeVisible({ timeout: 30_000 });
    const espelho = page.url().replace(/\d{4}-\d{2}(\/?)$/, `${comp}$1`);

    // A coordenação fecha o ponto da competência (o lote leva os minutos do fechamento).
    await entrar(page, 'SINT.PONTO');
    await page.goto(espelho);
    await expect(page.getByTestId('tela-espelho-ponto')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`dia-${comp}-02`)).toBeVisible();
    await page.getByTestId('periodo-fechar').click();
    await expect(page.getByTestId('espelho-aviso')).toContainText('Período fechado');

    // O departamento pessoal registra o afastamento da competência e cancela um registrado por engano.
    await entrar(page, 'SINT.DP.FOLHA');
    await abrirFolha(page, comp);
    await page.getByTestId('folha-aba-afastamentos').click();
    await expect(page.getByTestId('folha-afastamentos')).toContainText('Nenhum afastamento na competência.', {
      timeout: 30_000,
    });
    async function registrar(inicio: Date, fim: Date, motivo: string, obs: string): Promise<void> {
      await page.getByTestId('folha-afastamento-novo').click();
      const form = page.getByTestId('folha-afastamento-form');
      await expect(form).toBeVisible();
      await form.getByLabel('Buscar o colaborador (nome ou matrícula)').fill(nome);
      await page.getByTestId('folha-afastamento-buscar').click();
      await page.getByTestId('folha-afastamento-achados').getByRole('button').first().click();
      await expect(page.getByTestId('folha-afastamento-colaborador')).toBeVisible();
      await escolher(page.getByTestId('folha-afastamento-motivo'), { rotulo: motivo });
      await form.getByLabel('Início', { exact: true }).fill(br(inicio));
      await form.getByLabel('Início', { exact: true }).press('Tab');
      await form.getByLabel('Fim', { exact: true }).fill(br(fim));
      await form.getByLabel('Fim', { exact: true }).press('Tab');
      await form.getByLabel('Observação').fill(obs);
      await page.getByTestId('folha-afastamento-gravar').click();
      await expect(page.getByTestId('folha-afastamento-aviso')).toBeVisible();
    }
    const dia = (d: number) => new Date(ref.getFullYear(), ref.getMonth(), d);
    await registrar(dia(10), dia(12), 'Doença (até 15 dias)', 'Atestado sintético do E2E');
    await registrar(dia(20), dia(21), 'Acidente de trabalho', 'Registrado por engano (E2E)');
    await expect(page.locator('tr[data-testid^="folha-afastamento-"]')).toHaveCount(2);
    const engano = page.locator('tr[data-testid^="folha-afastamento-"]', { hasText: 'Acidente de trabalho' });
    await engano.locator('[data-testid^="folha-afastamento-cancelar-"]').click();
    await page
      .getByTestId('folha-afastamento-motivo-cancelamento')
      .locator('input, textarea')
      .first()
      .fill('Lançado no colaborador errado (E2E)');
    await page.getByTestId('folha-afastamento-confirmar').click();
    await expect(engano).toContainText('Cancelado');
    await expect(
      page.locator('tr[data-testid^="folha-afastamento-"]', { hasText: 'Doença (até 15 dias)' }),
    ).toContainText('Em vigor');
    await semViolacaoAxe(page, '/pessoas/folha (afastamentos)');

    // Gera o lote com a confirmação (o lote leva CPF): contagem e soma conferíveis.
    await page.getByTestId('folha-aba-interface').click();
    await expect(page.getByTestId('folha-lotes')).toContainText('Nenhum lote', { timeout: 30_000 });
    await page.getByTestId('folha-gerar').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await semViolacaoAxe(page, '/pessoas/folha (confirmar a geração)');
    await page.getByTestId('folha-confirmar-gerar').click();
    const gerado = page.getByTestId('folha-gerado');
    await expect(gerado).toBeVisible({ timeout: 30_000 });
    const texto = (await gerado.textContent()) ?? '';
    const lote = Number(/Lote (\d+) gerado/.exec(texto)?.[1]);
    expect(lote).toBeGreaterThan(0);
    await expect(page.getByTestId(`folha-lote-situacao-${lote}`)).toContainText('Gerado, aguardando retorno');
    await expect(page.getByTestId(`folha-lote-colaboradores-${lote}`)).toHaveText('1');
    await semViolacaoAxe(page, '/pessoas/folha (lote gerado)');

    // Baixa o arquivo: o código de conferência mostrado é o SHA-256 do conteúdo baixado.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId(`folha-baixar-${lote}`).click(),
    ]);
    const caminho = await download.path();
    const bruto = await readFile(caminho, 'utf8');
    const sha = createHash('sha256').update(bruto, 'utf8').digest('hex');
    await expect(page.getByTestId('folha-aviso')).toContainText(`Código de conferência: ${sha}`);
    const exportado = JSON.parse(bruto) as {
      colaboradores: { vinculo: number; cpf: string; afastamentos?: unknown[] }[];
    };
    expect(exportado.colaboradores).toHaveLength(1);
    const colab = exportado.colaboradores[0]!;
    expect(colab.cpf).toBe(doc);
    expect(bruto).toContain(`${comp}-10`);
    expect(bruto).not.toContain(`${comp}-20`);

    // Retorno do simulador da folha externa: conferido, com a conta dos títulos (parcelas impressas).
    await importarRetorno(page, lote, 'retorno-folha.json', simularFolhaExterna(exportado));
    await expect(page.getByTestId('folha-importacao')).toContainText('Conferido');
    await expect(page.getByTestId('folha-conferencia-resultado')).toContainText(
      'Contagem e soma conferem nos dois sentidos',
    );
    await expect(page.getByTestId('folha-conta-titulos')).toContainText('R$');
    await expect(page.getByTestId(`folha-lote-situacao-${lote}`)).toContainText('Conferido');
    await semViolacaoAxe(page, '/pessoas/folha (retorno conferido)');

    // Retorno com o líquido da colaboradora alterado: com divergência, o vínculo e os dois números; títulos barrados.
    await importarRetorno(
      page,
      lote,
      'retorno-folha-divergente.json',
      simularFolhaExterna(exportado, { alterarLiquido: { vinculo: colab.vinculo, centavos: 1_000 } }),
    );
    await expect(page.getByTestId('folha-importacao')).toContainText('Com divergência');
    await expect(page.getByTestId('folha-conferencia-resultado')).toContainText(
      'os títulos não serão lançados',
    );
    const div = page.getByTestId('folha-divergencias');
    await expect(div).toBeVisible();
    await expect(div.locator('[data-testid^="folha-divergencia-"]').first()).toContainText(
      String(colab.vinculo),
    );
    await expect(page.getByTestId(`folha-lote-situacao-${lote}`)).toContainText('Com divergência');
    await semViolacaoAxe(page, '/pessoas/folha (retorno com divergência)');

    // Quem só consulta a folha vê os lotes e as conferências, sem os botões de gravar.
    await entrar(page, 'SINT.FOLHA.CONSULTA');
    await abrirFolha(page, comp);
    await expect(page.getByTestId('folha-so-consulta')).toBeVisible();
    await expect(page.getByTestId(`folha-lote-${lote}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('folha-gerar')).toHaveCount(0);
    await expect(page.locator('[data-testid^="folha-baixar-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="folha-importar-"]')).toHaveCount(0);
    await page.locator('[data-testid^="folha-conferencia-"]').first().click();
    await semViolacaoAxe(page, '/pessoas/folha (consulta)');

    // Recolher: desligar a interface, o ponto e o cadastro de colaboradores (os dados ficam).
    await abrirLiberacao(page);
    await chave(page, 'pessoas.folhaExterna', false, 'Recolher o E2E M53.1');
    await expect(page.getByTestId('recurso-pessoas.folhaExterna')).toContainText('Desligada');
    // Desligada a interface, o arquivo com o CPF dos lotes já gerados também deixa de sair, mesmo pedido direto à API.
    await entrar(page, 'SINT.DP.FOLHA');
    const recolhido = await page.request.get(`/api/pessoas/folha/lotes/${lote}/arquivo`);
    expect(recolhido.status()).toBe(403);
    const corpoRecolhido = await recolhido.text();
    expect(corpoRecolhido).toContain('recurso-desligado');
    expect(corpoRecolhido).not.toContain(doc);
    await abrirLiberacao(page);
    await chave(page, 'pessoas.ponto', false, 'Recolher o E2E M53.1');
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E M53.1');
    expect(externas).toEqual([]);
  });
});
