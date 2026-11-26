// E2E @C1-096 (03-PEP linha 146): reuso de dialisadores da hemodiálise pelas rotas reais do módulo (o
// DialisadorController registrado no modulo.ts das sessões). A enfermagem abre a tela pelo menu (Agenda > Reuso de
// dialisadores). A porta grava só no banco próprio: na sessão sintética de dev/ci (logins SINT.*, sem o núcleo),
// GET /api/sessoes/dialisadores/em-uso responde 503 e a tela mostra o erro sem inventar lista (primeiro teste). O
// segundo simula as rotas (page.route com respostas sintéticas) e percorre o reprocessamento pela tela: a conferência
// na hora (sem volume e sem testes não grava), a prévia do volume abaixo de 80% (descarte anunciado), a liberação com
// 95% e os testes certos, o corpo do POST conferido, e a visão por paciente com o histórico e o cancelamento com
// motivo. O efeito no MariaDB está em apps/api/src/modulos/sessoes/dialisador-propria.int.spec.ts. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const D = '/api/sessoes/dialisadores';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const dialisador = (x: Record<string, unknown> = {}) => ({
  id: 71,
  paciente: 1001,
  pacienteNome: 'PACIENTE SINTETICO 1 TESTE',
  prontuario: 9001,
  identificacao: 'DIAL-SINT-1',
  insumo: null,
  modelo: null,
  metodo: 'automatizado',
  volumeInicialMl: 100,
  limiteReusos: 20,
  reusosRealizados: 3,
  abertoEm: '2026-11-01T08:00',
  fechadoEm: null,
  situacao: 'em_uso',
  motivo: null,
  versao: 4,
  reprocessamentos: [] as unknown[],
  ...x,
});

