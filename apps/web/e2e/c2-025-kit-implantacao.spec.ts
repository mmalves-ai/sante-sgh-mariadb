// E2E @C2-025 (01-ADM L98, ficha F78-01): o que falta para operar pelo caminho da tela /administracao/implantacao. O
// administrador vê o diagnóstico do hospital novo pelo checklist padrão (contagem e mínimo de cada cadastro), abre a
// implantação, reconta os cadastros, dispensa um item com o motivo (o botão só libera com o motivo, regra do domínio
// conferida na hora) e inclui e mede uma meta. As rotas /api/implantacao/kit exigem o banco próprio e o E2E roda com a
// fonte sintética (sem núcleo): as respostas da API são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco
// está no contrato de efeito apps/api/src/modulos/implantacao/kit-implantacao-propria.int.spec.ts.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const modelo = (id: number, codigo: string, modulo: string, titulo: string, critico: boolean) => ({
  id,
  codigo,
  titulo,
  descricao: null,
  modulo,
  tipo: 'cadastro_minimo',
  entidade: codigo === 'CAD-LEITO' ? 'leito' : 'convenio',
  quantidadeMinima: 1,
  orientacao: null,
  ordem: id,
  critico,
  ativo: true,
  versao: 1,
});
const LEITO = modelo(1, 'CAD-LEITO', 'internacao', 'Leitos cadastrados', true);
const CONVENIO = modelo(2, 'CAD-CONVENIO', 'faturamento', 'Convênios cadastrados', false);

interface Estado {
  aberta: boolean;
  dispensado: boolean;
  meta: boolean;
  medida: boolean;
}

function painel(e: Estado) {
  const itens = [
    {
      id: 11,
      sequencia: 1,
      modelo: LEITO,
      situacao: 'pendente',
      quantidadePrevista: 1,
      quantidadeRealizada: 0,
      dataInicioPrevista: null,
      dataPrazo: '2026-11-20',
      concluidoEm: null,
      ultimaConferenciaEm: null,
      responsavelNome: null,
      responsavelEmail: null,
      motivoDispensa: null,
      observacao: null,
      atrasado: true,
      versao: 1,
    },
    {
      id: 12,
      sequencia: 2,
      modelo: CONVENIO,
      situacao: e.dispensado ? 'dispensado' : 'pendente',
      quantidadePrevista: 1,
      quantidadeRealizada: 0,
      dataInicioPrevista: null,
      dataPrazo: null,
      concluidoEm: null,
      ultimaConferenciaEm: null,
      responsavelNome: null,
      responsavelEmail: null,
      motivoDispensa: e.dispensado ? 'Hospital só atende particular' : null,
      observacao: null,
      atrasado: false,
      versao: e.dispensado ? 2 : 1,
    },
  ];
  const abertos = itens.filter((i) => i.situacao !== 'dispensado');
  return {
    hoje: '2026-11-25',
    implantacao: e.aberta
      ? {
          id: 5,
          nome: 'Implantação sintética',
          fase: 'planejamento',
          situacao: 'em_andamento',
          dataInicioPrevista: '2026-11-25',
          dataFimPrevista: '2027-01-31',
          dataViradaPrevista: '2027-01-15',
          viradaEm: null,
          responsavelClienteNome: null,
          responsavelClienteEmail: null,
          observacao: null,
          versao: 1,
        }
      : null,
    diagnostico: e.aberta
      ? []
      : [
          { ...LEITO, contagem: 0, situacao: 'pendente' },
          { ...CONVENIO, contagem: 0, situacao: 'pendente' },
        ],
    itens: e.aberta ? itens : [],
    metas:
      e.aberta && e.meta
        ? [
            {
              id: 31,
              sequencia: 1,
              processo: 'Admissão',
              indicador: 'adesao',
              descricao: null,
              unidade: '%',
              valorMeta: 90,
              valorMedido: e.medida ? 95 : null,
              dataLimite: null,
              medidoEm: null,
              situacao: e.medida ? 'atingida' : 'pendente',
              analise: null,
              melhorias: null,
              versao: e.medida ? 2 : 1,
            },
          ]
        : [],
    resumo: {
      total: e.aberta ? 2 : 0,
      prontos: 0,
      dispensados: e.aberta && e.dispensado ? 1 : 0,
      emAndamento: 0,
      pendentes: e.aberta ? abertos.length : 0,
      criticosEmAberto: e.aberta ? 1 : 0,
      atrasados: e.aberta ? 1 : 0,
      percentual: e.aberta && e.dispensado ? 50 : 0,
      porModulo: e.aberta
        ? [
            { modulo: 'internacao', total: 1, concluidos: 0, percentual: 0 },
            {
              modulo: 'faturamento',
              total: 1,
              concluidos: e.dispensado ? 1 : 0,
              percentual: e.dispensado ? 100 : 0,
            },
          ]
        : [],
      oQueFalta: e.aberta ? abertos.map((i) => i.id) : [],
    },
  };
}

