// E2E @C1-114 (F3.7, 06-FAT linha 22): o protocolo de documentos entre setores pelo caminho da tela
// (/faturamento/protocolos). O faturista abre a tela pelo menu (Faturamento > Contas do paciente); no protocolo novo o
// mesmo setor dos dois lados e o lote sem item são barrados na hora pela regra do domínio (validarProtocolo); o item
// é achado pelo NÚMERO da conta (a busca devolve um só e já o escolhe) e o documento avulso exige a descrição; emitido,
// sai com o corpo certo e já enviado. Quem recebe confere item a item: um recebido e outro recusado com motivo, e a
// situação do lote sai da conferência. As rotas /api/faturamento/protocolos-tramite exigem o banco próprio e o E2E roda
// com a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato do servidor. O
// efeito no banco está no contrato de efeito apps/api/src/modulos/faturamento/auditoria-tramite-propria.int.spec.ts.
// Permissão (C1-114): a tela e as rotas pedem faturamento.tramite.ler e faturamento.tramite.registrar, dadas pelo perfil
// protocolo-documentos (SINT.CONTAS o recebe); a conta das contas sem o perfil (SINT.CONTAS.C10) não chega à tela.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const P = '/api/faturamento/protocolos-tramite';

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

const SETORES = [
  { id: 1, codigo: 'ARQ', descricao: 'Arquivo central sintético', tipo: 'arquivo' },
  { id: 2, codigo: 'FAT', descricao: 'Faturamento sintético', tipo: 'faturamento' },
];

function protocolo(situacao: string) {
  const conferido = situacao !== 'enviado';
  return {
    id: 40,
    numero: 1001,
    conteudo: 'misto',
    prioridade: 'urgente',
    situacao,
    deSetorId: 2,
    paraSetorId: 1,
    emissor: 'SINT.CONTAS',
    recebedor: conferido ? 'SINT.CONTAS' : null,
    emitidoEm: '2026-11-24T10:00:00.000Z',
    enviadoEm: '2026-11-24T10:00:00.000Z',
    recebidoEm: conferido ? '2026-11-24T11:00:00.000Z' : null,
    observacao: null,
    motivoCancelamento: null,
    itens: [
      {
        id: 401,
        sequencia: 1,
        tipo: 'conta',
        alvoId: 5501,
        rotulo: 'Conta 5501 sintética',
        recebido: conferido,
        recusado: false,
        motivoRecusa: null,
      },
      {
        id: 402,
        sequencia: 2,
        tipo: 'documento',
        alvoId: null,
        rotulo: 'Guia sintética',
        recebido: false,
        recusado: conferido,
        motivoRecusa: conferido ? 'Faltou a assinatura' : null,
      },
    ],
  };
}

