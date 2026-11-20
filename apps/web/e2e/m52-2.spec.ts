// E2E @M52.2 (ficha do M52, fatia F2; seções 7, 8 e 10 na parte da F2): com a escala desligada, as telas ficam em
// consulta → o administrador registra a conferência da coordenação de enfermagem e liga a escala (e o cadastro de
// colaboradores) em Funcionalidades → o RH admite a enfermeira sintética → a gestora de escala cria o regime 12x36 e o
// atribui à enfermeira → cria a escala de enfermagem do mês seguinte com a cobertura mínima → inclui o plantão (o alerta
// da validade do conselho não conferida: regra 3) → o plantão seguinte sem as 36 h de descanso é recusado (regra 5) →
// publica com a justificativa do furo de cobertura → a mudança da escala publicada pede o motivo (obrigatório; o servidor
// recusa sem ele) e entra com ele (regra 8) → o plantão aberto no diálogo → a trilha mostra a publicação → recolher. Axe sem violação séria.
// Sessão real sobre a fonte sintética de dev; gestão de pessoas e escala em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO.
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

async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId('recurso-pessoas.escala')).toBeVisible({ timeout: 30_000 });
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

test.describe('gestão de pessoas, fatia F2: regimes, montagem e publicação da escala @M52.2', () => {
  test.setTimeout(360_000);

  test('desligada → ligar → admitir → regime 12x36 → escala → plantão → interjornada recusada → publicar com furo → mudança só com motivo → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const hoje = new Date();
    const prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    const comp = `${prox.getFullYear()}-${p2(prox.getMonth() + 1)}`;
    const dia = (d: number) => `${p2(d)}/${p2(prox.getMonth() + 1)}/${prox.getFullYear()}`;
    const setor = `Posto E2E ${Date.now().toString(36)}`;

    // Escala desligada: a tela fica em consulta, sem o formulário da nova escala.
    await entrar(page, 'SINT.ESCALA');
    await page.goto('/pessoas/escala');
    await expect(page.getByRole('heading', { level: 1, name: 'Escala de plantão' })).toBeVisible();
    await expect(page.getByTestId('escala-gravacao-desligada')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('form-nova-escala')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/escala (desligada)');

    // O administrador registra as conferências e liga a escala e o cadastro de colaboradores.
    await abrirLiberacao(page);
    await prerequisito(page, 'pessoas.escala', 'Conferência sintética da coordenação de enfermagem');
    await chave(page, 'pessoas.escala', true, 'Escala sintética do E2E M52.2');
    await prerequisito(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M52.2)');
    await chave(page, 'pessoas.colaborador', true, 'Colaboradora sintética do E2E M52.2');

    // O RH admite a enfermeira sintética (profissional com registro no COREN, sem login).
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/colaboradores/admitir');
    await expect(page.getByTestId('tela-admissao')).toBeVisible();
    await page.getByLabel('CPF', { exact: true }).fill(cpf('900520004'));
    await page.getByTestId('consultar-cpf').click();
    await expect(page.getByTestId('previa-profissional')).toContainText('ENFERMEIRA SINTETICA TRES');
    await page.getByTestId('admissao-continuar').click();
    await page.getByLabel('Data de admissão').fill(br(hoje));
    await page.getByLabel('Data de admissão').press('Tab');
    await page.getByLabel('Cargo', { exact: true }).fill('Enfermeira plantonista');
    await page.getByLabel('Carga semanal (horas)').fill('36');
    await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Enfermagem da clínica médica/ });
    await page.getByTestId('admissao-revisar').click();
    await page.getByTestId('admissao-gravar').click();
    await expect(page.getByTestId('admissao-concluida')).toBeVisible();

    // A gestora de escala cria o regime 12x36 (36 h de descanso) e o atribui à enfermeira.
    await entrar(page, 'SINT.ESCALA');
    await page.goto('/pessoas/regimes');
    await expect(page.getByRole('heading', { level: 1, name: 'Regimes e banco de horas' })).toBeVisible();
    const fr = page.getByTestId('form-regime');
    await expect(fr).toBeVisible({ timeout: 30_000 });
    await fr.getByLabel('Sigla (ex.: 12x36)').fill(`12x36-${Date.now().toString(36).slice(-4)}`);
    await fr.getByLabel('Nome', { exact: true }).fill('Plantão 12 por 36');
    await escolher(fr.getByTestId('regime-jornada'), { rotulo: 'Escalonada' });
    await fr.getByLabel('Descanso mínimo entre jornadas (horas)').fill('36');
    await fr.getByLabel('Limite semanal de horas (fora do tempo parcial)').fill('48');
    await semViolacaoAxe(page, '/pessoas/regimes (formulário)');
    await page.getByTestId('gravar-regime').click();
    await expect(page.getByTestId('regimes-resultado')).toContainText('Regime incluído.');
    await expect(page.getByTestId('tabela-regimes')).toContainText('Plantão 12 por 36');
    const at = page.getByTestId('bloco-atribuir-regime');
    await at.getByLabel('Buscar colaborador (nome ou matrícula)').fill('TRES');
    await at.getByRole('button', { name: 'Buscar' }).click();
    await escolher(at.getByTestId('regime-colaborador'), { indice: 0 });
    await escolher(at.getByTestId('regime-escolhido'), { rotulo: /Plantão 12 por 36/ });
    await at.getByLabel('Vale a partir de').fill(br(hoje));
    await at.getByLabel('Vale a partir de').press('Tab');
    await page.getByTestId('atribuir-regime').click();
    await expect(page.getByTestId('regimes-resultado')).toContainText('a partir de');
    await expect(page.getByTestId('vigencias')).toContainText('SINT.ESCALA');

    // Nova escala de enfermagem do mês seguinte, com um profissional por manhã.
    await page.goto('/pessoas/escala');
    const fe = page.getByTestId('form-nova-escala');
    await expect(fe).toBeVisible({ timeout: 30_000 });
    await escolher(fe.getByTestId('nova-unidade'), { rotulo: 'Unidade sintética' });
    await fe.getByLabel('Setor (opcional)').fill(setor);
    await expect(fe.getByLabel('Competência (AAAA-MM)')).toHaveValue(comp);
    await fe.getByLabel('Mínimo na manhã').fill('1');
    await semViolacaoAxe(page, '/pessoas/escala (nova escala)');
    await page.getByTestId('criar-escala').click();
    await expect(page.getByTestId('tela-grade-escala')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('grade-estado')).toContainText('Rascunho');
    await expect(page.getByTestId('grade-estado')).toContainText('COREN');

    // Plantão de 12 h no dia 2: entra com o alerta da validade do conselho não conferida (regra 3).
    const fi = page.getByTestId('form-incluir-plantao');
    await fi.getByLabel('Buscar colaborador (nome ou matrícula)').fill('TRES');
    await fi.getByRole('button', { name: 'Buscar' }).click();
    await escolher(fi.getByTestId('incluir-colaborador'), { indice: 0 });
    await fi.getByLabel('Dia do início').fill(dia(2));
    await fi.getByLabel('Dia do início').press('Tab');
    await page.getByTestId('incluir-plantao').click();
    await expect(page.getByTestId('escala-resultado')).toContainText('Plantão incluído.');
    await expect(page.getByTestId('escala-alerta').first()).toContainText('validade do registro no conselho');
    await expect(page.getByTestId('grade-escala')).toContainText('07h–19h');
    await expect(page.getByTestId('bloco-furos')).toContainText('Manhã');
    await semViolacaoAxe(page, '/pessoas/escala/:id (grade)');

    // Regra 5 com o 12x36: o plantão do dia 3 não tem as 36 h de descanso.
    await fi.getByLabel('Dia do início').fill(dia(3));
    await fi.getByLabel('Dia do início').press('Tab');
    await page.getByTestId('incluir-plantao').click();
    await expect(page.getByTestId('recusa-pessoas')).toContainText('descanso entre as jornadas');

    // Publicar com a justificativa do furo de cobertura.
    await page
      .getByLabel('Justificativa da publicação com turnos abaixo do mínimo')
      .fill('Contratação em andamento; cobertura pelo sobreaviso (E2E)');
    await page.getByTestId('publicar-escala').click();
    await expect(page.getByTestId('escala-resultado')).toContainText('Escala publicada.');
    await expect(page.getByTestId('grade-estado')).toContainText('Publicada');

    // Regra 8: depois de publicada, a mudança pede o motivo (campo obrigatório; o servidor recusa sem ele) e entra com ele.
    await fi.getByLabel('Dia do início').fill(dia(5));
    await fi.getByLabel('Dia do início').press('Tab');
    await expect(fi.getByLabel('Motivo da mudança')).toHaveAttribute('required', '');
    await fi.getByLabel('Motivo da mudança').fill('Cobertura do furo da manhã (E2E)');
    await page.getByTestId('incluir-plantao').click();
    await expect(page.getByTestId('escala-resultado')).toContainText('Plantão incluído.');
    await expect(page.getByTestId('evento-publicada')).toContainText('Contratação em andamento');
    await expect(page.getByTestId('evento-incluido').first()).toContainText('Cobertura do furo da manhã');

    // O plantão aberto no diálogo (alteração e cancelamento pedem o motivo na escala publicada).
    await page
      .getByTestId('grade-escala')
      .getByRole('button', { name: /abrir o plantão/ })
      .first()
      .click();
    await expect(page.getByTestId('dialogo-plantao')).toContainText('ENFERMEIRA SINTETICA TRES');
    await expect(page.getByTestId('dialogo-plantao')).toContainText('Motivo da mudança');
    await semViolacaoAxe(page, 'diálogo do plantão');
    await page.getByTestId('dialogo-plantao').getByRole('button', { name: 'Fechar' }).click();

    // Recolher: desligar a escala e o cadastro de colaboradores (as telas voltam à consulta; os dados ficam).
    await abrirLiberacao(page);
    await chave(page, 'pessoas.escala', false, 'Recolher o E2E M52.2');
    await expect(page.getByTestId('recurso-pessoas.escala')).toContainText('Desligada');
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E M52.2');
    expect(externas).toEqual([]);
  });
});
