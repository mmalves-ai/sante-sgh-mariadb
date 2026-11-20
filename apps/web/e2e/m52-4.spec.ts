// E2E @M52.4 (ficha do M52, fatia F4; seções 7, 8 e 10 na parte da F4): com o ponto desligado, a tela fica em consulta →
// o administrador registra as conferências e liga o cadastro de colaboradores e o ponto → o RH admite a colaboradora
// sintética do ponto (com login próprio) → importa o arquivo do relógio do mês anterior (válido) e um com a sequência
// quebrada (quarentena inteira, com a falha e a linha: regra 12) → o espelho mostra a marcação ímpar → o RH lança o ajuste
// para desconsiderar a marcação errada (a original continua, riscada: regra 11) e não aprova → a coordenação aprova, fecha
// o período e baixa o arquivo de jornada → a colaboradora vê o próprio espelho e registra a ciência com a discordância →
// a regra do banco aparece nos regimes → recolher. Axe sem violação séria em cada tela. Sessão real sobre a fonte
// sintética de dev; gestão de pessoas, escala e ponto em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
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

async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId('recurso-pessoas.ponto')).toBeVisible({ timeout: 30_000 });
}
async function prerequisito(page: Page, recurso: string, evidencia: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
}
async function chave(page: Page, recurso: string, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}

