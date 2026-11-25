// F3.8-11 (07-FIN linha 109): retenções na fonte pela tela. (1) Na ficha do título a receber, o tributo que o tomador
// reteve vem sugerido pela regra vigente no recebimento; a soma é conferida na hora contra o saldo, um clique registra
// todos, a baixa recebe o líquido em dinheiro e o estorno pede o motivo. (2) No painel fiscal: a regra do ISS só entra
// com o município do serviço escolhido pelo nome, a guia do retido da competência é gerada com o credor pelo nome e o
// saldo retido pelos tomadores é compensado na competência. Axe em cada passo.
// As rotas `financeiro/retencao-sofrida` e `financeiro/contabil-fiscal/retencao` dependem do banco do cliente, que a
// fonte sintética do E2E não tem: aqui a API delas é simulada (page.route) com o mesmo formato e estado, e a tela é
// exercitada inteira, conferindo o corpo que ela envia. O que fica gravado é provado contra o MariaDB em
// `retencao-sofrida.int.spec.ts` e `contabil-fiscal.int.spec.ts`.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (r: Route, corpo: unknown, status = 200) =>
  r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
const ok = (mensagem: string) => ({ mensagem, repetida: false, avisos: [] });

interface Enviado {
  readonly caminho: string;
  readonly corpo: Record<string, unknown>;
}
interface Retencao {
  id: number;
  tributoId: number;
  tributo: string;
  base: number;
  aliquota: number;
  valor: number;
  data: string;
  compensada: boolean;
}