/** O estado simulado do servidor: a lista dos protocolos, a busca pelo número e as gravações. */
function simular(page: Page) {
  const st = {
    situacao: 'enviado',
    corpos: [] as { rota: string; corpo: Record<string, unknown> }[],
  };
  return {
    st,
    ligar: () =>
      page.route(`**${P}**`, (rota) => {
        const req = rota.request();
        const url = new URL(req.url());
        const caminho = url.pathname.replace(P, '');
        if (req.method() === 'GET') {
          if (caminho === '/alvos') {
            const achou =
              url.searchParams.get('tipo') === 'conta' && url.searchParams.get('numero') === '5501';
            return json(rota, {
              itens: achou ? [{ id: 5501, tipo: 'conta', rotulo: 'Conta 5501 sintética' }] : [],
            });
          }
          if (caminho === '' || caminho === '/')
            return json(rota, { setores: SETORES, protocolos: [protocolo(st.situacao)] });
          return rota.fallback();
        }
        st.corpos.push({ rota: caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
        if (caminho === '') return json(rota, { id: 41, numero: 1002, situacao: 'enviado' }, 201);
        if (caminho === '/40/conferencia') {
          st.situacao = 'recebido';
          return json(rota, { id: 40, situacao: 'recebido' });
        }
        return json(rota, { codigo: 'nao-simulado' }, 500);
      }),
  };
}

test.describe('@C1-114 Protocolo de documentos entre setores @fase3', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('pelo menu: Faturamento > Contas do paciente > Protocolo de documentos entre setores; axe', async ({
    page,
  }) => {
    const s = simular(page);
    await s.ligar();
    await entrar(page, 'SINT.CONTAS');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    // A busca do menu abre o ramo inteiro do item achado (Faturamento > Contas do paciente).
    await menu.locator('#menu-buscar').fill('Protocolo de documentos');
    await menu.getByRole('link', { name: 'Protocolo de documentos entre setores' }).click();
    await expect(page).toHaveURL(/\/faturamento\/protocolos$/);
    await expect(page.getByTestId('protocolos-tramite')).toBeVisible();
    await expect(page.getByTestId('prot-1001')).toBeVisible();
    await semViolacaoAxe(page, '/faturamento/protocolos');
  });

  test('emite pelo número da conta com a validação na hora e confere item a item com recusa motivada; axe', async ({
    page,
  }) => {
    const s = simular(page);
    await s.ligar();
    await entrar(page, 'SINT.CONTAS');
    await page.goto('/faturamento/protocolos');
    const form = page.getByTestId('prot-form');
    await expect(form).toBeVisible();

    // Sem setores nem itens: barrado na hora, nada gravado.
    await expect(form).toContainText('O setor de destino é o mesmo de origem.');
    await expect(page.getByTestId('prot-emitir')).toBeDisabled();
    await escolher(page.getByTestId('prot-de'), { rotulo: 'Faturamento sintético' });
    await escolher(page.getByTestId('prot-para'), { rotulo: 'Faturamento sintético' });
    await expect(form).toContainText('O setor de destino é o mesmo de origem.');
    await escolher(page.getByTestId('prot-para'), { rotulo: 'Arquivo central sintético' });
    await expect(form).not.toContainText('O setor de destino é o mesmo de origem.');
    await expect(page.getByTestId('prot-emitir')).toBeDisabled(); // ainda sem item

    // Item 1: a conta pelo número; a busca devolve uma só e já a escolhe.
    await page.getByTestId('prot-incluir').click();
    const item0 = page.getByTestId('prot-item-0');
    await expect(item0).toContainText('Escolha o item a enviar.');
    await page.getByTestId('prot-item-0-numero').fill('9999');
    await page.getByTestId('prot-item-0-numero').press('Enter');
    await expect(item0).toContainText('Nada encontrado com esse número neste estabelecimento.');
    await page.getByTestId('prot-item-0-numero').fill('5501');
    await page.getByTestId('prot-item-0-numero').press('Enter');
    await expect(page.getByTestId('prot-item-0-alvo')).toContainText('Conta 5501 sintética');
    await expect(item0).not.toContainText('Escolha o item a enviar.');

    // Item 2: documento avulso exige a descrição.
    await page.getByTestId('prot-incluir').click();
    await escolher(page.getByTestId('prot-item-1-tipo'), { rotulo: 'Documento' });
    const item1 = page.getByTestId('prot-item-1');
    await expect(item1).toContainText('Descreva o documento avulso.');
    await expect(page.getByTestId('prot-emitir')).toBeDisabled();
    await page.getByTestId('prot-item-1-descricao').fill('Guia sintética');
    await expect(item1).not.toContainText('Descreva o documento avulso.');
    expect(s.st.corpos).toHaveLength(0);
    await semViolacaoAxe(page, '/faturamento/protocolos (protocolo novo)');

    await page.getByTestId('prot-emitir').click();
    await expect(page.getByRole('status')).toHaveText('Gravado.');
    expect(s.st.corpos[0]).toEqual({
      rota: '',
      corpo: {
        remetenteId: 2,
        destinatarioId: 1,
        prioridade: 'normal',
        enviarJa: true,
        itens: [
          { tipo: 'conta', alvoId: 5501, descricao: null },
          { tipo: 'documento', alvoId: null, descricao: 'Guia sintética' },
        ],
      },
    });
    await expect(page.getByTestId('prot-item-0')).toHaveCount(0);

    // Recebimento: o item da conta chegou; o documento é recusado com motivo (sem motivo, o envio não sai).
    const lote = page.getByTestId('prot-1001');
    await expect(lote).toContainText('Enviado');
    await page.getByTestId('prot-conferir-1001').click();
    const conf = page.getByTestId('prot-form-conferencia');
    await expect(conf).toBeVisible();
    await conf.getByRole('group', { name: 'Guia sintética' }).getByLabel('Recusar').check();
    await page.getByTestId('prot-confirmar').click();
    expect(s.st.corpos).toHaveLength(1);
    await conf.getByPlaceholder('Motivo da recusa').fill('Faltou a assinatura');
    await semViolacaoAxe(page, '/faturamento/protocolos (conferência)');
    await page.getByTestId('prot-confirmar').click();
    await expect(conf).toHaveCount(0);
    expect(s.st.corpos[1]).toEqual({
      rota: '/40/conferencia',
      corpo: {
        itens: [
          { itemId: 401, recebido: true, motivoRecusa: null },
          { itemId: 402, recebido: false, motivoRecusa: 'Faltou a assinatura' },
        ],
      },
    });
    await expect(lote).toContainText('Recebido');
    await expect(lote).toContainText('Recusar: Faltou a assinatura');
    await expect(page.getByTestId('prot-conferir-1001')).toHaveCount(0);
  });

  test('sem o perfil de protocolo de documentos: nem o item do menu nem a tela', async ({ page }) => {
    const s = simular(page);
    await s.ligar();
    await entrar(page, 'SINT.CONTAS.C10');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.locator('#menu-buscar').fill('Protocolo de documentos');
    await expect(menu.getByRole('link', { name: 'Protocolo de documentos entre setores' })).toHaveCount(0);
    await page.goto('/faturamento/protocolos');
    await expect(page).toHaveURL(/sem-permissao/);
    await expect(page.getByTestId('protocolos-tramite')).toHaveCount(0);
    expect(s.st.corpos).toHaveLength(0);
  });
});
