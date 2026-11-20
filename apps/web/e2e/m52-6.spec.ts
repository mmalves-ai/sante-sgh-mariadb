// E2E @M52.6 (ficha do M52, fatia F6; seções 7, 8 e 10 na parte da F6): com os treinamentos desligados, a tela fica em
// consulta → o administrador registra as conferências e liga os treinamentos, o "Meu espaço" e o plantão realizado →
// a colaboradora com login (SINT.COLAB.PONTO) tem o vínculo (admitida aqui se ainda não tiver) → o RH cria o curso
// obrigatório, publica dois POPs (um da turma, outro para a ciência própria), abre a turma com o POP, inscreve a
// colaboradora, registra a presença e a conclusão (a ciência do POP da turma) e encerra a turma, com a lista de presença
// em PDF → a situação mostra o curso em dia (regra 20) → a colaboradora abre o "Meu espaço": o próprio vínculo, o
// holerite só com a folha, o POP pendente e a ciência dada por ela (regra 21) → o plantão realizado abre pela escala,
// com a tarifa por hora e o relatório ao repasse com o lançamento desligado (DP-33) → recolher (desligar a chave).
// Axe sem violação séria em cada tela. Sessão real sobre a fonte sintética de dev, gestão de pessoas em MEMÓRIA (nada vai
// à cópia); CPF SINTÉTICO (dígito calculado aqui sobre a base inventada).
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
const p2 = (n: number) => String(n).padStart(2, '0');
const br = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;

