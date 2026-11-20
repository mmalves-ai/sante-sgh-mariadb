// E2E @W0-06 (programa CRUD completo; parte 6e: autoatendimento, aceite 9): o administrador liga o cadastro de
// colaboradores, o Meu espaço, o ponto e a folha → a colaboradora com login (admitida aqui há 18 meses, se ainda não
// tiver vínculo) pede, em "Minhas solicitações", férias, abono, ajuste de ponto, correção do nome e envia o atestado com
// o CID, cada um com motivo → desiste do ajuste com motivo (só ela vê "Desistir") → a coordenação do ponto, na fila, aprova o
// abono escolhendo o movimento (efeito: justificativa aprovada no ponto), aprova as férias (efeito: férias programadas;
// recusa com motivo se o vínculo já existia de outro cenário, sem período com saldo), recusa a correção do nome com
// motivo e lê o atestado sem o CID (pedir o CID é 403: restrito à medicina do trabalho) → a colaboradora vê as decisões,
// o motivo da recusa e lê o próprio CID → recolher. Axe sem violação séria nas telas e nos diálogos.
// Sessão real sobre a fonte sintética de dev; pessoas, ponto e folha em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO
// (o da colaboradora com login, 900520006; o prefixo 9006066 fica reservado a este arquivo).
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
const mais = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const campo = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();
async function preencher(page: Page, id: string, valor: string): Promise<void> {
  const c = campo(page, id);
  await c.fill(valor);
  await c.press('Tab');
}
const data = (page: Page, id: string, d: Date) => preencher(page, id, br(d));

async function chave(page: Page, recurso: string, ligar: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligar ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}
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

/** O diálogo do motivo: confirmar fica desabilitado com menos de 10 caracteres; a variante destrutiva pergunta. */
async function confirmarComMotivo(
  page: Page,
  testid: string,
  motivo: string,
  destrutivo = true,
): Promise<void> {
  const d = page.getByTestId(testid);
  await expect(d).toBeVisible();
  await d.getByLabel('Motivo', { exact: true }).fill('curto');
  await expect(page.getByTestId(`${testid}-confirmar`)).toBeDisabled();
  await d.getByLabel('Motivo', { exact: true }).fill(motivo);
  await semViolacaoAxe(page, `diálogo ${testid}`);
  await page.getByTestId(`${testid}-confirmar`).click();
  if (destrutivo) await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
  await expect(d).toBeHidden({ timeout: 30_000 });
}

interface Minha {
  id: number;
  tipo: string;
  situacao: string;
  ferias: number | null;
  ajustes: { id: number; dia: string; situacao: string }[];
}
async function minhas(page: Page): Promise<Minha[]> {
  const r = await page.request.get('/api/pessoas/meu/solicitacoes');
  expect(r.status()).toBe(200);
  return ((await r.json()) as { itens: Minha[] }).itens;
}

/** POST da página com o CSRF da sessão e a Idempotency-Key, como a tela faz (para o que a tela não oferece). */
let sequencia = 0;
async function postar(page: Page, url: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
  return page.request.post(url, {
    data,
    headers: { 'x-csrf': csrf, 'idempotency-key': `e2e-w006-solic-${Date.now()}-${++sequencia}` },
  });
}

/** Abre "Nova solicitação", escolhe o tipo, preenche e envia com o motivo; devolve o ID da solicitação nova. */
async function pedir(
  page: Page,
  tipo: string,
  preencherCampos: () => Promise<void>,
  motivo: string,
): Promise<number> {
  const antes = new Set((await minhas(page)).map((s) => s.id));
  await page.getByTestId('solicitacao-nova').click();
  const d = page.getByTestId('solicitacao-incluir');
  await expect(d).toBeVisible();
  await escolher(page.getByTestId('solicitacao-tipo'), { rotulo: tipo });
  await preencherCampos();
  await expect(page.getByTestId('solicitacao-pendencia')).toHaveCount(0);
  await confirmarComMotivo(page, 'solicitacao-incluir', motivo, false);
  await expect(page.getByTestId('solicitacao-aviso')).toBeVisible();
  const nova = (await minhas(page)).find((s) => !antes.has(s.id));
  expect(nova, `a solicitação de ${tipo} foi gravada`).toBeTruthy();
  await expect(page.getByTestId(`solicitacao-${nova!.id}-situacao`)).toHaveText('Aguardando o gestor');
  return nova!.id;
}