test.describe('gestão de pessoas, fatia F4: ponto @M52.4', () => {
  test.setTimeout(360_000);

  test('desligado → ligar → admitir → importar → quarentena → ajuste → aprovar → fechar → AEJ → ciência → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    const ant = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const comp = `${ant.getFullYear()}-${p2(ant.getMonth() + 1)}`;
    const ultimo = new Date(ant.getFullYear(), ant.getMonth() + 1, 0).getDate();
    const de = `${comp}-01`;
    const ate = `${comp}-${p2(ultimo)}`;
    const admissao = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
    const doc = cpf('900520006');
    const nome = `COLABORADORA PONTO E2E ${Date.now().toString(36).toUpperCase()}`;

    // Ponto desligado: a tela fica em consulta, sem a importação.
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/ponto');
    await expect(page.getByRole('heading', { level: 1, name: 'Ponto eletrônico' })).toBeVisible();
    await expect(page.getByTestId('ponto-gravacao-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ponto-biometria')).toContainText('biometria no ponto fica desligada');
    await expect(page.getByTestId('form-importar-afd')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/ponto (desligado)');

    // O administrador registra as conferências e liga o ponto e o cadastro de colaboradores.
    await abrirLiberacao(page);
    await prerequisito(page, 'pessoas.ponto', 'Conferência sintética do RH e do setor-piloto (E2E M52.4)');
    await chave(page, 'pessoas.ponto', true, 'Ponto sintético do E2E M52.4');
    await prerequisito(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M52.4)');
    await chave(page, 'pessoas.colaborador', true, 'Colaboradora sintética do E2E M52.4');

    // O RH admite a colaboradora do ponto (o usuário dela é reusado pela prévia do CPF).
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill(doc);
    await page.getByTestId('consultar-cpf').click();
    await expect(page.getByTestId('previa-usuario')).toContainText('SINT.COLAB.PONTO');
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(nome);
    await page.getByLabel('Data de admissão').fill(br(admissao));
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Auxiliar administrativa');
    await page.getByLabel('Carga semanal (horas)').fill('44');
    await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Recursos humanos/ });
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();

    // Importação: o arquivo válido do mês anterior e um com a sequência quebrada (quarentena inteira).
    await page.goto('/pessoas/ponto');
    await expect(page.getByTestId('form-importar-afd')).toBeVisible({ timeout: 30_000 });
    const valido = afd(
      de,
      ate,
      [
        [1, `${comp}-02T07:00`],
        [2, `${comp}-02T11:00`],
        [3, `${comp}-03T08:00`],
      ],
      doc,
    );
    await page.getByTestId('ponto-arquivo').setInputFiles({
      name: 'afd-mes-anterior.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(valido, 'latin1'),
    });
    await page.getByTestId('ponto-importar').click();
    await expect(page.getByTestId('ponto-resultado-importacao')).toContainText(
      'Arquivo importado: 3 marcação(ões) nova(s)',
    );
    await semViolacaoAxe(page, '/pessoas/ponto (importado)');
    const quebrado = afd(
      de,
      ate,
      [
        [10, `${comp}-04T07:00`],
        [12, `${comp}-04T11:00`],
      ],
      doc,
    );
    await page.getByTestId('ponto-arquivo').setInputFiles({
      name: 'afd-quebrado.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(quebrado, 'latin1'),
    });
    await page.getByTestId('ponto-importar').click();
    await expect(page.getByTestId('ponto-resultado-importacao')).toContainText('Arquivo em quarentena');
    await expect(page.getByTestId('ponto-falhas')).toContainText(
      'Sequência dos números dos registros (NSR) quebrada',
    );
    await expect(page.getByTestId('ponto-falhas')).toContainText('Linha 3');
    await expect(page.getByTestId('ponto-arquivos')).toContainText('Em quarentena');
    // Depois de recarregar, a lista abre o detalhe do arquivo em quarentena com as falhas pelo código e pela linha.
    await page.reload();
    await page.getByRole('button', { name: 'Ver o detalhe do arquivo afd-quebrado.txt' }).click();
    await expect(page.getByTestId('arquivo-detalhe-falhas')).toContainText(
      'Sequência dos números dos registros (NSR) quebrada',
    );
    await expect(page.getByTestId('arquivo-detalhe-falhas')).toContainText('Linha 3');
    await semViolacaoAxe(page, '/pessoas/ponto (detalhe do arquivo em quarentena)');

    // O espelho do mês anterior: a marcação ímpar do dia 3.
    await expect(page.getByTestId('ponto-tabela-painel')).toContainText(nome);
    await page.getByRole('link', { name: `Abrir o espelho de ${nome}` }).click();
    await expect(page.getByTestId('tela-espelho-ponto')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('espelho-inconsistentes')).toBeVisible();
    await expect(page.getByTestId(`dia-${comp}-03`)).toContainText('Número ímpar de marcações');
    await semViolacaoAxe(page, '/pessoas/ponto/:vinculo/:competencia (espelho)');
    const url = page.url();

    // O RH lança o ajuste para desconsiderar a marcação errada; ele não aprova o próprio pedido.
    const fa = page.getByTestId('form-ajuste');
    await escolher(fa.getByTestId('ajuste-tipo'), { rotulo: 'Desconsiderar marcação' });
    await fa.getByLabel('Dia da jornada').fill(br(new Date(ant.getFullYear(), ant.getMonth(), 3)));
    await fa.getByLabel('Dia da jornada').press('Tab');
    await escolher(fa.getByTestId('ajuste-marcacao'), { indice: 0 });
    await fa.getByLabel('Motivo', { exact: true }).fill('Batida por engano ao passar pelo relógio (E2E)');
    await page.getByTestId('ajuste-gravar').click();
    await expect(page.getByTestId('espelho-aviso')).toContainText('aguarda a aprovação de outra pessoa');
    await expect(page.getByTestId('espelho-ajustes')).toContainText('Aguardando aprovação');
    await expect(page.locator('[data-testid^="aprovar-"]')).toHaveCount(0);

    // A coordenação aprova, fecha o período e baixa o arquivo de jornada.
    await entrar(page, 'SINT.PONTO');
    await page.goto(url);
    await expect(page.getByTestId('tela-espelho-ponto')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid^="aprovar-"]').first().click();
    await expect(page.getByTestId('espelho-aviso')).toContainText('Ajuste aprovado.');
    await expect(page.getByTestId('espelho-inconsistentes')).toHaveCount(0);
    await expect(page.getByTestId(`dia-${comp}-03`)).toContainText('desconsiderada');
    await page.getByTestId('periodo-fechar').click();
    await expect(page.getByTestId('espelho-aviso')).toContainText('Período fechado');
    await expect(page.getByTestId('espelho-estado')).toContainText('Fechado (versão 1)');
    await expect(page.getByTestId('trilha-fechado')).toContainText('SINT.PONTO');
    await semViolacaoAxe(page, 'espelho fechado');
    const aej = await page.request.get(`/api/pessoas/ponto/aej?competencia=${comp}`);
    expect(aej.status()).toBe(200);
    const linhas = (await aej.text()).trim().split('\r\n');
    expect(linhas[0]).toMatch(/^01\|1\|00000000000191\|/);
    expect(linhas.filter((l) => l.startsWith('05|')).length).toBeGreaterThanOrEqual(3);
    expect(linhas[linhas.length - 1]).toMatch(/^99\|/);
    await page.goto('/pessoas/ponto');
    await expect(page.getByTestId('ponto-aej')).toBeVisible({ timeout: 30_000 });

    // A colaboradora vê o próprio espelho e registra a ciência com a discordância.
    // Ela chega ao próprio espelho pelo menu do usuário (não tem o item do ponto no menu principal).
    await entrar(page, 'SINT.COLAB.PONTO');
    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('meu-espelho-ponto').click();
    await expect(page.getByTestId('tela-meu-espelho')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('espelho-estado')).toContainText('Fechado');
    await page.getByLabel('Não concordo').check();
    await page
      .getByTestId('ciencia-observacao')
      .locator('input, textarea')
      .first()
      .fill('A marcação do dia 3 foi do crachá emprestado (E2E)');
    await semViolacaoAxe(page, '/pessoas/ponto/meu');
    await page.getByTestId('ciencia-registrar').click();
    await expect(page.getByTestId('meu-aviso')).toContainText('Ciência registrada com a sua discordância');
    await expect(page.getByTestId('meu-ciencia-dada')).toContainText('não concorda');

    // A regra do banco de horas nos regimes.
    await entrar(page, 'SINT.ESCALA');
    await page.goto('/pessoas/regimes');
    await expect(page.getByTestId('bloco-regra-banco')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/regimes (banco de horas)');

    // Recolher: desligar o ponto e o cadastro de colaboradores (a tela volta à consulta; os dados ficam).
    await abrirLiberacao(page);
    await chave(page, 'pessoas.ponto', false, 'Recolher o E2E M52.4');
    await expect(page.getByTestId('recurso-pessoas.ponto')).toContainText('Desligada');
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E M52.4');
    expect(externas).toEqual([]);
  });
});
