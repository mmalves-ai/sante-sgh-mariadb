// F3.8 (07-FIN linha 111): a EFD-REINF por evento na tela `/financeiro/fiscal/reinf`. As leituras e as gravações dos
// eventos só existem no banco do cliente (na fonte sintética respondem 503), então este E2E simula
// `/api/financeiro/reinf/*` com um estado em memória que segue a regra do servidor (um evento por beneficiário, o
// tributo com processo vai como suspenso, só o gerado é transmitido, só o enviado recebe retorno). O que fica no banco
// é provado no contrato de efeito `aplicacao/reinf-eventos.int.spec.ts`; aqui se prova o fluxo da tela: o processo com
// suspensão conferido enquanto se digita (a mesma regra do domínio), um clique gera os eventos da competência, os
// prontos já vêm marcados para a transmissão, o retorno (recibo ou ocorrências) é dado na linha do evento, o XML abre
// na tela e o item está no menu. Axe em cada passo.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
// Documentos sintéticos (não são de pessoa nem de empresa real).
const CNPJ = '11222333000181';
const CPF = '52998224725';
const PROCESSO = '00012345620264013400';

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
const recusa = (rota: Route, codigo: string, detail: string) =>
  rota.fulfill({
    status: 409,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: `urn:sgh:erro:${codigo}`, title: detail, status: 409, detail, codigo }),
  });

interface Evento {
  id: number;
  evento: string;
  acao: string;
  situacao: 'gerado' | 'enviado' | 'aceito' | 'rejeitado';
  recibo: string | null;
  retifica: number | null;
  beneficiario: string;
  valorBruto: number;
  valorRetido: number;
  valorSuspenso: number;
  documentos: number;
  processos: number;
  retornos: number;
  lote: number | null;
  protocolo: string | null;
  mensagem: string | null;
}