/** O campo de texto ou de data dentro do invólucro do componente (o data-testid fica no invólucro). */
const entrada = (l: Locator) => l.locator('input, textarea').first();
async function preencher(l: Locator, valor: string): Promise<void> {
  const e = entrada(l);
  await e.fill(valor);
  await e.press('Tab');
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
async function chave(page: Page, recurso: string, ligada: boolean, motivo: string): Promise<void> {
  await page.getByTestId(`abrir-${recurso}`).click();
  const form = page.getByTestId('form-liberacao');
  await form.getByTestId(ligada ? 'opcao-ligar' : 'opcao-desligar').check();
  await form.getByLabel('Justificativa').fill(motivo);
  await form.getByTestId('liberacao-senha').fill(SENHA);
  await form.getByTestId('liberacao-aplicar').click();
  await expect(page.getByTestId('mensagem-liberacao')).toContainText('chave(s) alterada(s)');
}

async function publicarPop(page: Page, codigo: string, titulo: string, hoje: string): Promise<void> {
  await page.getByTestId('treino-aba-pops').click();
  await page.getByTestId('novo-pop').click();
  const f = page.getByTestId('form-pop');
  await preencher(f.getByTestId('pop-codigo'), codigo);
  await preencher(f.getByTestId('pop-titulo'), titulo);
  await preencher(f.getByTestId('pop-vigencia'), hoje);
  await preencher(
    f.getByTestId('pop-resumo'),
    'Procedimento sintético do E2E da fatia F6, com a ciência de cada versão.',
  );
  await f.getByTestId('pop-gravar').click();
  await expect(page.getByTestId('pops-aviso')).toBeVisible();
  await expect(page.getByTestId(`pop-${codigo}`)).toBeVisible();
}

test.describe('gestão de pessoas, fatia F6: treinamentos e POP, Meu espaço, plantão realizado @M52.6', () => {
  test.setTimeout(420_000);

  test('desligado → ligar → curso → POPs → turma com presença e conclusão → situação → Meu espaço com ciência → realizado e repasse → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const agora = new Date();
    const hoje = br(agora);
    const sufixo = Date.now().toString(36).toUpperCase().slice(-5);
    const CURSO = `NR32-${sufixo}`;
    const POP_TURMA = `POP-T-${sufixo}`;
    const POP_PROPRIO = `POP-P-${sufixo}`;

    // Treinamentos desligados: a tela fica em consulta.
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/treinamentos');
    await expect(page.getByRole('heading', { level: 1, name: 'Treinamentos e capacitações' })).toBeVisible();
    await expect(page.getByTestId('treino-situacao')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('treino-aba-cursos').click();
    await expect(page.getByTestId('novo-curso')).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/treinamentos (desligado)');

    // O administrador registra as conferências e liga os recursos da fatia (e o cadastro de colaboradores).
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.treinamento')).toContainText('Desligada', {
      timeout: 30_000,
    });
    await ligar(page, 'pessoas.colaborador', 'Conferência sintética do RH (E2E M52.6)');
    await ligar(page, 'pessoas.treinamento', 'Conferência sintética da educação permanente (E2E M52.6)');
    await ligar(page, 'pessoas.autoatendimento', 'Conferência sintética do RH e do DPO (E2E M52.6)');
    await ligar(page, 'pessoas.plantaoRealizado', 'Conferência sintética da coordenação médica (E2E M52.6)');

    // A colaboradora com login: admitida aqui se ainda não tiver vínculo (o E2E do ponto pode ter admitido antes).
    await entrar(page, 'SINT.COLAB.PONTO');
    await page.goto('/pessoas/meu');
    await expect(page.getByTestId('tela-meu-espaco')).toBeVisible();
    await expect(page.getByTestId('meu-vinculo').or(page.getByTestId('meu-sem-vinculo'))).toBeVisible({
      timeout: 30_000,
    });
    let nome: string;
    if (await page.getByTestId('meu-sem-vinculo').isVisible()) {
      nome = `COLABORADORA F6 E2E ${sufixo}`;
      await entrar(page, 'SINT.RH');
      await page.goto('/pessoas/colaboradores/admitir');
      await expect(page.getByTestId('tela-admissao')).toBeVisible();
      await page.getByLabel('CPF', { exact: true }).fill(cpf('900520006'));
      await page.getByTestId('consultar-cpf').click();
      await expect(page.getByTestId('previa-usuario')).toContainText('SINT.COLAB.PONTO');
      await page.getByTestId('admissao-continuar').click();
      await page.getByLabel('Nome completo').fill(nome);
      await page.getByLabel('Data de admissão').fill(hoje);
      await page.getByLabel('Data de admissão').press('Tab');
      await page.getByLabel('Cargo', { exact: true }).fill('Auxiliar administrativa');
      await page.getByLabel('Carga semanal (horas)').fill('44');
      await escolher(page.getByTestId('admissao-centro-custo'), { rotulo: /Recursos humanos/ });
      await page.getByTestId('admissao-revisar').click();
      await page.getByTestId('admissao-gravar').click();
      await expect(page.getByTestId('admissao-concluida')).toBeVisible();
    } else {
      nome = (await page.getByTestId('meu-vinculo').locator('h2').first().innerText()).trim();
    }

    // O RH cria o curso obrigatório (NR-32, validade de 12 meses) e publica os dois POPs.
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/treinamentos');
    await page.getByTestId('treino-aba-cursos').click();
    await page.getByTestId('novo-curso').click();
    const fc = page.getByTestId('form-curso');
    await preencher(fc.getByTestId('curso-codigo'), CURSO);
    await preencher(fc.getByTestId('curso-titulo'), 'Biossegurança e perfurocortantes (sintético)');
    await preencher(fc.getByTestId('curso-carga'), '120');
    await preencher(fc.getByTestId('curso-validade'), '12');
    await preencher(
      fc.getByTestId('curso-conteudo'),
      'Precauções padrão, descarte de perfurocortantes e conduta no acidente.',
    );
    await semViolacaoAxe(page, 'treinamentos: novo curso');
    await fc.getByTestId('curso-gravar').click();
    await expect(page.getByTestId('cursos-aviso')).toBeVisible();
    await expect(page.getByTestId(`curso-${CURSO}`)).toContainText('Obrigatório para o público');

    await publicarPop(page, POP_TURMA, 'Higiene das mãos (sintético)', hoje);
    await publicarPop(page, POP_PROPRIO, 'Descarte de perfurocortantes (sintético)', hoje);
    await semViolacaoAxe(page, 'treinamentos: POPs');

    // A turma do curso com o POP; inscrição, presença e conclusão (ciência do POP da turma); encerrar.
    await page.getByTestId('treino-aba-turmas').click();
    await page.getByTestId('nova-turma').click();
    const ft = page.getByTestId('form-turma');
    await escolher(ft.getByTestId('turma-curso'), { rotulo: new RegExp(CURSO) });
    await preencher(ft.getByTestId('turma-inicio'), hoje);
    await preencher(ft.getByTestId('turma-fim'), hoje);
    await preencher(ft.getByTestId('turma-carga'), '120');
    await preencher(ft.getByTestId('turma-instrutor'), 'ENFERMEIRA EDUCADORA SINTETICA');
    await escolher(ft.getByTestId('turma-pop'), { rotulo: new RegExp(POP_TURMA) });
    await semViolacaoAxe(page, 'treinamentos: nova turma');
    await ft.getByTestId('turma-gravar').click();
    const det = page.getByTestId('turma-detalhe');
    await expect(det).toContainText('Biossegurança e perfurocortantes', { timeout: 30_000 });
    await expect(det).toContainText(POP_TURMA);
    const fi = det.getByTestId('form-inscricao');
    await entrada(fi.getByTestId('inscricao-termo')).fill(nome.split(' ').slice(0, 2).join(' '));
    await fi.getByTestId('inscricao-buscar').click();
    await fi.locator('input[type="checkbox"]').first().check();
    await fi.getByTestId('inscrever').click();
    await expect(det.getByTestId(/^participante-\d+$/)).toHaveCount(1, { timeout: 30_000 });
    await det
      .getByTestId(/^registrar-\d+$/)
      .first()
      .click();
    await semViolacaoAxe(page, 'treinamentos: presença e conclusão');
    await det.getByTestId('part-gravar').click();
    await expect(det.getByTestId(/^participante-\d+$/).first()).toContainText('Presente');
    await expect(det.getByTestId('lista-pdf')).toHaveAttribute('href', /lista\/pdf/);
    await det.getByTestId('encerrar-turma').click();
    await expect(page.getByTestId('turmas-aviso')).toBeVisible();

    // A situação dos colaboradores: o curso concluído e válido; a ficha da colaboradora.
    await page.getByTestId('treino-aba-situacao').click();
    const sit = page.getByTestId('treino-situacao');
    await sit.getByLabel('Nome ou matrícula').fill(nome);
    await sit.getByRole('button', { name: 'Buscar' }).click();
    const linha = page
      .getByTestId(/^situacao-\d+$/)
      .filter({ hasText: nome })
      .first();
    await expect(linha).toBeVisible({ timeout: 30_000 });
    await linha.getByTestId(/^ficha-\d+$/).click();
    await expect(page.getByTestId(`ficha-curso-${CURSO}`)).toContainText('Em dia');
    await expect(page.getByTestId('treino-ficha')).toContainText(`${POP_TURMA} v1`);
    await expect(page.getByTestId('treino-ficha')).toContainText('(pela turma)');
    await semViolacaoAxe(page, 'treinamentos: situação e ficha');

    // A colaboradora: o próprio vínculo, a folha fora, o POP próprio pendente e a ciência (o da turma já tem ciência).
    await entrar(page, 'SINT.COLAB.PONTO');
    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('meu-espaco').click();
    await expect(page).toHaveURL(/\/pessoas\/meu/);
    await expect(page.getByTestId('meu-vinculo')).toContainText(nome, { timeout: 30_000 });
    await expect(page.getByTestId('meu-folha')).toContainText('folha de pagamento');
    await expect(page.getByTestId(`meu-pop-${POP_PROPRIO}`)).toBeVisible();
    await expect(page.getByTestId(`meu-pop-${POP_TURMA}`)).toHaveCount(0);
    await semViolacaoAxe(page, '/pessoas/meu');
    await page.getByTestId(`ciencia-${POP_PROPRIO}`).click();
    await expect(page.getByTestId('meu-aviso')).toContainText('Ciência registrada.');
    await expect(page.getByTestId(`meu-pop-${POP_PROPRIO}`)).toHaveCount(0);
    // O plantão realizado abre pela escala; a tarifa por hora e o relatório ao repasse com o lançamento desligado.
    await entrar(page, 'SINT.ESCALA');
    await page.goto('/pessoas/escala');
    await page.getByTestId('abrir-realizado').click();
    await expect(page.getByTestId('tela-realizado')).toBeVisible();
    await expect(page.getByTestId('realizado-contagem')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/pessoas/escala/realizado');
    await page.getByTestId('realizado-aba-repasse').click();
    await expect(page.getByTestId('repasse-desligado')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('repasse-total')).toBeVisible();
    await semViolacaoAxe(page, 'realizado: relatório ao repasse');
    await page.getByTestId('realizado-aba-tarifas').click();
    await expect(page.getByTestId('realizado-tarifas')).toBeVisible();

    // Recolher: desligar a chave dos treinamentos; a tela volta à consulta.
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/liberacao');
    await expect(page.getByTestId('recurso-pessoas.treinamento')).toContainText('Ligada', {
      timeout: 30_000,
    });
    await chave(page, 'pessoas.treinamento', false, 'Recolher do E2E M52.6');
    await entrar(page, 'SINT.RH');
    await page.goto('/pessoas/treinamentos');
    await page.getByTestId('treino-aba-cursos').click();
    await expect(page.getByTestId(`curso-${CURSO}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('novo-curso')).toHaveCount(0);

    expect(externas).toEqual([]);
  });
});
