// E2E @C2-053 (F8, 01-ADM linha 117): central de comando assistencial, pela tela própria:
//   - a diretoria clínica abre "Central de comando assistencial", inclui um tema e uma regra de risco por permanência
//     (critério que vale para todo paciente em acompanhamento), com a validação na hora (código inválido e critério
//     sem alvo desligam o botão de gravar), e um limite de fluxo de ocupação;
//   - a enfermagem apura os riscos, vê o risco no quadro do paciente, reconhece e resolve com a conduta (curta demais
//     é recusada na hora), inclui uma meta das 24 horas e a marca como cumprida.
// As rotas /api/enfermagem/central-comando exigem o banco próprio do cliente e, na fonte sintética, respondem 501
// (recurso-desligado). Por isso a sessão é real (login, permissão e casca) e as respostas da central são simuladas pelo
// Playwright com massa SINTÉTICA e estado entre os passos; os corpos enviados pela tela são conferidos. O efeito no banco
// está no contrato de efeito apps/api/src/modulos/enfermagem/central-comando-propria.int.spec.ts. Combos por
// e2e/combos.ts. axe sem violação séria.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const URL = '/enfermagem/central-comando';

async function entrar(page: Page, login: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

type Corpo = Record<string, unknown>;
interface Pedido {
  caminho: string;
  corpo: Corpo;
}
interface Ocorrencia {
  id: number;
  regra: string;
  tema: string;
  atendimento: number;
  gravidade: string;
  situacao: 'aberta' | 'reconhecida' | 'resolvida' | 'descartada';
  detectadoEm: string;
  evidencia: { criterios: { tipo: string; negado: boolean; valor: number | null }[] };
  resolucao: string | null;
  versao: number;
}
interface Meta {
  id: number;
  atendimento: number;
  data: string;
  categoria: string;
  descricao: string;
  prazoEm: string;
  situacao: string;
  atrasada: boolean;
  justificativa: string | null;
  ocorrencia: number | null;
  versao: number;
}
interface Estado {
  seq: number;
  temas: { id: number; codigo: string; descricao: string; ativo: boolean }[];
  regras: {
    id: number;
    codigo: string;
    nome: string;
    tema: number;
    gravidade: string;
    ativo: boolean;
    versao: number;
  }[];
  alertas: Corpo[];
  ocorrencias: Ocorrencia[];
  metas: Meta[];
  pedidos: Pedido[];
}

// Um paciente SINTÉTICO em acompanhamento, há 30 horas na unidade.
const ATENDIMENTO = 9101;
const PERMANENCIA = 30;

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
const recusa = (rota: Route, status: number, detail: string) =>
  rota.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: 'about:blank', title: 'Recusado', status, detail }),
  });

function quadro(e: Estado) {
  const riscos = e.ocorrencias.filter((o) => o.situacao === 'aberta' || o.situacao === 'reconhecida');
  const cumpridas = e.metas.filter((m) => m.situacao === 'cumprida').length;
  const pendentes = e.metas.filter((m) => m.situacao === 'pendente').length;
  const cumprimento = {
    total: e.metas.length,
    cumpridas,
    pendentes,
    percentual: e.metas.length ? Math.round((cumpridas / e.metas.length) * 100) : null,
  };
  const ordem = ['baixa', 'media', 'alta', 'critica'];
  const maior = riscos.map((o) => o.gravidade).sort((a, b) => ordem.indexOf(b) - ordem.indexOf(a))[0] ?? null;
  return {
    agora: new Date().toISOString(),
    pacientes: [
      {
        atendimento: ATENDIMENTO,
        paciente: 501,
        nome: 'PACIENTE SINTETICO CC',
        numero: String(ATENDIMENTO),
        leito: 'LEITO SINTETICO 01',
        permanenciaHoras: PERMANENCIA,
        maiorGravidade: maior,
        riscosAbertos: riscos.length,
        riscos,
        metas: e.metas,
        metasAtrasadas: 0,
        cumprimento,
        escorePiora: null,
        protocolosAbertos: 0,
      },
    ],
    alertas: e.alertas,
    resumo: {
      pacientes: 1,
      comRisco: riscos.length ? 1 : 0,
      riscosCriticos: riscos.filter((o) => o.gravidade === 'critica').length,
      metas: cumprimento,
      metasAtrasadas: 0,
      alertasCriticos: 0,
    },
  };
}

