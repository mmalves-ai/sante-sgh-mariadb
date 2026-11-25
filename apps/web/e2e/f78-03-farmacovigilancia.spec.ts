// E2E @C1-013 (F7, 03-PEP L103): reação adversa a medicamento no paciente (farmacovigilância) pelo caminho da tela,
// com cada passo dado por quem pode dá-lo. O médico chega pelo atalho do prontuário, registra a reação ligada ao item
// prescrito com a gravidade e não vê o passo da avaliação. A farmácia clínica entra pelo menu (Farmácia clínica >
// Reação adversa a medicamento), abre a tela do paciente, escolhe a causalidade e avalia, sem o formulário de registro.
// O médico notifica à vigilância e encerra com o desfecho; a encerrada só oferece reabrir. O corpo de cada POST é
// conferido. As rotas /api/pep/farmacovigilancia exigem o banco do cliente (503 na fonte sintética): as respostas são
// simuladas pelo Playwright com massa SINTÉTICA, no formato de apps/web/src/modulos/pep/api-farmacovigilancia.ts.
// O contexto do paciente e a sessão são reais. O que fica no banco (eventos, 403 da avaliação sem a permissão da
// farmácia) é provado pelo contrato de efeito apps/api/src/modulos/pep/farmacovigilancia-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;
const REACAO = 9301;
const ITEM = 801;

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

type Reacao = {
  id: number;
  versao: number;
  medicamento: string;
  descricao: string;
  inicio: string | null;
  fim: string | null;
  gravidade: { id: number; descricao: string; nivel: number };
  causalidade: string | null;
  conduta: string | null;
  desfecho: string | null;
  situacao: string;
  notificadaEm: string | null;
  exigeNotificacao: boolean;
  eventos: { etapa: string }[];
};

const GRAVIDADES = [
  { id: 1, descricao: 'Leve', nivel: 1 },
  { id: 2, descricao: 'Moderada', nivel: 2 },
  { id: 3, descricao: 'Grave', nivel: 3 },
];
const CAUSALIDADES = [
  { id: 1, descricao: 'Possível' },
  { id: 2, descricao: 'Provável' },
];

