// E2E @W0-06 (programa CRUD completo; parte 2c: realizado e turma): liga escala, colaborador, realizado e treinamentos
// → o RH admite dois colaboradores sintéticos → a coordenação publica a escala de hoje com um plantão do primeiro → o
// realizado é registrado (SINT.ESCALA) e aprovado por outra pessoa (SINT.ESCALA.APROVA), que o ESTORNA com motivo (a
// linha mostra quem, quando e o motivo) → o RH abre a turma, inscreve os dois, lança a presença do primeiro, RETIRA a
// inscrição do segundo (feita por engano), tenta retirar a do primeiro (409 com a contagem, que oferece a correção),
// CORRIGE a presença com motivo e ALTERA a turma aberta com motivo (o histórico mostra o valor anterior) → recolher.
// Axe sem violação séria nas telas e nos diálogos. Sessão real sobre a fonte sintética de dev; gestão de pessoas, escala,
// realizado e treinamentos em MEMÓRIA (nada vai à cópia); CPF SINTÉTICO. O realizado vai de 01:00 a 01:30 de hoje
// (dentro das 6 horas antes do plantão das 07:00): rodar depois da 01:30.
import { expect, type Locator, type Page, test } from '@playwright/test';
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
const entrada = (l: Locator) => l.locator('input, textarea').first();
async function preencher(l: Locator, valor: string): Promise<void> {
  const e = entrada(l);
  await e.fill(valor);
  await e.press('Tab');
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
async function ligar(page: Page, recurso: string, evidencia: string): Promise<void> {
  if ((await page.getByTestId(`recurso-${recurso}`).innerText()).includes('Ligada')) return;
  await page.getByTestId(`abrir-${recurso}`).click();
  const pre = page.getByTestId('form-prerequisito');
  await pre.getByLabel('Evidência (protocolo ou número; nunca o certificado ou a senha)').fill(evidencia);
  await pre.locator('#prereq-senha').fill(SENHA);
  await pre.getByRole('button', { name: 'Registrar pré-requisito' }).click();
  await expect(page.getByTestId('mensagem-liberacao')).toBeVisible();
  await chave(page, recurso, true, evidencia);
}
async function abrirLiberacao(page: Page): Promise<void> {
  await entrar(page, 'SINT.ADMIN');
  await page.goto('/administracao/liberacao');
  await expect(page.getByTestId('recurso-pessoas.escala')).toBeVisible({ timeout: 30_000 });
}

/** O diálogo do motivo: confirmar fica desabilitado com menos de 10 caracteres; a confirmação destrutiva pergunta. */
async function confirmarComMotivo(page: Page, testid: string, motivo: string): Promise<void> {
  const d = page.getByTestId(testid);
  await expect(d).toBeVisible();
  await d.getByLabel('Motivo').fill('curto');
  await expect(page.getByTestId(`${testid}-confirmar`)).toBeDisabled();
  await d.getByLabel('Motivo').fill(motivo);
  await semViolacaoAxe(page, `diálogo ${testid}`);
  await page.getByTestId(`${testid}-confirmar`).click();
  await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
}

async function admitir(page: Page, nome: string, base9: string, hoje: string): Promise<void> {
  await page.goto('/pessoas/colaboradores/admitir');
  await expect(page.getByTestId('tela-admissao')).toBeVisible();
  await page.getByLabel('CPF', { exact: true }).fill(cpf(base9));
  await page.getByTestId('consultar-cpf').click();
  await page.getByTestId('admissao-continuar').click();
  await page.getByLabel('Nome completo').fill(nome);
  await page.getByLabel('Data de admissão').fill(hoje);
  await page.getByLabel('Data de admissão').press('Tab');
  await page.getByLabel('Cargo', { exact: true }).fill('Técnico de enfermagem');
  await page.getByLabel('Carga semanal (horas)').fill('36');
  await escolher(page.getByTestId('admissao-centro-custo'), { indice: 0 });
  await page.getByTestId('admissao-revisar').click();
  await page.getByTestId('admissao-gravar').click();
  await expect(page.getByTestId('admissao-concluida')).toBeVisible();
}

test.describe('W0-06 (parte 2c): estorno do realizado e correções da turma @W0-06', () => {
  test.setTimeout(420_000);

  test('ligar → admitir → realizado aprovado e estornado → turma: retirar, 409 com presença, corrigir, alterar → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const agora = new Date();
    test.skip(
      agora.getHours() * 60 + agora.getMinutes() < 95,
      'O realizado de 01:00 a 01:30 precisa ter passado.',
    );
    const hoje = br(agora);
    const competencia = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}`;
    const sufixo = Date.now().toString(36).slice(-5).toUpperCase();
    const nome1 = `TECNICA W006 UM ${sufixo}`;
    const nome2 = `TECNICA W006 DOIS ${sufixo}`;
    const CURSO = `W6C-${sufixo}`;
    const fim2 = String(Date.now() % 100).padStart(2, '0');

    await abrirLiberacao(page);
    await ligar(page, 'pessoas.escala', 'Conferência sintética da coordenação (E2E W0-06 2c)');
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E W0-06 2c)');
    await ligar(
      page,
      'pessoas.plantaoRealizado',
      'Conferência sintética da coordenação médica (E2E W0-06 2c)',
    );
    await ligar(page, 'pessoas.treinamento', 'Conferência sintética da educação permanente (E2E W0-06 2c)');

    await entrar(page, 'SINT.RH');
    await admitir(page, nome1, `9006061${fim2}`, hoje);
    await admitir(page, nome2, `9006062${fim2}`, hoje);

    // A escala de hoje, publicada, com o plantão das 07:00 do primeiro colaborador.
    await entrar(page, 'SINT.ESCALA');
    await page.goto('/pessoas/escala');
    const fe = page.getByTestId('form-nova-escala');
    await expect(fe).toBeVisible({ timeout: 30_000 });
    await escolher(fe.getByTestId('nova-unidade'), { rotulo: 'Unidade sintética' });
    await escolher(fe.getByTestId('nova-tipo'), { rotulo: /apoio/i });
    await fe.getByLabel('Setor (opcional)').fill(`Apoio W006 R ${sufixo}`);
    await preencher(fe.getByTestId('nova-competencia'), competencia);
    await page.getByTestId('criar-escala').click();
    await expect(page.getByTestId('tela-grade-escala')).toBeVisible({ timeout: 30_000 });
    const fi = page.getByTestId('form-incluir-plantao');
    await fi.getByLabel('Buscar colaborador (nome ou matrícula)').fill(`UM ${sufixo}`);
    await fi.getByRole('button', { name: 'Buscar' }).click();
    await escolher(fi.getByTestId('incluir-colaborador'), { indice: 0 });
    await fi.getByLabel('Dia do início').fill(hoje);
    await fi.getByLabel('Dia do início').press('Tab');
    await page.getByTestId('incluir-plantao').click();
    await expect(page.getByTestId('escala-resultado')).toContainText('Plantão incluído.');
    const just = page.getByLabel('Justificativa da publicação com turnos abaixo do mínimo');
    if (await just.isVisible().catch(() => false)) await just.fill('Cobertura mínima sintética (E2E W0-06)');
    await page.getByTestId('publicar-escala').click();
    await expect(page.getByTestId('grade-estado')).toContainText('Publicada');

    // O realizado: registrado pela coordenação (01:00 a 01:30, dentro da antecipação do plantão).
    const abrirRealizado = async () => {
      await page.goto('/pessoas/escala/realizado');
      await expect(page.getByTestId('tela-realizado')).toBeVisible();
      await preencher(page.getByTestId('realizado-competencia'), competencia);
      await page.getByTestId('realizado-buscar').click();
      const l = page
        .getByTestId(/^realizado-\d+$/)
        .filter({ hasText: nome1 })
        .first();
      await expect(l).toBeVisible({ timeout: 30_000 });
      return l;
    };
    let linha = await abrirRealizado();
    await linha.getByTestId(/^registrar-realizado-\d+$/).click();
    const fr = page.getByTestId('form-realizado');
    await preencher(fr.getByTestId('real-ini-dia'), hoje);
    await preencher(fr.getByTestId('real-ini-hora'), '01:00');
    await preencher(fr.getByTestId('real-fim-dia'), hoje);
    await preencher(fr.getByTestId('real-fim-hora'), '01:30');
    await fr.getByTestId('real-gravar').click();
    await expect(page.getByTestId('realizado-aviso')).toBeVisible({ timeout: 30_000 });

    // Outra pessoa da coordenação aprova e, depois, estorna com motivo.
    await entrar(page, 'SINT.ESCALA.APROVA');
    linha = await abrirRealizado();
    await linha.getByTestId(/^decidir-realizado-\d+$/).click();
    await page.getByTestId('real-decidir').click();
    await expect(linha).toContainText('Aprovado', { timeout: 30_000 });
    await linha.getByTestId(/^estornar-realizado-\d+$/).click();
    await confirmarComMotivo(page, 'dialogo-estorno', 'Plantão registrado para a pessoa errada (E2E)');
    await expect(linha.getByTestId(/^estorno-realizado-\d+$/)).toContainText(
      'Plantão registrado para a pessoa errada (E2E)',
    );
    await expect(linha).toContainText('SINT.ESCALA.APROVA');
    await expect(linha.getByTestId(/^estornar-realizado-\d+$/)).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/escala/realizado (estornado)');

    // A turma: curso, turma aberta, inscrição dos dois e presença do primeiro.
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/treinamentos');
    await page.getByTestId('treino-aba-cursos').click();
    await page.getByTestId('novo-curso').click();
    const fc = page.getByTestId('form-curso');
    await preencher(fc.getByTestId('curso-codigo'), CURSO);
    await preencher(fc.getByTestId('curso-titulo'), 'Curso sintético das correções (W0-06)');
    await preencher(fc.getByTestId('curso-carga'), '60');
    await preencher(fc.getByTestId('curso-validade'), '12');
    await preencher(fc.getByTestId('curso-conteudo'), 'Conteúdo sintético do E2E das correções da turma.');
    await fc.getByTestId('curso-gravar').click();
    await expect(page.getByTestId(`curso-${CURSO}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('treino-aba-turmas').click();
    await page.getByTestId('nova-turma').click();
    const ft = page.getByTestId('form-turma');
    await escolher(ft.getByTestId('turma-curso'), { rotulo: new RegExp(CURSO) });
    await preencher(ft.getByTestId('turma-inicio'), hoje);
    await preencher(ft.getByTestId('turma-fim'), hoje);
    await preencher(ft.getByTestId('turma-carga'), '60');
    await preencher(ft.getByTestId('turma-instrutor'), 'INSTRUTORA SINTETICA ORIGINAL');
    await ft.getByTestId('turma-gravar').click();
    const det = page.getByTestId('turma-detalhe');
    await expect(det).toContainText('Curso sintético das correções', { timeout: 30_000 });
    const fins = det.getByTestId('form-inscricao');
    await entrada(fins.getByTestId('inscricao-termo')).fill(sufixo);
    await fins.getByTestId('inscricao-buscar').click();
    for (const n of [nome1, nome2]) await fins.locator('label', { hasText: n }).locator('input').check();
    await fins.getByTestId('inscrever').click();
    await expect(det.getByTestId(/^participante-\d+$/)).toHaveCount(2, { timeout: 30_000 });
    const part = (n: string) =>
      det
        .getByTestId(/^participante-\d+$/)
        .filter({ hasText: n })
        .first();
    await part(nome1)
      .getByTestId(/^registrar-\d+$/)
      .click();
    await det.getByTestId('part-gravar').click();
    await expect(part(nome1)).toContainText('Presente', { timeout: 30_000 });

    // Retirar a inscrição feita por engano (sem presença): sai da lista.
    await part(nome2)
      .getByTestId(/^retirar-\d+$/)
      .click();
    await confirmarComMotivo(page, 'dialogo-retirada', 'Inscrito na turma errada por engano (E2E)');
    await expect(det.getByTestId(/^participante-\d+$/)).toHaveCount(1, { timeout: 30_000 });

    // Retirar quem tem presença: 409 com a contagem, que oferece a correção da presença.
    await part(nome1)
      .getByTestId(/^retirar-\d+$/)
      .click();
    await confirmarComMotivo(page, 'dialogo-retirada', 'Tentativa de retirar com presença (E2E)');
    await expect(page.getByTestId('dialogo-retirada-bloqueios')).toContainText('Presença lançada: 1');
    await expect(page.getByTestId('recusa-pessoas')).toContainText('corrija a presença');
    await semViolacaoAxe(page, 'turma: retirada recusada');
    await page.getByTestId('dialogo-retirada-corrigir').click();

    // A correção da presença, com motivo: o histórico mostra o valor anterior.
    const fp = det.getByTestId('form-participacao');
    await expect(fp).toContainText('Corrigir a presença');
    await fp.getByTestId('part-presenca').getByLabel('Ausente').check();
    await escolher(fp.getByTestId('part-aproveitamento'), { indice: 0 });
    await expect(fp.getByTestId('part-gravar')).toBeDisabled();
    await entrada(fp.getByTestId('part-motivo')).fill('Presença lançada para a pessoa errada (E2E)');
    await fp.getByTestId('part-gravar').click();
    await expect(part(nome1)).toContainText('Ausente', { timeout: 30_000 });
    await expect(det.getByTestId('turma-historico')).toContainText('Presença corrigida');
    await expect(det.getByTestId('turma-historico')).toContainText('Presença: de Presente para Ausente');
    await expect(det.getByTestId('turma-historico')).toContainText(
      'Presença lançada para a pessoa errada (E2E)',
    );

    // Alterar a turma aberta, com motivo: o instrutor anterior fica no histórico.
    await det.getByTestId('alterar-turma').click();
    const fa = det.getByTestId('form-alterar-turma');
    await preencher(fa.getByTestId('alt-instrutor'), 'INSTRUTORA SINTETICA NOVA');
    await expect(fa.getByTestId('alt-gravar')).toBeDisabled();
    await entrada(fa.getByTestId('alt-motivo')).fill('Troca de instrutora por afastamento (E2E)');
    await semViolacaoAxe(page, 'turma: alterar');
    await fa.getByTestId('alt-gravar').click();
    await expect(det).toContainText('INSTRUTORA SINTETICA NOVA', { timeout: 30_000 });
    const hist = det.getByTestId('turma-historico');
    await expect(hist).toContainText('Turma alterada');
    await expect(hist).toContainText(
      'Instrutor: de INSTRUTORA SINTETICA ORIGINAL para INSTRUTORA SINTETICA NOVA',
    );
    await semViolacaoAxe(page, 'turma: histórico das correções');

    // Recolher.
    await abrirLiberacao(page);
    await chave(page, 'pessoas.treinamento', false, 'Recolher o E2E W0-06 2c');
    await chave(page, 'pessoas.plantaoRealizado', false, 'Recolher o E2E W0-06 2c');
    await chave(page, 'pessoas.escala', false, 'Recolher o E2E W0-06 2c');
    await chave(page, 'pessoas.colaborador', false, 'Recolher o E2E W0-06 2c');
    expect(externas).toEqual([]);
  });
});
