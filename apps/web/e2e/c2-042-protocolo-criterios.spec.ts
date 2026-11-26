// E2E @C2-042 (F7, 03-PEP linha 134): protocolos gerenciados com os critérios de entrada avaliados pelo sistema e as
// etapas com meta de tempo, pela tela própria:
//   - a diretoria clínica abre "Protocolos: critérios e metas", escolhe um protocolo com modelo de mercado (sepse, dor
//     torácica ou AVC) e aplica as metas de mercado: as etapas aparecem com a meta em minutos;
//   - a validação é na hora: a faixa invertida do critério e a fórmula com grupo inexistente desligam o botão de gravar;
//   - inclui uma etapa nova com meta e vê a etapa na lista;
//   - o alerta de elegíveis e os protocolos em andamento respondem (avaliação pelo servidor).
// Os critérios e as etapas gravam só no banco próprio do cliente: na fonte sintética de dev/ci a API responde 501
// (pendente-modelo-proprio), o que o teste confere primeiro. Depois simula as rotas com um estado em memória que segue a
// resposta do servidor (o modelo de sepse com as metas de 60 minutos, a etapa incluída na lista) e percorre a tela. O
// efeito no MariaDB está em apps/api/src/modulos/enfermagem/protocolo-criterios-propria.int.spec.ts. Dados SINTÉTICOS
// (nada vai à cópia). axe sem violação séria.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const B = '/api/enfermagem/protocolos-gerenciados';

/** Estado em memória das rotas do banco do cliente: um protocolo de sepse com modelo e outro sem. */
async function simular(page: Page, alvo: { id: number; nome: string }): Promise<void> {
  const json = (rota: Route, corpo: unknown, status = 200) =>
    rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
  const protocolo = (id: number, nome: string, tipo: string, temModelo: boolean) => ({
    id,
    codigo: `P${id}`,
    nome,
    tipo,
    situacao: 'ativo',
    publico: 'adulto',
    formula: null,
    versao: 1,
    temModelo,
  });
  const protocolos = [
    protocolo(alvo.id, alvo.nome, 'sepse', true),
    protocolo(8, 'ROTINA SINTETICA SEM MODELO', 'outro', false),
  ];
  const etapas: {
    id: number;
    sequencia: number;
    nome: string;
    tipo: string;
    metaMinutos: number | null;
    faixaEtaria: string;
    obrigatoria: boolean;
    versao: number;
  }[] = [];
  const novaEtapa = (nome: string, tipo: string, metaMinutos: number | null, obrigatoria: boolean) =>
    etapas.push({
      id: 100 + etapas.length,
      sequencia: etapas.length + 1,
      nome,
      tipo,
      metaMinutos,
      faixaEtaria: 'todas',
      obrigatoria,
      versao: 1,
    });
  await page.route(`**${B}**`, async (rota) => {
    const req = rota.request();
    const url = new URL(req.url()).pathname;
    if (req.method() === 'GET') {
      if (url === B) return json(rota, { itens: protocolos });
      if (url === `${B}/elegiveis`)
        return json(rota, { agora: '2026-11-26T10:00', avaliados: 3, alertas: [] });
      if (url === `${B}/inclusoes`) return json(rota, { agora: '2026-11-26T10:00', itens: [] });
      const id = Number(url.slice(B.length + 1));
      const p = protocolos.find((x) => x.id === id);
      if (!p) return json(rota, { status: 404, title: 'Protocolo' }, 404);
      return json(rota, {
        protocolo: p,
        criterios: [],
        etapas: p.id === alvo.id ? etapas : [],
        formulaVigente: '',
        problemaFormula: null,
      });
    }
    if (url === `${B}/${alvo.id}/modelo`) {
      // O modelo de mercado da sepse: as três primeiras etapas com meta de 60 minutos.
      const antes = etapas.length;
      if (!etapas.some((e) => e.nome === 'Lactato sérico coletado')) {
        novaEtapa('Lactato sérico coletado', 'exame', 60, true);
        novaEtapa('Hemoculturas antes do antimicrobiano', 'exame', 60, true);
        novaEtapa('Antimicrobiano administrado', 'medicacao', 60, true);
      }
      const n = etapas.length - antes;
      return json(rota, {
        ok: true,
        etapas: n,
        criterios: 0,
        mensagem: n
          ? `Modelo aplicado: ${n} etapa(s) e 0 critério(s) incluídos.`
          : 'O protocolo já tinha tudo o que o modelo traz.',
      });
    }
    if (url === `${B}/${alvo.id}/etapas`) {
      const c = req.postDataJSON() as {
        nome: string;
        tipo: string;
        metaMinutos: number | null;
        obrigatoria: boolean;
      };
      novaEtapa(c.nome, c.tipo, c.metaMinutos, c.obrigatoria);
      return json(rota, { ok: true, mensagem: 'Etapa incluída: vale para as próximas inclusões.' });
    }
    return json(rota, { status: 404, title: 'Rota não simulada' }, 404);
  });
}

