// E2E @M34 (ficha, seção 10): emitir relatório do catálogo com parâmetro, exportar com justificativa (o relatório sai com
// dado de pessoa), agendar o envio por e-mail (chega ao Mailpit só com o link) e reprocessar a mensagem da fila de mortos;
// e a conferência do retorno do laboratório de apoio pelo responsável técnico. axe sem violação séria. Sessão real sobre
// a fonte sintética de dev (as portas em memória: nada vai à cópia; nomes de pacientes fictícios).
import { expect, test, type Page } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher as escolherNoCombo } from './combos.js';

const SENHA = 'Sintetico#2026';
const MAILPIT = 'http://127.0.0.1:8325';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function escolher(page: Page, testid: string, valor: string): Promise<void> {
  await escolherNoCombo(page.getByTestId(testid), valor);
}

test.describe('Catálogo de relatórios e integrações @M34', () => {
  test('emitir relatório com parâmetro (a diretoria, pelas opções dos relatórios que ele substitui)', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.DIRETORIA');
    await page.goto('/relatorios');
    await expect(page.getByRole('heading', { level: 1, name: 'Catálogo de relatórios' })).toBeVisible();
    await escolher(page, 'catalogo-relatorio', 'atendimentosPorDia');
    await expect(page.getByTestId('catalogo-ficha')).toContainText('Contagem dos atendimentos');
    await page.getByTestId('parametro-inicio').fill('2026-10-01');
    await page.getByTestId('parametro-fim').fill('2026-10-03');
    await page.getByTestId('catalogo-emitir').click();
    await expect(page.getByTestId('catalogo-resultado')).toContainText('6 linha(s)');
    await expect(page.getByTestId('catalogo-grade').locator('tbody tr')).toHaveCount(6);
    await expect(page.getByTestId('catalogo-grade').locator('tfoot')).toContainText('Total');
    // O período acima do máximo é recusado na tela pelo mesmo esquema do servidor.
    await page.getByTestId('parametro-inicio').fill('2024-01-01');
    await expect(page.getByTestId('catalogo-validacao')).toContainText('Período acima do máximo');
    await semViolacaoAxe(page, '/relatorios');
    expect(externas).toEqual([]);
  });

  test('exportar com justificativa: o relatório com dado de pessoa só sai com o motivo', async ({ page }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/relatorios?relatorio=contasNaoFechadas&p.inicio=2026-10-01&p.fim=2026-10-10');
    await expect(page.getByTestId('catalogo-ficha')).toContainText('Contas não emitidas ou não fechadas');
    await page.getByTestId('catalogo-emitir').click();
    await expect(page.getByTestId('catalogo-grade')).toContainText('Paciente Fictício Um');
    await expect(page.getByTestId('catalogo-botao-exportar')).toBeDisabled();
    await page
      .getByLabel('Justificativa da exportação (fica registrada com o arquivo)')
      .fill('Conferência das contas pendentes com o faturamento.');
    const baixando = page.waitForEvent('download');
    await page.getByTestId('catalogo-botao-exportar').click();
    const arquivo = await baixando;
    expect(arquivo.suggestedFilename()).toBe('contasNaoFechadas.csv');
    await expect(page.getByTestId('catalogo-exportado')).toContainText('exportado e registrado');
    await page.getByTestId('catalogo-historico').locator('summary').click();
    await expect(page.getByTestId('catalogo-historico')).toContainText('Exportação');
    await semViolacaoAxe(page, '/relatorios (exportação)');
  });

  test('agendar o envio: o e-mail chega ao Mailpit só com o link do relatório', async ({ page }) => {
    // A espera do Mailpit sozinha vai até 30 s (60 × 500 ms): o teste inteiro precisa de mais que os 30 s padrão.
    test.setTimeout(75_000);
    const inicio = Date.now();
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/relatorios/agendamentos');
    await expect(page.getByRole('heading', { level: 1, name: 'Envio agendado por e-mail' })).toBeVisible();
    await expect(page.getByTestId('agendamento-origem')).toContainText('tentativa(s) sem envio');
    await escolher(page, 'agendamento-relatorio', 'atendimentosPorDia');
    const titulo = `Atendimentos de ontem ${inicio.toString(36)}`;
    await page.getByLabel('Nome do envio').fill(titulo);
    await escolher(page, 'agendamento-parametro-inicio', 'ontem');
    await escolher(page, 'agendamento-parametro-fim', 'ontem');
    await page.getByTestId('agendamento-enderecos').fill('diretoria@sintetico.invalid');
    await page.getByTestId('agendamento-agendar').click();
    await expect(page.getByTestId('agendamento-aviso')).toContainText('Envio agendado. Próximo:');
    const linha = page.getByTestId('tabela-agendamentos').locator('tbody tr', { hasText: titulo });
    await expect(linha).toBeVisible();
    await linha.getByRole('button', { name: 'Enviar agora' }).click();
    await expect(page.getByTestId('agendamento-aviso')).toContainText('Envio posto na fila');
    await semViolacaoAxe(page, '/relatorios/agendamentos');
    // O worker (fila relatorio-<rede>) entrega no Mailpit: o assunto com o título, o corpo com o link e sem anexo.
    let corpo: string | null = null;
    for (let i = 0; i < 60 && !corpo; i++) {
      const r = await page.request.get(`${MAILPIT}/api/v1/messages?limit=50`);
      const lista = (await r.json()) as {
        messages: { ID: string; Subject: string; Created: string; Attachments: number }[];
      };
      const m = lista.messages.find(
        (x) => x.Subject.startsWith(titulo) && new Date(x.Created).getTime() >= inicio - 5_000,
      );
      if (m) {
        expect(m.Attachments).toBe(0);
        corpo = (
          (await (await page.request.get(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string }
        ).Text;
      } else await page.waitForTimeout(500);
    }
    expect(corpo).toContain('/relatorios?');
    expect(corpo).toContain('relatorio=atendimentosPorDia');
    expect(corpo).toContain('não leva o arquivo nem os dados');
  });

  test('reprocessar a mensagem da fila de mortos (o alerta das 4 h, o motivo, auditado)', async ({
    page,
  }) => {
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/admin/integracoes/monitor');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Monitor de filas e reprocessamento' }),
    ).toBeVisible();
    await expect(page.getByTestId('monitor-alerta')).toContainText('há mais de 4 horas sem tratamento');
    await expect(page.getByTestId('monitor-em-uso')).toContainText('OUT_ADT_A04');
    await semViolacaoAxe(page, '/admin/integracoes/monitor');
    const morto = page.getByTestId('tabela-mortos').locator('tbody tr').first();
    await morto.getByRole('button', { name: 'Tratar' }).click();
    await page.getByLabel('Motivo').fill('De-para do exame corrigido no laboratório.');
    await page.getByTestId('morto-confirmar').click();
    await expect(page.getByTestId('monitor-feito')).toContainText('Mensagem tratada: Pendente');
    await expect(page.getByTestId('monitor-alerta')).toHaveCount(0);
    await expect(page.getByText('Nenhuma mensagem na fila de mortos.')).toBeVisible();
  });

  test('o responsável técnico confere o retorno do laboratório de apoio e grava no exame', async ({
    page,
  }) => {
    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/laboratorio/apoio');
    await expect(page.getByRole('heading', { level: 1, name: 'Laboratório de apoio' })).toBeVisible();
    const retorno = page.locator('[data-testid^="retorno-"]').filter({ hasText: 'Protocolo AP-2026-0001' });
    await expect(retorno).toContainText('GLICOSE');
    await expect(retorno).toContainText('70-99');
    await semViolacaoAxe(page, '/sadt/laboratorio/apoio');
    await retorno.getByRole('button', { name: 'Aprovar e gravar no exame' }).click();
    await expect(page.getByTestId('apoio-feito')).toContainText('Resultado gravado no exame 777');
    await expect(page.getByText('Nenhum retorno a conferir.')).toBeVisible();
  });
});