/** A API da retenção sofrida e das retenções do contábil-fiscal, simulada com estado: devolve o que a tela gravou. */
function simularApi(page: Page): Enviado[] {
  const enviados: Enviado[] = [];
  const TRIBUTOS = [
    { id: 5, sigla: 'IRRF', descricao: 'Imposto de renda retido na fonte', codigoReceita: '1708' },
    { id: 6, sigla: 'COFINS', descricao: 'Contribuição para a seguridade', codigoReceita: '5952' },
    { id: 8, sigla: 'ISS', descricao: 'Imposto sobre serviços', codigoReceita: null },
  ];
  const sigla = (id: number) => TRIBUTOS.find((t) => t.id === id)?.sigla ?? String(id);
  // Fatura sintética de 100,00: a regra do recebimento sugere IRRF de 1,5% e COFINS de 3%.
  const FATURA = 100;
  const REGRA = [
    { tributoId: 5, aliquota: 1.5 },
    { tributoId: 6, aliquota: 3 },
  ];
  let seq = 90;
  let versao = 1;
  let retencoes: Retencao[] = [];
  let compensado = false;
  const regras: Record<string, unknown>[] = [];
  let guiaGerada = false;
  const centavos = (v: number) => Math.round(v * 100) / 100;
  const doTitulo = () => {
    const retido = centavos(retencoes.reduce((s, r) => s + r.valor, 0));
    const tem = new Set(retencoes.map((r) => r.tributoId));
    return {
      titulo: 9001,
      versao: `v${String(versao).padStart(10, '0')}`,
      emAberto: true,
      valorFatura: FATURA,
      saldoParcela: centavos(FATURA - retido),
      retido,
      retencoes,
      sugestoes: REGRA.filter((g) => !tem.has(g.tributoId)).map((g) => ({
        tributo: sigla(g.tributoId),
        tributoId: g.tributoId,
        regra: g.tributoId,
        base: FATURA,
        aliquota: g.aliquota,
        valor: centavos((FATURA * g.aliquota) / 100),
        dispensada: false,
      })),
      municipio: null,
      tributos: [5, 6, 8].map((id) => ({
        id,
        sigla: sigla(id),
        descricao: `Tributo sintético ${sigla(id)}`,
      })),
    };
  };

  void page.route('**/api/financeiro/retencao-sofrida/**', async (r) => {
    const req = r.request();
    const caminho = new URL(req.url()).pathname.replace('/api/financeiro/retencao-sofrida', '');
    if (req.method() === 'GET') {
      if (caminho.startsWith('/titulo/')) return json(r, doTitulo());
      if (caminho === '/municipios') return json(r, [{ id: 3106200, nome: 'Município Sintético', uf: 'MG' }]);
      if (caminho === '/saldo') {
        const irrf = retencoes.find((x) => x.tributoId === 5)?.valor ?? 30;
        return json(r, [
          {
            tributo: 'IRRF',
            tributoId: 5,
            retido: irrf,
            compensado: compensado ? irrf : 0,
            aCompensar: compensado ? 0 : irrf,
            desde: compensado ? null : '2026-10',
            creditos: compensado ? [] : [{ competencia: '2026-10', valor: irrf }],
          },
        ]);
      }
      if (caminho === '/compensacoes') {
        const irrf = retencoes.find((x) => x.tributoId === 5)?.valor ?? 30;
        return json(
          r,
          compensado
            ? [
                {
                  id: 71,
                  numero: 'CS-2026-10-5-1',
                  tributoId: 5,
                  tributo: 'IRRF',
                  competencia: '2026-10',
                  valor: irrf,
                  retencoes: 1,
                  em: '2026-11-05',
                },
              ]
            : [],
        );
      }
      return json(r, { title: 'Não encontrado' }, 404);
    }
    const corpo = req.postDataJSON() as Record<string, unknown>;
    enviados.push({ caminho, corpo });
    if (caminho === '/registrar') {
      const itens = corpo['itens'] as { tributo: number; base: number; aliquota: number; valor: number }[];
      retencoes = [
        ...retencoes,
        ...itens.map((i) => ({
          id: ++seq,
          tributoId: i.tributo,
          tributo: sigla(i.tributo),
          base: i.base,
          aliquota: i.aliquota,
          valor: i.valor,
          data: String(corpo['data']),
          compensada: false,
        })),
      ];
      versao += 1;
      return json(
        r,
        ok('Retenção do tomador registrada; o saldo da parcela foi abatido e o crédito fica a compensar.'),
      );
    }
    if (caminho === '/estornar') {
      retencoes = retencoes.filter((x) => x.id !== corpo['retencao']);
      versao += 1;
      return json(r, ok('Retenção estornada; o valor voltou ao saldo da parcela.'));
    }
    if (caminho === '/compensar') {
      compensado = true;
      return json(r, ok('Compensação registrada; o crédito usado saiu do saldo a compensar.'));
    }
    if (caminho === '/cancelar-compensacao') {
      compensado = false;
      return json(r, ok('Compensação cancelada; o crédito voltou ao saldo a compensar.'));
    }
    return json(r, { title: 'Não encontrado' }, 404);
  });

  void page.route('**/api/financeiro/contabil-fiscal/fornecedores**', (r) =>
    json(r, [{ id: 41, nome: 'Fazenda Sintética Arrecadadora', documento: '00000000000191' }]),
  );
  void page.route('**/api/financeiro/contabil-fiscal/retencao/**', async (r) => {
    const req = r.request();
    const caminho = new URL(req.url()).pathname.replace('/api/financeiro/contabil-fiscal/retencao', '');
    if (req.method() === 'GET') {
      if (caminho === '/apoio')
        return json(r, {
          tributos: TRIBUTOS,
          naturezas: [{ id: 9, codigo: '2.1', descricao: 'Tributos a recolher' }],
        });
      if (caminho === '/regras') return json(r, regras);
      if (caminho === '/em-aberto')
        return json(
          r,
          guiaGerada ? [] : [{ tributo: 5, sigla: 'IRRF', codigoReceita: '1708', retencoes: 2, valor: 45 }],
        );
      return json(r, []);
    }
    const corpo = req.postDataJSON() as Record<string, unknown>;
    enviados.push({ caminho: `/retencao${caminho}`, corpo });
    if (caminho === '/regras') {
      regras.push({
        id: regras.length + 1,
        tributoId: corpo['tributo'],
        tributo: sigla(Number(corpo['tributo'])),
        descricao: corpo['descricao'],
        momento: corpo['momento'],
        participante: corpo['participante'],
        municipio: corpo['municipio'],
        percentualBase: corpo['percentualBase'],
        aliquota: corpo['aliquota'],
        faixaInicio: null,
        faixaFim: null,
        deducao: 0,
        minimo: Number(corpo['minimo'] ?? 0),
        maximo: null,
        vigenciaInicio: corpo['vigenciaInicio'],
        vigenciaFim: null,
        ativo: true,
        versao: 1,
        codigoReceita: null,
      });
      return json(r, ok('Regra de retenção gravada.'));
    }
    if (caminho === '/recolhimento') {
      guiaGerada = true;
      return json(r, ok('Título do recolhimento gerado; as retenções da competência ficam ligadas a ele.'));
    }
    return json(r, { title: 'Não encontrado' }, 404);
  });
  return enviados;
}