test.describe('O que falta para operar @C2-025 @fase7', () => {
  test.setTimeout(180_000);
  test('diagnóstico, abrir a implantação, recontar, dispensar com motivo, incluir e medir meta; axe', async ({
    page,
  }) => {
    const pedidos: { metodo: string; caminho: string; corpo: Record<string, unknown> }[] = [];
    const e: Estado = { aberta: false, dispensado: false, meta: false, medida: false };
    await page.route('**/api/implantacao/kit**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(/^\/api\/implantacao\/kit\/?/, '');
      if (req.method() === 'GET') {
        if (caminho === '') return json(rota, painel(e));
        if (caminho === 'modelo')
          return json(rota, { itens: [LEITO, CONVENIO], contagens: ['convenio', 'leito'] });
        return rota.fallback();
      }
      pedidos.push({
        metodo: req.method(),
        caminho,
        corpo: (req.postDataJSON() ?? {}) as Record<string, unknown>,
      });
      if (caminho === '') {
        e.aberta = true;
        return json(rota, { id: 5, itens: 2 }, 201);
      }
      if (caminho === '5/conferencia') return json(rota, { alterados: 0, conferidos: 2 });
      if (caminho === 'itens/12') {
        e.dispensado = true;
        return json(rota, { id: 12, situacao: 'dispensado' });
      }
      if (caminho === '5/metas') {
        e.meta = true;
        return json(rota, { id: 31 }, 201);
      }
      if (caminho === 'metas/31/medicao') {
        e.medida = true;
        return json(rota, { id: 31, situacao: 'atingida' });
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.ADMIN');
    await page.goto('/administracao/implantacao');
    await expect(page.getByTestId('kit-implantacao')).toBeVisible();

    // Diagnóstico sem implantação: a contagem e o mínimo de cada cadastro.
    await expect(page.getByTestId('kit-diag-CAD-LEITO')).toContainText('0/1');
    await expect(page.getByTestId('kit-abrir-gravar')).toBeDisabled();
    await page.getByTestId('kit-nome').locator('input').fill('Implantação sintética');
    await page.getByTestId('kit-inicio').fill('2026-11-25');
    await page.getByTestId('kit-fim').fill('2026-11-01');
    // O fim antes do início: a regra do domínio trava na hora, sem pedido.
    await expect(page.getByTestId('kit-abrir-gravar')).toBeDisabled();
    await page.getByTestId('kit-fim').fill('2027-01-31');
    await expect(page.getByTestId('kit-abrir-gravar')).toBeEnabled();
    expect(pedidos).toHaveLength(0);
    await semViolacaoAxe(page, '/administracao/implantacao (diagnóstico)');
    await page.getByTestId('kit-abrir-gravar').click();

    // Aberta: o que falta na ordem do domínio (o crítico atrasado primeiro).
    await expect(page.getByTestId('kit-nome-aberta')).toContainText('Implantação sintética');
    expect(pedidos[0]).toMatchObject({
      metodo: 'POST',
      caminho: '',
      corpo: {
        nome: 'Implantação sintética',
        dataInicioPrevista: '2026-11-25',
        dataFimPrevista: '2027-01-31',
      },
    });
    const leito = page.getByTestId('kit-item-CAD-LEITO');
    await expect(leito.getByTestId('kit-item-atrasado')).toBeVisible();

    await page.getByTestId('kit-recontar').click();
    await expect(page.getByTestId('kit-aviso')).toContainText('2 itens conferidos');
    expect(pedidos[1]).toMatchObject({ metodo: 'POST', caminho: '5/conferencia' });

    // Pronto sem atingir o mínimo é recusado na hora; dispensa só com o motivo.
    const convenio = page.getByTestId('kit-item-CAD-CONVENIO');
    await escolher(convenio.getByTestId('kit-item-nova-situacao'), { rotulo: 'Pronto' });
    await expect(convenio.getByTestId('kit-item-falta')).toBeVisible();
    await expect(convenio.getByTestId('kit-item-gravar')).toBeDisabled();
    await escolher(convenio.getByTestId('kit-item-nova-situacao'), { rotulo: 'Dispensado' });
    await expect(convenio.getByTestId('kit-item-gravar')).toBeDisabled();
    await convenio.getByTestId('kit-item-motivo').locator('input').fill('Hospital só atende particular');
    await expect(convenio.getByTestId('kit-item-gravar')).toBeEnabled();
    await semViolacaoAxe(page, '/administracao/implantacao (o que falta)');
    await convenio.getByTestId('kit-item-gravar').click();
    await expect(page.getByTestId('kit-item-CAD-CONVENIO')).toHaveCount(0);
    await expect(page.getByTestId('kit-percentual')).toContainText('50%');
    expect(pedidos[2]).toMatchObject({
      metodo: 'PATCH',
      caminho: 'itens/12',
      corpo: { situacao: 'dispensado', motivoDispensa: 'Hospital só atende particular', versao: 1 },
    });

    // Meta: adesão acima de 100% é recusada na hora; incluída e medida.
    await page.getByTestId('kit-meta-processo').locator('input').fill('Admissão');
    await page.getByTestId('kit-meta-alvo').locator('input').fill('120');
    await expect(page.getByTestId('kit-meta-incluir')).toBeDisabled();
    await page.getByTestId('kit-meta-alvo').locator('input').fill('90');
    await expect(page.getByTestId('kit-meta-incluir')).toBeEnabled();
    await page.getByTestId('kit-meta-incluir').click();
    const metaCartao = page.getByTestId('kit-meta-1');
    await expect(metaCartao.getByTestId('kit-meta-situacao')).toContainText('Pendente');
    expect(pedidos[3]).toMatchObject({
      metodo: 'POST',
      caminho: '5/metas',
      corpo: { processo: 'Admissão', indicador: 'adesao', valorMeta: 90 },
    });
    await metaCartao.getByTestId('kit-meta-valor').locator('input').fill('95');
    await metaCartao.getByTestId('kit-meta-medir').click();
    await expect(metaCartao.getByTestId('kit-meta-situacao')).toContainText('Atingida');
    expect(pedidos[4]).toMatchObject({
      metodo: 'POST',
      caminho: 'metas/31/medicao',
      corpo: { valorMedido: 95, versao: 1 },
    });
  });
});