test.describe('@C2-042 protocolos gerenciados: critérios e metas', () => {
  test.setTimeout(180_000);

  test('aplica as metas de mercado, valida na hora e inclui etapa', async ({ page }) => {
    const externas = vigiarExternas(page);
    await entrar(page, 'SINT.DIRETOR.CLINICO');

    // Sem o banco do cliente, a API recusa com o código próprio, sem inventar lista.
    const real = await page.request.get(B);
    expect(real.status(), await real.text()).toBe(501);
    expect(((await real.json()) as { codigo: string }).codigo).toBe('pendente-modelo-proprio');

    const alvo = { id: 7, nome: 'SEPSE SINTETICA ADULTO' };
    await simular(page, alvo);

    await page.goto('/enfermagem/protocolos-criterios');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Protocolos gerenciados');
    await expect(page.getByTestId('pc-avaliar')).toBeVisible();
    await page.getByTestId('pc-avaliar').click();
    await expect(page.getByText(/atendimento\(s\) avaliado\(s\)/)).toBeVisible();

    await escolher(page.getByTestId('pc-protocolo'), { rotulo: new RegExp(alvo.nome) });
    await page.getByTestId('pc-modelo').click();
    await expect(page.getByTestId('pc-mensagem')).toContainText(/Modelo aplicado|já tinha tudo/);
    await expect(page.getByTestId('pc-etapas-config').getByRole('row').first()).toBeVisible();
    await semViolacaoAxe(page, '/enfermagem/protocolos-criterios (configuração)');

    // Validação na hora: a faixa invertida e a fórmula com grupo inexistente.
    await page.getByTestId('pc-minimo').fill('100');
    await page.getByTestId('pc-maximo').fill('50');
    await expect(page.getByTestId('pc-problema-criterio')).toContainText('menor que o mínimo');
    await expect(page.getByTestId('pc-incluir-criterio')).toBeDisabled();
    await page.getByTestId('pc-formula').fill('grupo_que_nao_existe E');
    await expect(page.getByTestId('pc-problema-formula')).toBeVisible();
    await expect(page.getByTestId('pc-gravar-formula')).toBeDisabled();

    // Etapa nova com meta.
    const nome = `Reavaliação sintética ${Date.now()}`;
    await page.getByTestId('pc-nome-etapa').fill(nome);
    await escolher(page.getByTestId('pc-tipo-etapa'), { rotulo: 'Reavaliação' });
    await page.getByTestId('pc-meta-etapa').fill('120');
    await escolher(page.getByTestId('pc-obrigatoria'), { rotulo: 'Opcional' });
    await page.getByTestId('pc-incluir-etapa').click();
    await expect(page.getByTestId('pc-mensagem')).toContainText('Etapa incluída');
    await expect(page.getByTestId('pc-etapas-config')).toContainText(nome);

    expect(externas).toEqual([]);
  });
});
