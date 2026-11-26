// E2E @C2-092 (05-SUP linha 11): fracionamento e unitarização de dose pelas rotas reais do módulo (o
// UnitarizacaoDoseController registrado no modulo.ts). O usuário da manipulação (SINT.MANIPULACAO, o farmacêutico da manipulação do E2E M46) abre a tela pelo menu (Suprimentos > Farmácia
// hospitalar > Fracionamento e unitarização de dose). A porta grava só no banco próprio: na sessão sintética de dev/ci
// (logins SINT.*, sem o núcleo), GET /api/farmacia/unitarizacao responde 503 e a tela mostra o erro sem inventar
// regra nem ordem (primeiro teste). O segundo teste simula as rotas (page.route com respostas sintéticas) e percorre o
// ciclo pela tela: regra, local, lote filtrado pelo local e pelo insumo de origem, doses acima do rendimento recusadas
// na hora, validade da dose calculada antes de gravar, POST da ordem (com a Idempotency-Key), etiquetas emitidas e o
// rastreio dose → lote de origem. O efeito no MariaDB (baixa do lote de origem, entrada das doses, etiqueta por dose e
// rastreio) está em apps/api/src/modulos/suprimentos/unitarizacao-dose.int.spec.ts. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const B = '/api/farmacia/unitarizacao';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

/** Abre a tela pelo menu e devolve o status da leitura do painel. */
async function abrirPeloMenu(page: Page): Promise<number> {
  const leitura = page.waitForResponse((r) => r.url().endsWith(B) && r.request().method() === 'GET');
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  await menu.getByRole('button', { name: /^Suprimentos/ }).click();
  const farmacia = menu.getByRole('button', { name: /^Farmácia hospitalar/ });
  if ((await farmacia.getAttribute('aria-expanded')) !== 'true') await farmacia.click();
  await menu.getByRole('link', { name: 'Fracionamento e unitarização de dose' }).click();
  await expect(page).toHaveURL(/\/farmacia\/unitarizacao$/);
  await expect(page.getByTestId('tela-farmacia-unitarizacao')).toBeVisible();
  return (await leitura).status();
}

