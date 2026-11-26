// E2E @C1-053 (09-AREA linha 88): o acordo de nível de serviço (SLA) do contrato com fornecedor, numa aba do contrato
// aberto. Roda na sessão sintética de dev/ci (logins SINT.*, sem o núcleo): o contrato nasce pelas rotas reais do módulo
// (menu Suprimentos > Compras > Contratos com fornecedores, como no c1-032); as rotas do SLA
// (/api/suprimentos/contratos/:id/sla, /medicoes, /previa, /apuracoes) são simuladas com estado por page.route, porque a
// porta do SLA só existe no banco próprio (em memória ela responde 503). O gestor abre a aba SLA, vê a validação na hora
// (descrição, meta e faixas: a faixa seguinte começa onde a anterior termina), grava o SLA com duas faixas (glosa de 10%
// abaixo de 90%), mede um chamado com o tempo coberto calculado na tela, vê a prévia da apuração com as parcelas
// impressas e registra a apuração, que entra no histórico. O efeito no MariaDB (sla_contrato, faixa_sla_contrato,
// medições e apurações) está em apps/api/src/modulos/suprimentos/sla-contrato.int.spec.ts. Massa SINTÉTICA.
import { expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FORNECEDOR = '7001';

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

async function escolherUsuario(page: Page, campo: string, login: string): Promise<void> {
  await page.getByTestId(`${campo}-termo`).fill(login);
  await page.getByTestId(`${campo}-buscar`).click();
  await escolher(page.getByTestId(campo), login);
}

interface FaixaPost {
  codigo: string;
  descricao: string;
  desempenhoInicio: number;
  desempenhoFim: number | null;
  penalidade: string;
  percentualGlosa: number | null;
  valorMulta: number | null;
}
interface SlaPost {
  servico: number | null;
  descricao: string;
  tipoRegra: string;
  unidade: string;
  meta: number;
  horarioInicio: string | null;
  horarioFim: string | null;
  somenteDiasUteis: boolean;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  faixas: FaixaPost[];
}

/** O estado simulado do SLA do contrato (uma lista por processo do teste). */
function simularSla(page: Page) {
  const estado = {
    slas: [] as Record<string, unknown>[],
    posts: { sla: [] as SlaPost[], medicoes: [] as unknown[], apuracoes: [] as unknown[] },
    chaves: [] as (string | undefined)[],
  };
  const json = (corpo: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(corpo),
  });
  const previa = (inicio: string, fim: string) => ({
    inicio,
    fim,
    considerados: 5,
    noPrazo: 4,
    minutosCobertos: 0,
    minutosParados: 0,
    realizado: 0,
    desempenho: 80,
    metaAtingida: false,
    faixa: (estado.slas[0]?.faixas as FaixaPost[] | undefined)?.[0] ?? null,
    valorFatura: 10000,
    glosa: 1000,
    multa: 0,
    total: 1000,
    parcelas: ['No prazo: 4 de 5 chamados = 80,00%', 'Glosa: 10% de R$ 10.000,00 = R$ 1.000,00'],
    medicoes: [],
  });
  return {
    estado,
    async ligar(): Promise<void> {
      await page.route(/\/api\/suprimentos\/contratos\/(\d+)\/sla(\/[^?]*)?(\?.*)?$/, async (rota) => {
        const r = rota.request();
        const url = new URL(r.url());
        const [, id, resto] = /\/contratos\/(\d+)\/sla(\/[^?]*)?/.exec(url.pathname) ?? [];
        const contrato = Number(id);
        if (r.method() === 'POST') estado.chaves.push(r.headers()['idempotency-key']);
        if (!resto && r.method() === 'GET') {
          return rota.fulfill(
            json({
              hoje: dia(0),
              agora: `${dia(0)}T12:00`,
              contrato: { id: contrato, situacao: 'vigente', inicio: dia(-30), fim: dia(335) },
              slas: estado.slas,
              servicos: [],
            }),
          );
        }
        if (!resto && r.method() === 'POST') {
          const corpo = r.postDataJSON() as SlaPost;
          estado.posts.sla.push(corpo);
          const novo = 900 + estado.slas.length;
          estado.slas.push({
            ...corpo,
            id: novo,
            versao: 1,
            servicoDescricao: null,
            vigente: true,
            medicoes: [],
            apuracoes: [],
          });
          return rota.fulfill(json({ id: novo, fechados: [], mensagem: 'SLA gravado.' }, 201));
        }
        const sla = estado.slas[0] as { medicoes: unknown[]; apuracoes: unknown[] } | undefined;
        if (!sla) return rota.fulfill(json({ title: 'SLA não encontrado' }, 404));
        if (resto?.endsWith('/medicoes')) {
          const m = r.postDataJSON() as { inicio: string; fim: string | null; descricao: string };
          estado.posts.medicoes.push(m);
          sla.medicoes.push({
            ...m,
            quantidade: null,
            id: 500 + sla.medicoes.length,
            medido: 2.5,
            usuario: 'SINT.CONTRATOS',
          });
          return rota.fulfill(json({ id: 500, medido: 2.5, mensagem: 'Medição registrada.' }, 201));
        }
        if (resto?.endsWith('/previa')) {
          return rota.fulfill(
            json(previa(url.searchParams.get('inicio') ?? '', url.searchParams.get('fim') ?? '')),
          );
        }
        if (resto?.endsWith('/apuracoes')) {
          const a = r.postDataJSON() as { inicio: string; fim: string; valorFatura: number | null };
          estado.posts.apuracoes.push(a);
          const p = previa(a.inicio, a.fim);
          const gravada = {
            id: 700 + sla.apuracoes.length,
            inicio: a.inicio,
            fim: a.fim,
            desempenho: p.desempenho,
            faixa: 'A',
            glosa: p.glosa,
            multa: p.multa,
            total: p.total,
            parcelas: p.parcelas,
            usuario: 'SINT.CONTRATOS',
            em: `${dia(0)}T12:00:00`,
          };
          sla.apuracoes.push(gravada);
          return rota.fulfill(json({ ...gravada, mensagem: 'Apuração registrada.' }, 201));
        }
        return rota.fulfill(json({ title: 'rota não simulada' }, 404));
      });
    },
  };
}

