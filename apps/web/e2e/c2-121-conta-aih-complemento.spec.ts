// C2-121 (06-SUS linha 58): o complemento da conta da AIH na tela da AIH, pelo caminho do faturista. A AIH fechada, o
// espelho e as rotas /api/sus/aih/:aih/complemento exigem o banco próprio (sem ele, 503); por isso as respostas são
// simuladas pelo Playwright com massa SINTÉTICA (AIH 9121, conta 55, CNS gerado pelo algoritmo, nunca de pessoa). A
// chave da AIH é ligada pelo administrador como no E2E @C2-119. O que se prova é a tela: as três abas (equipe,
// diagnósticos secundários, incrementos) com a conferência na hora pela regra do domínio (CNS inválido, CID igual ao
// principal, diagnóstico sem classificação, percentual acima do teto), o botão de gravar só sem problema, o corpo do PUT
// com a versão da conta, e o painel só de leitura quando a conta já foi apresentada. O efeito no banco (as três tabelas
// gravadas pela diferença, a versão da conta e da autorização) está no contrato de efeito
// apps/api/src/modulos/sus/conta-aih-complemento-propria.int.spec.ts. axe sem violação séria; nenhuma requisição externa.
import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FATURISTA = 'SINT.FATURISTA.AIH';
const AIH = 9121;
const CONTA = 55;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const cabecalhos = async (page: Page, k: string) => ({
  'x-csrf': (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '',
  'idempotency-key': `e2e-c2-121-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

async function prerequisito(page: Page): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, 'pre'),
    data: {
      recurso: 'faturamento.susAih',
      tipo: 'contrato',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'contrato SUS sintético do E2E do complemento da conta da AIH',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

async function chave(page: Page, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `chave-${ligar}`),
    data: {
      chave: 'faturamento.susAih',
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: [FATURISTA],
      ligar,
      justificativa: 'Complemento da conta da AIH sintético do E2E C2-121',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}

/** CNS sintético definitivo (começa por 7; soma ponderada múltipla de 11), gerado pelo algoritmo, nunca de pessoa. */
function cnsSintetico(semente: number): string {
  for (let k = 0; k < 1000; k++) {
    const corpo = `7${String(semente * 1000 + k).padStart(14, '0')}`;
    let t = 0;
    for (let i = 0; i < 15; i++) t += Number(corpo[i]) * (15 - i);
    if (t % 11 === 0) return corpo;
  }
  throw new Error('sem CNS sintético');
}

const entradaDe = (l: Locator) => l.locator('input, textarea').first();
async function digitar(l: Locator, valor: string): Promise<void> {
  await entradaDe(l).fill(valor);
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

type Complemento = {
  conta: number;
  situacaoConta: string;
  editavel: boolean;
  versao: number;
  equipe: {
    procedimento: number;
    codigoProcedimento: string;
    cns: string;
    nome: string | null;
    cbo: string;
    atividade: string;
    credor: string | null;
    documentoCredor: string | null;
  }[];
  diagnosticos: { cid: string; tipo: string; classificacao: string | null }[];
  incrementos: {
    habilitacao: string;
    descricao: string | null;
    procedimento: number | null;
    percentual: number;
    valorServicoHospitalar: number;
    valorServicoProfissional: number;
    valorTotal: number;
  }[];
};

const OPCOES = {
  procedimentos: [
    { sequencia: 1, codigo: '0406010811', nome: 'PROCEDIMENTO SINTETICO', tipo: 'principal' },
    { sequencia: 2, codigo: '0702040010', nome: 'OPM SINTETICA', tipo: 'opm' },
  ],
  atividades: [
    { codigo: '1', descricao: 'Cirurgião' },
    { codigo: '6', descricao: 'Anestesista' },
  ],
  credores: [{ codigo: '45', descricao: 'Profissional autônomo' }],
  habilitacoes: [{ codigo: '0802', descricao: 'HABILITACAO SINTETICA' }],
};

function aihLida(situacao: string) {
  return {
    id: AIH,
    situacao,
    registro: 7402,
    prontuario: 7402,
    conta: CONTA,
    entrada: '2026-11-02',
    alta: '2026-11-06',
    procedimentoSolicitado: '0406010811',
    procedimentoSolicitadoNome: 'PROCEDIMENTO SINTETICO',
    procedimentoRealizado: '0406010811',
    cidPrincipal: 'I210',
    cidSecundario: null,
    carater: '01',
    solicitante: '00000000191',
    solicitanteNome: null,
    dataLaudo: '2026-11-02',
    justificativa: 'LAUDO SINTETICO DO E2E (MASSA DE TESTE)',
    faixa: 1,
    numero: '3327000000011',
    dataAutorizacao: '2026-11-03',
    permanencia: 4,
    diariasUti: 0,
    competenciaApresentacao: null,
    arquivo: null,
    reapresentacoes: 0,
    justificativaSituacao: null,
    registradaPor: FATURISTA,
    registradaEm: '2026-11-02T10:00:00',
    alteradaPor: null,
    alteradaEm: null,
    versao: '2026-11-06T10:00:00.000',
  };
}

test.describe('C2-121 complemento da conta da AIH: equipe, diagnósticos e incrementos @C2-121 @F7', () => {
  test.describe.configure({ timeout: 300_000 });

  test('conferência na hora nas três abas, gravação com a versão da conta e leitura depois da apresentação; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const cns = cnsSintetico(1211);
    let situacaoAih = 'fechada';
    const complemento: Complemento = {
      conta: CONTA,
      situacaoConta: 'fechada',
      editavel: true,
      versao: 3,
      equipe: [],
      diagnosticos: [],
      incrementos: [],
    };
    let corpoPut: Record<string, unknown> | null = null;
    let puts = 0;

    await page.route(/\/api\/sus\/laudos-internacao(\/.*)?(\?.*)?$/, (rota) => json(rota, { itens: [] }));
    await page.route(/\/api\/sus\/aih(\?.*)?$/, (rota) =>
      json(rota, { itens: [aihLida(situacaoAih)], total: 1, porSituacao: { [situacaoAih]: 1 } }),
    );
    await page.route(new RegExp(`/api/sus/aih/${AIH}/espelho$`), (rota) =>
      json(rota, {
        aih: aihLida(situacaoAih),
        origem: 'fechamento',
        competencia: '202611',
        linhas: [],
        permanencia: { dias: 4, media: 3 },
        diariasUti: { total: 0, mesAnterior: 0 },
        itensForaDaAih: 0,
        itensSemSigtap: 0,
        valorTotal: 1000,
        criticas: [],
        lotesSaida: [],
        retorno: null,
        complemento: { ...complemento },
      }),
    );
    await page.route(new RegExp(`/api/sus/aih/${AIH}/complemento$`), async (rota) => {
      const req = rota.request();
      if (req.method() === 'GET') return json(rota, { ...complemento, opcoes: OPCOES });
      puts += 1;
      corpoPut = req.postDataJSON() as Record<string, unknown>;
      const c = corpoPut as {
        diagnosticos: Complemento['diagnosticos'];
        equipe: (Omit<Complemento['equipe'][number], 'codigoProcedimento' | 'nome'> & object)[];
        incrementos: { habilitacao: string; procedimento: number | null; percentual: number }[];
      };
      complemento.versao += 1;
      complemento.diagnosticos = c.diagnosticos;
      complemento.equipe = c.equipe.map((x) => ({ ...x, codigoProcedimento: '0406010811', nome: null }));
      complemento.incrementos = c.incrementos.map((x) => ({
        ...x,
        descricao: 'HABILITACAO SINTETICA',
        valorServicoHospitalar: 160,
        valorServicoProfissional: 40,
        valorTotal: 200,
      }));
      return json(rota, { ...complemento });
    });

    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page);
    await chave(page, true);
    try {
      await entrar(page, FATURISTA);
      await page.goto('/faturamento/sus/aih');
      await expect(page.getByTestId('aih-desligado')).toHaveCount(0);
      await page.getByTestId(`botao-abrir-aih-${AIH}`).click();
      const painel = page.getByTestId('aih-detalhe').getByTestId('aih-complemento');
      await expect(painel).toBeVisible();
      await expect(painel.getByTestId('aih-complemento-somente-leitura')).toHaveCount(0);
      const gravar = painel.getByTestId('aih-complemento-gravar');
      const problemas = painel.getByTestId('aih-complemento-problemas');

      // Equipe: o CNS é conferido na hora; o OPM não aparece entre os procedimentos.
      await painel.getByTestId('aih-equipe-incluir').click();
      const linha = painel.getByTestId('aih-equipe-0');
      await digitar(linha.getByTestId('aih-equipe-cns-0'), '123');
      await digitar(linha.getByTestId('aih-equipe-cbo-0'), '225125');
      await expect(problemas).toContainText('O CNS do profissional da linha 1 não é válido');
      await expect(problemas).toContainText('Diga a atividade do profissional na linha 1');
      await expect(gravar).toBeDisabled();
      await digitar(linha.getByTestId('aih-equipe-cns-0'), cns);
      await escolher(linha.getByTestId('aih-equipe-atividade-0'), '1');
      await expect(problemas).toHaveCount(0);
      await expect(painel.getByTestId('aih-complemento-aba-equipe')).toContainText('Equipe (1)');
      await semViolacaoAxe(page, 'Complemento da conta da AIH: equipe');

      // Diagnósticos: o principal não repete; o secundário pede a classificação.
      await painel.getByTestId('aih-complemento-aba-diagnosticos').click();
      await painel.getByTestId('aih-diagnostico-incluir').click();
      await digitar(painel.getByTestId('aih-diagnostico-cid-0'), 'I21.0');
      await expect(problemas).toContainText('já é o diagnóstico principal da AIH');
      await digitar(painel.getByTestId('aih-diagnostico-cid-0'), 'E119');
      await expect(problemas).toContainText('preexistente ou adquirido');
      await expect(gravar).toBeDisabled();
      await escolher(painel.getByTestId('aih-diagnostico-classificacao-0'), 'preexistente');
      await expect(problemas).toHaveCount(0);

      // Incrementos: o percentual fica até o teto do domínio.
      await painel.getByTestId('aih-complemento-aba-incrementos').click();
      await painel.getByTestId('aih-incremento-incluir').click();
      await digitar(painel.getByTestId('aih-incremento-percentual-0'), '400');
      await expect(problemas).toContainText('O percentual do incremento 1 fica acima de 0 e até 300%');
      await expect(gravar).toBeDisabled();
      await digitar(painel.getByTestId('aih-incremento-percentual-0'), '20');
      await expect(problemas).toHaveCount(0);
      await semViolacaoAxe(page, 'Complemento da conta da AIH: incrementos');

      await gravar.click();
      await expect(painel.getByTestId('aih-complemento-mensagem')).toContainText(`conta ${CONTA}`);
      expect(puts).toBe(1);
      expect(corpoPut).toEqual({
        versao: 3,
        diagnosticos: [{ cid: 'E119', tipo: 'secundario', classificacao: 'preexistente' }],
        equipe: [
          { procedimento: 1, cns, cbo: '225125', atividade: '1', credor: null, documentoCredor: null },
        ],
        incrementos: [{ habilitacao: '0802', procedimento: null, percentual: 20 }],
      });
      await expect(painel.getByTestId('aih-complemento-aba-incrementos')).toContainText('Incrementos (1)');

      // Apresentada ao gestor: o painel só mostra o que foi gravado.
      situacaoAih = 'apresentada';
      Object.assign(complemento, { situacaoConta: 'apresentada', editavel: false });
      await page.reload();
      await page.getByTestId(`botao-abrir-aih-${AIH}`).click();
      const leitura = page.getByTestId('aih-detalhe').getByTestId('aih-complemento');
      await expect(leitura.getByTestId('aih-complemento-somente-leitura')).toBeVisible();
      await expect(leitura.getByTestId('aih-complemento-gravar')).toHaveCount(0);
      await expect(leitura.getByTestId('aih-equipe-tabela')).toContainText(cns);
      await leitura.getByTestId('aih-complemento-aba-diagnosticos').click();
      await expect(leitura.getByTestId('aih-diagnosticos-lista')).toContainText('E119');
      await leitura.getByTestId('aih-complemento-aba-incrementos').click();
      await expect(leitura.getByTestId('aih-incrementos-tabela')).toContainText('0802');
      await semViolacaoAxe(page, 'Complemento da conta da AIH só de leitura');
      expect(puts).toBe(1);
      expect(externas).toEqual([]);
    } finally {
      await entrar(page, 'SINT.ADMIN');
      await chave(page, false);
    }
  });
});