test.describe('@C2-092 Fracionamento e unitarização de dose', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('pelo menu; sem o banco do cliente, a tela mostra o erro e não oferece gravação; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    await entrar(page, 'SINT.MANIPULACAO');
    const status = await abrirPeloMenu(page);
    const tela = page.getByTestId('tela-farmacia-unitarizacao');
    if (status === 503) {
      await expect(tela.getByTestId('mensagem-erro').first()).toBeVisible();
      await expect(tela.getByTestId('unit-ordem')).toHaveCount(0);
      await expect(tela.getByTestId('unit-regras')).toHaveCount(0);
    } else {
      expect(status).toBe(200);
    }
    await semViolacaoAxe(page, '/farmacia/unitarizacao');
  });

  test('ciclo pela tela com a API simulada: ordem, validação na hora, etiquetas e rastreio; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const json = (rota: Route, corpo: unknown, status = 200) =>
      rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    const posts: { corpo: Record<string, unknown>; chave: string | null }[] = [];
    const painel = {
      hoje: '2026-11-25',
      agora: '2026-11-25T10:00',
      regras: [
        {
          id: 7,
          versao: 1,
          origem: 41,
          origemNome: 'Ampola sintética 10 mL',
          resultante: 42,
          resultanteNome: 'Dose sintética 2 mL',
          quantidadeOrigem: 1,
          rendimento: 5,
          unidade: 3,
          unidadeSigla: 'mL',
          validadeHoras: null,
          exigeCapela: false,
          reaproveitaSobra: true,
          ativa: true,
        },
      ],
      lotes: [
        { id: 900, insumo: 41, local: 1, numero: 'L-SINT-A', validade: '2027-11-25', saldo: 10 },
        { id: 901, insumo: 41, local: 2, numero: 'L-SINT-B', validade: '2027-05-25', saldo: 4 },
      ],
      locais: [
        { id: 1, nome: 'Farmácia central sintética' },
        { id: 2, nome: 'Farmácia satélite sintética' },
      ],
      capelas: [{ id: 5, nome: 'Capela sintética', situacao: 'disponivel' }],
      unidades: [{ id: 3, sigla: 'mL' }],
      ordens: [] as Record<string, unknown>[],
    };
    const rastreio = {
      dose: {
        id: 1,
        identificador: 'D0000001',
        insumo: 'Dose sintética 2 mL',
        quantidade: 1,
        unidade: 'mL',
        validadeOriginal: '2027-11-25',
        validadeNova: '2027-02-25',
        unitarizadaEm: '2026-11-25T10:00',
        situacao: 'disponivel',
        etiquetaSituacao: 'emitida',
      },
      ordem: {
        id: 11,
        numero: 1,
        tipo: 'fracionamento',
        executadaEm: '2026-11-25T10:00',
        farmaceutico: 'Farmacêutico sintético',
        capela: null,
        rupturaLacre: true,
        percentualEstabilidade: null,
      },
      loteOrigem: {
        id: 900,
        numero: 'L-SINT-A',
        validade: '2027-11-25',
        insumo: 'Ampola sintética 10 mL',
        fabricante: null,
      },
      irmas: [
        { identificador: 'D0000001', situacao: 'disponivel' },
        { identificador: 'D0000002', situacao: 'disponivel' },
      ],
    };
    await page.route(`**${B}**`, async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname === `${B}/ordens`) {
        const corpo = req.postDataJSON() as Record<string, unknown>;
        posts.push({ corpo, chave: req.headers()['idempotency-key'] ?? null });
        painel.ordens.unshift({
          id: 11,
          numero: 1,
          tipo: 'fracionamento',
          executadaEm: '2026-11-25T10:00',
          origemNome: 'Ampola sintética 10 mL',
          loteOrigem: 'L-SINT-A',
          resultanteNome: 'Dose sintética 2 mL',
          doses: 2,
          perda: 0,
          sobra: 3,
          validadeDose: '2027-02-25',
          situacao: 'executada',
        });
        const dose = (id: number, ident: string) => ({
          id,
          etiqueta: 100 + id,
          validade: '2027-02-25',
          identificador: ident,
          linhas: ['Dose sintética 2 mL', 'Lote de origem L-SINT-A'],
          datamatrix: ident,
          barras: ident,
          legivel: ident,
        });
        return json(
          rota,
          {
            ok: true,
            id: 11,
            numero: 1,
            loteDoses: 77,
            movimentoSaida: 1,
            movimentoEntrada: 2,
            validadeDose: '2027-02-25',
            sobra: 3,
            validadeSobra: '2027-02-25',
            doses: [dose(1, 'D0000001'), dose(2, 'D0000002')],
            mensagem: 'Ordem 1: 2 dose(s) etiquetada(s), validade até 2027-02-25.',
          },
          201,
        );
      }
      if (url.pathname === `${B}/doses/D0000001`) return json(rota, rastreio);
      if (url.pathname === B) return json(rota, painel);
      return rota.fallback();
    });

    await entrar(page, 'SINT.MANIPULACAO');
    await abrirPeloMenu(page);
    const tela = page.getByTestId('tela-farmacia-unitarizacao');
    await expect(tela.getByTestId('unit-regra-7')).toContainText('Dose sintética 2 mL');

    await escolher(tela.getByTestId('unit-ordem-regra'), { rotulo: /Ampola sintética/ });
    await escolher(tela.getByTestId('unit-ordem-local'), 'Farmácia satélite sintética');
    // O lote é filtrado pelo local: na satélite só o L-SINT-B.
    await escolher(tela.getByTestId('unit-ordem-lote'), { rotulo: /L-SINT-B/ });
    await escolher(tela.getByTestId('unit-ordem-local'), 'Farmácia central sintética');
    await escolher(tela.getByTestId('unit-ordem-lote'), { rotulo: /L-SINT-A/ });

    // Validação na hora: 6 doses passam do rendimento (5 para 1 ampola).
    await tela.getByTestId('unit-ordem-doses').fill('6');
    await expect(tela.getByTestId('unit-ordem-recusas')).toBeVisible();
    await expect(tela.getByTestId('unit-ordem-executar')).toBeDisabled();
    await tela.getByTestId('unit-ordem-doses').fill('2');
    await expect(tela.getByTestId('unit-ordem-recusas')).toHaveCount(0);
    // A sobra (5 previstas - 2 doses - 0 de perda) não some: a regra a reaproveita e ela fica registrada na ordem.
    await expect(tela.getByTestId('unit-ordem-sobra')).toContainText('3');
    // Validade da dose: 25% dos 365 dias restantes (91 dias), antes da embalagem original.
    await expect(tela.getByTestId('unit-ordem-validade')).toContainText('24/02/2027');

    await semViolacaoAxe(page, '/farmacia/unitarizacao');
    await tela.getByTestId('unit-ordem-executar').click();
    await expect(tela.getByTestId('unit-aviso')).toContainText('2 dose(s) etiquetada(s)');
    await expect(tela.getByTestId('unit-rotulo-D0000001')).toContainText('L-SINT-A');
    await expect(tela.getByTestId('unit-ordens')).toContainText('L-SINT-A');

    expect(posts).toHaveLength(1);
    expect(posts[0]!.chave).toMatch(/^[A-Za-z0-9._:-]{8,80}$/);
    expect(posts[0]!.corpo).toMatchObject({
      regra: 7,
      tipo: 'fracionamento',
      local: 1,
      lote: 900,
      capela: null,
      quantidadeOrigem: 1,
      doses: 2,
      perda: 0,
    });

    // Rastreio: o código da etiqueta leva à ordem e ao lote de origem.
    await tela.getByTestId('unit-rastreio-codigo').fill('D0000001');
    await tela.getByTestId('unit-rastreio').getByRole('button', { name: 'Rastrear' }).click();
    await expect(tela.getByTestId('unit-rastreio-lote')).toContainText('L-SINT-A');
    await expect(tela.getByTestId('unit-rastreio-resultado')).toContainText('Doses da mesma ordem (2)');
  });
});
