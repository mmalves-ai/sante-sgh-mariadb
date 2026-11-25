// C2-119 (06-SUS linha 57): o laudo de internação SUS na tela da AIH, pelo caminho do faturista. A AIH (faixa, laudo da
// solicitação e autorização) corre na porta em MEMÓRIA, como no E2E @M51.4, com a internação SUS sintética 7402 (a 7401
// é do @M51.4). As rotas /api/sus/laudos-internacao exigem o banco próprio (sem ele, 503); por isso as respostas delas
// são simuladas pelo Playwright com massa SINTÉTICA, e a devolução pelo gestor reflete no espelho da AIH pela troca da
// situação na resposta. O que se prova é a tela: devolver com motivo (botão só com 10 caracteres), reenviar corrigido
// (sem mudança não deixa, procedimento e CID-10 conferidos na hora), autorizar, laudo especial com OPM do grupo 07 e
// diária de UTI inteira (avisos na hora), imprimir, gerar o lote com os laudos já marcados e enviar. O efeito no banco
// (laudo gravado com a AIH, devolução, reenvio, laudo especial com itens, impressão e lote) está no contrato de efeito
// apps/api/src/modulos/sus/porta-propria-aih.int.spec.ts ("o laudo de internação: emissão com a AIH, devolução,
// reenvio, laudo especial, impressão e lote"). axe sem violação séria; nenhuma requisição externa.
import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const FATURISTA = 'SINT.FATURISTA.AIH';

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
  'idempotency-key': `e2e-c2-119-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});

async function prerequisito(page: Page): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, 'pre'),
    data: {
      recurso: 'faturamento.susAih',
      tipo: 'contrato',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'contrato SUS sintético do E2E do laudo de internação',
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
      justificativa: 'Laudo de internação SUS sintético do E2E C2-119',
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

/** Número da AIH (13 dígitos): a base de 12 e o dígito pelo módulo 11. */
function numeroAih(base12: string): string {
  const r = Number(BigInt(base12) % 11n);
  return `${base12}${r === 10 ? '0' : String(r)}`;
}

const hoje = new Date();
const COMPETENCIA = `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}`;
const dia = (d: number) => `${String(d).padStart(2, '0')}/${COMPETENCIA.slice(4)}/${COMPETENCIA.slice(0, 4)}`;

const entradaDe = (l: Locator) => l.locator('input, textarea').first();
async function digitar(l: Locator, valor: string): Promise<void> {
  await entradaDe(l).fill(valor);
}
async function digitarData(l: Locator, valor: string): Promise<void> {
  const e = l.locator('input');
  await e.fill(valor);
  await e.blur();
}

const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

type Laudo = {
  id: number;
  numero: string;
  tipo: string;
  situacao: string;
  autorizacao: number | null;
  numeroAih: string | null;
  prontuario: number | null;
  dataLaudo: string;
  procedimentoSolicitado: string;
  cidPrincipal: string;
  justificativa: string;
  emitidoEm: string | null;
  impressoEm: string | null;
  enviadoEm: string | null;
  devolvidoEm: string | null;
  motivoDevolucao: string | null;
  lote: { id: number; numero: string } | null;
  especiais: {
    sequencia: number;
    tipo: string;
    procedimento: string;
    quantidade: number;
    justificativa: string | null;
  }[];
  versao: number;
};

test.describe('C2-119 laudo de internação SUS: devolução, reenvio, especial, impressão e lote @C2-119 @F7', () => {
  test.describe.configure({ timeout: 300_000 });

  test('solicitada → devolvida → reenviada → autorizada → laudo especial → impressão → lote enviado; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const base = `3327${String(Date.now() % 100_000_000).padStart(8, '0')}`;
    const inicial = numeroAih(base);
    const final = numeroAih((BigInt(base) + 4n).toString().padStart(12, '0'));
    await page.addInitScript(() => {
      window.print = () => undefined; // a impressão do navegador não abre no teste
    });

    // Estado simulado das rotas do laudo (massa sintética).
    let situacaoAihSimulada: string | null = null;
    let motivoSimulado: string | null = null;
    const laudos: Laudo[] = [];
    let lote: {
      id: number;
      numero: string;
      situacao: string;
      quantidadeLaudos: number;
      laudos: {
        laudo: number;
        numero: string;
        situacaoNaInclusao: string;
        incluidoEm: string;
        enviadoEm: string | null;
        retiradoEm: string | null;
        motivoRetirada: string | null;
      }[];
      geradoEm: string;
      enviadoEm: string | null;
      retornadoEm: string | null;
      observacao: string | null;
      versao: number;
    } | null = null;
    const corpos: Record<string, unknown> = {};

    // O espelho da AIH vem da porta em memória; a devolução simulada troca só a situação.
    await page.route(/\/api\/sus\/aih\/\d+\/espelho$/, async (rota) => {
      const resposta = await rota.fetch();
      const corpo = (await resposta.json()) as {
        aih: { situacao: string; justificativaSituacao: string | null };
      };
      if (situacaoAihSimulada) {
        corpo.aih.situacao = situacaoAihSimulada;
        corpo.aih.justificativaSituacao = motivoSimulado;
      }
      await rota.fulfill({ response: resposta, json: corpo });
    });
    await page.route(/\/api\/sus\/laudos-internacao(\/.*)?(\?.*)?$/, async (rota) => {
      const req = rota.request();
      const url = new URL(req.url());
      const caminho = url.pathname.replace('/api/sus/laudos-internacao', '');
      if (req.method() === 'GET') {
        if (caminho === '/lotes') return json(rota, { itens: lote ? [lote] : [] });
        if (url.searchParams.get('semLote') === 'true')
          return json(rota, { itens: laudos.filter((l) => l.lote === null && l.situacao !== 'cancelado') });
        return json(rota, { itens: laudos });
      }
      const corpo = req.postDataJSON() as Record<string, unknown>;
      corpos[caminho.replace(/\d+/g, ':id')] = corpo;
      const aih = Number(/\/aih\/(\d+)\//.exec(caminho)?.[1] ?? 0);
      if (caminho.endsWith('/devolver')) {
        situacaoAihSimulada = 'devolvida';
        motivoSimulado = String(corpo['motivo']);
        laudos.push({
          id: 901,
          numero: 'LS-000901',
          tipo: 'inicial',
          situacao: 'devolvido',
          autorizacao: aih,
          numeroAih: null,
          prontuario: 7402,
          dataLaudo: '2026-11-02',
          procedimentoSolicitado: '0406010811',
          cidPrincipal: 'I210',
          justificativa: 'LAUDO SINTETICO DO E2E',
          emitidoEm: '2026-11-02T10:00:00',
          impressoEm: null,
          enviadoEm: null,
          devolvidoEm: '2026-11-03T09:00:00',
          motivoDevolucao: motivoSimulado,
          lote: null,
          especiais: [],
          versao: 2,
        });
      } else if (caminho.endsWith('/reenviar')) {
        situacaoAihSimulada = null; // volta à situação da porta em memória: solicitada
        motivoSimulado = null;
        const l = laudos.find((x) => x.id === 901);
        if (l) Object.assign(l, { situacao: 'emitido', devolvidoEm: null, motivoDevolucao: null, versao: 3 });
      } else if (caminho.endsWith('/especial')) {
        const itens = corpo['itens'] as { tipo: string; procedimento: string; quantidade: number }[];
        const l = laudos.find((x) => x.id === 901);
        if (l) l.situacao = 'autorizado';
        laudos.push({
          ...(l as Laudo),
          id: 902,
          numero: 'LS-000902',
          tipo: 'especial',
          situacao: 'emitido',
          especiais: itens.map((x, i) => ({ sequencia: i + 1, ...x, justificativa: null })),
          versao: 1,
        });
      } else if (caminho.endsWith('/impressao')) {
        const l = laudos.find((x) => x.id === Number(/\/(\d+)\/impressao/.exec(caminho)?.[1]));
        if (l) l.impressoEm = '2026-11-05T11:00:00';
      } else if (caminho === '/lotes') {
        const ids = corpo['laudos'] as number[];
        lote = {
          id: 31,
          numero: 'LL-000031',
          situacao: 'fechado',
          quantidadeLaudos: ids.length,
          // O lote guarda o que continha (os itens ficam mesmo quando o laudo sai do lote).
          laudos: laudos
            .filter((l) => ids.includes(l.id))
            .map((l) => ({
              laudo: l.id,
              numero: l.numero,
              situacaoNaInclusao: 'emitido',
              incluidoEm: '2026-11-05T12:00:00',
              enviadoEm: null,
              retiradoEm: null,
              motivoRetirada: null,
            })),
          geradoEm: '2026-11-05T12:00:00',
          enviadoEm: null,
          retornadoEm: null,
          observacao: null,
          versao: 1,
        };
        for (const l of laudos) if (ids.includes(l.id)) l.lote = { id: 31, numero: 'LL-000031' };
      } else if (caminho.endsWith('/enviar') && lote) {
        lote = { ...lote, situacao: 'enviado', enviadoEm: '2026-11-05T13:00:00', versao: lote.versao + 1 };
      }
      return rota.fulfill({ status: 204 });
    });

    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page);
    await chave(page, true);
    try {
      await entrar(page, FATURISTA);
      await page.goto('/faturamento/sus/aih');
      await expect(page.getByTestId('aih-desligado')).toHaveCount(0);

      // Faixa e laudo da solicitação (porta em memória).
      await digitar(page.getByTestId('faixa-inicial'), inicial);
      await digitar(page.getByTestId('faixa-final'), final);
      await digitar(page.getByTestId('faixa-orgao'), 'SMS SINTETICA');
      await digitarData(page.getByTestId('faixa-data'), dia(1));
      await page.getByTestId('botao-registrar-faixa').click();
      await expect(page.getByTestId('tabela-faixas')).toContainText(inicial);
      await digitar(page.getByTestId('laudo-registro'), '7402');
      await page.getByTestId('botao-buscar-internacao').click();
      await expect(page.getByTestId('laudo-internacao')).toBeVisible();
      await digitar(page.getByTestId('laudo-procedimento'), '0406010811');
      await digitar(page.getByTestId('laudo-solicitante'), '00000000191');
      await digitar(page.getByTestId('laudo-justificativa'), 'LAUDO SINTETICO DO E2E (MASSA DE TESTE)');
      await page.getByTestId('botao-registrar-laudo').click();
      await expect(page.getByTestId('mensagem-aih')).toContainText('Laudo da internação 7402 registrado');

      const detalhe = page.getByTestId('aih-detalhe');
      const laudo = detalhe.getByTestId('laudo-sus');
      await expect(detalhe.getByTestId('aih-situacao')).toContainText('Solicitada');
      await expect(laudo).toBeVisible();
      await semViolacaoAxe(page, 'Laudo de internação (AIH solicitada)');

      // Devolução pelo gestor: o botão só libera com 10 caracteres de motivo.
      const devolver = laudo.getByTestId('botao-devolver-laudo');
      await digitar(laudo.getByTestId('laudo-sus-motivo'), 'curto');
      await expect(devolver).toBeDisabled();
      await digitar(laudo.getByTestId('laudo-sus-motivo'), 'CID-10 INCOMPATIVEL COM O PROCEDIMENTO');
      await devolver.click();
      await expect(laudo.getByTestId('laudo-sus-mensagem')).toContainText('Devolução registrada');
      expect(corpos['/aih/:id/devolver']).toMatchObject({ motivo: 'CID-10 INCOMPATIVEL COM O PROCEDIMENTO' });
      await expect(detalhe.getByTestId('aih-situacao')).toContainText('Devolvida pelo gestor');
      await expect(laudo.getByTestId('laudo-sus-linha-inicial')).toContainText('Devolvido pelo gestor');

      // Reenvio corrigido: sem mudança não deixa; CID-10 conferido na hora.
      const reenvio = laudo.getByTestId('laudo-sus-reenvio');
      await expect(reenvio).toContainText('CID-10 INCOMPATIVEL COM O PROCEDIMENTO');
      const reenviar = reenvio.getByTestId('botao-reenviar-laudo');
      await expect(reenvio.getByTestId('laudo-sus-reenvio-problema')).toContainText('Mude o procedimento');
      await expect(reenviar).toBeDisabled();
      await digitar(reenvio.getByTestId('laudo-sus-reenvio-cid'), '12X');
      await expect(reenvio.getByTestId('laudo-sus-reenvio-problema')).toContainText('O CID-10 é uma letra');
      await digitar(reenvio.getByTestId('laudo-sus-reenvio-cid'), 'I21.1');
      await expect(reenvio.getByTestId('laudo-sus-reenvio-problema')).toHaveCount(0);
      await semViolacaoAxe(page, 'Reenvio do laudo devolvido');
      await reenviar.click();
      await expect(laudo.getByTestId('laudo-sus-mensagem')).toContainText('Laudo corrigido reenviado');
      expect(corpos['/aih/:id/reenviar']).toMatchObject({
        cidPrincipal: 'I211',
        procedimentoSolicitado: null,
      });
      await expect(detalhe.getByTestId('aih-situacao')).toContainText('Solicitada');

      // Autorização com o próximo número da faixa (porta em memória).
      await digitar(detalhe.getByTestId('autorizar-autorizador'), cnsSintetico(772));
      await digitarData(detalhe.getByTestId('autorizar-data'), dia(3));
      await detalhe.getByTestId('botao-autorizar').click();
      await expect(page.getByTestId('mensagem-aih')).toContainText(`AIH autorizada com o número ${inicial}`);

      // Laudo especial: OPM fora do grupo 07 e diária fracionada avisam na hora.
      const especial = laudo.getByTestId('laudo-sus-especial');
      const emitir = especial.getByTestId('botao-emitir-laudo-especial');
      await digitar(especial.getByTestId('laudo-sus-especial-procedimento-0'), '0406010811');
      await expect(especial.getByTestId('laudo-sus-especial-item-0')).toContainText('grupo 07');
      await digitar(especial.getByTestId('laudo-sus-especial-procedimento-0'), '0702040010');
      await expect(especial.getByTestId('laudo-sus-especial-item-0')).not.toContainText('grupo 07');
      await especial.getByTestId('laudo-sus-especial-incluir').click();
      await escolher(especial.getByTestId('laudo-sus-especial-tipo-1'), 'diaria_uti');
      await digitar(especial.getByTestId('laudo-sus-especial-procedimento-1'), '0802010083');
      await digitar(especial.getByTestId('laudo-sus-especial-quantidade-1'), '2,5');
      await expect(especial.getByTestId('laudo-sus-especial-item-1')).toContainText('número inteiro');
      await digitar(especial.getByTestId('laudo-sus-especial-quantidade-1'), '3');
      await digitar(
        especial.getByTestId('laudo-sus-especial-justificativa'),
        'STENT E DIARIAS DE UTI SINTETICOS (MASSA DE TESTE)',
      );
      await expect(emitir).toBeEnabled();
      await semViolacaoAxe(page, 'Laudo especial');
      await emitir.click();
      await expect(laudo.getByTestId('laudo-sus-mensagem')).toContainText('Laudo especial emitido');
      expect(corpos['/aih/:id/especial']).toMatchObject({
        itens: [
          { tipo: 'opm', procedimento: '0702040010', quantidade: 1 },
          { tipo: 'diaria_uti', procedimento: '0802010083', quantidade: 3 },
        ],
      });
      await expect(laudo.getByTestId('laudo-sus-linha-especial')).toContainText('Diária de UTI');

      // Impressão: a primeira marca; o botão passa a reimprimir.
      await laudo.getByTestId('laudo-sus-imprimir-902').click();
      await expect(laudo.getByTestId('laudo-sus-mensagem')).toContainText('Impressão do laudo registrada');
      await expect(laudo.getByTestId('laudo-sus-imprimir-902')).toContainText('Reimprimir');

      // Lote: os laudos sem lote chegam marcados; gerar e enviar.
      const lotes = page.getByTestId('lotes-laudo-sus');
      await expect(lotes.getByTestId('lotes-laudo-sem-lote')).toContainText('LS-000902');
      await lotes.getByTestId('lotes-laudo-marcar-901').uncheck();
      await expect(lotes.getByTestId('botao-gerar-lote-laudos')).toContainText('1 laudos');
      await lotes.getByTestId('lotes-laudo-marcar-todos').check();
      await expect(lotes.getByTestId('botao-gerar-lote-laudos')).toContainText('2 laudos');
      await semViolacaoAxe(page, 'Lotes de laudos');
      await lotes.getByTestId('botao-gerar-lote-laudos').click();
      await expect(lotes.getByTestId('lotes-laudo-mensagem')).toContainText('Lote gerado');
      expect(corpos['/lotes']).toEqual({ laudos: [901, 902] });
      const linhaLote = lotes.getByTestId('lote-laudo-LL-000031');
      await expect(linhaLote.getByTestId('lote-laudo-situacao')).toHaveText('Fechado (pronto para enviar)');
      await expect(linhaLote.getByTestId('lote-laudo-itens').locator('li')).toHaveCount(2);
      await expect(linhaLote.getByTestId('lote-laudo-item-LS-000901')).toBeVisible();
      await expect(lotes.getByTestId('botao-lote-laudo-retornar-31')).toHaveCount(0);
      await lotes.getByTestId('botao-lote-laudo-enviar-31').click();
      await expect(lotes.getByTestId('lotes-laudo-mensagem')).toContainText('Lote enviado');
      await expect(linhaLote.getByTestId('lote-laudo-situacao')).toHaveText('Enviado');
      await expect(lotes.getByTestId('botao-lote-laudo-retornar-31')).toBeVisible();
      await expect(lotes.getByTestId('botao-lote-laudo-cancelar-31')).toHaveCount(0);
      expect(externas).toEqual([]);
    } finally {
      await entrar(page, 'SINT.ADMIN');
      await chave(page, false);
    }
  });
});
