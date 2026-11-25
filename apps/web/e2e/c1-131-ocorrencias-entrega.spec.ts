// E2E @C1-131 (F8, 04-HOT linha 143): ocorrências na entrega da refeição pelo caminho da tela (`/nutricao/mapa`). A copa
// (SINT.COPA: hotelaria.mapaDieta.ler, .imprimir e .fechar) abre o mapa fechado da unidade e da refeição, registra a
// ocorrência pela linha do paciente (o paciente já escolhido no diálogo), vê na hora que o tipo exige a justificativa e
// que o tipo gera reposição (aviso), grava, vê a lista com a pendente e a resolve com a providência (a linha fica com
// quem e quando). Os combos são SanteSelecao (nenhum <select> nativo). As ocorrências só existem no banco do cliente (na
// fonte sintética a API responde 503) e o retrato do mapa é acrescentado à resposta real: as respostas são simuladas pelo
// Playwright com massa SINTÉTICA, no contrato do servidor. O que fica no banco está no contrato de efeito
// (apps/api/src/modulos/nutricao/ocorrencia-refeicao-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

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

const TIPOS = [
  {
    id: 1,
    codigo: 'ATRASO',
    descricao: 'Atraso na entrega',
    geraReposicao: false,
    exigeJustificativa: false,
    ativo: true,
  },
  {
    id: 2,
    codigo: 'RECUSA',
    descricao: 'Recusa do paciente',
    geraReposicao: false,
    exigeJustificativa: true,
    ativo: true,
  },
  {
    id: 3,
    codigo: 'ERRADA',
    descricao: 'Dieta errada',
    geraReposicao: true,
    exigeJustificativa: false,
    ativo: true,
  },
];

interface Ocorrencia {
  id: number;
  internacao: number;
  linhaMapa: number;
  tipo: number;
  tipoCodigo: string;
  tipoDescricao: string;
  reposicao: boolean;
  ocorridoEm: string;
  descricao: string;
  registradaPor: string;
  resolvida: boolean;
  resolvidaEm: string | null;
  resolvidaPor: string | null;
  providencia: string | null;
  versao: number;
}

function simular(page: Page) {
  const st = { itens: [] as Ocorrencia[], corpos: [] as Record<string, unknown>[] };
  let proximo = 9701;
  // O mapa real da fonte sintética, com o retrato do fechamento (a bandeja existe).
  void page.route(/\/api\/nutricao\/mapa\?/, async (r) => {
    const resposta = await r.fetch();
    const corpo = (await resposta.json()) as Record<string, unknown>;
    corpo['retrato'] ??= {
      id: 9700,
      em: '2026-11-25T10:00',
      por: 'SINT.COPA',
      corteEm: '2026-11-25T10:00',
      itens: 4,
      jejuns: 1,
      hash: '',
    };
    return json(r, corpo);
  });
  void page.route(/\/api\/nutricao\/mapa\/ocorrencias\/tipos$/, (r) => json(r, { itens: TIPOS }));
  void page.route(/\/api\/nutricao\/mapa\/ocorrencias(\?.*)?$/, async (r) => {
    if (r.request().method() === 'GET') return json(r, { itens: st.itens });
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push(corpo);
    const tipo = TIPOS.find((x) => x.id === corpo['tipo'])!;
    const descricao = String(corpo['descricao'] ?? '').trim();
    if (tipo.exigeJustificativa && descricao.length < 10)
      return json(r, { codigo: 'regra-violada', title: 'Ocorrência na entrega inválida', status: 422 }, 422);
    const id = proximo++;
    st.itens.push({
      id,
      internacao: Number(corpo['internacao']),
      linhaMapa: 1,
      tipo: tipo.id,
      tipoCodigo: tipo.codigo,
      tipoDescricao: tipo.descricao,
      reposicao: tipo.geraReposicao,
      ocorridoEm: '2026-11-25T12:20',
      descricao: descricao || tipo.descricao,
      registradaPor: 'SINT.COPA',
      resolvida: false,
      resolvidaEm: null,
      resolvidaPor: null,
      providencia: null,
      versao: 1,
    });
    return json(
      r,
      {
        id,
        reposicao: tipo.geraReposicao,
        mensagem: tipo.geraReposicao
          ? `Ocorrência registrada (${tipo.descricao}): providencie a reposição da refeição.`
          : `Ocorrência registrada (${tipo.descricao}).`,
      },
      201,
    );
  });
  void page.route(/\/api\/nutricao\/mapa\/ocorrencias\/\d+\/resolver$/, async (r) => {
    const id = Number(/ocorrencias\/(\d+)\/resolver/.exec(r.request().url())?.[1]);
    const corpo = r.request().postDataJSON() as { providencia: string; versao: number };
    st.corpos.push(corpo as unknown as Record<string, unknown>);
    const o = st.itens.find((x) => x.id === id);
    if (!o || o.resolvida || o.versao !== corpo.versao)
      return json(
        r,
        { codigo: 'regra-violada', title: 'Resolução da ocorrência inválida', status: 422 },
        422,
      );
    Object.assign(o, {
      resolvida: true,
      resolvidaEm: '2026-11-25T12:40',
      resolvidaPor: 'SINT.COPA',
      providencia: corpo.providencia,
      versao: o.versao + 1,
    });
    return json(r, { id });
  });
  return st;
}

