// E2E @C2-081 (06-FAT linha 27): autorização prévia à operadora pela recepção e pela internação. O faturista chega pelo
// menu (Recepção > Atendimento > Autorização prévia à operadora), abre o paciente e monta a internação a partir da
// carteira: o botão só habilita quando as regras do domínio aceitam (falta o CID da internação, depois aceita);
// envia (a guia eletrônica fica validada e guardada, "pronta para enviar"), registra o canal real da entrega, registra
// a resposta por item (a negativa pede o motivo, conferido na hora) e cobre os itens da conta com a autorização. O
// item da internação (Internação e leitos > Internação > Autorização prévia e prorrogação) abre a mesma tela. As rotas
// /api/tiss/autorizacoes exigem o banco próprio e o E2E roda com a fonte sintética (sem núcleo): as respostas da API
// são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco está em
// apps/api/src/modulos/tiss/autorizacao-previa-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7481;

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

type Estado = 'nada' | 'rascunho' | 'pronta_envio' | 'enviada' | 'autorizada_parcial' | 'coberta';
function visao(estado: Estado) {
  const respondida = estado === 'autorizada_parcial' || estado === 'coberta';
  const pedido = {
    id: 91,
    numero: 'SA000091',
    tipo: 'internacao',
    situacao: estado === 'coberta' ? 'autorizada_parcial' : estado,
    canal: estado === 'rascunho' || estado === 'pronta_envio' ? 'webservice' : 'portal',
    fontePagadora: 'Operadora sintética',
    carteira: '0000555566667777',
    conta: 4410,
    solicitadaEm: '2026-11-25T10:00:00.000Z',
    enviadaEm: estado === 'rascunho' || estado === 'pronta_envio' ? null : '2026-11-25T10:05:00.000Z',
    observacao: null,
    xmlGuardado: estado !== 'rascunho',
    versao: { nada: 1, rascunho: 1, pronta_envio: 2, enviada: 3, autorizada_parcial: 4, coberta: 4 }[estado],
    itensDaContaCobertos: estado === 'coberta' ? 1 : 0,
    diagnosticos: [{ sequencia: 1, principal: true, cid: 'K359', descricao: 'Diagnóstico sintético' }],
    itens: [
      {
        sequencia: 1,
        codigoTabela: '22',
        codigoProcedimento: '31003079',
        descricao: 'Procedimento sintético',
        quantidade: 2,
        quantidadeAutorizada: respondida ? 1 : null,
        opme: false,
      },
    ],
    respostas: respondida
      ? [
          {
            id: 7,
            situacao: 'autorizado_parcial',
            recebidaEm: '2026-11-25T11:00:00.000Z',
            senha: 'SNSINT01',
            numeroGuiaOperadora: 'OPSINT01',
          },
        ]
      : [],
    consultas: [],
  };
  return {
    coberturas: [
      { id: 33, fontePagadora: 'Operadora sintética', carteira: '0000555566667777', validade: '2027-12-31' },
    ],
    pedidos: estado === 'nada' ? [] : [pedido],
  };
}