test.describe('@C1-053 SLA do contrato com fornecedor', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  test('aba SLA: validação na hora, SLA com faixas, medição, prévia com parcelas e apuração; axe', async ({
    page,
  }) => {
    vigiarExternas(page);
    const sim = simularSla(page);
    await sim.ligar();
    const numero = `CT-C1053-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    await entrar(page, 'SINT.CONTRATOS');

    // 1. A tela dos contratos pelo menu e o contrato vigente do fornecedor (rotas reais do módulo).
    const menu = page.getByRole('navigation', { name: 'Menu principal' });
    await menu.getByRole('button', { name: /^Suprimentos/ }).click();
    const compras = menu.getByRole('button', { name: /^Compras/ });
    if ((await compras.getAttribute('aria-expanded')) !== 'true') await compras.click();
    await menu.getByRole('link', { name: 'Contratos com fornecedores' }).click();
    await expect(page.getByTestId('tela-contratos')).toBeVisible();
    await page.getByTestId('ctr-novo').click();
    await page.getByTestId('ctr-numero').fill(numero);
    await page.getByTestId('ctr-fornecedor-termo').fill(FORNECEDOR);
    await page.getByTestId('ctr-fornecedor-buscar').click();
    await escolher(page.getByTestId('ctr-fornecedor'), FORNECEDOR);
    await page.getByTestId('ctr-objeto').fill('Manutenção sintética de equipamentos com SLA (teste C1-053)');
    await page.getByTestId('ctr-inicio').fill(dia(-30));
    await page.getByTestId('ctr-fim').fill(dia(335));
    await page.getByTestId('ctr-valor').fill('120.000,00');
    await escolher(page.getByTestId('ctr-indice'), 'ipca');
    await page.getByTestId('ctr-database').fill(dia(-30));
    await escolherUsuario(page, 'ctr-gestor', 'SINT.CONTRATOS');
    await escolherUsuario(page, 'ctr-fiscal', 'SINT.GERCOMPRAS');
    await page.getByTestId('ctr-gravar').click();
    await expect(page.getByTestId('ctr-det-painel').getByRole('heading').first()).toContainText(numero);

    // 2. A aba SLA: sem SLA ainda, e o formulário com os avisos na hora (descrição e meta vazias).
    await page.getByTestId('ctr-det-aba-sla').click();
    await expect(page.getByTestId('ctr-sla-painel')).toBeVisible();
    await expect(page.getByTestId('ctr-sla-nenhum')).toBeVisible();
    await expect(page.getByTestId('ctr-sla-recusa-0')).toBeVisible();
    await expect(page.getByTestId('ctr-sla-gravar')).toBeDisabled();

    // 3. O SLA: tempo de atendimento em horas, meta de 4 h, 24 horas todos os dias; faixa A até 90% com glosa de 10%,
    //    faixa B de 90% em diante sem penalidade (o início da B vem da A, sem digitar).
    await page.getByTestId('ctr-sla-descricao').fill('Atendimento de chamado de manutenção');
    await escolher(page.getByTestId('ctr-sla-modelo'), 'tempo_atendimento');
    await escolher(page.getByTestId('ctr-sla-unidade'), 'hora');
    await page.getByTestId('ctr-sla-meta').fill('4');
    // A vigência do SLA começa com o contrato (o padrão é hoje): a medição e a apuração abaixo são de dias anteriores,
    // e a tela recusa apurar período antes da vigência (o início da apuração tem a vigência como mínimo).
    await page.getByTestId('ctr-sla-vigencia-inicio').fill(dia(-30));
    await page.getByTestId('ctr-sla-faixa-0-ate').fill('90');
    await escolher(page.getByTestId('ctr-sla-faixa-0-penalidade'), 'glosa');
    await page.getByTestId('ctr-sla-faixa-0-glosa').fill('10');
    await page.getByTestId('ctr-sla-mais-faixa').click();
    await expect(page.getByTestId('ctr-sla-faixa-1-codigo')).toHaveValue('B');
    await expect(page.getByTestId('ctr-sla-faixas-form')).toContainText('90%');
    await expect(page.locator('[data-testid^="ctr-sla-recusa-"]')).toHaveCount(0);
    await semViolacaoAxe(page, 'SLA novo preenchido');
    await page.getByTestId('ctr-sla-gravar').click();
    await expect(page.getByTestId('ctr-sla-mensagem')).toContainText('SLA gravado');
    const sla = sim.estado.posts.sla[0]!;
    expect(sla.tipoRegra).toBe('tempo_atendimento');
    expect(sla.meta).toBe(4);
    expect(sla.vigenciaInicio).toBe(dia(-30));
    expect(sla.faixas).toHaveLength(2);
    expect(sla.faixas[0]).toMatchObject({
      desempenhoInicio: 0,
      desempenhoFim: 90,
      penalidade: 'glosa',
      percentualGlosa: 10,
    });
    expect(sla.faixas[1]).toMatchObject({
      codigo: 'B',
      desempenhoInicio: 90,
      desempenhoFim: null,
      penalidade: 'nenhuma',
    });
    await expect(page.getByTestId('ctr-sla-escolhido')).toContainText('Atendimento de chamado');

    // 4. A medição de um chamado: o tempo coberto aparece na hora (2,5 h contra a meta de 4 h) e entra no histórico.
    await page.getByTestId('ctr-sla-med-inicio').fill(`${dia(-2)}T08:00`);
    await page.getByTestId('ctr-sla-med-fim').fill(`${dia(-2)}T10:30`);
    await page.getByTestId('ctr-sla-med-descricao').fill('Chamado sintético 1');
    await expect(page.getByTestId('ctr-sla-med-previa')).toContainText('2,5');
    await expect(page.getByTestId('ctr-sla-med-previa')).toContainText('meta 4');
    await page.getByTestId('ctr-sla-med-gravar').click();
    await expect(page.getByTestId('ctr-sla-mensagem')).toContainText('Medição registrada');
    await expect(page.locator('[data-testid^="ctr-sla-medicao-"]')).toHaveCount(1);
    expect(sim.estado.posts.medicoes).toHaveLength(1);

    // 5. A prévia da apuração do período (sem gravar) com as parcelas impressas; depois o registro.
    await page.getByTestId('ctr-sla-ap-inicio').fill(dia(-29));
    await page.getByTestId('ctr-sla-ap-fim').fill(dia(-1));
    await page.getByTestId('ctr-sla-ap-fatura').fill('10000');
    await page.getByTestId('ctr-sla-ap-previa').click();
    const resultado = page.getByTestId('ctr-sla-ap-resultado');
    await expect(resultado).toContainText('80');
    await expect(resultado).toContainText('faixa A');
    await expect(resultado.getByRole('listitem')).toHaveCount(2);
    await expect(resultado).toContainText('Glosa: 10%');
    expect(sim.estado.posts.apuracoes).toHaveLength(0);
    await page.getByTestId('ctr-sla-ap-gravar').click();
    await expect(page.getByTestId('ctr-sla-mensagem')).toContainText('Apuração registrada');
    await expect(page.locator('[data-testid^="ctr-sla-apuracao-"]')).toHaveCount(1);
    expect(sim.estado.posts.apuracoes[0]).toMatchObject({
      inicio: dia(-29),
      fim: dia(-1),
      valorFatura: 10000,
    });
    // Cada gravação vai com a sua chave de idempotência (o reenvio não grava duas vezes).
    expect(new Set(sim.estado.chaves).size).toBe(sim.estado.chaves.length);
    expect(sim.estado.chaves.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
    await semViolacaoAxe(page, 'SLA com medição e apuração');
  });
});
