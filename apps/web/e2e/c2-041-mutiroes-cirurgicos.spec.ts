// E2E @C2-041 (F8, 04-CC linha 108): projetos e mutirões cirúrgicos do SUS pela tela do centro cirúrgico. As rotas
// `/api/cirurgia/mutiroes/*` só existem no banco do cliente (na fonte sintética respondem 503), então este E2E simula
// essas rotas com um estado em memória que segue a regra do servidor (a AIH marcada soma na meta pelo SIGTAP; a
// retirada fica no histórico e devolve o saldo). O que fica no banco está no contrato de efeito
// apps/api/src/modulos/cirurgia/mutirao-cirurgico-propria.int.spec.ts. Aqui se prova o fluxo: a lista com a meta
// contra a produção, a validação do projeto e da meta na hora (portaria exigida; procedimento sem SIGTAP recusado), a
// conferência da AIH pelo número antes de gravar (a fora da vigência mostra o motivo; a válida pede a justificativa),
// a marcação por paciente com um clique e a retirada com a justificativa e o complemento. Axe na tela. Massa SINTÉTICA.
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

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

function simular(page: Page) {
  const corpos: Record<string, unknown>[] = [];
  const projeto = {
    id: 7,
    versao: 2,
    codigo: 'FILAS-FIC',
    descricao: 'MUTIRAO FICTICIO DE CATARATA',
    portaria: 'Portaria ficticia 1/2030',
    periodoInicio: '2030-03-01',
    periodoFim: '2030-03-31',
    valorFinanciamento: 50000,
    situacao: 'em_andamento',
    motivoCancelamento: null,
    fontePagadora: null,
  };
  const metas = [
    {
      id: 1,
      versao: 1,
      procedimentoDescricao: 'P1 - FACECTOMIA FICTICIA',
      sigtap: '0405050372',
      prevista: 10,
      valor: 700,
    },
  ];
  const vinculos: Record<string, unknown>[] = [];
  const justificativas = [
    {
      id: 31,
      versao: 1,
      codigo: 'FILA',
      descricao: 'Paciente da fila regulada',
      ativo: true,
      aplicaInclusao: true,
      aplicaAlteracao: false,
      exigeComplemento: false,
    },
    {
      id: 32,
      versao: 1,
      codigo: 'DESIST',
      descricao: 'Desistencia',
      ativo: true,
      aplicaInclusao: false,
      aplicaAlteracao: true,
      exigeComplemento: true,
    },
  ];
  const aihs: Record<string, { id: number; data: string; problemas: { campo: string; mensagem: string }[] }> =
    {
      '2041900000001': { id: 501, data: '2030-03-02', problemas: [] },
      '2041900000002': {
        id: 502,
        data: '2031-01-10',
        problemas: [{ campo: 'documento', mensagem: 'A data da AIH está fora da vigência do projeto.' }],
      },
    };
  const realizada = () => vinculos.filter((v) => v['situacao'] === 'vigente').length * 2;
  const detalhe = () => {
    const r = realizada();
    return {
      projeto,
      acompanhamento: {
        prevista: metas.reduce((s, m) => s + m.prevista, 0),
        realizada: r,
        percentual: Math.round((r / 10) * 1000) / 10,
        valorPrevisto: 7000,
        valorRealizado: r * 700,
        decorrido: 0.5,
      },
      metas: metas.map((m, i) => ({
        ...m,
        realizada: i === 0 ? r : 0,
        saldo: m.prevista - (i === 0 ? r : 0),
        percentual: 0,
        esperadoAteHoje: Math.ceil(m.prevista / 2),
        ritmo: (i === 0 ? r : 0) >= Math.ceil(m.prevista / 2) ? 'no_ritmo' : 'abaixo_do_ritmo',
      })),
      insumos: [],
      fornecedores: [],
      vinculos,
    };
  };
  const painel = () => ({
    projetos: [{ ...projeto, prevista: 10, realizada: realizada(), percentual: realizada() * 10 }],
    justificativas,
    opcoes: {
      procedimentos: [
        { id: 9, rotulo: 'P1 - FACECTOMIA FICTICIA', sigtap: '0405050372' },
        { id: 10, rotulo: 'P2 - PROCEDIMENTO SEM SUS', sigtap: null },
        { id: 11, rotulo: 'P3 - VITRECTOMIA FICTICIA', sigtap: '0405030045' },
      ],
      fornecedores: [{ id: 4, rotulo: 'FORNECEDOR FICTICIO' }],
      insumos: [],
      fontesPagadoras: [],
    },
  });
  return {
    corpos,
    async ligar() {
      await page.route(/\/api\/cirurgia\/mutiroes$/, (rota) => json(rota, painel()));
      await page.route(/\/api\/cirurgia\/mutiroes\/7$/, (rota) => json(rota, detalhe()));
      await page.route(/\/api\/cirurgia\/mutiroes\/7\/documentos\?/, (rota) => {
        const numero = new URL(rota.request().url()).searchParams.get('numero') ?? '';
        const a = aihs[numero];
        return json(rota, {
          documentos: a
            ? [
                {
                  id: a.id,
                  tipo: 'aih',
                  numero,
                  situacao: 'fechada',
                  data: a.data,
                  paciente: 'PACIENTE FICTICIO A',
                  prontuario: '9001',
                  problemas: a.problemas,
                },
              ]
            : [],
        });
      });
      await page.route('**/api/cirurgia/mutiroes/7/metas', async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        metas.push({
          id: 2,
          versao: 1,
          procedimentoDescricao: 'P3 - VITRECTOMIA FICTICIA',
          sigtap: '0405030045',
          prevista: Number(c['quantidadePrevista']),
          valor: 0,
        });
        return json(rota, { id: 2 });
      });
      await page.route('**/api/cirurgia/mutiroes/7/aih', async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        vinculos.push({
          id: 80 + vinculos.length,
          versao: 1,
          tipo: 'aih',
          numero: '2041900000001',
          documentoData: '2030-03-02',
          paciente: 'PACIENTE FICTICIO A',
          prontuario: '9001',
          situacao: 'vigente',
          justificativa: 'Paciente da fila regulada',
          complemento: null,
          retiradaJustificativa: null,
        });
        return json(rota, { id: 80, realizada: 2 });
      });
      await page.route('**/api/cirurgia/mutiroes/7/vinculos/*/retirar', async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        const v = vinculos[0]!;
        v['situacao'] = 'retirado';
        v['retiradaJustificativa'] = 'Desistencia';
        return json(rota, { id: v['id'], realizada: 0 });
      });
    },
  };
}

