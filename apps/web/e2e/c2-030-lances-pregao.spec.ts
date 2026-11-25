// E2E @C2-030 (05-SUP linha 26): os lances da disputa aberta do pregão sobre a porta PRÓPRIA (MariaDB, cliente de teste),
// Lei 14.133/2021, art. 56 e 57. O agente de contratação abre a tela da licitação pelo menu (Suprimentos > Compras >
// Licitação e pregão), segue o atalho "Lances da disputa", escolhe o pregão em sessão e, no primeiro item, tenta um lance
// que não melhora a oferta (a regra do domínio avisa na hora e trava o botão) e registra um lance válido. Ao recarregar a
// tela, o lance segue no histórico do item e na oferta do licitante: o que prova que ficou no banco. axe sem violação
// séria. Precisa de um pregão em sessão com proposta válida no cliente do E2E; sem isso, o teste é pulado com o motivo
// dito. Massa SINTÉTICA; nenhum dado de pessoa.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const S = '/api/suprimentos/lances-pregao';

interface Disputa {
  id: number;
  numero: string;
  objeto: string;
  sentido: 'menor' | 'maior' | null;
  itens: {
    sequencia: number;
    propostas: {
      fornecedor: number;
      fornecedorNome: string;
      valor: number;
      ultimoLance: number | null;
      apta: boolean;
    }[];
    lances: { fornecedor: number; valor: number }[];
  }[];
}

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe('Lances do pregão na porta própria @C2-030', () => {
  test.setTimeout(180_000);

  test('o lance que não melhora é avisado na hora; o válido fica gravado no histórico do item', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.LICITACAO');

    const processos = (await (await page.request.get(S)).json()) as { id: number; numero: string }[];
    let disputa: Disputa | null = null;
    for (const p of processos) {
      const d = (await (await page.request.get(`${S}/${p.id}`)).json()) as Disputa;
      if (d.sentido === 'menor' && d.itens[0]?.propostas.some((x) => x.apta)) {
        disputa = d;
        break;
      }
    }
    test.skip(disputa === null, 'Sem pregão em sessão com proposta válida no cliente do E2E.');
    const item = disputa!.itens[0]!;
    const licitante = item.propostas.find((x) => x.apta)!;
    const proprios = item.lances.filter((l) => l.fornecedor === licitante.fornecedor).map((l) => l.valor);
    const anterior = Math.min(licitante.valor, ...proprios);
    const lance = Math.round(anterior * 0.95 * 100) / 100;
    test.skip(!(lance > 0 && lance < anterior), 'A oferta anterior não deixa lance menor com 2 casas.');

    await page.getByRole('link', { name: 'Licitação e pregão' }).first().click();
    await expect(page).toHaveURL(/\/suprimentos\/licitacao/);
    await page.getByTestId('lic-lances').click();
    await expect(page.getByTestId('tela-lances-pregao')).toBeVisible();
    await semViolacaoAxe(page, '/suprimentos/licitacao/lances');

    await escolher(page.getByTestId('lance-processo'), { rotulo: new RegExp(disputa!.numero) });
    const s = item.sequencia;
    await escolher(page.getByTestId(`lance-licitante-${s}`), { rotulo: licitante.fornecedorNome });
    // Não melhora: a regra do domínio avisa na hora e o botão fica travado.
    await page.getByTestId(`lance-valor-${s}`).fill(String(anterior).replace('.', ','));
    await expect(page.getByTestId(`lance-aviso-${s}`)).toBeVisible();
    await expect(page.getByTestId(`lance-registrar-${s}`)).toBeDisabled();

    await page.getByTestId(`lance-valor-${s}`).fill(String(lance).replace('.', ','));
    await expect(page.getByTestId(`lance-aviso-${s}`)).toHaveCount(0);
    await page.getByTestId(`lance-registrar-${s}`).click();
    await expect(page.getByTestId('lance-mensagem')).toBeVisible();
    await expect(page.getByTestId(`lance-historico-${s}`)).toContainText(licitante.fornecedorNome);
    await semViolacaoAxe(page, '/suprimentos/licitacao/lances');

    // Recarregada a tela, o lance segue gravado (histórico e oferta do licitante).
    await page.reload();
    await escolher(page.getByTestId('lance-processo'), { rotulo: new RegExp(disputa!.numero) });
    await expect(page.getByTestId(`lance-historico-${s}`)).toContainText(licitante.fornecedorNome);
    const depois = (await (await page.request.get(`${S}/${disputa!.id}`)).json()) as Disputa;
    const oferta = depois.itens[0]!.propostas.find((x) => x.fornecedor === licitante.fornecedor)!.ultimoLance;
    expect(oferta).toBe(lance);
    expect(externas).toEqual([]);
  });
});