async function simularCentral(page: Page, e: Estado): Promise<void> {
  await page.route('**/api/enfermagem/central-comando/**', (rota) => {
    const req = rota.request();
    const caminho = new URL(req.url()).pathname.replace(/^\/api\/enfermagem\/central-comando\//, '');
    if (req.method() === 'GET') {
      if (caminho === 'quadro') return json(rota, quadro(e));
      if (caminho === `atendimentos/${ATENDIMENTO}`)
        return json(rota, { atendimento: ATENDIMENTO, ocorrencias: e.ocorrencias, metas: e.metas });
      if (caminho === 'regras')
        return json(rota, {
          temas: e.temas,
          regras: e.regras,
          alertas: e.alertas,
          apoio: { exames: [], itens: [], sinais: [], unidades: [{ id: 1, rotulo: 'UNIDADE SINTETICA' }] },
        });
      return recusa(rota, 404, `GET ${caminho} não simulado`);
    }
    const corpo = (req.postDataJSON() ?? {}) as Corpo;
    e.pedidos.push({ caminho, corpo });
    const id = ++e.seq;
    if (caminho === 'temas') {
      e.temas.push({ id, codigo: String(corpo.codigo), descricao: String(corpo.descricao), ativo: true });
      return json(rota, { ok: true, mensagem: 'Tema incluído.', id, versao: 1 });
    }
    if (caminho === 'regras') {
      e.regras.push({
        id,
        codigo: String(corpo.codigo),
        nome: String(corpo.nome),
        tema: Number(corpo.tema),
        gravidade: String(corpo.gravidade),
        ativo: true,
        versao: 1,
      });
      return json(rota, { ok: true, mensagem: 'Regra incluída: entra na próxima apuração.', id, versao: 1 });
    }
    if (caminho === 'alertas') {
      e.alertas.push({
        ...corpo,
        id,
        unidadeNome: null,
        ativo: true,
        versao: 1,
        medida: 70,
        nivel: 'normal',
      });
      return json(rota, { ok: true, mensagem: 'Limite de fluxo incluído.', id, versao: 1 });
    }
    if (caminho === 'apuracao') {
      let abertas = 0;
      for (const r of e.regras.filter((x) => x.ativo)) {
        if (e.ocorrencias.some((o) => o.regra === r.codigo && o.situacao !== 'resolvida')) continue;
        abertas += 1;
        e.ocorrencias.push({
          id: ++e.seq,
          regra: r.codigo,
          tema: e.temas.find((t) => t.id === r.tema)?.codigo ?? '',
          atendimento: ATENDIMENTO,
          gravidade: r.gravidade,
          situacao: 'aberta',
          detectadoEm: new Date().toISOString(),
          evidencia: { criterios: [{ tipo: 'permanencia', negado: false, valor: PERMANENCIA }] },
          resolucao: null,
          versao: 1,
        });
      }
      return json(rota, { ok: true, mensagem: 'Riscos apurados.', avaliados: 1, abertas, encerradas: 0 });
    }
    const oc = /^ocorrencias\/(\d+)$/.exec(caminho);
    if (oc) {
      const o = e.ocorrencias.find((x) => x.id === Number(oc[1]));
      if (!o || o.versao !== corpo.versao) return recusa(rota, 409, 'Versão desatualizada.');
      if (corpo.acao !== 'reconhecer' && String(corpo.resolucao ?? '').trim().length < 10)
        return recusa(rota, 422, 'A conduta precisa de pelo menos 10 letras.');
      o.situacao =
        corpo.acao === 'reconhecer' ? 'reconhecida' : corpo.acao === 'resolver' ? 'resolvida' : 'descartada';
      o.resolucao = (corpo.resolucao as string | null) ?? null;
      o.versao += 1;
      return json(rota, { ok: true, mensagem: 'Risco atualizado.', versao: o.versao });
    }
    if (caminho === 'metas') {
      e.metas.push({
        id,
        atendimento: Number(corpo.atendimento),
        data: new Date().toISOString().slice(0, 10),
        categoria: String(corpo.categoria),
        descricao: String(corpo.descricao),
        prazoEm: String(corpo.prazoEm),
        situacao: 'pendente',
        atrasada: false,
        justificativa: null,
        ocorrencia: (corpo.ocorrencia as number | null) ?? null,
        versao: 1,
      });
      return json(rota, { ok: true, mensagem: 'Meta incluída.', id, versao: 1 });
    }
    const en = /^metas\/(\d+)\/encerramento$/.exec(caminho);
    if (en) {
      const m = e.metas.find((x) => x.id === Number(en[1]));
      if (!m || m.versao !== corpo.versao) return recusa(rota, 409, 'Versão desatualizada.');
      m.situacao = String(corpo.situacao);
      m.justificativa = (corpo.justificativa as string | null) ?? null;
      m.versao += 1;
      return json(rota, { ok: true, mensagem: 'Meta encerrada.', versao: m.versao });
    }
    return recusa(rota, 500, `POST ${caminho} não simulado`);
  });
}

test.describe('@C2-053 central de comando assistencial', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);
  const marca = Date.now().toString(36).toUpperCase().slice(-6);
  const codigoRegra = `PERM.${marca}`;
  // Estado da central entre os dois passos (modo serial): a regra do primeiro é apurada no segundo.
  const e: Estado = { seq: 100, temas: [], regras: [], alertas: [], ocorrencias: [], metas: [], pedidos: [] };

  test('configura tema, regra com critério e limite de fluxo, com validação na hora', async ({ page }) => {
    const externas = vigiarExternas(page);
    await simularCentral(page, e);
    await entrar(page, 'SINT.DIRETOR.CLINICO');
    await page.goto(URL);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Central de comando assistencial');
    await expect(page.getByTestId('cc-apurar')).toBeVisible();

    // Tema novo.
    await page.getByTestId('cc-tema-codigo').fill(`T.${marca}`);
    await page.getByTestId('cc-tema-descricao').fill('Tema sintético de permanência');
    await page.getByTestId('cc-incluir-tema').click();
    await expect(page.getByTestId('cc-temas')).toContainText(`T.${marca}`);

    // Validação na hora: código inválido e critério sem alvo.
    await page.getByTestId('cc-regra-codigo').fill('x');
    await page.getByTestId('cc-regra-nome').fill('Permanência sintética');
    await expect(page.getByTestId('cc-problemas-regra')).toContainText('O código da regra');
    await expect(page.getByTestId('cc-problemas-regra')).toContainText('alvo do seu tipo');
    await expect(page.getByTestId('cc-gravar-regra')).toBeDisabled();

    await page.getByTestId('cc-regra-codigo').fill(codigoRegra);
    await escolher(page.getByTestId('cc-regra-tema'), { rotulo: new RegExp(`T\\.${marca}`) });
    await escolher(page.getByTestId('cc-regra-gravidade'), { rotulo: 'Alta' });
    await escolher(page.getByTestId('cc-criterio-tipo-0'), { rotulo: 'Permanência' });
    await page.getByTestId('cc-criterio-horas-0').fill('0');
    await expect(page.getByTestId('cc-problemas-regra')).toHaveCount(0);
    await page.getByTestId('cc-gravar-regra').click();
    await expect(page.getByTestId('cc-regras')).toContainText(codigoRegra);

    // Limite de fluxo: a atenção acima do crítico é recusada na hora.
    await escolher(page.getByTestId('cc-limite-tipo'), { rotulo: 'Ocupação' });
    await page.getByTestId('cc-limite-atencao').fill('95');
    await page.getByTestId('cc-limite-critico').fill('90');
    await expect(page.getByTestId('cc-problema-limite')).toContainText('abaixo do crítico');
    await expect(page.getByTestId('cc-incluir-limite')).toBeDisabled();
    await page.getByTestId('cc-limite-atencao').fill('80');
    await page.getByTestId('cc-incluir-limite').click();
    await expect(page.getByTestId('cc-mensagem')).toBeVisible();
    await expect(page.getByTestId('cc-alertas')).toContainText('Ocupação');
    await semViolacaoAxe(page, `${URL} (configuração)`);

    // O que a tela gravou: o tema, a regra por permanência (0 hora, presente) e o limite de ocupação em percentual.
    const tema = e.pedidos.find((p) => p.caminho === 'temas');
    expect(tema?.corpo).toEqual({ codigo: `T.${marca}`, descricao: 'Tema sintético de permanência' });
    const regra = e.pedidos.find((p) => p.caminho === 'regras');
    expect(regra?.corpo).toMatchObject({ codigo: codigoRegra, gravidade: 'alta', tema: e.temas[0]?.id });
    expect(regra?.corpo.criterios).toEqual([
      expect.objectContaining({ tipo: 'permanencia', permanenciaMinimaHoras: 0, negado: false }),
    ]);
    const limite = e.pedidos.find((p) => p.caminho === 'alertas');
    expect(limite?.corpo).toMatchObject({
      tipo: 'ocupacao',
      unidadeLimite: 'percentual',
      limiteAtencao: 80,
      limiteCritico: 90,
    });

    expect(externas).toEqual([]);
  });

  test('apura, reconhece e resolve o risco e cumpre a meta das 24 horas', async ({ page }) => {
    const externas = vigiarExternas(page);
    await simularCentral(page, e);
    await entrar(page, 'SINT.ENF.PLANTAO');
    await page.goto(URL);
    await page.getByTestId('cc-apurar').click();
    await expect(page.getByTestId('cc-mensagem')).toContainText('paciente(s) avaliado(s)');

    const linha = page.locator('[data-testid^="cc-paciente-"]', { hasText: codigoRegra }).first();
    await expect(linha).toBeVisible();
    await linha.locator('[data-testid^="cc-abrir-"]').click();
    const visao = page.getByTestId('cc-visao');
    await expect(visao).toBeVisible();

    const ocorrencia = visao.locator('[data-testid^="cc-ocorrencia-"]', { hasText: codigoRegra }).first();
    await expect(ocorrencia).toBeVisible();
    await ocorrencia.locator('[data-testid^="cc-reconhecer-"]').click();
    await expect(ocorrencia.locator('[data-testid^="cc-situacao-"]')).toHaveText('Reconhecida');

    // A conduta curta é recusada na hora; a completa resolve.
    await ocorrencia.locator('[data-testid^="cc-conduta-"]').first().fill('curta');
    await expect(ocorrencia.locator('[data-testid^="cc-resolver-"]')).toBeDisabled();
    await ocorrencia
      .locator('[data-testid^="cc-conduta-"]')
      .first()
      .fill('Conduta sintética: reavaliado e plano de alta revisto.');
    await ocorrencia.locator('[data-testid^="cc-resolver-"]').click();
    await expect(ocorrencia.locator('[data-testid^="cc-situacao-"]')).toHaveText('Resolvida');

    // Meta das 24 horas: descrição curta recusada na hora; a válida entra e é cumprida.
    await escolher(page.getByTestId('cc-meta-categoria'), { rotulo: 'Mobilização' });
    await page.getByTestId('cc-meta-descricao').fill('abc');
    await expect(page.getByTestId('cc-problema-meta')).toContainText('pelo menos 5 letras');
    await expect(page.getByTestId('cc-incluir-meta')).toBeDisabled();
    const descricao = `Sentar na poltrona ${marca}`;
    await page.getByTestId('cc-meta-descricao').fill(descricao);
    await page.getByTestId('cc-incluir-meta').click();
    const meta = visao.locator('[data-testid^="cc-meta-"]', { hasText: descricao }).first();
    await expect(meta).toBeVisible();
    await meta.locator('[data-testid^="cc-cumprir-"]').click();
    await expect(meta.locator('[data-testid^="cc-meta-situacao-"]')).toHaveText('Cumprida');
    expect(e.pedidos.find((p) => p.caminho === 'metas')?.corpo).toMatchObject({
      atendimento: ATENDIMENTO,
      categoria: 'mobilizacao',
      descricao,
    });
    expect(e.ocorrencias.find((o) => o.regra === codigoRegra)?.resolucao).toContain('Conduta sintética');
    await semViolacaoAxe(page, `${URL} (visão do paciente)`);

    expect(externas).toEqual([]);
  });
});