test.describe('@C2-041 mutirões cirúrgicos do SUS', () => {
  test('acompanha a meta contra a produção e marca a AIH com a conferência na hora', async ({ page }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.ADMIN');

    await page.goto('/cirurgia/mutiroes');
    await expect(page.getByTestId('mutiroes-cirurgicos')).toBeVisible();
    await expect(page.getByTestId('mutirao-projeto-7')).toContainText('0 de 10');

    // Projeto novo: a portaria é exigida na hora, sem ida ao servidor.
    await page.getByTestId('mutirao-codigo').locator('input').fill('NOVO-FIC');
    await page.getByTestId('mutirao-descricao').locator('input').fill('Mutirao ficticio');
    await expect(page.getByTestId('mutirao-problemas')).toContainText('portaria');
    await expect(page.getByTestId('mutirao-gravar')).toBeDisabled();

    // Abre o projeto em andamento: meta por SIGTAP; o procedimento sem SIGTAP é recusado na hora.
    await page.getByTestId('mutirao-abrir-7').click();
    await expect(page.getByTestId('mutirao-detalhe')).toHaveAttribute('data-situacao', 'em_andamento');
    await escolher(page.getByTestId('mutirao-meta-procedimento'), '10');
    await page.getByTestId('mutirao-meta-quantidade').locator('input').fill('5');
    await expect(page.getByTestId('mutirao-meta-problemas')).toContainText('SIGTAP');
    await expect(page.getByTestId('mutirao-meta-gravar')).toBeDisabled();
    await escolher(page.getByTestId('mutirao-meta-procedimento'), '11');
    await expect(page.getByTestId('mutirao-meta-problemas').locator('li')).toHaveCount(0);
    await page.getByTestId('mutirao-meta-gravar').click();
    await expect(page.getByTestId('mutirao-metas')).toContainText('VITRECTOMIA FICTICIA');
    expect(api.corpos.at(-1)).toEqual({ procedimento: 11, quantidadePrevista: 5, valorUnitario: null });

    // AIH fora da vigência: o motivo aparece antes de gravar e não há botão de marcar.
    await page.getByTestId('mutirao-numero').locator('input').fill('2041900000002');
    await page.getByTestId('mutirao-conferir').click();
    await expect(page.getByTestId('mutirao-achado-problemas')).toContainText('fora da vigência');
    await expect(page.getByTestId('mutirao-marcar-gravar')).toHaveCount(0);

    // AIH válida: escolhe a justificativa e marca; a produção soma na meta.
    await page.getByTestId('mutirao-numero').locator('input').fill('2041900000001');
    await page.getByTestId('mutirao-conferir').click();
    await escolher(page.getByTestId('mutirao-justificativa'), '31');
    await page.getByTestId('mutirao-marcar-gravar').click();
    await expect(page.getByTestId('mutirao-vinculo-2041900000001')).toHaveAttribute(
      'data-situacao',
      'vigente',
    );
    await expect(page.getByTestId('mutirao-vinculo-2041900000001')).toContainText('PACIENTE FICTICIO A');
    await expect(page.getByTestId('mutirao-acompanhamento')).toContainText('2 de 15');
    expect(api.corpos.at(-1)).toEqual({ documento: 501, justificativa: 31, complemento: null });
    await semViolacaoAxe(page, '/cirurgia/mutiroes');

    // Retirada: a justificativa exige o complemento; a linha fica no histórico.
    await page.getByTestId('mutirao-retirar-2041900000001').click();
    await escolher(page.getByTestId('mutirao-retirada-justificativa'), '32');
    await expect(page.getByTestId('mutirao-retirada-confirmar')).toBeDisabled();
    await page
      .getByTestId('mutirao-retirada-complemento')
      .locator('input, textarea')
      .first()
      .fill('Paciente desistiu');
    await page.getByTestId('mutirao-retirada-confirmar').click();
    await expect(page.getByTestId('mutirao-vinculo-2041900000001')).toHaveAttribute(
      'data-situacao',
      'retirado',
    );
    expect(api.corpos.at(-1)).toEqual({ versao: 1, justificativa: 32, complemento: 'Paciente desistiu' });
    await semViolacaoAxe(page, '/cirurgia/mutiroes');
    expect(externas).toEqual([]);
  });
});
