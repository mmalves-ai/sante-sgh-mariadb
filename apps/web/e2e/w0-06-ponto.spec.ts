// E2E @W0-06 (programa CRUD completo; parte 3c: ponto): liga o ponto, a escala e o cadastro → o RH admite um colaborador
// sintético novo e importa o arquivo do relógio do mês anterior → no espelho, o RH lança o ajuste (desconsiderar a
// marcação) → a coordenação abre o mesmo espelho e NÃO vê "Desistir" (só quem pediu desiste) → o RH DESISTE com motivo
// (o pedido fica no histórico como "Desistência do solicitante", sem efeito) → a gestora cria um regime, grava a regra
// do banco de horas e a DESATIVA com motivo (a regra fica na lista, "Desativada: <motivo>") e a reativa → recolher.
// Axe sem violação séria nas telas e nos diálogos. O AFD e as marcações não têm botão de alteração em nenhuma tela.
// Sessão real sobre a fonte sintética de dev; gestão de pessoas e ponto em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO.
import { expect, test, type Page } from '@playwright/test';
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

// Arquivo do relógio (leiaute "003" da Portaria 671/2021) com o CRC-16/KERMIT de cada linha; relógio próprio deste E2E.
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
    `0000000001100000000000191${pad('', 14)}${pad('HOSPITAL SINTETICO E2E', 150)}${pad('00004000000006006', 17)}${de}${ate}${ate}T23:00:00-03000031${pad('00000000000191', 14)}${pad('RELOGIO SINTETICO W006', 30)}`,
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

/** O diálogo do motivo: confirmar fica desabilitado com menos de 10 caracteres; a variante destrutiva pergunta. */
async function confirmarComMotivo(
  page: Page,
  testid: string,
  motivo: string,
  destrutivo = true,
): Promise<void> {
  const d = page.getByTestId(testid);
  await expect(d).toBeVisible();
  await d.getByLabel('Motivo').fill('curto');
  await expect(page.getByTestId(`${testid}-confirmar`)).toBeDisabled();
  await d.getByLabel('Motivo').fill(motivo);
  await semViolacaoAxe(page, `diálogo ${testid}`);
  await page.getByTestId(`${testid}-confirmar`).click();
  if (destrutivo) await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
}

