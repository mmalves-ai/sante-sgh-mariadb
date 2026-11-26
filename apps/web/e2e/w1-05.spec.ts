// E2E @W1-05 (atendimento: corrigir a ficha, excluir e estornar o procedimento extra; fichas a imprimir e locais de
// observação). Sessão real sobre a fonte sintética de dev e as portas do atendimento e dos domínios em MEMÓRIA (fichas,
// contas, marcações, modelos e locais SINTÉTICOS; nada vai à cópia). Prova, na tela: a correção da ficha (convênio e
// observação) com a justificativa; o procedimento extra lançado, corrigido (quantidade) e estornado com a senha; a
// exclusão da ficha vazia pelo supervisor (pergunta de confirmação e senha); a ficha do agendamento excluída com a
// marcação voltando (D-EXC-AGE-20); a conta fechada encaminhando a correção ao faturamento; as fichas a imprimir na
// tela própria das regras de impressão, pelo atalho dos atendimentos do dia (02-REC linha 35); e, no CRUD genérico,
// incluir e excluir o local de observação. Nenhuma tela com a faixa "só consulta".
import { expect, type Locator, type Page, test } from '@playwright/test';
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

/** Nenhuma faixa de "só consulta" / "em consulta nesta etapa" na tela (regra do programa CRUD completo). */
async function semFaixaDeConsulta(page: Page): Promise<void> {
  await expect(page.getByText(/s[óo] consulta|em consulta nesta etapa/i)).toHaveCount(0);
}