test.describe('W0-06 (parte 6e): solicitações do autoatendimento, decisão do gestor e atestado restrito @W0-06', () => {
  test.setTimeout(480_000);

  test('ligar → pedir os 5 tipos → desistir → gestor aprova (ponto e férias), recusa e lê o atestado sem CID → colaboradora vê → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    // Admitida há 18 meses: o 1º período aquisitivo está completo e dentro do prazo de concessão.
    const admissao = new Date(hoje.getFullYear(), hoje.getMonth() - 18, 1);
    // Férias na primeira segunda-feira depois de 35 dias (fora do aviso curto de 30 dias).
    const segunda = mais(hoje, 35);
    while (segunda.getDay() !== 1) segunda.setDate(segunda.getDate() + 1);
    const sufixo = Date.now().toString(36).slice(-5).toUpperCase();

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E W0-06)');
    await ligar(page, 'pessoas.autoatendimento', 'Conferência sintética do RH e do DPO (E2E W0-06)');
    await ligar(page, 'pessoas.ponto', 'Conferência sintética do RH e do setor-piloto (E2E W0-06)');
    await ligar(page, 'pessoas.folha', 'Conferência sintética do departamento pessoal (E2E W0-06)');

    // A colaboradora com login: admitida aqui se ainda não tiver vínculo (outro cenário da mesma rodada pode já tê-la
    // admitido; aí as férias pedidas são recusadas pelo gestor, e o resto do roteiro vale igual).
    await entrar(page, 'SINT.COLAB.PONTO');
    await page.goto('/pessoas/meu');
    await expect(page.getByTestId('tela-meu-espaco')).toBeVisible();
    await expect(page.getByTestId('meu-vinculo').or(page.getByTestId('meu-sem-vinculo'))).toBeVisible({
      timeout: 30_000,
    });
    const admitirAqui = await page.getByTestId('meu-sem-vinculo').isVisible();
    if (admitirAqui) {
      await entrar(page, 'SINT.RH');
      await page.goto('/pessoas/colaboradores/admitir');
      await expect(page.getByTestId('tela-admissao')).toBeVisible();
      await page.getByLabel('CPF', { exact: true }).fill(cpf('900520006'));
      await page.getByTestId('consultar-cpf').click();
      await expect(page.getByTestId('previa-usuario')).toContainText('SINT.COLAB.PONTO');
      await page.getByTestId('admissao-continuar').click();
      await page.getByLabel('Nome completo').fill(`COLABORADORA SOLICITACOES W006 ${sufixo}`);
      await page.getByLabel('Data de admissão').fill(br(admissao));
      await page.getByLabel('Data de admissão').press('Tab');
      await page.getByLabel('Cargo', { exact: true }).fill('Técnico de enfermagem');
      await page.getByLabel('Carga semanal (horas)').fill('36');
      await escolher(page.getByTestId('admissao-centro-custo'), { indice: 0 });
      await page.getByTestId('admissao-revisar').click();
      await page.getByTestId('admissao-gravar').click();
      await expect(page.getByTestId('admissao-concluida')).toBeVisible();
      await entrar(page, 'SINT.COLAB.PONTO');
      await page.goto('/pessoas/meu');
    }
    await expect(page.getByTestId('minhas-solicitacoes')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/meu (Minhas solicitações)');

    // Os cinco pedidos, cada um com motivo (o abono e o atestado no futuro próximo: valem mesmo com admissão de hoje).
    const ferias = await pedir(
      page,
      'Férias',
      async () => {
        await data(page, 'solicitacao-inicio', segunda);
        await preencher(page, 'solicitacao-dias-gozo', '20');
        await preencher(page, 'solicitacao-dias-abono', '0');
      },
      'Férias combinadas com a coordenação (E2E W0-06)',
    );
    const abono = await pedir(
      page,
      'Abono de falta ou atraso',
      async () => {
        await data(page, 'solicitacao-inicio', mais(hoje, 7));
        await data(page, 'solicitacao-fim', mais(hoje, 8));
      },
      'Folga combinada pela troca de plantão (E2E W0-06)',
    );
    const ajuste = await pedir(
      page,
      'Ajuste de ponto',
      async () => {
        await data(page, 'solicitacao-dia', hoje);
        await escolher(page.getByTestId('solicitacao-ajuste'), { rotulo: 'Inclusão de marcação que faltou' });
        await preencher(page, 'solicitacao-hora', '00:05');
      },
      'O relógio não registrou a entrada (E2E W0-06)',
    );
    const nome = await pedir(
      page,
      'Alteração cadastral',
      async () => {
        await preencher(page, 'solicitacao-valor-novo', `COLABORADORA RENOMEADA W006 ${sufixo}`);
      },
      'Nome mudou no casamento, certidão nova (E2E W0-06)',
    );
    const atestado = await pedir(
      page,
      'Atestado',
      async () => {
        await data(page, 'solicitacao-inicio', hoje);
        await data(page, 'solicitacao-fim', mais(hoje, 1));
        await data(page, 'solicitacao-emitido', hoje);
        await preencher(page, 'solicitacao-dias-atestado', '2');
        await preencher(page, 'solicitacao-emitente', 'MEDICA SINTETICA E2E');
        await preencher(page, 'solicitacao-conselho', 'CRM-RS 0000');
        await preencher(page, 'solicitacao-cid', 'J11');
      },
      'Atestado da consulta de hoje (E2E W0-06)',
    );

    // A colaboradora desiste do ajuste com motivo: fica no histórico como desistência, sem efeito no ponto.
    await page.getByTestId(`solicitacao-${ajuste}-desistir`).click();
    await confirmarComMotivo(
      page,
      'solicitacao-desistir',
      'Achei a marcação no relógio do outro setor (E2E)',
    );
    await expect(page.getByTestId(`solicitacao-${ajuste}-situacao`)).toHaveText('Desistência');
    await expect(page.getByTestId(`solicitacao-${ajuste}-desistir`)).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/meu (ajuste desistido)');

    // A coordenação do ponto (aprova as solicitações e lê os tipos de movimento do ponto): a fila mostra os pendentes (o ajuste desistido não); ela não desiste por ninguém.
    await entrar(page, 'SINT.PONTO');
    await page.goto('/pessoas/solicitacoes');
    await expect(page.getByTestId('tela-fila-solicitacoes')).toBeVisible();
    await expect(page.getByTestId(`fila-${abono}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`fila-${ajuste}`)).toHaveCount(0);
    const alheia = await postar(page, `/api/pessoas/meu/solicitacoes/${abono}/desistencia`, {
      versao: 1,
      motivo: 'Tentativa de desistir por outra pessoa (E2E)',
    });
    expect(JSON.stringify(await alheia.json())).toContain('solicitacao-desistencia-so-do-solicitante');
    await semViolacaoAxe(page, '/pessoas/solicitacoes (pendentes)');

    // Aprovar o abono: a gestora escolhe o tipo de movimento no ponto.
    await page.getByTestId(`fila-${abono}-aprovar`).click();
    await escolher(page.getByTestId('fila-decisao-movimento'), { indice: 0 });
    await confirmarComMotivo(page, 'fila-decisao', 'Folga acertada com a coordenação do setor', false);
    await expect(page.getByTestId('fila-resultado')).toBeVisible();
    await expect(page.getByTestId(`fila-${abono}`)).toHaveCount(0);

    // Férias: aprovadas (programadas na hora) ou, sem período com saldo, recusadas com motivo.
    await page.getByTestId(`fila-${ferias}-${admitirAqui ? 'aprovar' : 'recusar'}`).click();
    await confirmarComMotivo(
      page,
      'fila-decisao',
      admitirAqui ? 'Período combinado na escala do setor' : 'Sem período aquisitivo com saldo nesta data',
      !admitirAqui,
    );
    await expect(page.getByTestId(`fila-${ferias}`)).toHaveCount(0);

    // A correção do nome é recusada com motivo (a colaboradora vê o motivo).
    await page.getByTestId(`fila-${nome}-recusar`).click();
    await confirmarComMotivo(page, 'fila-decisao', 'Traga a certidão de casamento ao RH para conferir');
    await expect(page.getByTestId(`fila-${nome}`)).toHaveCount(0);

    // O atestado: pedir o CID é 403 (restrito à medicina do trabalho); sem o CID, a leitura vale e fica na trilha.
    await page.getByTestId(`fila-${atestado}-atestado`).click();
    const dlg = page.getByTestId('fila-atestado-dialogo');
    await expect(dlg).toBeVisible();
    await preencher(page, 'atestado-finalidade', 'Conferir a ausência na escala do setor');
    await page.getByTestId('atestado-ver-cid').click();
    await page.getByTestId('atestado-ler').click();
    await expect(dlg.getByTestId('recusa-pessoas')).toContainText('restrito a quem lê o exame ocupacional');
    await page.getByTestId('atestado-ver-cid').click();
    await page.getByTestId('atestado-ler').click();
    await expect(dlg.getByTestId('atestado-conteudo')).toContainText('MEDICA SINTETICA E2E');
    await expect(dlg.getByTestId('atestado-cid')).toHaveText(
      'CID informado (restrito à medicina do trabalho).',
    );
    await expect(dlg).not.toContainText('J11');
    await expect(dlg.getByTestId('atestado-acessos')).toHaveCount(0);
    await semViolacaoAxe(page, 'diálogo do atestado (sem o CID)');
    await page.keyboard.press('Escape');
    const direto = await postar(page, `/api/pessoas/solicitacoes/${atestado}/atestado`, {
      finalidade: 'Tentativa de ler o CID sem permissão',
      verCid: true,
    });
    expect(direto.status()).toBe(403);
    expect(JSON.stringify(await direto.json())).toContain('cid-restrito');

    // As aprovadas e recusadas saem da fila de pendentes e aparecem no filtro da situação.
    await escolher(page.getByTestId('fila-situacao'), { rotulo: 'Recusada' });
    await expect(page.getByTestId(`fila-${nome}-situacao`)).toHaveText('Recusada', { timeout: 30_000 });
    await expect(page.getByTestId(`fila-${nome}`)).toContainText('Traga a certidão de casamento ao RH');
    await escolher(page.getByTestId('fila-situacao'), { rotulo: 'Aprovada' });
    await expect(page.getByTestId(`fila-${abono}-situacao`)).toHaveText('Aprovada', { timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/solicitacoes (aprovadas)');

    // A colaboradora vê as decisões e o efeito: justificativa aprovada no ponto e férias programadas.
    await entrar(page, 'SINT.COLAB.PONTO');
    await page.goto('/pessoas/meu');
    await expect(page.getByTestId('minhas-solicitacoes')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`solicitacao-${abono}-situacao`)).toHaveText('Aprovada');
    await expect(page.getByTestId(`solicitacao-${nome}-situacao`)).toHaveText('Recusada');
    await expect(page.getByTestId(`solicitacao-${nome}`)).toContainText(
      'Traga a certidão de casamento ao RH',
    );
    await expect(page.getByTestId(`solicitacao-${ferias}-situacao`)).toHaveText(
      admitirAqui ? 'Aprovada' : 'Recusada',
    );
    const lidas = await minhas(page);
    const efeitoAbono = lidas.find((s) => s.id === abono)!;
    expect(efeitoAbono.ajustes.map((a) => a.situacao)).toEqual(['aprovado', 'aprovado']);
    const efeitoAjuste = lidas.find((s) => s.id === ajuste)!;
    expect(efeitoAjuste.ajustes.every((a) => a.situacao !== 'aprovado')).toBe(true);
    if (admitirAqui) expect(lidas.find((s) => s.id === ferias)!.ferias).not.toBeNull();
    else expect(lidas.find((s) => s.id === ferias)!.ferias).toBeNull();

    // A própria colaboradora lê o próprio CID (com a finalidade, na trilha).
    await page.getByTestId(`solicitacao-${atestado}-atestado`).click();
    await expect(page.getByTestId('solicitacao-atestado-dialogo')).toBeVisible();
    await preencher(page, 'atestado-finalidade', 'Conferir o que enviei ao gestor');
    await page.getByTestId('atestado-ver-cid').click();
    await page.getByTestId('atestado-ler').click();
    await expect(page.getByTestId('atestado-cid')).toHaveText('CID-10: J11');
    await semViolacaoAxe(page, 'diálogo do atestado (a própria colaboradora)');
    await page.keyboard.press('Escape');

    // Recolher.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.ponto')).toBeVisible({ timeout: 30_000 });
    await chave(page, 'pessoas.autoatendimento', false, 'Recolher o E2E W0-06');
    await chave(page, 'pessoas.ponto', false, 'Recolher o E2E W0-06');
    await chave(page, 'pessoas.folha', false, 'Recolher o E2E W0-06');
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E W0-06');
    expect(externas).toEqual([]);
  });
});