test.describe('financeiro: retenções na fonte, no recebimento e na guia @F3.8-11', () => {
  test.describe.configure({ mode: 'serial' });

  test('título a receber: sugestão da regra → soma conferida → registrar tudo → baixa com o líquido → estorno; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const enviados = simularApi(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/receber/titulos/9001');
    await expect(page.getByTestId('rs-bloco')).toBeVisible();
    await expect(page.getByTestId('rs-nenhuma')).toBeVisible();
    // A regra já traz o valor de cada tributo; ninguém calcula de cabeça.
    await expect(page.getByTestId('rs-valor-IRRF')).toHaveValue('1,50');
    await expect(page.getByTestId('rs-valor-COFINS')).toHaveValue('3,00');
    await expect(page.getByTestId('rs-total')).toContainText('4,50');
    await expect(page.getByTestId('rs-total')).toContainText('95,50');
    // Validação na hora: a soma acima do saldo da parcela desliga o botão e diz por quê.
    await page.getByTestId('rs-valor-IRRF').fill('99,00');
    await expect(page.getByTestId('rs-passa')).toBeVisible();
    await expect(page.getByTestId('rs-registrar')).toBeDisabled();
    await page.getByTestId('rs-valor-IRRF').fill('1,50');
    await expect(page.getByTestId('rs-registrar')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/receber/titulos/:id (retenção do tomador sugerida)');
    await page.getByTestId('rs-registrar').click();
    await expect(page.getByTestId('rs-ok')).toContainText('Retenção do tomador registrada');
    expect(enviados.at(-1)).toMatchObject({
      caminho: '/registrar',
      corpo: {
        titulo: 9001,
        itens: [
          { tributo: 5, base: 100, aliquota: 1.5, valor: 1.5 },
          { tributo: 6, base: 100, aliquota: 3, valor: 3 },
        ],
      },
    });
    // O retido aparece na ficha e a baixa manual já vem com o líquido em dinheiro.
    await expect(page.getByTestId('rs-registradas')).toContainText('IRRF');
    await expect(page.getByTestId('rs-registradas')).toContainText('COFINS');
    await expect(page.getByTestId('trd-valor')).toHaveValue('95.5');
    await expect(page.getByTestId('rs-sem-regra')).toBeVisible();
    await semViolacaoAxe(page, '/financeiro/receber/titulos/:id (retenção registrada)');
    // O estorno pede o motivo e não some com o histórico (o servidor marca a linha, não apaga).
    await page.getByTestId('rs-estornar-IRRF').click();
    await expect(page.getByTestId('rs-confirmar-estorno')).toBeDisabled();
    await page.getByTestId('rs-motivo').fill('Retido informado errado pelo convênio');
    await semViolacaoAxe(page, '/financeiro/receber/titulos/:id (estorno da retenção)');
    await page.getByTestId('rs-confirmar-estorno').click();
    await expect(page.getByTestId('rs-ok')).toContainText('Retenção estornada');
    expect(enviados.at(-1)).toMatchObject({
      caminho: '/estornar',
      corpo: { titulo: 9001, motivo: 'Retido informado errado pelo convênio' },
    });
    await expect(page.getByTestId('rs-valor-IRRF')).toHaveValue('1,50');
    await expect(page.getByTestId('trd-valor')).toHaveValue('97');
    expect(externas).toEqual([]);
  });

  test('painel fiscal: regra do ISS com município → guia do retido com credor pelo nome → compensar o saldo; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const enviados = simularApi(page);
    await entrar(page, 'SINT.FIN.LANCA');
    await page.goto('/financeiro/fiscal/reinf');
    await expect(page.getByTestId('tela-fin-reinf')).toBeVisible();
    await page.getByTestId('dc-periodo').fill('2026-10');
    await expect(page.getByTestId('rt-painel')).toBeVisible();
    // Regra do ISS: sem o município do serviço o botão não liga.
    await escolher(page.getByTestId('rt-nova-tributo'), '8');
    await page.getByTestId('rt-nova-descricao').fill('ISS retido no município do serviço');
    await page.getByTestId('rt-nova-aliquota').fill('2');
    await expect(page.getByTestId('rt-nova-incluir')).toBeDisabled();
    await page.getByTestId('rt-nova-municipio').fill('Mun');
    await page.getByTestId('rt-nova-municipio-achados').getByRole('button').first().click();
    await expect(page.getByTestId('rt-nova-municipio-escolhido')).toContainText('Município Sintético (MG)');
    await expect(page.getByTestId('rt-nova-incluir')).toBeEnabled();
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (regra do ISS com município)');
    await page.getByTestId('rt-nova-incluir').click();
    await expect(page.getByTestId('rt-ok')).toContainText('Regra de retenção gravada');
    expect(enviados.at(-1)).toMatchObject({
      caminho: '/retencao/regras',
      corpo: { acao: 'incluir', tributo: 8, municipio: 3106200, aliquota: 2 },
    });
    await expect(page.getByTestId('rt-regras')).toContainText('ISS retido no município do serviço');
    // Guia do retido da competência: o credor é escolhido pelo nome e um clique gera o título.
    await expect(page.getByTestId('rt-aberto')).toContainText('IRRF');
    await expect(page.getByTestId('rt-gerar-IRRF')).toBeDisabled();
    await page.getByTestId('rt-credor-busca').fill('Fazenda');
    await page.getByTestId('rt-credor-achados').getByRole('button').first().click();
    await expect(page.getByTestId('rt-credor-escolhido')).toContainText('Fazenda Sintética Arrecadadora');
    await page.getByTestId('rt-gerar-IRRF').click();
    await expect(page.getByTestId('rt-ok')).toContainText('Título do recolhimento gerado');
    expect(enviados.at(-1)).toMatchObject({
      caminho: '/retencao/recolhimento',
      corpo: { competencia: '2026-10', tributo: 5, credor: 41, codigoReceita: '1708' },
    });
    await expect(page.getByTestId('rt-aberto')).toHaveCount(0);
    // Saldo retido pelos tomadores: compensa na competência da tela e o saldo zera.
    await expect(page.getByTestId('sc-linha-IRRF')).toContainText('30,00');
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (saldo a compensar)');
    // O primeiro clique só pede a confirmação, com o valor que vai ser usado; nada é gravado antes dela.
    const antesDeCompensar = enviados.length;
    await page.getByTestId('sc-compensar-IRRF').click();
    await expect(page.getByTestId('sc-confirma-IRRF')).toContainText('30,00');
    expect(enviados.length).toBe(antesDeCompensar);
    await page.getByTestId('sc-confirmar').click();
    await expect(page.getByTestId('sc-ok')).toContainText('Compensação registrada');
    expect(enviados.at(-1)).toMatchObject({
      caminho: '/compensar',
      corpo: { competencia: '2026-10', tributo: 5 },
    });
    await expect(page.getByTestId('sc-compensar-IRRF')).toHaveCount(0);
    // A compensação feita aparece e pode ser cancelada com motivo: o crédito volta ao saldo.
    await expect(page.getByTestId('sc-feita-71')).toContainText('CS-2026-10-5-1');
    await semViolacaoAxe(page, '/financeiro/fiscal/reinf (compensações feitas)');
    await page.getByTestId('sc-cancelar-71').click();
    await expect(page.getByTestId('sc-confirmar-cancelamento')).toBeDisabled();
    await page.getByTestId('sc-motivo').fill('Competência errada no filtro');
    await page.getByTestId('sc-confirmar-cancelamento').click();
    await expect(page.getByTestId('sc-ok')).toContainText('Compensação cancelada');
    expect(enviados.at(-1)).toMatchObject({
      caminho: '/cancelar-compensacao',
      corpo: { apuracao: 71, motivo: 'Competência errada no filtro' },
    });
    await expect(page.getByTestId('sc-feita-71')).toHaveCount(0);
    await expect(page.getByTestId('sc-compensar-IRRF')).toBeVisible();
    expect(externas).toEqual([]);
  });
});
