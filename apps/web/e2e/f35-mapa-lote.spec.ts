// E2E @F3.5-05 (F3.5, 05-SADT linha 8): mapa de trabalho da bancada em /sadt/mapa-trabalho. O biomédico vê os exames
// da bancada com o urgente na frente, retém um exame com o motivo na própria linha (o botão só libera com o motivo) e
// o devolve à fila; abre o lote de trabalho com um clique (os exames na ordem do suporte, com a posição), imprime e
// fecha o lote, sem sair da tela. As rotas de retenção e de lote exigem o banco próprio e o E2E roda com a fonte
// sintética (sem núcleo): as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco (lote,
// sequência, posição, analista, trilha, retido fora do lote, pendente de volta à fila) está em
// apps/api/src/modulos/sadt/aplicacao/lote-trabalho.int.spec.ts e mapa-trabalho.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const exame = (id: number, nome: string, paciente: string, urgente: boolean) => ({
  id,
  chave: String(id),
  versao: null,
  paciente: {
    id: id + 1000,
    prontuario: id + 2000,
    nome: paciente,
    sexo: 'F',
    idadeAnos: 40,
    nascimento: null,
  },
  atendimento: { cabecalho: 'ATENDIMENTO SINTETICO', reg: id + 3000, tipo: 'E', unidade: null, leito: null },
  setor: 'laboratorio',
  ato: 1,
  atoRotulo: 'Exame de laboratório',
  exame: { id: 501, codigo: 'SINT', nome },
  estado: 'recebido',
  estadoRotulo: 'Recebido',
  urgente,
  origem: 'outro',
  solicitante: 'MEDICO SINTETICO',
  pedidoEm: null,
  previsaoColeta: null,
  material: null,
  recipiente: null,
  especialidade: null,
  amostra: null,
  critico: false,
});

const BANCADA = 71;
const URGENTE = exame(11, 'POTASSIO SINTETICO', 'PACIENTE SINTETICO URGENTE', true);
const ROTINA = exame(12, 'SODIO SINTETICO', 'PACIENTE SINTETICO ROTINA', false);

