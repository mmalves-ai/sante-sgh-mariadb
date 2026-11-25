// F3.8 (07-FIN linha 113): o ciclo da nota de serviço na tela `/financeiro/fiscal/nfse`. As leituras e as gravações do
// ciclo só existem no banco do cliente (na fonte sintética respondem 503 e o painel some), então este E2E simula
// `/api/financeiro/fiscal/notas-servico/*` com um estado em memória que segue a regra do servidor (a fatura com nota
// ativa sai da seleção, só a autorizada é cancelada ou substituída, a substituta aponta para a original). O que fica
// no banco é provado no contrato de efeito `aplicacao/nota-servico.int.spec.ts`; aqui se prova o fluxo da tela: várias
// faturas num envio só, a dedução conferida enquanto se digita (a mesma regra do domínio), cancelar e substituir na
// linha da nota com motivo do catálogo, justificativa contada e o prazo do município à vista, e o histórico da nota.
// Dados sintéticos (nenhuma pessoa nem empresa real). Axe em cada passo.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const JUSTIFICATIVA = 'Valor da fatura corrigido depois da conferência.';

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

interface Nota {
  id: number;
  rps: number;
  numero: string | null;
  emitidaEm: string;
  tituloReceber: number;
  tituloNumero: string;
  conta: null;
  tomador: string;
  valorServicos: number;
  valorDeducoes: number;
  baseCalculo: number;
  aliquotaIss: number;
  valorIss: number;
  issRetido: boolean;
  valorLiquido: number;
  situacao: string;
  lote: number | null;
  substitui: number | null;
  substituta: number | null;
}
interface Evento {
  id: number;
  nota: number;
  tipo: string;
  em: string;
  protocolo: string | null;
  motivo: string | null;
  justificativa: string | null;
  substituta: number | null;
  usuario: string;
}