test.describe('W0-06 (parte 3c): desistência do ajuste pelo solicitante e desativação da regra do banco @W0-06', () => {
  test.setTimeout(360_000);

  test('ligar → admitir → importar → ajuste → outro não desiste → solicitante desiste → regra desativada e reativada → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    const ant = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const comp = `${ant.getFullYear()}-${p2(ant.getMonth() + 1)}`;
    const ultimo = new Date(ant.getFullYear(), ant.getMonth() + 1, 0).getDate();
    const admissao = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
    const sufixo = Date.now().toString(36).slice(-5);
    const nome = `TECNICO PONTO SINTETICO W006 ${sufixo.toUpperCase()}`;
    const doc = cpf(`9006064${String(Date.now() % 100).padStart(2, '0')}`);

    await abrirLiberacao(page);
    await prerequisito(page, 'pessoas.ponto', 'Conferência sintética do RH e do setor-piloto (E2E W0-06)');
    await chave(page, 'pessoas.ponto', true, 'Ponto sintético do E2E W0-06');
    await prerequisito(page, 'pessoas.escala', 'Conferência sintética da coordenação (E2E W0-06)');
    await chave(page, 'pessoas.escala', true, 'Escala sintética do E2E W0-06');
    await prerequisito(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E W0-06)');
    await chave(page, 'pessoas.colaborador', true, 'Colaborador sintético do E2E W0-06');

    // O RH admite um colaborador novo (sem profissional, sem login) e importa o arquivo do relógio do mês anterior.
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill(doc);
    await page.getByTestId('consultar-cpf').click();
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Nome completo').fill(nome);
    await page.getByLabel('Data de admissão').fill(br(admissao));
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Técnico de enfermagem');
    await page.getByLabel('Carga semanal (horas)').fill('36');
    await escolher(page.getByTestId('admissao-centro-custo'), { indice: 0 });
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();

    await page.goto('/pessoas/ponto');
    await expect(page.getByTestId('form-importar-afd')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('ponto-arquivo').setInputFiles({
      name: `afd-w006-${sufixo}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(
        afd(`${comp}-01`, `${comp}-${p2(ultimo)}`, [[1, `${comp}-03T08:00`]], doc),
        'latin1',
      ),
    });
    await page.getByTestId('ponto-importar').click();
    await expect(page.getByTestId('ponto-resultado-importacao')).toContainText('Arquivo importado');
    await expect(page.getByTestId('ponto-tabela-painel')).toContainText(nome);
    await page.getByRole('link', { name: `Abrir o espelho de ${nome}` }).click();
    await expect(page.getByTestId('tela-espelho-ponto')).toBeVisible({ timeout: 30_000 });
    const url = page.url();

    // O RH lança o ajuste (desconsiderar a marcação ímpar do dia 3): fica aguardando a aprovação de outra pessoa.
    const fa = page.getByTestId('form-ajuste');
    await escolher(fa.getByTestId('ajuste-tipo'), { rotulo: 'Desconsiderar marcação' });
    await fa.getByLabel('Dia da jornada').fill(br(new Date(ant.getFullYear(), ant.getMonth(), 3)));
    await fa.getByLabel('Dia da jornada').press('Tab');
    await escolher(fa.getByTestId('ajuste-marcacao'), { indice: 0 });
    await fa
      .getByLabel('Motivo', { exact: true })
      .fill('Batida por engano ao passar pelo relógio (E2E W0-06)');
    await page.getByTestId('ajuste-gravar').click();
    await expect(page.getByTestId('espelho-ajustes')).toContainText('Aguardando aprovação');
    await expect(page.locator('[data-testid^="desistir-"]')).toHaveCount(1);

    // A coordenação vê o pedido e pode decidir, mas não desiste por quem pediu (o servidor também recusa com 403).
    await entrar(page, 'SINT.PONTO');
    await page.goto(url);
    await expect(page.getByTestId('espelho-ajustes')).toContainText('Aguardando aprovação');
    await expect(page.locator('[data-testid^="aprovar-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="desistir-"]')).toHaveCount(0);

    // O próprio solicitante desiste com motivo: o pedido fica no histórico, sem efeito, e sai da fila de aprovação.
    await entrar(page, 'SINT.RH');
    await page.goto(url);
    await expect(page.getByTestId('tela-espelho-ponto')).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid^="desistir-"]').click();
    await confirmarComMotivo(
      page,
      'dialogo-desistir-ajuste',
      'A marcação estava certa, conferi a escala (E2E)',
    );
    await expect(page.getByTestId('espelho-ajustes')).toContainText('Desistência do solicitante');
    await expect(page.getByTestId('espelho-ajustes')).toContainText(
      'Batida por engano ao passar pelo relógio',
    );
    await expect(page.locator('[data-testid^="desistir-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="aprovar-"]')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/ponto/:vinculo/:competencia (ajuste desistido)');

    // A regra do banco de horas de um regime novo: gravada, desativada com motivo e reativada.
    await entrar(page, 'SINT.ESCALA');
    await page.goto('/pessoas/regimes');
    const fr = page.getByTestId('form-regime');
    await expect(fr).toBeVisible({ timeout: 30_000 });
    const nomeRegime = `Regime banco W0-06 ${sufixo}`;
    await fr.getByLabel('Sigla (ex.: 12x36)').fill(`WB-${sufixo.slice(-4)}`);
    await fr.getByLabel('Nome', { exact: true }).fill(nomeRegime);
    await escolher(fr.getByTestId('regime-jornada'), { rotulo: 'Escalonada' });
    await fr.getByLabel('Descanso mínimo entre jornadas (horas)').fill('11');
    await fr.getByLabel('Limite semanal de horas (fora do tempo parcial)').fill('44');
    await page.getByTestId('gravar-regime').click();
    await expect(page.getByTestId('regimes-resultado')).toContainText('Regime incluído.');
    const bloco = page.getByTestId('bloco-regra-banco');
    await escolher(bloco.getByTestId('regra-regime'), { rotulo: new RegExp(nomeRegime) });
    await bloco.getByLabel('Primeiro ciclo a partir de (AAAA-MM)').fill(comp);
    await bloco.getByLabel('Duração do ciclo (meses)').fill('6');
    await page.getByTestId('regra-gravar').click();
    await expect(page.getByTestId('regra-aviso')).toBeVisible();
    const linha = page.getByTestId('tabela-regras-banco').getByRole('row', { name: new RegExp(nomeRegime) });
    await expect(linha).toBeVisible();
    await linha.locator('[data-testid^="situacao-regra-"]').click();
    await confirmarComMotivo(
      page,
      'dialogo-situacao-regra',
      'Regime passou a pagar as horas extras na folha (E2E)',
    );
    await expect(page.getByTestId('regra-aviso')).toContainText('desativada');
    await expect(linha.locator('[data-testid^="regra-inativa-"]')).toContainText(
      'Desativada: Regime passou a pagar as horas extras na folha (E2E)',
    );
    await semViolacaoAxe(page, '/pessoas/regimes (regra do banco desativada)');
    await linha.locator('[data-testid^="situacao-regra-"]').click();
    await confirmarComMotivo(
      page,
      'dialogo-situacao-regra',
      'Acordo de banco de horas renovado (E2E)',
      false,
    );
    await expect(page.getByTestId('regra-aviso')).toContainText('reativada');
    await expect(linha.locator('[data-testid^="regra-inativa-"]')).toHaveCount(0);

    // Recolher.
    await abrirLiberacao(page);
    await chave(page, 'pessoas.ponto', false, 'Recolher o E2E W0-06');
    await chave(page, 'pessoas.escala', false, 'Recolher o E2E W0-06');
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E W0-06');
    expect(externas).toEqual([]);
  });
});