test.describe('financeiro: EFD-REINF por evento @F3.8-12', () => {
  test.setTimeout(180_000);

  test('processo conferido na hora, eventos gerados por beneficiário, transmissão, retorno e XML; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const eventos: Evento[] = [];
    const processos: Record<string, unknown>[] = [];
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let lotes = 0;

    await page.route('**/api/financeiro/reinf/**', async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace(/^.*\/reinf/, '');
      if (req.method() === 'GET') {
        if (caminho === '/painel')
          return json(rota, { periodo: url.searchParams.get('periodo'), eventos, processos });
        const id = Number(/^\/eventos\/(\d+)\/xml$/.exec(caminho)?.[1]);
        const e = eventos.find((x) => x.id === id);
        if (!e) return rota.fulfill({ status: 404 });
        return json(rota, {
          xml: `<Reinf><evt id="${e.id}"><tipo>${e.evento}</tipo><benef>${e.beneficiario}</benef></evt></Reinf>`,
        });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      const ok = (mensagem: string) => json(rota, { mensagem, repetida: false, ids: {}, avisos: [] });
      if (caminho === '/processos') {
        processos.push({
          id: processos.length + 1,
          tipo: corpo['tipo'],
          numero: corpo['numero'],
          indicativo: corpo['indicativo'],
          tributo: corpo['tributo'],
          beneficiario: corpo['beneficiario'],
          vigenciaInicio: corpo['vigenciaInicio'],
          vigenciaFim: corpo['vigenciaFim'],
          situacao: 'ativo',
        });
        return ok('Processo com suspensão gravado.');
      }
      if (caminho === '/gerar') {
        // Segunda geração da mesma série: nada mudou, nada é gerado de novo.
        if (eventos.length > 0)
          return ok('0 evento(s) gerado(s), 0 exclusão(ões), 1 igual(is) ao já enviado.');
        const suspende = processos.some((p) => p['tributo'] === 'ir' && p['beneficiario'] === CNPJ);
        const novo = (id: number, evento: string, beneficiario: string, suspenso: number): Evento => ({
          id,
          evento,
          acao: 'original',
          situacao: 'gerado',
          recibo: null,
          retifica: null,
          beneficiario,
          valorBruto: 1000,
          valorRetido: 15,
          valorSuspenso: suspenso,
          documentos: 1,
          processos: suspenso > 0 ? 1 : 0,
          retornos: 0,
          lote: null,
          protocolo: null,
          mensagem: null,
        });
        eventos.push(novo(1, 'R-4020', CNPJ, suspende ? 15 : 0), novo(2, 'R-4010', CPF, 0));
        return ok('2 evento(s) gerado(s), 0 exclusão(ões), 0 igual(is) ao já enviado.');
      }
      if (caminho === '/transmitir') {
        const ids = corpo['eventos'] as number[];
        const alvo = eventos.filter((e) => ids.includes(e.id));
        if (alvo.length === 0 || alvo.some((e) => e.situacao !== 'gerado'))
          return recusa(rota, 'evento-nao-transmissivel', 'Só o evento gerado ou validado é transmitido.');
        lotes += 1;
        for (const e of alvo)
          Object.assign(e, { situacao: 'enviado', lote: lotes, protocolo: `SIM-${lotes}` });
        return ok(`Lote ${lotes} transmitido ao simulador (protocolo SIM-${lotes}).`);
      }
      const e = eventos.find((x) => x.id === corpo['evento']);
      if (!e || e.situacao !== 'enviado')
        return recusa(rota, 'evento-nao-enviado', 'Só o evento enviado recebe retorno.');
      if (corpo['aceito'] === true) {
        if (!corpo['recibo']) return recusa(rota, 'recibo-obrigatorio', 'Informe o recibo do evento aceito.');
        Object.assign(e, { situacao: 'aceito', recibo: corpo['recibo'], retornos: e.retornos + 1 });
        return ok('Evento aceito, recibo registrado.');
      }
      Object.assign(e, { situacao: 'rejeitado', mensagem: corpo['ocorrencias'], retornos: e.retornos + 1 });
      return ok('Evento rejeitado, ocorrências registradas.');
    });

    await entrar(page, 'SINT.FIN.LANCA');
    const apoio = (await (await page.request.get('/api/financeiro/apoio')).json()) as { hoje: string };
    const competencia = apoio.hoje.slice(0, 7);

    await page.goto('/financeiro/fiscal/reinf');
    await expect(page.getByTestId('tela-fin-reinf')).toBeVisible();
    await expect(page.getByTestId('dc-periodo')).toHaveValue(competencia);
    const painel = page.getByTestId('reinf-eventos');
    await expect(painel).toBeVisible();
    await expect(page.getByTestId('re-vazio')).toBeVisible();
    // Sem evento pronto, nada a transmitir.
    await expect(page.getByTestId('re-transmitir')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (competência sem evento)');

    // O processo com suspensão é conferido enquanto se digita: o número judicial tem 20 dígitos.
    await expect(page.getByTestId('re-p-incluir')).toBeDisabled();
    await page.getByTestId('re-p-numero').fill('12345');
    await page.getByTestId('re-p-indicativo').fill('01');
    await page.getByTestId('re-p-inicio').fill(`${competencia}-01`);
    await expect(page.getByTestId('re-p-recusa')).toContainText('20 dígitos');
    await expect(page.getByTestId('re-p-incluir')).toBeDisabled();
    await page.getByTestId('re-p-numero').fill(PROCESSO);
    await expect(page.getByTestId('re-p-recusa')).toHaveCount(0);
    // O indicativo tem 2 dígitos.
    await page.getByTestId('re-p-indicativo').fill('1');
    await expect(page.getByTestId('re-p-recusa')).toContainText('2 dígitos');
    await page.getByTestId('re-p-indicativo').fill('01');
    // O beneficiário, quando informado, é CPF ou CNPJ.
    await page.getByTestId('re-p-beneficiario').fill('123');
    await expect(page.getByTestId('re-p-recusa')).toContainText('CPF (11) ou CNPJ (14)');
    await page.getByTestId('re-p-beneficiario').fill(CNPJ);
    await expect(page.getByTestId('re-p-recusa')).toHaveCount(0);
    // O fim da vigência não vem antes do início.
    await page.getByTestId('re-p-fim').fill(`${Number(competencia.slice(0, 4)) - 1}-12-31`);
    await expect(page.getByTestId('re-p-recusa')).toContainText('fim da vigência');
    await page.getByTestId('re-p-fim').fill('');
    await expect(page.getByTestId('re-p-recusa')).toHaveCount(0);
    // Processo judicial pede a vara e a data da decisão: sem elas o botão segue preso.
    await expect(page.getByTestId('re-p-incluir')).toBeDisabled();
    await page.getByTestId('re-p-vara').fill('0012');
    await page.getByTestId('re-p-decisao').fill(`${competencia}-01`);
    await expect(page.getByTestId('re-p-incluir')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (processo preenchido)');
    await page.getByTestId('re-p-incluir').click();
    await expect(page.getByTestId('re-ok')).toContainText('Processo com suspensão gravado');
    expect(corpos.at(-1)).toEqual({
      caminho: '/processos',
      corpo: {
        tipo: 'judicial',
        numero: PROCESSO,
        vara: '0012',
        indicativo: '01',
        tributo: 'ir',
        beneficiario: CNPJ,
        vigenciaInicio: `${competencia}-01`,
        vigenciaFim: null,
        dataDecisao: `${competencia}-01`,
      },
    });
    const listaProcessos = page.getByTestId('re-processos');
    await expect(listaProcessos.locator('tbody tr')).toHaveCount(1);
    await expect(listaProcessos).toContainText(PROCESSO);
    await expect(listaProcessos).toContainText('sem fim');
    // O número e o beneficiário voltam vazios para o próximo processo.
    await expect(page.getByTestId('re-p-numero')).toHaveValue('');

    // Um clique gera os eventos da série na competência da tela: um por beneficiário, o do processo com o suspenso.
    await page.getByTestId('re-gerar').click();
    await expect(page.getByTestId('re-ok')).toContainText('2 evento(s) gerado(s)');
    expect(corpos.at(-1)).toEqual({ caminho: '/gerar', corpo: { serie: 'R-4000', periodo: competencia } });
    await expect(page.getByTestId('re-eventos').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('re-evento-1')).toHaveAttribute('data-beneficiario', CNPJ);
    await expect(page.getByTestId('re-evento-1')).toContainText('R-4020');
    await expect(page.getByTestId('re-evento-1').locator('td').nth(5)).toContainText('15,00');
    await expect(page.getByTestId('re-evento-2')).toContainText('R-4010');
    await expect(page.getByTestId('re-evento-2').locator('td').nth(5)).toContainText('0,00');
    // Os prontos para envio já vêm marcados.
    await expect(page.getByTestId('re-marcar-1')).toBeChecked();
    await expect(page.getByTestId('re-marcar-2')).toBeChecked();
    await expect(page.getByTestId('re-transmitir')).toContainText('(2)');
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (eventos gerados)');

    // O XML do evento abre na própria tela.
    await page.getByTestId('re-xml-1').click();
    await expect(page.getByTestId('re-xml')).toContainText('R-4020');

    // Transmite só o marcado; o outro segue gerado.
    await page.getByTestId('re-marcar-2').uncheck();
    await expect(page.getByTestId('re-transmitir')).toContainText('(1)');
    await page.getByTestId('re-transmitir').click();
    await expect(page.getByTestId('re-ok')).toContainText('Lote 1 transmitido ao simulador');
    expect(corpos.at(-1)).toEqual({ caminho: '/transmitir', corpo: { periodo: competencia, eventos: [1] } });
    await expect(page.getByTestId('re-situacao-1')).toContainText('enviado');
    await expect(page.getByTestId('re-situacao-1')).toContainText('lote 1');
    await expect(page.getByTestId('re-situacao-2')).toContainText('gerado');
    // O enviado não é mais marcável; o retorno só aparece na linha do enviado.
    await expect(page.getByTestId('re-marcar-1')).toHaveCount(0);
    await expect(page.getByTestId('re-aceito-2')).toHaveCount(0);

    // Retorno aceito, com o recibo, na linha do evento.
    await page.getByTestId('re-recibo-1').fill('1.2.0000000000000000001');
    await page.getByTestId('re-aceito-1').click();
    await expect(page.getByTestId('re-ok')).toContainText('Evento aceito');
    expect(corpos.at(-1)).toEqual({
      caminho: '/retorno',
      corpo: { evento: 1, aceito: true, recibo: '1.2.0000000000000000001', ocorrencias: null },
    });
    await expect(page.getByTestId('re-situacao-1')).toContainText('aceito');
    await expect(page.getByTestId('re-situacao-1')).toContainText('1.2.0000000000000000001');
    await expect(page.getByTestId('re-aceito-1')).toHaveCount(0);

    // O segundo vai num lote à parte e volta rejeitado, com as ocorrências guardadas na linha.
    await expect(page.getByTestId('re-marcar-2')).toBeChecked();
    await page.getByTestId('re-transmitir').click();
    await expect(page.getByTestId('re-ok')).toContainText('Lote 2 transmitido');
    expect(corpos.at(-1)).toEqual({ caminho: '/transmitir', corpo: { periodo: competencia, eventos: [2] } });
    await page.getByTestId('re-ocorrencias-2').fill('Natureza do rendimento incompatível');
    await page.getByTestId('re-rejeitado-2').click();
    await expect(page.getByTestId('re-ok')).toContainText('Evento rejeitado');
    expect(corpos.at(-1)).toEqual({
      caminho: '/retorno',
      corpo: { evento: 2, aceito: false, recibo: null, ocorrencias: 'Natureza do rendimento incompatível' },
    });
    await expect(page.getByTestId('re-situacao-2')).toContainText('rejeitado');
    await expect(page.getByTestId('re-situacao-2')).toContainText('Natureza do rendimento incompatível');
    // Nada pronto para envio: a transmissão fica presa.
    await expect(page.getByTestId('re-transmitir')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (aceito e rejeitado)');

    // A outra série vai com a mesma competência; o igual ao já enviado não é gerado de novo.
    await escolher(page.getByTestId('re-serie'), 'R-2000');
    await page.getByTestId('re-gerar').click();
    await expect(page.getByTestId('re-ok')).toContainText('0 evento(s) gerado(s)');
    expect(corpos.at(-1)).toEqual({ caminho: '/gerar', corpo: { serie: 'R-2000', periodo: competencia } });
    await expect(page.getByTestId('re-eventos').locator('tbody tr')).toHaveCount(2);

    // O item está no menu de quem consulta a EFD-REINF.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'EFD-REINF')).click();
    await expect(page).toHaveURL(/\/financeiro\/fiscal\/reinf/);
    await expect(page.getByTestId('reinf-eventos')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
