// E2E @C2-083 (07-FIN linha 157): remuneração variável do profissional. O analista escolhe o médico pela busca, inclui
// o mínimo garantido, vê as faixas sobrepostas recusadas na hora (o botão fica desligado e o aviso aparece), corrige e
// inclui a meta de produtividade, informa o valor apurado da competência, escolhe a apuração em aberto, confere a
// simulação (lançado/a lançar) e lança; axe sem violação séria.
//
// Fonte sintética: a remuneração variável só existe no banco próprio (na sessão sintética a API responde 503), então as
// rotas /api/repasse/remuneracao-variavel e /api/repasse/prestadores são simuladas com page.route, com estado em memória
// que responde ao que a tela grava. O teste confere o corpo de cada gravação (vigência fechada no mês, faixas corrigidas,
// competência do apurado, apuração e médico do lançamento). O efeito no banco é provado no contrato de efeito da porta
// própria da remuneração variável. Nenhum dado de pessoa (só ids e nomes sintéticos).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const R = '/api/repasse/remuneracao-variavel';

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

const MEDICO = { prestador: 8301, registro: 98301, nome: 'Médico Sintético E2E', conselho: 'CRM 0000' };
const EVENTO = { id: 8311, codigo: 'E2E-EV', nome: 'Rendimento sintético' };
const INDICADOR = {
  id: 8321,
  codigo: 'E2E-IND',
  descricao: 'Indicador sintético',
  unidade: '%',
  sentido: 'maior',
};
const APURACAO = { id: 8331, numero: '2083', competencia: '2027-03-01', situacao: 'aberta' };
const DE = '2027-03-01';
const ATE = '2027-03-31';

interface Gravado {
  [k: string]: unknown;
}

async function simular(page: Page): Promise<Record<string, Gravado>> {
  const corpos: Record<string, Gravado> = {};
  const estado = {
    minimos: [] as Gravado[],
    metas: [] as (Gravado & { id: number; apurados: Gravado[] })[],
    lancado: false,
  };
  const vigente = (c: Gravado, id: number) => ({
    id,
    profissional: MEDICO.prestador,
    profissionalNome: MEDICO.nome,
    evento: c['evento'],
    eventoNome: EVENTO.nome,
    inicio: c['inicio'],
    fim: c['fim'],
    versao: 1,
  });
  const painel = () => ({
    minimos: estado.minimos,
    fixos: [],
    resultados: [],
    metas: estado.metas,
    custos: [],
    eventos: [EVENTO],
    indicadores: [INDICADOR],
    centros: [],
    apuracoes: [APURACAO],
  });
  const simulacao = () => ({
    apuracao: APURACAO.id,
    competencia: APURACAO.competencia,
    situacao: APURACAO.situacao,
    profissionais: [
      {
        profissional: MEDICO.prestador,
        nome: MEDICO.nome,
        producao: 3000,
        credito: 2000,
        debito: 0,
        pendencias: [],
        itens: [
          {
            tipo: 'complemento_minimo',
            regra: 1,
            sentido: 'credito',
            valor: 2000,
            memoria: 'mínimo 5.000,00 − produção 3.000,00',
            referente: APURACAO.competencia,
            lancado: estado.lancado,
          },
        ],
      },
    ],
  });
  await page.route('**/api/repasse/prestadores**', (rota) => json(rota, [MEDICO]));
  await page.route(`**${R}**`, (rota) => {
    const url = new URL(rota.request().url());
    const caminho = url.pathname;
    if (rota.request().method() === 'GET') {
      if (caminho.endsWith('/simulacao')) {
        expect(url.searchParams.get('apuracao')).toBe(String(APURACAO.id));
        expect(url.searchParams.get('profissional')).toBe(String(MEDICO.prestador));
        return json(rota, simulacao());
      }
      expect(url.searchParams.get('profissional')).toBe(String(MEDICO.prestador));
      return json(rota, painel());
    }
    const corpo = rota.request().postDataJSON() as Gravado;
    if (caminho.endsWith('/minimos')) {
      corpos['minimo'] = corpo;
      estado.minimos.push({
        ...vigente(corpo, 1),
        valorMinimo: corpo['valorMinimo'],
        complementoAutomatico: true,
      });
      return json(rota, { id: 1 }, 201);
    }
    if (caminho.endsWith('/metas')) {
      corpos['meta'] = corpo;
      estado.metas.push({
        ...vigente(corpo, 2),
        indicador: INDICADOR.id,
        indicadorCodigo: INDICADOR.codigo,
        indicadorDescricao: INDICADOR.descricao,
        unidade: INDICADOR.unidade,
        sentido: INDICADOR.sentido,
        centroNome: null,
        forma: corpo['forma'],
        peso: corpo['peso'],
        faixas: corpo['faixas'],
        apurados: [],
      });
      return json(rota, { id: 2 }, 201);
    }
    const apurado = /\/metas\/(\d+)\/apurado$/.exec(caminho);
    if (apurado) {
      corpos['apurado'] = corpo;
      estado.metas
        .find((m) => m.id === Number(apurado[1]))
        ?.apurados.unshift({ competencia: corpo['competencia'], valor: corpo['valor'], fonte: 'informado' });
      return json(rota, { id: 3 }, 201);
    }
    if (caminho.endsWith('/lancar')) {
      corpos['lancar'] = corpo;
      estado.lancado = true;
      return json(rota, { lancamentos: 1, descontos: 0, credito: 2000, debito: 0 });
    }
    return json(rota, { status: 404 }, 404);
  });
  return corpos;
}