/** Abre uma consulta do paciente 1001 (JOSÉ DA SILVA) na recepção e devolve o número do atendimento. */
async function abrirConsulta(page: Page): Promise<number> {
  await page.goto('/recepcao/atendimento/novo');
  await page.getByTestId('abrir-atd-termo').fill('JOSE DA SILVA');
  await page.getByTestId('abrir-atd-buscar').click();
  await page.getByTestId('abrir-atd-paciente-1001').click();
  const ficha = page.getByRole('region', { name: 'Dados do atendimento' });
  await escolher(ficha.getByLabel('Tipo', { exact: true }), 'consulta');
  await escolher(ficha.getByLabel('Convênio', { exact: true }), '306');
  await escolher(ficha.getByLabel('Especialidade', { exact: true }), '15');
  await escolher(ficha.getByLabel('Profissional', { exact: true }), '7101');
  await escolher(ficha.getByLabel('Unidade', { exact: true }), '1');
  await escolher(ficha.getByLabel('Centro de custo', { exact: true }), '300600');
  await page.getByTestId('abrir-atd-procedimento').fill('10101012');
  await page.getByTestId('abrir-atd-cid').fill('febre');
  await page.getByTestId('abrir-atd-cid-buscar').click();
  await page.getByTestId('abrir-atd-cid-1').click();
  await page.getByTestId('botao-abrir-atendimento').click();
  await expect(page.getByTestId('tela-impressos')).toBeVisible();
  const reg = Number(/\/recepcao\/atendimento\/(\d+)\//.exec(page.url())?.[1]);
  expect(reg).toBeGreaterThan(0);
  return reg;
}

/** O supervisor exclui a ficha pela tela do encerramento: motivo, justificativa, a pergunta e a senha. */
async function excluirFicha(page: Page, reg: number, marcacaoVolta: boolean): Promise<void> {
  await page.goto(`/recepcao/atendimento/${reg}/encerrar`);
  await expect(page.getByTestId('tela-encerrar')).toBeVisible();
  await expect(page.getByTestId('previa-exclusao')).toBeVisible();
  if (marcacaoVolta) await expect(page.getByTestId('previa-marcacao-volta')).toBeVisible();
  await expect(page.getByTestId('previa-dependentes')).toHaveCount(0);
  await semFaixaDeConsulta(page);
  await escolher(page.getByLabel('Motivo da exclusão', { exact: true }), { indice: 1 });
  await page.getByLabel('Justificativa', { exact: true }).fill('Aberto por engano no paciente (teste E2E)');
  await semViolacaoAxe(page, '/recepcao/atendimento/:reg/encerrar (exclusão)');
  await page.getByTestId('botao-excluir').click();
  await page.getByTestId('confirmacao').getByRole('button', { name: 'Confirmar' }).click();
  await page.getByTestId('excluir-senha').fill(SENHA);
  await page.getByTestId('botao-confirmar-exclusao').click();
  await expect(page).toHaveURL(/\/recepcao\/atendimento\?excluido=sim/);
}

/** Preenche o que faltar no formulário do CRUD genérico: números com 1 e combos vazios com a primeira opção. */
async function completarFormulario(form: Locator): Promise<void> {
  for (const campo of await form.locator('input[type="number"]').all())
    if (!(await campo.inputValue())) await campo.fill('1');
  for (const combo of await form.getByRole('combobox').all()) {
    const texto = (await combo.innerText()).trim();
    if (!texto || /selecione|escolha/i.test(texto)) await escolher(combo, { indice: 0 });
  }
}

/** Exclui o item da linha (motivo e senha no diálogo de gravação) e espera a mensagem. */
async function excluirLinha(page: Page, linha: Locator, motivo: string): Promise<void> {
  await linha.getByRole('button', { name: 'Excluir' }).click();
  const dialogo = page.getByTestId('form-gravacao');
  await expect(dialogo).toBeVisible();
  await dialogo.getByTestId('dialogo-motivo').fill(motivo);
  await dialogo.getByTestId('dialogo-senha').fill(SENHA);
  await dialogo.getByTestId('dialogo-confirmar').click();
}

test.describe('Atendimento: corrigir a ficha, estornar o extra, excluir; fichas a imprimir e locais @W1-05', () => {
  test.setTimeout(240_000);

  test('corrigir a ficha (convênio e observação), lançar, corrigir e estornar o extra, excluir a ficha; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    // A prévia do preço e do credenciamento (ADR 0009) exige o banco do cliente; o E2E roda com a fonte sintética, por
    // isso a leitura da prévia é simulada (massa SINTÉTICA). Sem ela, a tela fica fechada (falha fechada) e o
    // lançamento não sai. O cálculo está em precos/agenda-preco e no contrato de efeito do preço.
    await page.route('**/api/atendimento/*/preco**', (r) =>
      r.request().method() !== 'GET'
        ? r.fallback()
        : r.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              valor: 10,
              origem: 'tabela_convenio',
              regraPrecoParticularId: null,
              tabelaPrecoId: null,
              textoOrigemId: null,
              estimada: false,
              credenciamento: { credenciado: true, efeito: 'nenhum', credenciamentoId: null, motivo: null },
              explicacao: 'Tabela sintética do convênio',
              recusa: null,
            }),
          }),
    );
    await entrar(page, 'SINT.ATENDIMENTO');
    const reg = await abrirConsulta(page);

    // Corrigir a ficha: troca do convênio (conta aberta, sem outros itens) e a observação, com a justificativa.
    await page.goto(`/recepcao/atendimento/${reg}/corrigir`);
    await expect(page.getByTestId('tela-corrigir-ficha')).toBeVisible();
    await semFaixaDeConsulta(page);
    await escolher(page.getByLabel('Convênio', { exact: true }), '320');
    await page.getByLabel(/Observação/).fill('Paciente trouxe a carteirinha do plano novo');
    await page.getByLabel('Solicitante', { exact: true }).fill('SOLICITANTE UM');
    await page
      .getByRole('search')
      .filter({ has: page.getByLabel('Solicitante', { exact: true }) })
      .getByRole('button')
      .click();
    await page.getByRole('button', { name: /SOLICITANTE UM/ }).click();
    await expect(page.getByTestId('corrigir-solicitante-escolhido')).toContainText('SOLICITANTE UM');
    await expect(page.getByTestId('corrigir-mudancas')).toContainText('3');
    await semViolacaoAxe(page, '/recepcao/atendimento/:reg/corrigir');
    await page.getByTestId('botao-revisar-correcao').click();
    const dialogo = page.getByTestId('dialogo-correcao');
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByTestId('botao-gravar-correcao')).toBeDisabled();
    await dialogo.getByLabel(/Justificativa/).fill('Convênio escolhido errado na abertura (teste E2E)');
    await dialogo.getByTestId('botao-gravar-correcao').click();
    await expect(page.getByTestId('ficha-corrigida')).toBeVisible();

    // Revisão: a correção mostra o solicitante e a observação gravados e os retira (envia null).
    await page.goto(`/recepcao/atendimento/${reg}/corrigir`);
    await expect(page.getByTestId('corrigir-solicitante-escolhido')).toContainText('SOLICITANTE UM');
    await expect(page.getByLabel(/Observação/)).toHaveValue('Paciente trouxe a carteirinha do plano novo');
    await expect(page.getByTestId('corrigir-mudancas')).toContainText('Nenhum campo mudou');
    await page.getByTestId('corrigir-remover-solicitante').click();
    await page.getByTestId('corrigir-remover-observacao').click();
    await expect(page.getByTestId('corrigir-solicitante-retirado')).toContainText('SOLICITANTE UM');
    await expect(page.getByTestId('corrigir-observacao-retirada')).toContainText('carteirinha');
    await expect(page.getByTestId('corrigir-mudancas')).toContainText('2');
    await page.getByTestId('botao-revisar-correcao').click();
    await page
      .getByTestId('dialogo-correcao')
      .getByLabel(/Justificativa/)
      .fill('Solicitante e observação lançados por engano (teste E2E)');
    await page.getByTestId('dialogo-correcao').getByTestId('botao-gravar-correcao').click();
    await expect(page.getByTestId('ficha-corrigida')).toBeVisible();
    await page.goto(`/recepcao/atendimento/${reg}/corrigir`);
    await expect(page.getByTestId('tela-corrigir-ficha')).toBeVisible();
    await expect(page.getByLabel(/Observação/)).toHaveValue('');
    await expect(page.getByTestId('corrigir-solicitante-escolhido')).toHaveCount(0);

    // Procedimento extra: lançar 2 hemogramas, corrigir para 3 e estornar com a justificativa e a senha.
    await page.goto(`/recepcao/atendimento/${reg}/procedimentos`);
    await expect(page.getByTestId('tela-procedimentos')).toBeVisible();
    await semFaixaDeConsulta(page);
    await page.getByTestId('extras-termo').fill('HEMOGRAMA');
    await page.getByTestId('extras-buscar').click();
    await page.getByTestId('extras-proc-40301630').click();
    await page.getByLabel('Quantidade', { exact: true }).fill('2');
    await page.getByTestId('botao-lancar-extra').click();
    await expect(page.getByTestId('tabela-extras')).toContainText('HEMOGRAMA');
    await page.getByTestId('extra-corrigir-1').click();
    const extra = page.getByTestId('dialogo-extra');
    await expect(extra).toBeVisible();
    await extra.getByTestId('extra-nova-quantidade').fill('3');
    await extra.locator('#extra-justificativa').fill('Foram colhidas três amostras (teste E2E)');
    await semViolacaoAxe(page, 'diálogo da correção do extra');
    await extra.getByTestId('botao-confirmar-extra').click();
    await expect(extra).toHaveCount(0);
    await expect(page.getByTestId('tabela-extras').locator('tbody tr').first()).toContainText('3');
    await page.getByTestId('extra-estornar-1').click();
    await expect(extra.getByTestId('extra-senha')).toBeVisible();
    await extra.locator('#extra-justificativa').fill('Lançado no atendimento errado (teste E2E)');
    await extra.getByTestId('extra-senha').fill(SENHA);
    await semViolacaoAxe(page, 'diálogo do estorno do extra');
    await extra.getByTestId('botao-confirmar-extra').click();
    await expect(page.getByTestId('tabela-extras')).toHaveCount(0);

    // Excluir a ficha (depois do estorno, sem nenhum ato): o supervisor, com a pergunta e a senha.
    await entrar(page, 'SINT.SUPERVISOR.ATD');
    await excluirFicha(page, reg, false);
    expect(externas).toEqual([]);
  });

  test('a ficha do agendamento sai e a marcação volta (D-EXC-AGE-20); a conta fechada vai ao faturamento', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.ATENDIMENTO');
    await page.goto('/recepcao/atendimento/novo?marcacao=880002');
    await expect(page.getByTestId('abrir-atd-do-agendamento')).toContainText('08:00');
    const ficha = page.getByRole('region', { name: 'Dados do atendimento' });
    await escolher(ficha.getByLabel('Profissional', { exact: true }), '7101');
    await page.getByTestId('abrir-atd-cid').fill('febre');
    await page.getByTestId('abrir-atd-cid-buscar').click();
    await page.getByTestId('abrir-atd-cid-1').click();
    await page.getByTestId('botao-abrir-atendimento').click();
    await expect(page.getByTestId('tela-impressos')).toBeVisible();
    const reg = Number(/\/recepcao\/atendimento\/(\d+)\//.exec(page.url())?.[1]);

    // A conta fechada (consulta sintética de ANTÔNIO): a troca do convênio é recusada e encaminhada ao faturamento.
    await page.goto('/recepcao/atendimento');
    const fechada = page
      .getByTestId(/^atendimento-\d+$/)
      .filter({ hasText: 'ANTÔNIO' })
      .first();
    const regFechada = Number((await fechada.getAttribute('data-testid'))?.replace('atendimento-', ''));
    await page.goto(`/recepcao/atendimento/${regFechada}/corrigir`);
    await expect(page.getByTestId('tela-corrigir-ficha')).toBeVisible();
    await escolher(page.getByLabel('Convênio', { exact: true }), '320');
    await page.getByTestId('botao-revisar-correcao').click();
    await page
      .getByTestId('dialogo-correcao')
      .getByLabel(/Justificativa/)
      .fill('Convênio escolhido errado na abertura (teste E2E)');
    await page.getByTestId('botao-gravar-correcao').click();
    await expect(page.getByText(/faturamento/i).first()).toBeVisible();
    await expect(page.getByTestId('ficha-corrigida')).toHaveCount(0);

    // O supervisor exclui a ficha do agendamento; a marcação volta a não atendida e abre de novo.
    await entrar(page, 'SINT.SUPERVISOR.ATD');
    await excluirFicha(page, reg, true);
    await entrar(page, 'SINT.ATENDIMENTO');
    await page.goto('/recepcao/atendimento/novo?marcacao=880002');
    await expect(page.getByTestId('abrir-atd-do-agendamento')).toContainText('08:00');
    await expect(page.getByTestId('abrir-atd-paciente-escolhido')).toContainText('LETÍCIA ROCHA');
    await expect(page.getByTestId('tela-impressos')).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('fichas a imprimir: a manutenção é a tela das regras de impressão, aberta pelo atalho; axe', async ({
    page,
  }) => {
    // 02-REC linha 35: os modelos de ficha e as regras por fonte pagadora, especialidade, grupo e unidade saíram do
    // CRUD genérico para a tela própria. A manutenção exige o banco do cliente e o E2E roda com a fonte sintética, por
    // isso a leitura é simulada (massa SINTÉTICA); a gravação e a conferência estão em f32-regras-impressao.spec.ts e o
    // efeito no banco em apps/api/src/modulos/atendimento/regras-impressao.int.spec.ts.
    const externas = vigiarExternas(page);
    await page.route('**/api/atendimento/regras-impressao**', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          estabelecimento: 7,
          modelos: [
            {
              id: 901,
              versao: 1,
              codigo: 'FICHA',
              titulo: 'FICHA SINTETICA',
              tipoDocumento: 'ficha_ambulatorial',
              conteudo: 'Texto sintético.',
              copias: 1,
              ordem: 1,
              somenteRetorno: false,
              idadeMinima: null,
              idadeMaxima: null,
              ativo: true,
              regrasAtivas: 1,
            },
          ],
          regras: [
            {
              id: 801,
              versao: 1,
              modelo: 901,
              estabelecimento: 7,
              categoria: null,
              fontePagadora: null,
              especialidade: null,
              grupo: null,
              unidade: null,
              clinica: null,
              copias: null,
              selecionada: true,
              ativo: true,
            },
          ],
          opcoes: { categorias: [], fontes: [], especialidades: [], grupos: [], unidades: [] },
        }),
      }),
    );
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/recepcao/atendimento');
    await page.getByTestId('link-regras-impressao').click();
    await expect(page).toHaveURL(/\/recepcao\/atendimento\/regras-impressao$/);
    await expect(page.getByTestId('tela-regras-impressao')).toBeVisible();
    await semFaixaDeConsulta(page);
    await expect(page.getByTestId('modelo-901')).toContainText('FICHA SINTETICA');
    await expect(page.getByTestId('regra-801')).toContainText('Todo atendimento');
    await expect(page.getByTestId('conferir-impressao').getByTestId('conferir-fichas')).toContainText(
      'FICHA SINTETICA: 1 cópia(s)',
    );
    await semViolacaoAxe(page, '/recepcao/atendimento/regras-impressao (pelo atalho)');
    expect(externas).toEqual([]);
  });

  test('locais de observação: incluir e excluir o local sem leito; axe', async ({ page }) => {
    const externas = vigiarExternas(page);
    // Os locais de observação são do PA (opções dos leitos de observação no grupo do médico do PA).
    await entrar(page, 'SINT.MEDICO.PA');
    await page.goto('/cadastros/dominios/atendimento/localObservacao');
    await expect(page.getByRole('heading', { level: 1, name: 'Locais de observação' })).toBeVisible();
    await semFaixaDeConsulta(page);
    await page.getByTestId('botao-incluir').click();
    const form = page.getByTestId('form-dominio');
    await form.getByLabel('Sigla', { exact: true }).fill('E2E');
    await form.getByLabel('Nome', { exact: true }).fill('OBSERVACAO E2E');
    await form.getByLabel('Cor no mapa').fill('AZUL');
    await completarFormulario(form);
    await semViolacaoAxe(page, 'inclusão do local de observação');
    await form.getByTestId('botao-salvar').click();
    await expect(page.getByTestId('mensagem-dominio')).toContainText('Incluído');
    const tabela = page.getByTestId('tabela-dominio');
    await excluirLinha(
      page,
      tabela.locator('tbody tr', { hasText: 'OBSERVACAO E2E' }),
      'Incluído por engano (teste E2E)',
    );
    await expect(page.getByTestId('mensagem-dominio')).toContainText('excluído');
    await expect(tabela.locator('tbody tr', { hasText: 'OBSERVACAO E2E' })).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