test.describe('financeiro: ciclo da nota de serviço @F3.8-13 @C1-062', () => {
  test.setTimeout(180_000);

  test('lote por faturas com dedução conferida na hora, cancelar e substituir na linha, prazo e histórico; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const agora = new Date();
    const haDias = (d: number) => new Date(agora.getTime() - d * 86_400_000).toISOString();
    const faturas = [
      { titulo: 9101, numero: 'TR-9101', documento: 'F-1', emissao: '2026-10-05', valor: 1000 },
      { titulo: 9102, numero: 'TR-9102', documento: 'F-2', emissao: '2026-10-06', valor: 500 },
      { titulo: 9103, numero: 'TR-9103', documento: 'F-3', emissao: '2026-10-07', valor: 800 },
    ].map((f) => ({ ...f, situacao: 'aberto', devedor: 'OPERADORA SINTETICA' }));
    const motivos = [
      {
        id: 1,
        codigo: 'erro_valor_tributo',
        descricao: 'Valor, dedução ou tributo incorreto',
        justificativaPadrao: null,
      },
      {
        id: 2,
        codigo: 'nota_duplicada',
        descricao: 'Nota emitida em duplicidade',
        justificativaPadrao: null,
      },
    ];
    const parametros = {
      municipio: { ibge: '0000000', nome: 'MUNICIPIO SINTETICO' },
      aliquota: 2,
      issRetido: false,
      prazoCancelamentoDias: 30,
      prazoSubstituicaoDias: 30,
      prazoPadrao: true,
      temRegra: true,
    };
    // Uma nota antiga, emitida há 40 dias: fora do prazo do município.
    const notas: Nota[] = [
      {
        id: 1,
        rps: 1,
        numero: 'SIM000000001',
        emitidaEm: haDias(40),
        tituloReceber: 9000,
        tituloNumero: 'TR-9000',
        conta: null,
        tomador: 'OPERADORA SINTETICA',
        valorServicos: 300,
        valorDeducoes: 0,
        baseCalculo: 300,
        aliquotaIss: 2,
        valorIss: 6,
        issRetido: false,
        valorLiquido: 300,
        situacao: 'autorizada',
        lote: 1,
        substitui: null,
        substituta: null,
      },
    ];
    const eventos: Evento[] = [];
    const corpos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let lotes = 1;
    const evento = (nota: number, tipo: string, extra: Partial<Evento> = {}) =>
      eventos.push({
        id: eventos.length + 1,
        nota,
        tipo,
        em: agora.toISOString(),
        protocolo: null,
        motivo: null,
        justificativa: null,
        substituta: null,
        usuario: 'USUARIO SINTETICO',
        ...extra,
      });
    const ativa = (titulo: number) =>
      notas.some(
        (n) => n.tituloReceber === titulo && ['rps_gerado', 'enviada', 'autorizada'].includes(n.situacao),
      );
    const nova = (p: Record<string, unknown>, lote: number | null, substitui: number | null): Nota => {
      const servicos = Number(p['valorServicos']);
      const ded = ((p['deducoes'] as { valor: number }[] | undefined) ?? []).reduce((s, d) => s + d.valor, 0);
      const id = notas.length + 1;
      const f = faturas.find((x) => x.titulo === p['tituloReceber']);
      const n: Nota = {
        id,
        rps: id,
        numero: `SIM${String(id).padStart(9, '0')}`,
        emitidaEm: agora.toISOString(),
        tituloReceber: Number(p['tituloReceber']),
        tituloNumero: f?.numero ?? `TR-${String(p['tituloReceber'])}`,
        conta: null,
        tomador: 'OPERADORA SINTETICA',
        valorServicos: servicos,
        valorDeducoes: ded,
        baseCalculo: servicos - ded,
        aliquotaIss: Number(p['aliquotaIss']),
        valorIss: Math.round((servicos - ded) * Number(p['aliquotaIss'])) / 100,
        issRetido: false,
        valorLiquido: servicos,
        situacao: 'autorizada',
        lote,
        substitui,
        substituta: null,
      };
      notas.unshift(n);
      evento(id, 'emissao');
      evento(id, 'autorizacao', { protocolo: n.numero });
      return n;
    };

    await page.route('**/api/financeiro/fiscal/notas-servico**', async (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^.*\/notas-servico/, '');
      if (req.method() === 'GET') {
        if (caminho === '') return json(rota, notas);
        if (caminho === '/apoio')
          return json(rota, {
            destino: 'simulador',
            parametros,
            motivos,
            faturas: faturas.filter((f) => !ativa(f.titulo)),
          });
        const id = Number(/^\/(\d+)\/historico$/.exec(caminho)?.[1]);
        const n = notas.find((x) => x.id === id);
        if (!n) return rota.fulfill({ status: 404 });
        return json(rota, {
          nota: n.id,
          numero: n.numero,
          situacao: n.situacao,
          eventos: eventos.filter((e) => e.nota === id),
          deducoes:
            n.valorDeducoes > 0
              ? [
                  {
                    sequencia: 1,
                    tipo: 'material',
                    descricao: 'ORTESE SINTETICA',
                    valor: n.valorDeducoes,
                    documento: 'NF-SINT-1',
                  },
                ]
              : [],
          tributos: [],
        });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      corpos.push({ caminho, corpo });
      const ok = (mensagem: string) => json(rota, { mensagem, repetida: false, ids: {}, avisos: [] });
      if (caminho === '/lote') {
        const pedidas = corpo['notas'] as Record<string, unknown>[];
        if (pedidas.some((p) => ativa(Number(p['tituloReceber']))))
          return recusa(
            rota,
            'fatura-com-nota',
            'Nota 1: a fatura já tem nota emitida; para corrigi-la, substitua a nota.',
          );
        const lote = ++lotes;
        for (const p of pedidas) nova(p, lote, null);
        return ok(`Lote ${lote}: ${pedidas.length} nota(s) autorizada(s) pelo simulador da prefeitura.`);
      }
      if (caminho === '/prazo') {
        Object.assign(parametros, {
          prazoCancelamentoDias: corpo['prazoCancelamentoDias'],
          prazoSubstituicaoDias: corpo['prazoSubstituicaoDias'],
          prazoPadrao: false,
        });
        return ok('Prazos do município gravados.');
      }
      const alvo = /^\/(\d+)\/(cancelar|substituir)$/.exec(caminho);
      const n = notas.find((x) => x.id === Number(alvo?.[1]));
      if (!alvo || !n) return rota.fulfill({ status: 404 });
      if (n.situacao !== 'autorizada')
        return recusa(rota, 'nota-nao-alteravel', 'Só a nota emitida e ativa pode ser alterada.');
      const motivo = motivos.find((m) => m.id === corpo['motivo'])?.descricao ?? null;
      if (alvo[2] === 'cancelar') {
        n.situacao = 'cancelada';
        evento(n.id, 'cancelamento', { motivo, justificativa: String(corpo['justificativa']) });
        return ok('Nota cancelada; ela continua no histórico e a fatura pode receber outra nota.');
      }
      n.situacao = 'substituida';
      const s = nova(corpo['nova'] as Record<string, unknown>, null, n.id);
      n.substituta = s.id;
      evento(n.id, 'substituicao', {
        motivo,
        justificativa: String(corpo['justificativa']),
        substituta: s.id,
      });
      return ok(`Nota substituída; a substituta saiu com o RPS ${s.rps}.`);
    });

    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/fiscal/nfse');
    await expect(page.getByTestId('tela-fin-nfse')).toBeVisible();
    await expect(page.getByTestId('ns-ciclo')).toBeVisible();
    // A nota só sai pelo ciclo: o formulário avulso e a lista antiga não existem mais na tela.
    await expect(page.getByTestId('nf-formulario')).toHaveCount(0);
    await expect(page.getByTestId('nf-lista')).toHaveCount(0);
    await expect(page.getByTestId('ns-destino')).toContainText('simulador');
    await expect(page.getByTestId('ns-faturas').locator('tbody tr')).toHaveCount(3);
    // A alíquota vem da regra do município; sem fatura escolhida o botão fica desligado.
    await expect(page.getByTestId('ns-aliquota')).toHaveValue('2');
    await expect(page.getByTestId('ns-emitir')).toBeDisabled();
    await semViolacaoAxe(page, '/financeiro/fiscal/nfse (seleção de faturas)');

    // Duas faturas no mesmo envio; a conferência acompanha o preenchimento.
    await page.getByTestId('ns-marcar-9101').check();
    await page.getByTestId('ns-marcar-9102').check();
    await expect(page.getByTestId('ns-resumo')).toContainText('2 fatura(s)');
    await expect(page.getByTestId('ns-resumo')).toContainText('1.500,00');
    await expect(page.getByTestId('ns-recusa-lote')).toContainText('item da lista de serviços');
    await page.getByTestId('ns-item').fill('4.03');
    await expect(page.getByTestId('ns-recusa-lote')).toContainText('classificação tributária');
    await page.getByTestId('ns-classificacao').fill('010101');
    await expect(page.getByTestId('ns-recusa-lote')).toHaveCount(0);
    // A dedução da base exige o comprovante e não pode chegar ao valor da fatura.
    await page.getByTestId('ns-deduzir-9102').check();
    await escolher(page.getByTestId('ns-ded-tipo-9102'), 'material');
    await page.getByTestId('ns-ded-valor-9102').fill('100');
    await expect(page.getByTestId('ns-recusa-lote')).toContainText('Descreva a dedução');
    await page.getByTestId('ns-ded-descricao-9102').fill('ORTESE SINTETICA');
    await expect(page.getByTestId('ns-recusa-lote')).toContainText('documento que a comprova');
    await expect(page.getByTestId('ns-emitir')).toBeDisabled();
    await page.getByTestId('ns-ded-documento-9102').fill('NF-SINT-1');
    await page.getByTestId('ns-ded-valor-9102').fill('500');
    await expect(page.getByTestId('ns-recusa-lote')).toContainText('não podem chegar ao valor');
    await page.getByTestId('ns-ded-valor-9102').fill('100');
    await expect(page.getByTestId('ns-recusa-lote')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/fiscal/nfse (lote com dedução)');
    await page.getByTestId('ns-emitir').click();
    await expect(page.getByTestId('ns-ok')).toContainText('2 nota(s) autorizada(s)');
    const lote = corpos.at(-1);
    expect(lote?.caminho).toBe('/lote');
    expect(
      (lote?.corpo['notas'] as { tituloReceber: number; deducoes: unknown[] }[]).map((n) => [
        n.tituloReceber,
        n.deducoes.length,
      ]),
    ).toEqual([
      [9101, 0],
      [9102, 1],
    ]);
    // As faturas emitidas saem da seleção e as notas entram na lista.
    await expect(page.getByTestId('ns-faturas').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('ns-notas').locator('tbody tr')).toHaveCount(3);
    await expect(page.getByTestId('ns-situacao-3')).toContainText('Autorizada');

    // Cancelar na linha: o motivo vem do catálogo, a justificativa é contada e o botão só libera com tudo certo.
    await page.getByTestId('ns-cancelar-2').click();
    await expect(page.getByTestId('ns-prazo')).toContainText('prazo do município é de 30 dia(s)');
    await expect(page.getByTestId('ns-recusa-acao')).toContainText('motivo ativo do catálogo');
    await expect(page.getByTestId('ns-confirmar')).toBeDisabled();
    await escolher(page.getByTestId('ns-motivo'), '2');
    await page.getByTestId('ns-justificativa').fill('curta');
    await expect(page.getByTestId('ns-recusa-acao')).toContainText('ao menos 15 letras');
    await page.getByTestId('ns-justificativa').fill(JUSTIFICATIVA);
    await expect(page.getByTestId('ns-recusa-acao')).toHaveCount(0);
    await semViolacaoAxe(page, '/financeiro/fiscal/nfse (cancelamento)');
    await page.getByTestId('ns-confirmar').click();
    await expect(page.getByTestId('ns-ok')).toContainText('Nota cancelada');
    await expect(page.getByTestId('ns-situacao-2')).toContainText('Cancelada');
    await expect(page.getByTestId('ns-cancelar-2')).toHaveCount(0);
    expect(corpos.at(-1)).toEqual({
      caminho: '/2/cancelar',
      corpo: { motivo: 2, justificativa: JUSTIFICATIVA },
    });
    // A fatura da nota cancelada volta à seleção.
    await expect(page.getByTestId('ns-fatura-9101')).toBeVisible();

    // Substituir na linha: a substituta é da mesma fatura, com o novo valor.
    await page.getByTestId('ns-substituir-3').click();
    await escolher(page.getByTestId('ns-motivo'), '1');
    await page.getByTestId('ns-justificativa').fill(JUSTIFICATIVA);
    await page.getByTestId('ns-novo-valor').fill('0');
    await expect(page.getByTestId('ns-recusa-acao')).toContainText('valor dos serviços');
    await page.getByTestId('ns-novo-valor').fill('450');
    await expect(page.getByTestId('ns-recusa-acao')).toHaveCount(0);
    await page.getByTestId('ns-confirmar').click();
    await expect(page.getByTestId('ns-ok')).toContainText('Nota substituída');
    await expect(page.getByTestId('ns-situacao-3')).toContainText('substituída pela nota 4');
    await expect(page.getByTestId('ns-situacao-4')).toContainText('substitui a nota 3');
    const troca = corpos.at(-1);
    expect(troca?.caminho).toBe('/3/substituir');
    expect(troca?.corpo['nova']).toMatchObject({ tituloReceber: 9102, valorServicos: 450 });

    // A nota antiga está fora do prazo do município: a tela diz por quê e não deixa confirmar.
    await page.getByTestId('ns-cancelar-1').click();
    await escolher(page.getByTestId('ns-motivo'), '1');
    await page.getByTestId('ns-justificativa').fill(JUSTIFICATIVA);
    await expect(page.getByTestId('ns-recusa-acao')).toContainText('emitida há 40 dias');
    await expect(page.getByTestId('ns-confirmar')).toBeDisabled();
    await page.getByTestId('ns-desistir').click();
    await expect(page.getByTestId('ns-acao')).toHaveCount(0);

    // O histórico da nota substituída: emissão, autorização e a substituição com o motivo e a substituta.
    await page.getByTestId('ns-historico-3').click();
    const historico = page.getByTestId('ns-historico');
    await expect(historico.locator('tbody tr')).toHaveCount(3);
    await expect(page.getByTestId('ns-evento-substituicao')).toContainText('substituta: nota 4');
    await expect(page.getByTestId('ns-evento-substituicao')).toContainText(JUSTIFICATIVA);
    await expect(page.getByTestId('ns-hist-deducoes')).toContainText('NF-SINT-1');
    await semViolacaoAxe(page, '/financeiro/fiscal/nfse (histórico)');
    await page.getByTestId('ns-hist-fechar').click();

    // Os prazos do município ficam na mesma tela.
    await page.getByTestId('ns-prazos').locator('summary').click();
    await page.getByTestId('ns-prazo-cancelamento').fill('60');
    await page.getByTestId('ns-prazo-substituicao').fill('60');
    await page.getByTestId('ns-gravar-prazos').click();
    await expect(page.getByTestId('ns-ok')).toContainText('Prazos do município gravados');
    await expect(page.getByTestId('ns-prazos-texto')).toContainText('cancelar em até 60 dia(s)');
    expect(corpos.at(-1)?.corpo).toMatchObject({
      prazoCancelamentoDias: 60,
      prazoSubstituicaoDias: 60,
      aliquota: null,
    });
    // Com o prazo maior, a nota antiga já pode ser cancelada.
    await page.getByTestId('ns-cancelar-1').click();
    await escolher(page.getByTestId('ns-motivo'), '1');
    await page.getByTestId('ns-justificativa').fill(JUSTIFICATIVA);
    await expect(page.getByTestId('ns-recusa-acao')).toHaveCount(0);
    await expect(page.getByTestId('ns-confirmar')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/fiscal/nfse (prazos)');

    // O item está no menu de quem consulta as notas de serviço.
    await page.goto('/inicio');
    await (await itemDoMenu(page, 'NFS-e')).click();
    await expect(page).toHaveURL(/\/financeiro\/fiscal\/nfse/);
    await expect(page.getByTestId('ns-ciclo')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
