// E2E @M37 (ficha, seções 7, 10 e 11): o comitê vê o setor, passa-o por homologação e treinamento, publica a trilha,
// registra a conclusão da turma, libera o setor e aplica o lote (a pessoa que concluiu ganha o acesso; quem não
// concluiu fica de fora e aparece listada) e o recolhe inteiro; a condução opcional ida e volta (o gestor de acessos
// retira o par com a autorização e devolve); abrir chamado pelo menu do usuário (todos) e triar (N1/N2). Sessão
// sintética de dev, portas em MEMÓRIA (nada vai à cópia); axe sem violação séria em cada aba.
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function passarSetor(page: Page, situacao: string, extra?: () => Promise<void>): Promise<void> {
  await page.getByTestId('gerir-agendamento').click();
  const form = page.getByTestId('form-setor');
  await escolher(form.getByTestId('setor-situacao'), situacao);
  await extra?.();
  await form
    .getByTestId('setor-justificativa')
    .locator('input, textarea')
    .first()
    .fill(`Passagem sintética para ${situacao}`);
  await form.getByTestId('setor-gravar').click();
  await expect(page.getByTestId('mensagem-migracao')).toContainText('Setor gravado');
}

test.describe('Painel de migração gradual, treinamento e governança @M37', () => {
  // Jornadas longas (várias abas e o axe em cada uma): o teto padrão de 30 s não basta na VM compartilhada.
  test.setTimeout(180_000);
  test('comitê: setor, trilha, conclusão da turma, lote do setor (quem não concluiu fica de fora) e recolhimento; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/coexistencia/migracao');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Migração gradual dos usuários' }),
    ).toBeVisible();
    await expect(page.getByTestId('setor-agendamento').getByTestId('situacao')).toHaveText(
      'No outro sistema',
    );
    await expect(page.getByTestId('migracao-publico')).toContainText('Público por papel');
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao');
    await passarSetor(page, 'homologacao');
    await passarSetor(page, 'treinamento');

    // Trilha da recepção na onda 1 e a conclusão de três pessoas da turma.
    await page.getByTestId('aba-migracao-treinamento').click();
    await expect(page).toHaveURL(/migracao\/treinamento$/);
    await page
      .getByTestId('exercicio-recepcao-1')
      .fill('Marcar e remarcar a consulta do paciente sintético da turma.');
    await page.getByTestId('publicar-recepcao-1').click();
    await expect(page.getByTestId('mensagem-treino')).toContainText('Versão 1 publicada');
    await expect(page.getByTestId('trilha-recepcao-1').getByTestId('versao')).toHaveText('1');
    const form = page.getByTestId('form-conclusao');
    await form.getByTestId('conclusao-turma').locator('input, textarea').first().fill('T1');
    await form.getByTestId('conclusao-logins').fill('SINT.TURMA01 SINT.TURMA02 SINT.TURMA03');
    await form.getByTestId('conclusao-registrar').click();
    await expect(page.getByTestId('mensagem-treino')).toContainText('3 conclusão(ões) registrada(s)');
    await expect(page.getByTestId('tabela-turmas')).toContainText('T1');
    // O guia e o roteiro de vídeo da tarefa abrem na própria tela (servidos pela API).
    await page.locator('[data-testid^="guia-recepcao-"]').first().click();
    await expect(page.getByTestId('guia-aberto')).toBeVisible();
    await expect(page.getByTestId('guia-texto')).not.toBeEmpty();
    await page.locator('[data-testid^="video-recepcao-"]').first().click();
    await expect(page.getByTestId('guia-texto')).not.toBeEmpty();
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/treinamento');

    // Liberado o setor, o lote do setor inteiro: as três entram; o resto da turma fica de fora, listado.
    await page.getByTestId('aba-migracao-setores').click();
    await passarSetor(page, 'liberado');
    const lote = page.getByTestId('form-lote');
    await lote
      .getByTestId('lote-justificativa')
      .locator('input, textarea')
      .first()
      .fill('Primeiro lote sintético do setor');
    await lote.getByTestId('lote-senha').fill(SENHA);
    await lote.getByTestId('lote-aplicar').click();
    await expect(page.getByTestId('mensagem-migracao')).toContainText('3 pessoa(s) com acesso');
    await expect(page.getByTestId('lote-fora')).toContainText('SINT.TURMA04');
    await expect(page.getByTestId('setor-agendamento').getByTestId('com-acesso')).toHaveText('<5');
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao (lote aplicado)');
    // Recolher: o lote inteiro volta ao estado de antes.
    await page
      .getByTestId('recolher-justificativa')
      .locator('input, textarea')
      .first()
      .fill('Recolhimento sintético do lote');
    await page.getByTestId('recolher-senha').fill(SENHA);
    await page.locator('[data-testid^="recolher-"]').filter({ hasText: 'Recolher' }).first().click();
    await expect(page.getByTestId('mensagem-migracao')).toContainText('recolhido');
    await expect(page.getByTestId('setor-agendamento').getByTestId('com-acesso')).toHaveText('0');

    // Por pessoa e indicadores (só leitura).
    await page.getByTestId('aba-migracao-pessoas').click();
    await page.getByTestId('pessoas-termo').fill('TURMA');
    await page.getByTestId('pessoas-buscar').click();
    await expect(page.getByTestId('pessoa-SINT.TURMA01')).toContainText('sim');
    await expect(page.getByTestId('pessoa-SINT.TURMA03').getByTestId('ultima-outro')).toContainText('dia(s)');
    // Quem já trabalha no novo mostra o dia do último uso (a trilha); quem não usou, o travessão.
    await expect(page.getByTestId('pessoa-SINT.TURMA03').getByTestId('ultimo-novo')).toHaveText('—');
    await page.getByTestId('pessoas-termo').fill('SINT.ADMIN');
    await page.getByTestId('pessoas-buscar').click();
    await expect(page.getByTestId('pessoa-SINT.ADMIN').getByTestId('ultimo-novo')).toHaveText(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/pessoas');
    await page.getByTestId('aba-migracao-indicadores').click();
    await expect(page.getByTestId('parcela-agenda.agendarConsulta')).toContainText('novo 61 de 100 = 61%');
    await expect(page.getByTestId('ind-tempo')).toContainText('Abrir prontuário');
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/indicadores');
    expect(externas).toEqual([]);
  });

  test('condução opcional ida e volta: o gestor retira o par do grupo com a autorização e devolve; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/coexistencia/migracao');
    await page.getByTestId('gerir-agendamento').click();
    const form = page.getByTestId('form-setor');
    await form.getByTestId('setor-grupos').fill('AGENDA');
    await form.getByTestId('setor-conducao').check();
    await form
      .getByTestId('setor-justificativa')
      .locator('input, textarea')
      .first()
      .fill('O setor pediu a condução (sintético)');
    await form.getByTestId('setor-gravar').click();
    await expect(page.getByTestId('mensagem-migracao')).toContainText('Setor gravado');

    await entrar(page, 'SINT.GESTOR');
    await page.goto('/administracao/coexistencia/migracao/conducao');
    await escolher(page.getByTestId('conducao-setor'), 'agendamento');
    await expect(page.getByTestId('tabela-conducao')).toBeVisible();
    const primeiro = page.locator('[data-testid^="escolher-AGENDA-"]').first();
    const id = (await primeiro.getAttribute('data-testid'))!.replace('escolher-', '');
    await primeiro.check();
    await page
      .getByTestId('conducao-autorizacao')
      .locator('input, textarea')
      .first()
      .fill('ESTADO.md › Autorizações (sintética)');
    await page.getByTestId('conducao-senha').fill(SENHA);
    await page.getByTestId('conducao-retirar').click();
    await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByTestId('mensagem-conducao')).toContainText('1 opção(ões) retirada(s)');
    await expect(page.getByTestId(`par-${id}`).getByTestId('situacao-par')).toHaveText('retirada');
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/conducao (retirada)');
    await page.getByTestId('conducao-senha').fill(SENHA);
    await page.getByTestId('conducao-devolver').click();
    await expect(page.getByTestId('mensagem-conducao')).toContainText('1 opção(ões) devolvida(s)');
    await expect(page.getByTestId(`par-${id}`).getByTestId('situacao-par')).toHaveText('proposta');
  });

  test('chamado: a recepção abre pelo menu do usuário (em que sistema aconteceu); o comitê tria o S1 com comandante; axe', async ({
    page,
  }) => {
    await entrar(page, 'SINT.RECEPCAO');
    await page.getByTestId('menu-usuario').click();
    await page.getByTestId('abrir-chamado').click();
    const f = page.getByTestId('form-chamado');
    await expect(f.getByTestId('chamado-aviso')).toContainText('CPF');
    await f.getByLabel('Neste sistema').check();
    await escolher(f.getByTestId('chamado-severidade'), 'S1');
    await f
      .getByTestId('chamado-descricao')
      .locator('textarea, input')
      .first()
      .fill('A marcação parou na tela da agenda');
    await semViolacaoAxe(page, 'diálogo Abrir chamado');
    await f.getByTestId('chamado-enviar').click();
    await expect(f.getByTestId('chamado-aberto')).toContainText('aberto');
    const numero = /Chamado (\d+) aberto/.exec(
      (await f.getByTestId('chamado-aberto').textContent()) ?? '',
    )?.[1];
    expect(numero).toBeTruthy();

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/coexistencia/migracao/chamados');
    const linha = page.getByTestId(`chamado-${numero}`);
    await expect(linha.getByTestId('severidade')).toHaveText('S1');
    await expect(page.getByTestId('chamados-prazos')).toContainText('a aprovar');
    await semViolacaoAxe(page, '/administracao/coexistencia/migracao/chamados');
    await page.getByTestId(`triar-${numero}`).click();
    const t = page.getByTestId('form-triagem');
    await escolher(t.getByTestId('triagem-situacao'), 'contornado');
    await escolher(t.getByTestId('triagem-nivel'), 'N2');
    await t.getByTestId('triagem-comandante').fill('SINT.GESTOR');
    await t.getByTestId('triagem-gravar').click();
    await expect(page.getByTestId('mensagem-chamados')).toContainText('Contornado');
    await expect(linha.getByTestId('situacao-chamado')).toHaveText('Contornado');
  });
});