test.describe('Autorização prévia à operadora @C2-081 @fase7', () => {
  test.setTimeout(180_000);
  test('pedido de internação conferido na hora, guia guardada, entrega, resposta por item e conta coberta; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let estado: Estado = 'nada';
    await page.route('**/api/tiss/autorizacoes**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/tiss\/autorizacoes\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === `pacientes/${PACIENTE}`) return json(rota, visao(estado));
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === '') {
        estado = 'rascunho';
        return json(rota, { id: 91, numero: 'SA000091', liberacao: null }, 201);
      }
      if (caminho === '91/envio') {
        estado = 'pronta_envio';
        return json(rota, { id: 91, situacao: 'pronta_envio', hash: '0'.repeat(32) });
      }
      if (caminho === '91/transmissao') {
        estado = 'enviada';
        return json(rota, { id: 91, situacao: 'enviada' });
      }
      if (caminho === '91/resposta') {
        estado = 'autorizada_parcial';
        return json(rota, { id: 91, situacao: 'autorizada_parcial' });
      }
      if (caminho === '91/conta') {
        estado = 'coberta';
        return json(rota, { id: 91, ligados: 1, semCobertura: 1 });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.FIN.GESTOR');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.locator('#menu-buscar').fill('Autorização prévia à operadora');
    await menu.getByRole('link', { name: 'Autorização prévia à operadora' }).click();
    await expect(page).toHaveURL(/\/faturamento\/autorizacoes/);
    const tela = page.getByTestId('autorizacao-previa');
    await expect(tela).toBeVisible();
    await page.getByTestId('aut-paciente').locator('input').fill(String(PACIENTE));
    await page.getByTestId('aut-abrir').click();
    await expect(page).toHaveURL(new RegExp(`paciente=${PACIENTE}`));
    await esperarSemSelectNativo(tela);

    // Internação montada da carteira: sem o CID, a regra recusa na hora e o botão fica desabilitado.
    await escolher(page.getByTestId('aut-tipo'), { rotulo: 'Internação' });
    await page.getByTestId('aut-solicitante').locator('input').fill('15');
    await page.getByTestId('aut-conta').locator('input').fill('4410');
    await page.getByTestId('aut-diarias').locator('input').fill('2');
    await page.getByTestId('aut-admissao').locator('input').fill('2026-11-26');
    await page.getByTestId('aut-indicacao').locator('input').fill('Indicação sintética');
    const item = page.getByTestId('aut-item-0');
    await item.getByTestId('aut-item-codigo').locator('input').fill('31003079');
    await item.getByTestId('aut-item-descricao').locator('input').fill('Procedimento sintético');
    await item.getByTestId('aut-item-quantidade').locator('input').fill('2');
    await item.getByTestId('aut-item-faturavel').locator('input').fill('501');
    await expect(page.getByTestId('aut-falta')).toContainText('hipótese diagnóstica principal');
    await expect(page.getByTestId('aut-criar')).toBeDisabled();
    await page.getByTestId('aut-cid-0').locator('input').fill('K35.9');
    await expect(page.getByTestId('aut-falta')).toHaveCount(0);
    await semViolacaoAxe(page, '/faturamento/autorizacoes (pedido novo)');
    await page.getByTestId('aut-criar').click();
    await expect(page.getByTestId('aut-aviso')).toHaveText('Pedido SA000091 criado.');
    expect(pedidos[0]!.corpo).toMatchObject({
      tipo: 'internacao',
      cobertura: 33,
      canal: 'webservice',
      conta: 4410,
      solicitanteProfissional: 15,
      regime: 'hospitalar',
      diarias: 2,
      dataAdmissao: '2026-11-26',
      diagnosticos: [{ cid: 'K35.9' }],
      itens: [{ codigoTabela: '22', codigoProcedimento: '31003079', quantidade: 2, itemFaturavel: 501 }],
    });

    const linha = page.getByTestId('aut-pedido-91');
    await expect(linha.getByTestId('aut-situacao')).toHaveText('Rascunho');
    await linha.getByTestId('aut-enviar').click();
    await expect(page.getByTestId('aut-aviso')).toContainText('Guia validada e guardada');
    await expect(linha.getByTestId('aut-xml')).toBeVisible();
    await escolher(linha.getByTestId('aut-entrega'), { rotulo: 'Portal da operadora' });
    await linha.getByTestId('aut-transmitir').click();
    await expect(linha.getByTestId('aut-situacao')).toHaveText('Enviada');

    // Resposta por item: a negativa (zero) pede o motivo, conferido na hora; depois, parcial com a senha.
    const resposta = linha.getByTestId('aut-resposta');
    await resposta.getByTestId('aut-senha').locator('input').fill('SNSINT01');
    await resposta.getByTestId('aut-guia-operadora').locator('input').fill('OPSINT01');
    await resposta.getByTestId('aut-qtd-1').locator('input').fill('0');
    await expect(resposta.getByTestId('aut-falta-resposta')).toContainText('motivo');
    await expect(resposta.getByTestId('aut-responder')).toBeDisabled();
    await resposta.getByTestId('aut-qtd-1').locator('input').fill('1');
    await expect(resposta.getByTestId('aut-falta-resposta')).toHaveCount(0);
    await resposta.getByTestId('aut-responder').click();
    await expect(linha.getByTestId('aut-situacao')).toHaveText('Autorizada em parte');

    await linha.getByTestId('aut-ligar-conta').click();
    await expect(page.getByTestId('aut-aviso')).toHaveText(
      '1 item(ns) da conta coberto(s); 1 sem autorização.',
    );
    await expect(linha.getByTestId('aut-cobertos')).toBeVisible();
    expect(pedidos.map((p) => p.caminho)).toEqual([
      '',
      '91/envio',
      '91/transmissao',
      '91/resposta',
      '91/conta',
    ]);
    expect(pedidos[2]!.corpo).toEqual({ versao: 2, canal: 'portal' });
    expect(pedidos[3]!.corpo).toMatchObject({
      senha: 'SNSINT01',
      itens: [{ sequencia: 1, quantidadeAutorizada: 1 }],
    });

    // Pela internação, o item do menu abre a mesma tela.
    await menu.locator('#menu-buscar').fill('Autorização prévia e prorrogação');
    await menu.getByRole('link', { name: 'Autorização prévia e prorrogação' }).click();
    await expect(page).toHaveURL(/\/faturamento\/autorizacoes\?origem=internacao/);
    await expect(page.getByTestId('autorizacao-previa')).toBeVisible();
  });
});
