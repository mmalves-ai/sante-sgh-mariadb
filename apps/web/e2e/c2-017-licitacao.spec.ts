// E2E @C2-017 (09-AREA linha 81): o processo de contratação pública sobre a porta PRÓPRIA (MariaDB, cliente de teste),
// Lei 14.133/2021. O agente de contratação abre uma dispensa por valor (art. 75, II), passa pela pesquisa de preços, pela
// proposta do fornecedor e pelo julgamento; não homologa o que conduz (segregação de funções, art. 7º). A autoridade
// entra pelo menu (Suprimentos > Compras > Licitação e pregão), acha o processo pelo filtro e homologa. Ao recarregar a
// tela, o processo continua homologado e o histórico (só de inclusão) traz os atos: o que prova que ficou no banco e não
// na memória. axe sem violação séria. O fornecedor vem da busca da própria rota (massa SINTÉTICA do cliente de teste);
// sem fornecedor, o teste é pulado com o motivo dito. Nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const L = '/api/suprimentos/licitacoes';

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

function dia(deslocamento: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test.describe('Contratação pública na porta própria @C2-017', () => {
  test.setTimeout(240_000);

  test('dispensa por valor gravada no banco: o agente conduz, a autoridade homologa e o histórico fica', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.LICITACAO');
    let seq = 0;
    const chave = () => `e2e-c2017-${Date.now().toString(36)}-${++seq}`;
    const post = async (url: string, data: Record<string, unknown>, esperado = 201) => {
      const k = chave();
      const csrf = (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
      const r = await page.request.post(url, {
        headers: { 'x-csrf': csrf, 'Idempotency-Key': k },
        data: { ...data, chave: k },
      });
      expect(r.status(), await r.text()).toBe(esperado);
      return (await r.json()) as Record<string, unknown>;
    };
    const versao = async (id: number) =>
      ((await (await page.request.get(`${L}/${id}`)).json()) as { versao: number }).versao;

    // O fornecedor sai da busca da rota (cadastro do cliente de teste), nunca de um código fixo da memória.
    let fornecedor: number | null = null;
    for (const termo of ['ltda', 'sint', 'forn', 'com', 'me']) {
      const r = (await (await page.request.get(`${L}/fornecedores?termo=${termo}`)).json()) as {
        itens: { codigo: number }[];
      };
      if (r.itens.length > 0) {
        fornecedor = r.itens[0]!.codigo;
        break;
      }
    }
    test.skip(fornecedor === null, 'Sem fornecedor cadastrado no cliente do E2E.');

    const numero = `DL-C2017-${Date.now() % 1_000_000}/2026`;
    const id = (
      await post(L, {
        numero,
        regime: 'lei-14133',
        modalidade: 'dispensa',
        fundamento: 'art. 75, II',
        natureza: 'servico-comum',
        objeto: 'Serviço sintético de manutenção de equipamentos (teste)',
        justificativa: 'Manutenção anual sintética dos equipamentos do setor (teste)',
        agente: 'SINT.LICITACAO',
        itens: [{ descricao: 'Manutenção sintética', unidade: 'UN', quantidade: 1 }],
      })
    ).id as number;
    await post(`${L}/${id}/etapas`, { versao: await versao(id), para: 'pesquisa' });
    const item = ((await (await page.request.get(`${L}/${id}`)).json()) as { itensDetalhe: { id: number }[] })
      .itensDetalhe[0]!.id;
    await post(`${L}/${id}/precos`, {
      versao: await versao(id),
      item,
      fonte: 'fornecedor',
      referencia: 'Cotação sintética',
      valor: 5000,
      data: dia(-1),
      fornecedor,
    });
    await post(`${L}/${id}/etapas`, {
      versao: await versao(id),
      para: 'sessao',
      justificativaPesquisa: 'Prestador único credenciado (sintético)',
    });
    await post(`${L}/${id}/propostas`, { versao: await versao(id), item, fornecedor, valor: 4800 });
    await post(`${L}/${id}/etapas`, { versao: await versao(id), para: 'julgado' });
    // Quem conduz não homologa.
    await post(`${L}/${id}/homologacao`, { versao: await versao(id), observacao: null }, 403);

    // A autoridade, pelo menu.
    await entrar(page, 'SINT.AUTORIDADE');
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.getByRole('button', { name: /^Suprimentos/ }).click();
    const compras = menu.getByRole('button', { name: /^Compras/ });
    if ((await compras.count()) > 0 && (await compras.first().getAttribute('aria-expanded')) !== 'true')
      await compras.first().click();
    await menu.getByRole('link', { name: 'Licitação e pregão' }).click();
    await expect(page).toHaveURL(/\/suprimentos\/licitacao$/);
    await semViolacaoAxe(page, 'painel da licitação');
    await page.getByTestId('lic-f-termo').fill(numero);
    await page.getByTestId('lic-f-aplicar').click();
    await page.getByTestId(`lic-abrir-${id}`).click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'julgado');
    await page.getByTestId('lic-det-aba-autoridade').click();
    await page.getByTestId('lic-hom-obs').fill('Homologação sintética da dispensa (teste)');
    await page.getByTestId('lic-homologar').click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'homologado');
    await expect(page.getByTestId('lic-det-mensagem')).toContainText('Processo homologado');

    // Recarregada a tela, o processo segue homologado: está no banco próprio.
    await page.reload();
    await page.getByTestId('lic-f-termo').fill(numero);
    await page.getByTestId('lic-f-aplicar').click();
    await page.getByTestId(`lic-abrir-${id}`).click();
    await expect(page.getByTestId('lic-det-etapa')).toHaveAttribute('data-etapa', 'homologado');
    const detalhe = (await (await page.request.get(`${L}/${id}`)).json()) as {
      etapa: string;
      eventos: unknown[];
    };
    expect(detalhe.etapa).toBe('homologado');
    expect(detalhe.eventos.length).toBeGreaterThanOrEqual(4);
    await semViolacaoAxe(page, 'processo homologado');
    expect(externas).toEqual([]);
  });
});