/** Servidor simulado: guarda a reação e devolve o estado novo a cada leitura; registra o corpo de cada POST. */
async function simular(page: Page) {
  const pedidos: Record<string, unknown>[] = [];
  let reacao: Reacao | null = null;
  await page.route('**/api/pep/farmacovigilancia/**', (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(/^\/api\/pep\/farmacovigilancia\//, '');
    if (req.method() === 'GET') {
      if (caminho === `paciente/${PACIENTE}`)
        return json(rota, {
          reacoes: reacao ? [reacao] : [],
          usoContinuo: [],
          itensPrescritos: [
            { id: ITEM, descricao: 'DIPIRONA SINTETICA 500 mg', prescritoEm: '2026-11-24T08:00:00' },
          ],
          gravidades: GRAVIDADES,
          causalidades: CAUSALIDADES,
          nivelGrave: 3,
        });
      return rota.fallback();
    }
    if (caminho !== 'reacoes') return json(rota, { codigo: 'nao-simulado' }, 500);
    const corpo = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    pedidos.push(corpo);
    const acao = corpo['acao'];
    if (acao === 'registrar') {
      reacao = {
        id: REACAO,
        versao: 1,
        medicamento: 'DIPIRONA SINTETICA 500 mg',
        descricao: String(corpo['descricao']),
        inicio: String(corpo['inicio']),
        fim: null,
        gravidade: GRAVIDADES.find((g) => g.id === corpo['gravidade']) ?? GRAVIDADES[0]!,
        causalidade: null,
        conduta: null,
        desfecho: null,
        situacao: 'registrada',
        notificadaEm: null,
        exigeNotificacao: false,
        eventos: [{ etapa: 'registrada' }],
      };
    } else if (reacao && acao === 'avaliar') {
      const c = CAUSALIDADES.find((x) => x.id === corpo['causalidade']);
      reacao = {
        ...reacao,
        versao: reacao.versao + 1,
        situacao: 'avaliada',
        causalidade: c?.descricao ?? null,
      };
      reacao.eventos = [...reacao.eventos, { etapa: 'avaliada' }];
    } else if (reacao && acao === 'notificar') {
      reacao = {
        ...reacao,
        versao: reacao.versao + 1,
        situacao: 'notificada',
        notificadaEm: '2026-11-25T10:00:00',
      };
      reacao.eventos = [...reacao.eventos, { etapa: 'notificada' }];
    } else if (reacao && acao === 'encerrar') {
      reacao = {
        ...reacao,
        versao: reacao.versao + 1,
        situacao: 'encerrada',
        desfecho: String(corpo['desfecho']),
        fim: '2026-11-25T11:00:00',
      };
      reacao.eventos = [...reacao.eventos, { etapa: 'encerrada' }];
    } else return json(rota, { codigo: 'nao-simulado' }, 500);
    return json(rota, { ok: true, id: REACAO }, 201);
  });
  return pedidos;
}

test.describe('Reação adversa a medicamento @C1-013 @fase7', () => {
  test.setTimeout(240_000);
  test('médico registra, farmácia avalia, médico notifica e encerra; cada um só com os seus passos; axe', async ({
    page,
  }) => {
    const pedidos = await simular(page);
    const tela = `/pep/paciente/${PACIENTE}/farmacovigilancia`;

    // 1. Médico: pelo atalho do prontuário, registra a reação ligada ao item prescrito.
    await entrar(page, 'SINT.MEDICO');
    await page.goto(`/pep/paciente/${PACIENTE}`);
    await page.getByTestId('atalho-farmacovigilancia').click();
    await expect(page).toHaveURL(new RegExp(`${tela}$`));
    await expect(page.getByTestId('farmaco-tela')).toBeVisible();
    const nova = page.getByTestId('farmaco-nova');
    await escolher(nova.getByTestId('farmaco-item'), String(ITEM));
    await expect(nova.getByTestId('farmaco-nome')).toHaveCount(0);
    await nova.getByTestId('farmaco-descricao').fill('Exantema sintético após a dose');
    await escolher(nova.getByTestId('farmaco-gravidade'), '2');
    await semViolacaoAxe(page, `${tela} (registro)`);
    await nova.getByTestId('farmaco-registrar').click();
    await expect(page.getByTestId('farmaco-ok')).toBeVisible();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      acao: 'registrar',
      paciente: PACIENTE,
      prescricaoItem: ITEM,
      descricao: 'Exantema sintético após a dose',
      gravidade: 2,
    });
    const cartao = page.getByTestId(`farmaco-reacao-${REACAO}`);
    await expect(cartao).toContainText('Registrada');
    await expect(cartao.getByTestId(`farmaco-avaliar-${REACAO}`)).toHaveCount(0);
    await expect(cartao.getByTestId(`farmaco-causalidade-${REACAO}`)).toHaveCount(0);

    // 2. Farmácia clínica: entra pelo menu (busca do paciente) e avalia a causalidade, sem o formulário de registro.
    await entrar(page, 'SINT.SUP.FARMACIA');
    await page.goto('/farmacia-clinica/farmacovigilancia');
    await expect(page.getByTestId('tela-prescricao-inicio')).toBeVisible();
    await page.goto(tela);
    await expect(page.getByTestId('farmaco-tela')).toBeVisible();
    await expect(page.getByTestId('farmaco-nova')).toHaveCount(0);
    await escolher(cartao.getByTestId(`farmaco-causalidade-${REACAO}`), '2');
    await cartao.getByTestId(`farmaco-avaliar-${REACAO}`).click();
    await expect(page.getByTestId('farmaco-ok')).toBeVisible();
    expect(pedidos[1]).toMatchObject({ acao: 'avaliar', reacao: REACAO, versao: 1, causalidade: 2 });
    await expect(cartao).toContainText('Avaliada');
    await semViolacaoAxe(page, `${tela} (avaliação da farmácia)`);

    // 3. Médico: notifica à vigilância e encerra com o desfecho.
    await entrar(page, 'SINT.MEDICO');
    await page.goto(tela);
    await expect(cartao).toContainText('Avaliada');
    await expect(cartao.getByTestId(`farmaco-avaliar-${REACAO}`)).toHaveCount(0);
    await cartao.getByTestId(`farmaco-texto-${REACAO}`).fill('Notificação sintética enviada');
    await cartao.getByTestId(`farmaco-notificar-${REACAO}`).click();
    await expect(cartao).toContainText('Notificada');
    expect(pedidos[2]).toMatchObject({
      acao: 'notificar',
      reacao: REACAO,
      versao: 2,
      observacao: 'Notificação sintética enviada',
    });
    await escolher(cartao.getByTestId(`farmaco-desfecho-${REACAO}`), 'recuperado');
    await cartao.getByTestId(`farmaco-encerrar-${REACAO}`).click();
    await expect(cartao).toContainText('Encerrada');
    expect(pedidos[3]).toMatchObject({ acao: 'encerrar', reacao: REACAO, versao: 3, desfecho: 'recuperado' });
    expect(pedidos).toHaveLength(4);
    await expect(cartao.getByTestId(`farmaco-reabrir-${REACAO}`)).toBeVisible();
    await expect(cartao.getByTestId(`farmaco-encerrar-${REACAO}`)).toHaveCount(0);
    await semViolacaoAxe(page, `${tela} (encerrada)`);
  });
});
