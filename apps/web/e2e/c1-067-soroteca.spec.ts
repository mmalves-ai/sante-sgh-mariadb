// E2E @C1-067 (F8, 05-SADT linha 9): a aba Soroteca da tela /sadt/amostras. A equipe do laboratório lê a etiqueta e
// vê na hora o prazo de descarte pela regra; escolhe o equipamento e o rack em SanteSelecao e a posição livre já vem
// sugerida (a posição manual ocupada é avisada antes de gravar); guarda; retira com motivo; e expurga a vencida do dia
// com o motivo de prazo vencido. As rotas /api/sadt/soroteca exigem o banco próprio e o E2E roda com a fonte sintética
// (sem núcleo): as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco (posição, prazo,
// movimentos, expurgo que não apaga, trilha) está em apps/api/src/modulos/sadt/aplicacao/soroteca.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const HOJE = '2026-03-15';
const CODIGO = 'SINT0000001';

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

const guarda = (p: Record<string, unknown>) => ({
  id: 81,
  amostra: 71,
  codigo: CODIGO,
  paciente: 61,
  equipamento: 11,
  equipamentoDescricao: 'GELADEIRA SINTETICA',
  suporte: 21,
  suporteCodigo: 'RACK-S1',
  tipoMaterial: 'soro',
  prateleira: 1,
  linha: 1,
  coluna: 2,
  guardadoEm: `${HOJE}T10:00:00.000Z`,
  descartePrevistoEm: '2026-04-14',
  situacao: 'guardada',
  retiradoEm: null,
  descartadoEm: null,
  ...p,
});

const vencida = guarda({
  id: 82,
  amostra: 72,
  codigo: 'SINT0000002',
  linha: 1,
  coluna: 1,
  descartePrevistoEm: '2026-03-14',
});

const painel = () => ({
  hoje: HOJE,
  equipamentos: [
    {
      id: 11,
      codigo: 'GEL-S1',
      descricao: 'GELADEIRA SINTETICA',
      tipo: 'geladeira',
      temperaturaMinima: 2,
      temperaturaMaxima: 8,
      ativo: true,
      guardadas: 1,
    },
  ],
  suportes: [
    {
      id: 21,
      equipamento: 11,
      codigo: 'RACK-S1',
      descricao: 'RACK SINTETICO',
      tipo: 'rack',
      prateleira: 1,
      quantidadeLinhas: 2,
      quantidadeColunas: 2,
      ativo: true,
      ocupadas: [{ linha: 1, coluna: 1 }],
      sugerida: { linha: 1, coluna: 2 },
    },
  ],
  regras: [
    {
      id: 31,
      descricao: 'SOROLOGIA SINTETICA',
      abrangencia: 'exame',
      exame: 501,
      comparador: null,
      valorTexto: null,
      fontePagadora: null,
      diasGuarda: 30,
      prioridade: 1,
      ativo: true,
    },
  ],
  motivos: [
    { id: 41, codigo: 'RET', descricao: 'RETESTE SINTETICO', finalidade: 'reteste', definitiva: false },
    {
      id: 42,
      codigo: 'VEN',
      descricao: 'PRAZO VENCIDO SINTETICO',
      finalidade: 'prazo_vencido',
      definitiva: true,
    },
  ],
  guardas: [vencida],
  vencidas: [vencida],
});