test.describe('remuneração variável do profissional @C2-083', () => {
  test('mínimo → faixas recusadas na hora → meta → valor apurado → simular → lançar; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.REP.ANALISTA');
    const corpos = await simular(page);

    await page.goto('/repasse/remuneracao-variavel');
    await expect(page.getByTestId('tela-rep-remuneracao-variavel')).toBeVisible();

    // O médico pela busca (nome · conselho), escolhido pelo registro.
    await page.getByTestId('rv-medico-busca').fill('Sintético');
    await page.getByTestId('rv-medico-buscar').click();
    await escolher(page.getByTestId('rv-medico'), String(MEDICO.registro));
    await expect(page.getByTestId('rv-min-incluir')).toBeVisible();
    await semViolacaoAxe(page, '/repasse/remuneracao-variavel');

    // Mínimo garantido, com a vigência fechada no mês da apuração: sem evento o botão fica desligado; com tudo, grava.
    await page.getByTestId('rv-min-valor').fill('5000');
    await page.getByTestId('rv-min-inicio').fill(DE);
    await page.getByTestId('rv-min-fim').fill(ATE);
    await expect(page.getByTestId('rv-min-incluir')).toBeDisabled();
    await escolher(page.getByTestId('rv-min-evento'), String(EVENTO.id));
    await expect(page.getByTestId('rv-min-incluir')).toBeEnabled();
    await page.getByTestId('rv-min-incluir').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId('rv-minimos')).toContainText('5.000,00');
    expect(corpos['minimo']).toMatchObject({
      profissional: MEDICO.prestador,
      evento: EVENTO.id,
      inicio: DE,
      fim: ATE,
      valorMinimo: 5000,
    });

    // Meta de produtividade: faixas sobrepostas recusadas na hora, sem ir ao servidor.
    await escolher(page.getByTestId('rv-meta-indicador'), String(INDICADOR.id));
    await escolher(page.getByTestId('rv-meta-forma'), { rotulo: /% da produção/ });
    await escolher(page.getByTestId('rv-meta-evento'), String(EVENTO.id));
    await page.getByTestId('rv-meta-inicio').fill(DE);
    await page.getByTestId('rv-meta-fim').fill(ATE);
    await page.getByTestId('rv-faixa-de-0').fill('80');
    await page.getByTestId('rv-faixa-ate-0').fill('100');
    await page.getByTestId('rv-faixa-premio-0').fill('5');
    await page.getByTestId('rv-faixa-mais').click();
    await page.getByTestId('rv-faixa-de-1').fill('95');
    await page.getByTestId('rv-faixa-premio-1').fill('10');
    await expect(page.getByTestId('rv-faixas-problemas')).toContainText('se sobrepõem');
    await expect(page.getByTestId('rv-meta-incluir')).toBeDisabled();
    expect(corpos['meta']).toBeUndefined();
    await page.getByTestId('rv-faixa-de-1').fill('100.01');
    await expect(page.getByTestId('rv-faixas-problemas')).toHaveCount(0);
    await page.getByTestId('rv-meta-incluir').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId('rv-metas')).toBeVisible();
    expect(corpos['meta']).toMatchObject({
      profissional: MEDICO.prestador,
      indicador: INDICADOR.id,
      evento: EVENTO.id,
      forma: 'percentual_producao',
      inicio: DE,
      fim: ATE,
      faixas: [
        { de: 80, ate: 100, premio: 5 },
        { de: 100.01, ate: null, premio: 10 },
      ],
    });

    // Valor apurado na competência da apuração, na linha da meta recém-gravada.
    await page.getByTestId('rv-apu-comp-2').fill(DE.slice(0, 7));
    await page.getByTestId('rv-apu-valor-2').fill('92');
    await page.getByTestId('rv-apu-informar-2').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('Gravado');
    await expect(page.getByTestId('rv-apurados-2')).toContainText('92');
    expect(corpos['apurado']).toEqual({ competencia: DE, valor: 92 });

    // Na apuração: simulação com o complemento do mínimo, depois o lançamento.
    await escolher(page.getByTestId('rv-apuracao'), String(APURACAO.id));
    await expect(page.getByTestId('rv-sim-itens')).toBeVisible();
    await expect(page.getByTestId('rv-sim-itens')).toContainText('a lançar');
    await semViolacaoAxe(page, '/repasse/remuneracao-variavel (apuração)');
    await page.getByTestId('rv-lancar').click();
    await expect(page.getByTestId('rv-mensagem')).toContainText('lançamento(s)');
    await expect(page.getByTestId('rv-sim-itens')).not.toContainText('a lançar');
    await expect(page.getByTestId('rv-lancar')).toBeDisabled();
    expect(corpos['lancar']).toEqual({ apuracao: APURACAO.id, profissional: MEDICO.prestador });

    expect(externas).toEqual([]);
  });
});