test.describe('@C1-096 Reuso de dialisadores na hemodiálise', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('pelo menu; sem o banco do cliente, a tela mostra o erro; axe', async ({ page }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.ENF.PLANTAO');
    const leitura = page.waitForResponse((r) => r.url().endsWith(`${D}/em-uso`));
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    // Área > grupo > item: a Agenda fica dentro de "Atendimento ao paciente", que começa fechada. Um grupo com um
    // item só sobe o item para o nível de cima (filtro-menu, concluir): a enfermagem do plantão vê só o reuso na
    // Agenda, e o link aparece direto na área; com mais itens visíveis, o grupo Agenda é aberto antes.
    await menu.getByRole('button', { name: /^Atendimento ao paciente/ }).click();
    const grupoAgenda = menu.getByRole('button', { name: /^Agenda/ });
    if ((await grupoAgenda.count()) > 0) await grupoAgenda.click();
    await menu.getByRole('link', { name: 'Reuso de dialisadores' }).click();
    await expect(page).toHaveURL(/\/agenda\/sessoes\/dialisadores/);
    const tela = page.getByTestId('tela-dialisadores');
    await expect(tela).toBeVisible();
    const status = (await leitura).status();
    if (status === 503) await expect(tela.getByTestId('dialisadores-em-uso')).toHaveCount(0);
    else expect(status).toBe(200);
    await semViolacaoAxe(page, '/agenda/sessoes/dialisadores');
  });

  test('reprocessamento com a API simulada: conferência na hora, prévia, liberação, histórico e cancelamento; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const corpos: { url: string; corpo: Record<string, unknown> }[] = [];
    const json = (rota: Route, corpo: unknown, status = 200) =>
      rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    let atual = dialisador();
    await page.route(`**${D}/**`, async (rota) => {
      const req = rota.request();
      const url = new URL(req.url()).pathname;
      if (req.method() === 'GET') {
        if (url.endsWith('/em-uso')) return json(rota, { itens: atual.situacao === 'em_uso' ? [atual] : [] });
        if (url.includes('/pacientes/')) return json(rota, { itens: [atual] });
      }
      corpos.push({ url, corpo: req.postDataJSON() as Record<string, unknown> });
      if (url.endsWith('/reprocessamentos')) {
        atual = dialisador({
          reusosRealizados: 4,
          versao: 5,
          reprocessamentos: [
            {
              id: 501,
              sequencia: 4,
              reprocessadoEm: '2026-11-25T07:00',
              volumeInicialMl: 100,
              volumeAtualMl: 95,
              testePreEnxague: 'positivo',
              testePosEnxague: 'negativo',
              metodo: 'automatizado',
              agente: null,
              linhasDescartadas: true,
              aprovado: true,
              responsavel: 'PROFISSIONAL SINTETICO',
              observacao: null,
              situacao: 'valido',
              motivoCancelamento: null,
              versao: 1,
            },
          ],
        });
        return json(
          rota,
          {
            id: 501,
            sequencia: 4,
            aprovado: true,
            descartado: false,
            ultimoReuso: false,
            reusosRealizados: 4,
            reprovacoes: [],
          },
          201,
        );
      }
      if (url.endsWith('/cancelamento')) return json(rota, { id: 501 });
      return json(rota, { id: atual.id });
    });

    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto('/agenda/sessoes/dialisadores');
    const tela = page.getByTestId('tela-dialisadores');
    await expect(tela.getByTestId('dialisadores-em-uso')).toContainText('DIAL-SINT-1');
    await expect(tela.getByTestId('dialisadores-em-uso')).toContainText('3 / 20');
    await tela.getByTestId('reprocessar-71').click();
    const f = tela.getByTestId('form-reprocessamento');

    // Conferência na hora: sem volume e sem os testes, nada sai.
    await f.getByTestId('reprocessamento-gravar').click();
    await expect(f).toContainText('volume interno atual');
    expect(corpos).toHaveLength(0);

    // Volume a 70% do inicial: a prévia anuncia o descarte antes de gravar.
    await f.getByLabel('Volume interno atual (ml)').fill('70');
    await expect(f.getByTestId('reprocessamento-previa')).toContainText('70%');
    await expect(f.getByTestId('reprocessamento-previa')).toContainText('será descartado');

    // 95% e os testes certos: liberado.
    await f.getByLabel('Volume interno atual (ml)').fill('95');
    await escolher(f.getByLabel('Desinfetante antes do enxágue'), { rotulo: 'Presente' });
    await escolher(f.getByLabel('Desinfetante depois do enxágue'), { rotulo: 'Ausente' });
    await expect(f.getByTestId('reprocessamento-previa')).toContainText('liberado para o próximo uso');
    await semViolacaoAxe(page, '/agenda/sessoes/dialisadores (reprocessamento)');
    await f.getByTestId('reprocessamento-gravar').click();
    await expect(tela.getByTestId('dialisador-mensagem')).toContainText('Reprocessamento 4 registrado');
    expect(corpos[0]).toMatchObject({
      url: `${D}/71/reprocessamentos`,
      corpo: {
        metodo: 'automatizado',
        volumeAtualMl: 95,
        testePreEnxague: 'positivo',
        testePosEnxague: 'negativo',
        linhasDescartadas: true,
        versao: 4,
      },
    });

    // Visão por paciente: o histórico e o cancelamento do último com motivo.
    await tela.getByTestId('ver-paciente-71').click();
    await expect(page).toHaveURL(/paciente=1001/);
    const pac = tela.getByTestId('dialisadores-do-paciente');
    await expect(pac.getByTestId('reprocessamentos-71')).toContainText('Liberado');
    await pac.getByTestId('cancelar-reprocessamento-501').click();
    const m = tela.getByTestId('form-motivo');
    await m.getByLabel('Motivo').fill('abc');
    await expect(m.getByTestId('motivo-confirmar')).toBeDisabled();
    await m.getByLabel('Motivo').fill('Lançado no dialisador errado');
    await m.getByTestId('motivo-confirmar').click();
    await expect(tela.getByTestId('dialisador-mensagem')).toContainText('Reprocessamento cancelado');
    expect(corpos[1]).toMatchObject({
      url: `${D}/reprocessamentos/501/cancelamento`,
      corpo: { motivo: 'Lançado no dialisador errado', versao: 1 },
    });
  });
});