test.describe('Soroteca @C1-067 @fase8', () => {
  test.setTimeout(180_000);
  test('prazo na hora, posição sugerida, guarda, retirada com motivo e expurgo da vencida; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let guardada = false;
    await page.route('**/api/sadt/catalogo/opcoes**', (rota) =>
      json(rota, { exames: [{ id: 501, nome: 'SOROLOGIA SINTETICA' }], setores: [], analitos: [] }),
    );
    await page.route('**/api/sadt/soroteca**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/sadt\/soroteca\/?/, '');
      if (req.method() === 'GET' && caminho === '') return json(rota, painel());
      if (req.method() === 'GET' && caminho.startsWith('amostras/'))
        return json(rota, {
          id: 71,
          codigo: CODIGO,
          situacao: 'recebida',
          guardas: guardada ? [guarda({})] : [],
          movimentos: guardada
            ? [
                {
                  guarda: 81,
                  tipo: 'entrada',
                  em: `${HOJE}T10:00:00.000Z`,
                  linha: 1,
                  coluna: 2,
                  motivo: null,
                  por: 'USUARIO SINTETICO',
                  observacao: null,
                },
              ]
            : [],
          doPaciente: [],
          prazo: { regra: 31, dias: 30, descarteSeGuardarHoje: '2026-04-14' },
        });
      const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      pedidos.push({ caminho, corpo });
      if (caminho === 'guardas') {
        guardada = true;
        return json(rota, { id: 81 });
      }
      if (caminho === 'guardas/81/retirar') return json(rota, { id: 81 });
      if (caminho === 'expurgo') return json(rota, { id: 82, descartadas: 1 });
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.LABORATORIO');
    await page.goto('/sadt/amostras');
    await page.getByTestId('amostras-aba-soroteca').click();
    await expect(page.getByTestId('soroteca')).toBeVisible();
    await semViolacaoAxe(page, '/sadt/amostras (soroteca)');

    // Leitura da etiqueta: o prazo de descarte pela regra aparece antes de guardar.
    await page.getByTestId('soroteca-codigo').fill(CODIGO);
    await page.getByTestId('soroteca-ler').click();
    await expect(page.getByTestId('soroteca-prazo')).toContainText('2026-04-14');
    const guardar = page.getByTestId('soroteca-guardar');
    await expect(guardar).toBeDisabled();
    await escolher(page.getByTestId('soroteca-equipamento'), { rotulo: /GELADEIRA SINTETICA/ });
    await escolher(page.getByTestId('soroteca-suporte'), { rotulo: /RACK SINTETICO/ });
    await expect(page.getByTestId('soroteca-sugerida')).toContainText('linha 1, coluna 2');
    // Posição manual ocupada: aviso na hora e botão travado, sem ir ao servidor.
    await page.getByText('Outra posição (opcional)').click();
    await page.getByTestId('soroteca-linha').fill('1');
    await page.getByTestId('soroteca-coluna').fill('1');
    await expect(page.getByTestId('soroteca-aviso-posicao')).toBeVisible();
    await expect(guardar).toBeDisabled();
    await page.getByTestId('soroteca-linha').fill('');
    await page.getByTestId('soroteca-coluna').fill('');
    expect(pedidos).toHaveLength(0);
    await guardar.click();
    await expect(page.getByTestId('soroteca-mensagem')).toBeVisible();
    expect(pedidos[0]).toMatchObject({
      caminho: 'guardas',
      corpo: {
        codigo: CODIGO,
        equipamento: 11,
        suporte: 21,
        tipoMaterial: 'soro',
        linha: null,
        coluna: null,
      },
    });
    await expect(page.getByTestId('soroteca-guarda-atual')).toContainText('RACK-S1');
    await expect(page.getByTestId('soroteca-historico')).toContainText('USUARIO SINTETICO');

    // Retirada: só com o motivo.
    const retirar = page.getByTestId('soroteca-retirar');
    await expect(retirar).toBeDisabled();
    await escolher(page.getByTestId('soroteca-motivo-retirada'), { rotulo: 'RETESTE SINTETICO' });
    await retirar.click();
    await expect.poll(() => pedidos.map((p) => p.caminho)).toContain('guardas/81/retirar');
    expect(pedidos.find((p) => p.caminho === 'guardas/81/retirar')?.corpo).toMatchObject({ motivo: 41 });

    // Expurgo da vencida: só os motivos de prazo vencido ou descarte; marca e confirma.
    const expurgar = page.getByTestId('soroteca-expurgar');
    await expect(expurgar).toBeDisabled();
    await page.getByTestId('soroteca-vencida-SINT0000002').check();
    await escolher(page.getByTestId('soroteca-motivo-expurgo'), { rotulo: 'PRAZO VENCIDO SINTETICO' });
    await expurgar.click();
    await expect(page.getByTestId('soroteca-mensagem')).toContainText('1 amostra(s) descartada(s)');
    expect(pedidos.find((p) => p.caminho === 'expurgo')?.corpo).toMatchObject({ guardas: [82], motivo: 42 });
  });
});
