// F3.8 (07-FIN linha 111): a EFD-REINF por evento na tela `/financeiro/fiscal/reinf`. As leituras e as gravações dos
// eventos só existem no banco do cliente (na fonte sintética respondem 503), então este E2E simula
// `/api/financeiro/reinf/*` com um estado em memória que segue a regra do servidor: um evento por beneficiário, as
// séries são independentes (a R-4000 gera R-4020 e R-4010; a R-2000 gera o R-2010 do prestador com INSS), o tributo com
// suspensão em vigor vai como suspenso, o igual não é gerado de novo, o gerado que mudou fica cancelado, só o gerado é
// transmitido e só o enviado recebe retorno. A ligação rota -> banco é provada no contrato de efeito
// `aplicacao/reinf-eventos.int.spec.ts`, que chama o controlador de verdade com os MESMOS corpos conferidos aqui em
// `corpos.at(-1)` e confere as mensagens e o painel campo a campo. Aqui se prova o fluxo da tela: o processo com
// suspensão conferido enquanto se digita (a mesma regra do domínio), um clique gera os eventos da competência, os
// prontos já vêm marcados para a transmissão, o retorno (recibo ou ocorrências) é dado na linha do evento, o XML abre
// na tela, a suspensão é anulada ou encerrada e o processo alterado na linha (sem apagar), o título sem CPF nem CNPJ
// do credor é avisado e o item está no menu. Axe em cada passo.
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
  situacao: 'gerado' | 'enviado' | 'aceito' | 'rejeitado' | 'cancelado';
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

  test('processo conferido na hora, eventos por beneficiário e por série, transmissão, retorno, XML, suspensão encerrada e anulada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const eventos: Evento[] = [];
    const processos: Record<string, unknown>[] = [];
    // Um título com retenção na competência cujo credor não tem CPF nem CNPJ: fica fora dos eventos e é avisado.
    const titulosSemDocumento = [77];
    const AVISO =
      ' Atenção: 1 título(s) com retenção ficaram fora, sem CPF ou CNPJ do beneficiário no cadastro.';
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let lotes = 0;

    await page.route('**/api/financeiro/reinf/**', async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace(/^.*\/reinf/, '');
      if (req.method() === 'GET') {
        if (caminho === '/painel')
          return json(rota, {
            periodo: url.searchParams.get('periodo'),
            eventos,
            processos,
            titulosSemDocumento,
          });
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
        // O mesmo número é o mesmo processo; cada inclusão é uma suspensão dele.
        const mesmo = processos.find((p) => p['numero'] === corpo['numero']);
        processos.push({
          id: mesmo ? mesmo['id'] : processos.length + 1,
          suspensao: processos.length + 1,
          tipo: corpo['tipo'],
          numero: corpo['numero'],
          vara: corpo['vara'],
          indicativo: corpo['indicativo'],
          tributo: corpo['tributo'],
          beneficiario: corpo['beneficiario'],
          vigenciaInicio: corpo['vigenciaInicio'],
          vigenciaFim: corpo['vigenciaFim'],
          vigenciaFimProcesso: corpo['vigenciaFim'],
          encerradaEm: null,
          anulada: false,
          motivoEncerramento: null,
          situacao: 'ativo',
        });
        return ok('Processo com suspensão gravado.');
      }
      if (caminho === '/suspensoes/encerrar') {
        const p = processos.find((x) => x['suspensao'] === corpo['suspensao']);
        if (!p || p['anulada'] === true || p['encerradaEm'] !== null)
          return recusa(rota, 'suspensao-ja-encerrada', 'A suspensão já foi encerrada ou anulada.');
        Object.assign(p, {
          encerradaEm: corpo['fim'],
          anulada: corpo['fim'] === null,
          motivoEncerramento: corpo['motivo'],
          vigenciaFim: corpo['fim'] ?? p['vigenciaFim'],
        });
        return ok(
          corpo['fim'] === null
            ? 'Suspensão anulada: não vale em nenhuma competência.'
            : 'Suspensão encerrada: gere de novo os eventos das competências seguintes.',
        );
      }
      if (caminho === '/processos/alterar') {
        const alvo = processos.filter((x) => x['id'] === corpo['processo']);
        for (const p of alvo)
          Object.assign(p, {
            vara: corpo['vara'],
            vigenciaInicio: corpo['vigenciaInicio'],
            vigenciaFimProcesso: corpo['vigenciaFim'],
            vigenciaFim: p['encerradaEm'] ?? corpo['vigenciaFim'],
          });
        const emVigor = alvo.filter((p) => p['anulada'] !== true && p['encerradaEm'] === null).length;
        return ok(`Processo alterado: vale para ${emVigor} suspensão(ões) em vigor.`);
      }
      if (caminho === '/gerar') {
        // A regra do servidor: cada série gera só os eventos dela, um por beneficiário; o tributo com suspensão em
        // vigor na competência (não anulada, não encerrada antes dela) vai como suspenso; o igual ao vigente não é
        // gerado de novo; o gerado que mudou fica cancelado e entra o novo.
        const periodo = String(corpo['periodo']);
        const suspende = (tributo: string, beneficiario: string) =>
          processos.some(
            (p) =>
              p['tributo'] === tributo &&
              (p['beneficiario'] === null || p['beneficiario'] === beneficiario) &&
              p['anulada'] !== true &&
              (p['encerradaEm'] === null || String(p['encerradaEm']) >= `${periodo}-01`),
          );
        const plano: [string, string, string, number][] =
          corpo['serie'] === 'R-2000'
            ? [['R-2010', CNPJ, 'inss', 110]]
            : [
                ['R-4020', CNPJ, 'ir', 15],
                ['R-4010', CPF, 'ir', 15],
              ];
        let gerados = 0;
        let iguais = 0;
        for (const [evento, beneficiario, tributo, valor] of plano) {
          const suspenso = suspende(tributo, beneficiario) ? valor : 0;
          const vigente = eventos.findLast(
            (e) => e.evento === evento && e.beneficiario === beneficiario && e.situacao !== 'cancelado',
          );
          if (vigente && vigente.valorSuspenso === suspenso) {
            iguais += 1;
            continue;
          }
          if (vigente && vigente.situacao === 'gerado') vigente.situacao = 'cancelado';
          gerados += 1;
          eventos.push({
            id: eventos.length + 1,
            evento,
            acao: 'inclusao',
            situacao: 'gerado',
            recibo: null,
            retifica: null,
            beneficiario,
            valorBruto: 1000,
            valorRetido: valor - suspenso,
            valorSuspenso: suspenso,
            documentos: 1,
            processos: suspenso > 0 ? 1 : 0,
            retornos: 0,
            lote: null,
            protocolo: null,
            mensagem: null,
          });
        }
        return ok(
          `${gerados} evento(s) gerado(s), 0 exclusão(ões), ${iguais} igual(is) ao já enviado.${AVISO}`,
        );
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
    // O título com retenção cujo credor não tem CPF nem CNPJ é avisado no alto, com o número dele.
    await expect(page.getByTestId('re-sem-documento')).toContainText('1 título(s)');
    await expect(page.getByTestId('re-sem-documento')).toContainText('77');
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
    await expect(page.getByTestId('re-ok')).toContainText('1 título(s) com retenção ficaram fora');
    expect(corpos.at(-1)).toEqual({ caminho: '/gerar', corpo: { serie: 'R-4000', periodo: competencia } });
    await expect(page.getByTestId('re-eventos').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('re-evento-1')).toHaveAttribute('data-beneficiario', CNPJ);
    await expect(page.getByTestId('re-evento-1')).toContainText('R-4020');
    await expect(page.getByTestId('re-evento-1').locator('td').nth(4)).toContainText('0,00');
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

    // Outra suspensão do mesmo processo (INSS, para todos os beneficiários): vara, indicativo, vigência e decisão
    // seguem preenchidos; só o número e o tributo mudam.
    await page.getByTestId('re-p-numero').fill(PROCESSO);
    await escolher(page.getByTestId('re-p-tributo'), 'INSS');
    await page.getByTestId('re-p-incluir').click();
    await expect(page.getByTestId('re-ok')).toContainText('Processo com suspensão gravado');
    expect(corpos.at(-1)).toEqual({
      caminho: '/processos',
      corpo: {
        tipo: 'judicial',
        numero: PROCESSO,
        vara: '0012',
        indicativo: '01',
        tributo: 'inss',
        beneficiario: null,
        vigenciaInicio: `${competencia}-01`,
        vigenciaFim: null,
        dataDecisao: `${competencia}-01`,
      },
    });
    await expect(listaProcessos.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('re-suspensao-2')).toContainText('todos');
    await expect(page.getByTestId('re-s-situacao-2')).toContainText('em vigor');

    // A série R-2000 é independente da R-4000: gera o R-2010 do prestador, com o INSS suspenso pelo processo.
    await escolher(page.getByTestId('re-serie'), 'R-2000');
    await page.getByTestId('re-gerar').click();
    await expect(page.getByTestId('re-ok')).toContainText('1 evento(s) gerado(s)');
    expect(corpos.at(-1)).toEqual({ caminho: '/gerar', corpo: { serie: 'R-2000', periodo: competencia } });
    await expect(page.getByTestId('re-eventos').locator('tbody tr')).toHaveCount(3);
    await expect(page.getByTestId('re-evento-3')).toHaveAttribute('data-beneficiario', CNPJ);
    await expect(page.getByTestId('re-evento-3')).toContainText('R-2010');
    await expect(page.getByTestId('re-evento-3').locator('td').nth(4)).toContainText('0,00');
    await expect(page.getByTestId('re-evento-3').locator('td').nth(5)).toContainText('110,00');
    // Repetir a MESMA série sem mudança não gera outro: o igual é contado.
    await page.getByTestId('re-gerar').click();
    await expect(page.getByTestId('re-ok')).toContainText(
      '0 evento(s) gerado(s), 0 exclusão(ões), 1 igual(is)',
    );
    await expect(page.getByTestId('re-eventos').locator('tbody tr')).toHaveCount(3);

    // A suspensão de INSS foi lançada por engano: é anulada na linha, com o motivo (conferido na hora), sem apagar.
    await page.getByTestId('re-s-abrir-2').click();
    await expect(page.getByTestId('re-edicao')).toBeVisible();
    await expect(page.getByTestId('re-s-anular')).toBeDisabled();
    await expect(page.getByTestId('re-s-encerrar')).toBeDisabled();
    await page.getByTestId('re-s-motivo').fill('abc');
    await expect(page.getByTestId('re-s-anular')).toBeDisabled();
    await page.getByTestId('re-s-motivo').fill('Lançada por engano');
    await expect(page.getByTestId('re-s-anular')).toBeEnabled();
    // O último dia da suspensão não vem antes do início da vigência.
    await page.getByTestId('re-s-fim').fill(`${Number(competencia.slice(0, 4)) - 1}-12-31`);
    await expect(page.getByTestId('re-s-recusa')).toContainText('não vem antes do início');
    await expect(page.getByTestId('re-s-encerrar')).toBeDisabled();
    await page.getByTestId('re-s-fim').fill('');
    await expect(page.getByTestId('re-s-recusa')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (suspensão em edição)');
    await page.getByTestId('re-s-anular').click();
    await expect(page.getByTestId('re-ok')).toContainText('Suspensão anulada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/suspensoes/encerrar',
      corpo: { suspensao: 2, fim: null, motivo: 'Lançada por engano' },
    });
    await expect(page.getByTestId('re-edicao')).toHaveCount(0);
    await expect(listaProcessos.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('re-s-situacao-2')).toContainText('anulada: Lançada por engano');
    await expect(page.getByTestId('re-s-abrir-2')).toHaveCount(0);
    // Gerar de novo: o R-2010 gerado com o suspenso fica cancelado e entra o novo, com o INSS retido.
    await page.getByTestId('re-gerar').click();
    await expect(page.getByTestId('re-ok')).toContainText('1 evento(s) gerado(s)');
    await expect(page.getByTestId('re-situacao-3')).toContainText('cancelado');
    await expect(page.getByTestId('re-evento-4')).toContainText('R-2010');
    await expect(page.getByTestId('re-evento-4').locator('td').nth(4)).toContainText('110,00');
    await expect(page.getByTestId('re-evento-4').locator('td').nth(5)).toContainText('0,00');

    // Os dados do processo (vara e vigência) mudam por ação própria na linha, conferida na hora.
    await page.getByTestId('re-s-abrir-1').click();
    await expect(page.getByTestId('re-pa-vara')).toHaveValue('0012');
    await expect(page.getByTestId('re-pa-inicio')).toHaveValue(`${competencia}-01`);
    await page.getByTestId('re-pa-fim').fill(`${Number(competencia.slice(0, 4)) - 1}-12-31`);
    await expect(page.getByTestId('re-pa-recusa')).toContainText('fim da vigência');
    await expect(page.getByTestId('re-pa-gravar')).toBeDisabled();
    await page.getByTestId('re-pa-fim').fill(`${Number(competencia.slice(0, 4)) + 1}-12-31`);
    await page.getByTestId('re-pa-vara').fill('');
    await expect(page.getByTestId('re-pa-recusa')).toContainText('vara');
    await page.getByTestId('re-pa-vara').fill('0013');
    await expect(page.getByTestId('re-pa-recusa')).toHaveCount(0);
    await page.getByTestId('re-pa-gravar').click();
    await expect(page.getByTestId('re-ok')).toContainText('Processo alterado: vale para 1 suspensão(ões)');
    expect(corpos.at(-1)).toEqual({
      caminho: '/processos/alterar',
      corpo: {
        processo: 1,
        vara: '0013',
        vigenciaInicio: `${competencia}-01`,
        vigenciaFim: `${Number(competencia.slice(0, 4)) + 1}-12-31`,
      },
    });
    // A liminar caiu: a suspensão de IR é encerrada no último dia em que vale, com o motivo; a linha continua.
    await page.getByTestId('re-s-abrir-1').click();
    await page.getByTestId('re-s-fim').fill(`${competencia}-28`);
    await page.getByTestId('re-s-motivo').fill('Liminar cassada');
    await page.getByTestId('re-s-encerrar').click();
    await expect(page.getByTestId('re-ok')).toContainText('Suspensão encerrada');
    expect(corpos.at(-1)).toEqual({
      caminho: '/suspensoes/encerrar',
      corpo: { suspensao: 1, fim: `${competencia}-28`, motivo: 'Liminar cassada' },
    });
    await expect(page.getByTestId('re-s-situacao-1')).toContainText(
      `encerrada em ${competencia}-28: Liminar cassada`,
    );
    await expect(page.getByTestId('re-s-abrir-1')).toHaveCount(0);
    await expect(listaProcessos.locator('tbody tr')).toHaveCount(2);
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (suspensões encerrada e anulada)');

    // O item está no menu de quem consulta a EFD-REINF.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'EFD-REINF')).click();
    await expect(page).toHaveURL(/\/financeiro\/fiscal\/reinf/);
    await expect(page.getByTestId('reinf-eventos')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
