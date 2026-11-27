// E2E @C2-074 (08-SGO L113): o lado interno da operadora no portal do prestador, com respostas simuladas (fonte
// sintética; a porta própria tem o contrato de efeito na integração). O gestor da operadora (SINT.OPERADORA, rede
// credenciada: operadora.prestador.ler/editar) vê a fila dos pedidos web, analisa um, recusa outro com o motivo,
// publica e retira um aviso à rede e inclui e inativa uma regra de documento. Nenhuma saída externa.
import { expect, type Page, test } from '@playwright/test';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
async function entrar(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill('SINT.OPERADORA');
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const pedido = (id: number, tipo: string, situacao: string, versao = 1, motivo: string | null = null) => ({
  id,
  numero: `PW${String(id).padStart(8, '0')}`,
  tipo,
  prestador: tipo === 'credenciamento' ? null : 7,
  prestadorNome: tipo === 'credenciamento' ? null : 'Clínica Sintética',
  pessoa: 'juridica',
  nome: tipo === 'credenciamento' ? 'Laboratório Sintético Novo' : 'Clínica Sintética',
  situacao,
  recebidoEm: '2026-11-25T10:00:00',
  analisadoEm: null,
  motivoRecusa: motivo,
  detalhes: null,
  versao,
});
const aviso = (id: number, ativo: boolean, versao = 1) => ({
  id,
  ativo,
  publico: 'prestadores',
  tipo: 'comunicado',
  titulo: id === 3 ? 'Prazo de envio dos lotes' : 'Aviso sintético',
  conteudo: 'Texto sintético.',
  link: null,
  documento: null,
  tipoPrestador: null,
  prestador: null,
  exibirDe: '2026-11-20T00:00:00',
  exibirAte: null,
  destaque: false,
  versao,
});
const regra = (id: number, ativo: boolean, versao = 1) => ({
  id,
  operadora: 1,
  descricao: id === 5 ? 'Alvará sanitário' : 'Certidão sintética',
  tipoPrestador: null,
  natureza: null,
  obrigatorio: true,
  extensoes: 'pdf',
  tamanhoMaximoKb: 2048,
  ativo,
  versao,
});

test('@C2-074 fila dos pedidos web, avisos e regras de documento na operadora', async ({ page }) => {
  let pedidos = [pedido(11, 'endereco', 'recebido'), pedido(12, 'credenciamento', 'recebido')];
  let avisos = [aviso(2, true)];
  let regras = [regra(5, true)];
  const corpos: Record<string, unknown> = {};
  const B = '**/api/operadora/portal-prestador';

  await page.route('**/api/operadora/portal/acessos', (r) =>
    r.fulfill({
      json: {
        itens: [],
        ligada: true,
        motivo: null,
        podeEditar: true,
        funcoes: [],
        tiposAtendimento: [],
        prestadores: [],
        operadoras: [{ id: 1, nome: 'OPERADORA SINTETICA', registroAns: '999999' }],
      },
    }),
  );
  await page.route(`${B}/pedidos**`, (r) => {
    const s = new URL(r.request().url()).searchParams.get('situacao');
    return r.fulfill({ json: { itens: pedidos.filter((p) => !s || p.situacao === s) } });
  });
  await page.route(`${B}/pedidos/*/decisao`, async (r) => {
    const id = Number(/pedidos\/(\d+)\/decisao/.exec(r.request().url())?.[1]);
    const b = r.request().postDataJSON() as { acao: string; motivo: string | null; versao: number };
    corpos[`decisao-${id}`] = b;
    const sit = b.acao === 'analisar' ? 'em_analise' : b.acao === 'aprovar' ? 'aprovado' : 'recusado';
    pedidos = pedidos.map((p) => (p.id === id ? pedido(id, p.tipo, sit, p.versao + 1, b.motivo) : p));
    await r.fulfill({ json: { id, versao: 2 } });
  });
  await page.route(`${B}/avisos/*/retirar`, async (r) => {
    corpos['retirar'] = r.request().postDataJSON();
    avisos = avisos.map((a) => (a.id === 3 ? aviso(3, false, 2) : a));
    await r.fulfill({ json: { id: 3, versao: 2 } });
  });
  await page.route(`${B}/avisos`, async (r) => {
    if (r.request().method() === 'POST') {
      corpos['aviso'] = r.request().postDataJSON();
      avisos = [aviso(3, true), ...avisos];
      await r.fulfill({ json: { id: 3, versao: 1 } });
    } else await r.fulfill({ json: { itens: avisos } });
  });
  await page.route(`${B}/regras-arquivo**`, async (r) => {
    if (r.request().method() === 'POST') {
      corpos['regra'] = r.request().postDataJSON();
      regras = [...regras, regra(6, true)];
      await r.fulfill({ json: { id: 6, versao: 1 } });
    } else await r.fulfill({ json: { itens: regras } });
  });
  await page.route(`${B}/regras-arquivo/*/inativar`, async (r) => {
    corpos['inativar'] = r.request().postDataJSON();
    regras = regras.map((x) => (x.id === 6 ? regra(6, false, 2) : x));
    await r.fulfill({ json: { id: 6, versao: 2 } });
  });

  await entrar(page);
  await page.goto('/operadora/portal-prestador');
  const fila = page.getByTestId('pp-op-fila');
  await expect(fila.getByTestId('pp-op-pedidos')).toContainText('PW00000011', { timeout: 30_000 });
  await expect(fila.getByTestId('pp-op-pedido-12')).toContainText('Novo credenciamento');

  // Analisar o pedido de endereço; recusar o credenciamento com o motivo.
  await fila.getByTestId('pp-op-analisar-11').click();
  await expect(page.getByTestId('pp-op-mensagem')).toContainText('PW00000011: Em análise');
  expect(corpos['decisao-11']).toMatchObject({ acao: 'analisar', versao: 1, motivo: null });
  await fila.getByTestId('pp-op-recusar-12').click();
  await expect(fila.getByTestId('pp-op-confirmar-recusa')).toBeDisabled();
  await page.locator('#pp-op-motivo').fill('Documentação incompleta');
  await fila.getByTestId('pp-op-confirmar-recusa').click();
  await expect(page.getByTestId('pp-op-mensagem')).toContainText('PW00000012: Recusado');
  expect(corpos['decisao-12']).toMatchObject({ acao: 'recusar', motivo: 'Documentação incompleta' });
  await escolher(fila.getByTestId('pp-op-filtro'), { rotulo: /Recusado/ });
  await expect(fila.getByTestId('pp-op-pedido-12')).toContainText('Documentação incompleta');

  // Publicar um aviso e retirá-lo (fica inativo).
  const av = page.getByTestId('pp-op-avisos');
  await expect(av.getByTestId('pp-op-aviso-2')).toBeVisible();
  await page.locator('#pp-op-aviso-titulo').fill('Prazo de envio dos lotes');
  await page.locator('#pp-op-aviso-conteudo').fill('Os lotes do mês vão até o dia 10.');
  await av.getByTestId('pp-op-publicar').click();
  await expect(av.getByTestId('pp-op-aviso-3')).toContainText('Prazo de envio dos lotes');
  expect(corpos['aviso']).toMatchObject({
    tipo: 'comunicado',
    titulo: 'Prazo de envio dos lotes',
    link: null,
  });
  await av.getByTestId('pp-op-retirar-3').click();
  await expect(av.getByTestId('pp-op-aviso-3')).toContainText('Retirado');
  expect(corpos['retirar']).toEqual({ versao: 1 });

  // Incluir uma regra de documento e inativá-la.
  const rg = page.getByTestId('pp-op-regras');
  await expect(rg.getByTestId('pp-op-regra-5')).toContainText('Alvará sanitário');
  await page.locator('#pp-op-regra-descricao').fill('Certidão sintética');
  await page.locator('#pp-op-regra-extensoes').fill('pdf');
  await rg.getByTestId('pp-op-incluir').click();
  await expect(rg.getByTestId('pp-op-regra-6')).toContainText('Certidão sintética');
  expect(corpos['regra']).toMatchObject({ operadora: 1, descricao: 'Certidão sintética', extensoes: 'pdf' });
  await rg.getByTestId('pp-op-inativar-6').click();
  await expect(rg.getByTestId('pp-op-regra-6')).toContainText('Retirado');
  expect(corpos['inativar']).toEqual({ versao: 1 });
});
