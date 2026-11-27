// E2E @C2-030 (05-SUP linha 26): ata de registro de preços e empenho pelo caminho da tela. A autoridade entra
// pelo menu (Suprimentos > Compras > Ata de registro de preços e empenho), escolhe o processo homologado (os itens
// adjudicados vêm prontos), vê a vigência máxima de 1 ano recusada na hora, registra a ata, empenha parte do saldo (a
// regra recusa na hora o que passa do saldo e o empenho sem fonte de recurso), confere o saldo que caiu, anula o
// empenho com motivo e vê o saldo voltar. axe sem violação séria. A ata e o empenho só existem no banco do cliente (na
// fonte sintética do E2E a API responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no contrato
// do servidor (ata-empenho.controller.ts); o efeito no banco é provado por ata-empenho.int.spec.ts. Nenhum dado de pessoa.
import { expect, type Page, type Route, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const MARCA = Date.now().toString(36).toUpperCase();
const EMPENHO = `NE${MARCA}`.slice(0, 20);

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dia(deslocamentoDias: number, deslocamentoAnos = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + deslocamentoAnos);
  d.setDate(d.getDate() + deslocamentoDias);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

const PROCESSO = {
  id: 93001,
  numero: 'PE-C2030/2030',
  objeto: 'Registro de preços de luvas sintéticas',
  itens: [
    {
      insumo: 93101,
      insumoNome: 'LUVA PROCEDIMENTO SINTETICA M',
      fornecedor: 93201,
      fornecedorNome: 'FORNECEDOR SINTETICO A',
      quantidade: 500,
      valor: 0.42,
    },
    {
      insumo: 93102,
      insumoNome: 'LUVA PROCEDIMENTO SINTETICA G',
      fornecedor: 93201,
      fornecedorNome: 'FORNECEDOR SINTETICO A',
      quantidade: 300,
      valor: 0.45,
    },
  ],
};

interface ItemAta {
  id: number;
  sequencia: number;
  insumo: number;
  insumoNome: string;
  fornecedor: number;
  fornecedorNome: string;
  registrada: number;
  utilizada: number;
  saldo: number;
  valorUnitario: number;
  situacao: string;
}
interface Estado {
  atas: {
    id: number;
    numero: string;
    objeto: string;
    vigenciaInicio: string;
    vigenciaFim: string;
    situacao: string;
    processo: string | null;
    itens: ItemAta[];
  }[];
  empenhos: {
    id: number;
    numero: string;
    emitidoEm: string;
    fornecedor: string;
    fonteRecurso: string;
    valorTotal: number;
    situacao: string;
    ata: string | null;
    itens: number;
    versao: number;
    motivoAnulacao: string | null;
    partes: { item: ItemAta; quantidade: number }[];
  }[];
}

/** O estado da ata e do empenho como o servidor guarda: o empenho baixa o saldo do item, a anulação devolve. */
async function simular(page: Page, st: Estado): Promise<void> {
  await page.route(/\/api\/suprimentos\/(atas-registro-preco|empenhos|adesoes-ata)/, (r) => {
    const url = new URL(r.request().url());
    const caminho = url.pathname.replace(/^.*\/api\/suprimentos/, '');
    const metodo = r.request().method();
    const corpo = (metodo === 'POST' ? r.request().postDataJSON() : {}) as Record<string, unknown>;
    if (caminho === '/atas-registro-preco/processos') return json(r, [PROCESSO]);
    if (caminho === '/atas-registro-preco' && metodo === 'GET') return json(r, st.atas);
    if (caminho === '/atas-registro-preco' && metodo === 'POST') {
      const id = 93300 + st.atas.length;
      const itens = (
        corpo['itens'] as { insumo: number; fornecedor: number; quantidade: number; valorUnitario: number }[]
      ).map((i, k) => {
        const origem = PROCESSO.itens.find((x) => x.insumo === i.insumo)!;
        return {
          id: id * 10 + k,
          sequencia: k + 1,
          insumo: i.insumo,
          insumoNome: origem.insumoNome,
          fornecedor: i.fornecedor,
          fornecedorNome: origem.fornecedorNome,
          registrada: i.quantidade,
          utilizada: 0,
          saldo: i.quantidade,
          valorUnitario: i.valorUnitario,
          situacao: 'ativo',
        };
      });
      st.atas.push({
        id,
        numero: String(corpo['numero']),
        objeto: String(corpo['objeto']),
        vigenciaInicio: String(corpo['vigenciaInicio']),
        vigenciaFim: String(corpo['vigenciaFim']),
        situacao: 'vigente',
        processo: PROCESSO.numero,
        itens,
      });
      const total = itens.reduce((t, i) => t + i.registrada * i.valorUnitario, 0);
      return json(r, { id, numero: String(corpo['numero']), itens: itens.length, valorTotal: total }, 201);
    }
    if (caminho === '/empenhos' && metodo === 'GET')
      return json(
        r,
        st.empenhos.map((e) => ({ ...e, partes: undefined })),
      );
    if (caminho === '/empenhos' && metodo === 'POST') {
      const pedidos = corpo['itens'] as { ataItem: number; quantidade: number }[];
      const partes = pedidos.map((p) => ({
        item: st.atas.flatMap((a) => a.itens).find((i) => i.id === p.ataItem)!,
        quantidade: p.quantidade,
      }));
      for (const p of partes) {
        p.item.utilizada += p.quantidade;
        p.item.saldo -= p.quantidade;
      }
      const id = 93500 + st.empenhos.length;
      const valorTotal = partes.reduce((t, p) => t + p.quantidade * p.item.valorUnitario, 0);
      const ata = st.atas.find((a) => a.itens.includes(partes[0]!.item))!;
      st.empenhos.push({
        id,
        numero: String(corpo['numero']),
        emitidoEm: String(corpo['emitidoEm']),
        fornecedor: partes[0]!.item.fornecedorNome,
        fonteRecurso: String(corpo['fonteRecurso']),
        valorTotal,
        situacao: 'emitido',
        ata: ata.numero,
        itens: partes.length,
        versao: 1,
        motivoAnulacao: null,
        partes,
      });
      return json(r, { id, numero: String(corpo['numero']), itens: partes.length, valorTotal }, 201);
    }
    const anul = /^\/empenhos\/(\d+)\/anulacao$/.exec(caminho);
    if (anul) {
      const e = st.empenhos.find((x) => x.id === Number(anul[1]))!;
      for (const p of e.partes) {
        p.item.utilizada -= p.quantidade;
        p.item.saldo += p.quantidade;
      }
      Object.assign(e, {
        situacao: 'anulado',
        versao: e.versao + 1,
        motivoAnulacao: String(corpo['motivo']),
      });
      return json(r, { id: e.id, numero: e.numero, itens: e.itens, valorTotal: e.valorTotal });
    }
    if (/^\/empenhos\/\d+\/(referencias|candidatos)$/.test(caminho)) return json(r, []);
    if (caminho === '/adesoes-ata' && metodo === 'GET') return json(r, []);
    return r.fallback();
  });
}

test.describe('Ata de registro de preços e empenho @C2-030', () => {
  test.setTimeout(180_000);

  test('ata do processo homologado, empenho sobre o saldo e anulação que devolve o saldo', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st: Estado = { atas: [], empenhos: [] };
    await simular(page, st);
    await entrar(page, 'SINT.AUTORIDADE');

    // Pelo menu (as áreas começam recolhidas: a busca do menu abre a área com o item).
    await (await itemDoMenu(page, 'Ata de registro de preços e empenho')).click();
    await expect(page).toHaveURL(/\/suprimentos\/atas-registro-preco/);
    await expect(page.getByTestId('tela-atas-registro-preco')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/atas-registro-preco');

    const processo = PROCESSO;

    // A ata nasce do processo: os itens adjudicados vêm prontos; a vigência acima de 1 ano é recusada na hora.
    await escolher(page.getByTestId('arp-processo'), { rotulo: new RegExp(processo.numero) });
    await expect(page.getByTestId('arp-itens-novos').locator('tbody tr')).toHaveCount(processo.itens.length);
    await page.getByTestId('arp-numero').fill(`ARP${MARCA}`);
    await page.getByTestId('arp-fim').fill(dia(0, 1));
    await expect(page.getByTestId('arp-recusa')).toContainText('até 1 ano');
    await expect(page.getByTestId('arp-registrar')).toBeDisabled();
    await page.getByTestId('arp-fim').fill(dia(-1, 1));
    await expect(page.getByTestId('arp-recusa')).toHaveCount(0);
    await page.getByTestId('arp-registrar').click();
    await expect(page.getByTestId('arp-mensagem')).toContainText(`ARP${MARCA}`);

    // O empenho de 1 unidade do primeiro item: acima do saldo e sem fonte são recusados na hora.
    const ata = page.getByTestId(`arp-ata-ARP${MARCA}`);
    await expect(ata.getByTestId('arp-ata-situacao')).toHaveAttribute('data-situacao', 'vigente');
    const registrada = processo.itens[0]!.quantidade;
    await ata.getByTestId('arp-empenhar').click();
    await ata.getByTestId('emp-qtd-1').fill(String(registrada + 1));
    await ata.getByTestId('emp-numero').fill(EMPENHO);
    await expect(ata.getByTestId('emp-recusa')).toBeVisible();
    await expect(ata.getByTestId('emp-emitir')).toBeDisabled();
    await ata.getByTestId('emp-qtd-1').fill('1');
    await expect(ata.getByTestId('emp-recusa')).toContainText('fonte de recurso');
    await ata.getByTestId('emp-fonte').fill('1.500.1002');
    await expect(ata.getByTestId('emp-recusa')).toHaveCount(0);
    await ata.getByTestId('emp-emitir').click();
    await expect(page.getByTestId('arp-mensagem')).toContainText(EMPENHO);
    await expect(ata.getByTestId('arp-saldo-1')).not.toHaveText(String(registrada));

    // A anulação pede o motivo e devolve o saldo.
    const linha = page.getByTestId(`emp-${EMPENHO}`);
    await expect(linha.getByTestId('emp-situacao')).toHaveAttribute('data-situacao', 'emitido');
    await linha.getByTestId('emp-anular').click();
    await expect(linha.getByTestId('emp-confirmar-anulacao')).toBeDisabled();
    await linha.getByTestId('emp-motivo').fill('Dotação remanejada no orçamento');
    await linha.getByTestId('emp-confirmar-anulacao').click();
    await expect(page.getByTestId('arp-mensagem')).toContainText('saldo voltou');
    await expect(linha.getByTestId('emp-situacao')).toHaveAttribute('data-situacao', 'anulado');
    await semViolacaoAxe(page, '/suprimentos/atas-registro-preco (empenho anulado)');
    // O que a tela mandou ao servidor: o empenho de 1 unidade e a anulação devolveram o saldo registrado.
    expect(st.atas[0]?.itens[0]?.saldo).toBe(registrada);
    expect(st.empenhos[0]?.motivoAnulacao).toBe('Dotação remanejada no orçamento');
    expect(externas).toEqual([]);
  });
});