test.describe('Ocorrências na entrega da refeição @C1-131', () => {
  test.setTimeout(180_000);

  test('linha do mapa → ocorrência com justificativa e reposição → resolver com a providência; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.COPA');
    await page.goto('/nutricao/mapa');
    await expect(page.getByTestId('tela-mapa-dietas')).toBeVisible();
    await escolher(page.getByTestId('mapa-unidade'), '2A');
    await escolher(page.getByTestId('mapa-refeicao'), '2');
    await page.getByTestId('mapa-abrir').click();
    const secao = page.getByTestId('ocorrencias-entrega');
    await expect(secao).toContainText('Nenhuma ocorrência nesta refeição.');

    // Pela linha do paciente: o diálogo abre com ele escolhido.
    await page.getByTestId('ocorrencia-linha-950001').click();
    const dialogo = page.getByTestId('dialogo-ocorrencia');
    await expect(dialogo).toBeVisible();
    await esperarSemSelectNativo(dialogo);
    await escolher(page.getByTestId('ocorrencia-tipo'), { rotulo: 'Recusa do paciente' });
    // A justificativa exigida pelo tipo, na hora.
    await expect(page.getByTestId('ocorrencia-falta-justificativa')).toBeVisible();
    await expect(page.getByTestId('ocorrencia-gravar')).toBeDisabled();
    await page.getByTestId('ocorrencia-descricao').locator('textarea').fill('Paciente recusou por náusea');
    await expect(page.getByTestId('ocorrencia-falta-justificativa')).toHaveCount(0);
    await semViolacaoAxe(page, '/nutricao/mapa (ocorrência)');
    await page.getByTestId('ocorrencia-gravar').click();
    await expect(page.getByTestId('ocorrencias-mensagem')).toContainText(
      'Ocorrência registrada (Recusa do paciente)',
    );
    expect(st.corpos[0]).toMatchObject({ unidade: '2A', refeicao: 2, internacao: 950001, tipo: 2 });

    // O tipo que gera reposição avisa antes de gravar e depois.
    await page.getByTestId('ocorrencia-registrar').click();
    await escolher(page.getByTestId('ocorrencia-paciente'), { indice: 0 });
    await escolher(page.getByTestId('ocorrencia-tipo'), { rotulo: 'Dieta errada' });
    await expect(page.getByTestId('ocorrencia-aviso-reposicao')).toBeVisible();
    await page.getByTestId('ocorrencia-gravar').click();
    await expect(page.getByTestId('ocorrencias-mensagem')).toContainText('reposição');
    await expect(page.getByTestId('ocorrencias-pendentes')).toContainText('2 pendente(s)');

    // A providência resolve a ocorrência: fica com quem e quando.
    await page.getByTestId('ocorrencia-resolver-9701').click();
    const resolver = page.getByTestId('dialogo-resolver-ocorrencia');
    await expect(resolver).toBeVisible();
    await expect(page.getByTestId('ocorrencia-resolver-gravar')).toBeDisabled();
    await page.getByTestId('ocorrencia-providencia').locator('textarea').fill('Oferecida sopa no lugar');
    await page.getByTestId('ocorrencia-resolver-gravar').click();
    await expect(page.getByTestId('ocorrencia-9701')).toContainText('Resolvida por SINT.COPA');
    await expect(page.getByTestId('ocorrencia-9701')).toContainText('Oferecida sopa no lugar');
    await expect(page.getByTestId('ocorrencias-pendentes')).toContainText('1 pendente(s)');
    expect(st.corpos.at(-1)).toMatchObject({ providencia: 'Oferecida sopa no lugar', versao: 1 });
    await semViolacaoAxe(page, '/nutricao/mapa (ocorrências)');
    expect(externas).toEqual([]);
  });
});