test.describe('Mapa de trabalho: retenção e lote da bancada @F3.5-05 @fase3', () => {
  test.setTimeout(180_000);
  test('retém com motivo, devolve à fila, abre o lote na ordem do suporte, imprime e fecha; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let retido: string | null = null;
    let lote: Record<string, unknown> | null = null;
    const itemLote = (e: typeof URGENTE, sequencia: number, situacao: string) => ({
      id: 900 + sequencia,
      exame: e.id,
      sequencia,
      posicaoSuporte: String(sequencia).padStart(3, '0'),
      situacao,
      motivo: null,
      exameNome: e.exame.nome,
      paciente: e.paciente.nome,
      amostra: null,
      urgente: e.urgente,
    });

    await page.route('**/api/sadt/mapa-trabalho**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/mapa-trabalho\/?/, '');
      if (req.method() === 'GET')
        return json(rota, {
          setor: 'laboratorio',
          bancadas: [
            {
              codigo: BANCADA,
              nome: 'BANCADA SINTETICA',
              urgentes: 1,
              limite: 2,
              lotes: 1,
              exames: retido === null ? [URGENTE, ROTINA] : [URGENTE],
              retidos: retido === null ? [] : [{ ...ROTINA, motivo: retido }],
            },
          ],
          cortada: false,
        });
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      retido = caminho === 'reter' ? String(corpo['motivo']) : null;
      return json(rota, {
        id: 801,
        exame: Number(corpo['exame']),
        lote: 'LT-7',
        situacao: caminho === 'reter' ? 'retido' : 'pendente',
      });
    });
    await page.route('**/api/sadt/lotes-trabalho**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/lotes-trabalho\/?/, '');
      if (req.method() === 'GET') return json(rota, { lotes: lote ? [lote] : [] });
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho: `lote/${caminho}`, corpo });
      if (caminho === 'abrir')
        lote = {
          id: 61,
          numero: 'LT-8',
          bancada: BANCADA,
          bancadaNome: 'BANCADA SINTETICA',
          data: '2026-03-15',
          situacao: 'aberto',
          analista: 5,
          analistaNome: 'ANALISTA SINTETICO',
          abertoEm: '2026-03-15T12:00:00.000Z',
          fechadoEm: null,
          impressoEm: null,
          itens: [itemLote(URGENTE, 1, 'pendente'), itemLote(ROTINA, 2, 'pendente')],
        };
      else if (caminho === 'imprimir') lote = { ...lote, impressoEm: '2026-03-15T12:05:00.000Z' };
      else
        lote = {
          ...lote,
          situacao: 'fechado',
          fechadoEm: '2026-03-15T12:30:00.000Z',
          itens: [itemLote(URGENTE, 1, 'processado'), itemLote(ROTINA, 2, 'pendente')],
        };
      return json(rota, lote);
    });
    // A impressão do navegador não abre no teste: só se confere que a tela a pediu.
    await page.addInitScript(() => {
      (window as unknown as { impressoes: number }).impressoes = 0;
      window.print = () => {
        (window as unknown as { impressoes: number }).impressoes += 1;
      };
    });

    await entrar(page, 'SINT.BIOMEDICO');
    await page.goto('/sadt/mapa-trabalho');
    await expect(page.getByTestId('tela-sadt-coleta')).toBeVisible();
    const bancada = page.getByTestId('mapa-bancada');
    await expect(bancada).toHaveCount(1);
    // O urgente vem na frente.
    await expect(bancada.getByTestId('mapa-exame').first()).toContainText('POTASSIO SINTETICO');
    await semViolacaoAxe(page, '/sadt/mapa-trabalho');

    // Reter: o botão só libera com o motivo; o retido perde o link da digitação e mostra o motivo.
    const linhaRotina = bancada.getByTestId('mapa-exame').filter({ hasText: 'SODIO SINTETICO' });
    await expect(linhaRotina.getByTestId('mapa-reter')).toBeDisabled();
    await linhaRotina.getByTestId('mapa-motivo').fill('Amostra hemolisada');
    await linhaRotina.getByTestId('mapa-reter').click();
    await expect(page.getByTestId('coleta-mensagem')).toContainText('LT-7');
    await expect(linhaRotina.getByTestId('mapa-retido')).toContainText('Amostra hemolisada');
    await expect(linhaRotina.getByRole('link')).toHaveCount(0);
    expect(pedidos[0]).toMatchObject({
      caminho: 'reter',
      corpo: { exame: 12, motivo: 'Amostra hemolisada' },
    });

    // Devolver à fila: um clique.
    await linhaRotina.getByTestId('mapa-reter').click();
    await expect(linhaRotina.getByTestId('mapa-retido')).toHaveCount(0);
    await expect(linhaRotina.getByRole('link')).toHaveCount(1);
    expect(pedidos[1]).toMatchObject({ caminho: 'soltar', corpo: { exame: 12 } });

    // Abrir o lote da bancada com um clique: os exames na ordem do suporte, o urgente na posição 001.
    await bancada.getByTestId('lote-abrir').click();
    await expect(bancada.getByTestId('lote-mensagem')).toContainText('LT-8');
    expect(pedidos[2]).toMatchObject({ caminho: 'lote/abrir', corpo: { bancada: BANCADA } });
    const itens = bancada.getByTestId('lote-item');
    await expect(itens).toHaveCount(2);
    await expect(itens.nth(0)).toContainText('001');
    await expect(itens.nth(0)).toContainText('POTASSIO SINTETICO');
    await expect(itens.nth(1)).toContainText('002');
    await expect(bancada.getByTestId('lote')).toContainText('ANALISTA SINTETICO');
    await semViolacaoAxe(page, '/sadt/mapa-trabalho (lote aberto)');

    // Imprimir registra a impressão no servidor e chama a impressão do navegador.
    await bancada.getByTestId('lote-imprimir').click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { impressoes: number }).impressoes))
      .toBe(1);
    expect(pedidos[3]).toMatchObject({ caminho: 'lote/imprimir', corpo: { lote: 61 } });

    // Fechar: o processado fica marcado e o pendente volta à fila; o lote fechado não oferece mais o fechamento.
    await bancada.getByTestId('lote-fechar').click();
    await expect(bancada.getByTestId('lote-mensagem')).toContainText('1 processado(s), 1 de volta à fila');
    expect(pedidos[4]).toMatchObject({ caminho: 'lote/fechar', corpo: { lote: 61 } });
    await expect(bancada.getByTestId('lote-fechar')).toHaveCount(0);
  });
});
