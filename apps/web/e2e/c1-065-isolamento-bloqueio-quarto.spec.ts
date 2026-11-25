// C1-065 (04-INT linha 75): a auditoria do isolamento com critério "bloquear" não conforme bloqueia o quarto até a CCIH
// (comissão de controle de infecção hospitalar) resolver o aviso, sem travar o leito do próprio paciente isolado.
// A tela /internacao/controles/isolamento avisa na hora, antes de gravar, que o quarto será bloqueado; ao gravar, diz
// quais leitos ficaram bloqueados e quais estão ocupados por outro paciente; o aviso crítico da CCIH mostra os leitos
// bloqueados, e resolver o aviso diz quantos leitos o quarto liberou. Axe em cada passo.
// O E2E roda sem banco próprio (fonte sintética, que responde 503 nestes controles): as respostas da API são simuladas
// no navegador com o formato da porta. O que fica no banco (período de bloqueio ligado à auditoria, leito do isolado
// intocado, liberação ao resolver e ao cancelar) é provado pelo contrato de efeito
// apps/api/src/modulos/adt/bloqueio-quarto-isolamento-propria.int.spec.ts.
import { expect, type Page, test } from '@playwright/test';
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

const ISOLAMENTO = {
  isolamento: 7,
  paciente: 501,
  internacao: 301,
  leito: '101-A',
  tipoPrecaucao: { id: 3, descricao: 'Contato sintético' },
  inicio: '2026-11-20T10:00:00.000Z',
  ultimaAuditoria: null,
  proximaAuditoria: null,
  auditoriaPendente: true,
  criterios: 2,
};
const CRITERIOS = [
  {
    id: 11,
    ordem: 1,
    descricao: 'Placa de sinalização na porta',
    orientacao: null,
    acao: 'registrar',
    validadeDias: 3,
  },
  {
    id: 12,
    ordem: 2,
    descricao: 'Coorte do quarto preservada',
    orientacao: null,
    acao: 'bloquear',
    validadeDias: null,
  },
];

/** A API dos controles simulada com o formato da porta própria (a fonte sintética não tem banco próprio). */
async function simularApi(page: Page) {
  const estado = { aviso: null as null | Record<string, unknown> };
  await page.route('**/api/internacao/controles/isolamentos**', async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    const corpo = (json: unknown, status = 200) =>
      rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    const caminho = url.pathname.replace(/.*\/isolamentos/, '');
    if (req.method() === 'GET') {
      if (caminho === '') return corpo({ itens: [ISOLAMENTO] });
      if (caminho === '/criterios') return corpo({ itens: CRITERIOS });
      if (caminho === '/avisos') return corpo({ itens: estado.aviso ? [estado.aviso] : [] });
      return rota.fallback();
    }
    if (caminho === '/auditorias') {
      estado.aviso = {
        id: 90,
        paciente: ISOLAMENTO.paciente,
        auditoria: 40,
        isolamento: ISOLAMENTO.isolamento,
        titulo: 'Isolamento: não conformidade que exige bloqueio',
        mensagem: 'Bloquear: Coorte do quarto preservada',
        prioridade: 'critica',
        situacao: 'pendente',
        geradoEm: new Date().toISOString(),
        resolvidoEm: null,
        versao: 1,
        leitosBloqueados: ['B'],
      };
      return corpo(
        {
          tabela: 'auditoria_isolamento',
          id: 40,
          aviso: 90,
          geral: 'nao_conforme',
          percentual: 50,
          alertas: [{ criterio: 12, descricao: 'Coorte do quarto preservada', acao: 'bloquear' }],
          leitosBloqueados: ['B'],
          leitosOcupadosNoQuarto: ['C'],
        },
        201,
      );
    }
    if (caminho === '/avisos/90/resolver') {
      estado.aviso = null;
      return corpo({ tabela: 'aviso_clinico', id: 90, leitosLiberados: 1 });
    }
    return rota.fallback();
  });
}

test.describe('internação: bloqueio do quarto pela auditoria do isolamento @C1-065', () => {
  test.setTimeout(180_000);

  test('prévia do bloqueio na hora, leitos bloqueados no aviso da CCIH e liberação ao resolver; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await simularApi(page);
    await entrar(page, 'SINT.CCIH');
    await page.goto('/internacao/controles/isolamento');
    await expect(page.getByTestId('tela-controles-internacao')).toBeVisible();
    await expect(page.getByTestId('iso-tabela')).toContainText('Contato sintético');
    await semViolacaoAxe(page, '/internacao/controles/isolamento (abertura)');

    await page.getByTestId(`iso-auditar-${ISOLAMENTO.isolamento}`).click();
    const form = page.getByTestId('iso-auditoria-form');
    await expect(form).toBeVisible();
    // Só respondido o primeiro: falta o critério de bloqueio, gravar travado.
    await escolher(page.getByTestId('iso-resposta-1'), 'conforme');
    await expect(page.getByTestId('iso-problema')).toContainText('Responda todos os critérios');
    await expect(page.getByTestId('iso-gravar')).toBeDisabled();
    // Critério de bloqueio conforme: nenhuma prévia de bloqueio.
    await escolher(page.getByTestId('iso-resposta-2'), 'conforme');
    await expect(page.getByTestId('iso-resultado')).toBeVisible();
    await expect(page.getByTestId('iso-previa-bloqueio')).toHaveCount(0);
    // Não conforme sem descrição: recusado na hora; com a descrição, a prévia avisa o bloqueio do quarto.
    await escolher(page.getByTestId('iso-resposta-2'), 'nao_conforme');
    await expect(page.getByTestId('iso-problema')).toContainText('Descreva a não conformidade');
    await form.getByLabel('O que não estava conforme').fill('Paciente sem a mesma precaução no quarto');
    await expect(page.getByTestId('iso-previa-bloqueio')).toContainText(
      'leitos livres do quarto ficam bloqueados',
    );
    await expect(page.getByTestId('iso-previa-bloqueio')).toContainText('paciente isolado segue em uso');
    await semViolacaoAxe(page, '/internacao/controles/isolamento (prévia do bloqueio)');

    await page.getByTestId('iso-gravar').click();
    const aviso = page.getByTestId('controles-aviso');
    await expect(aviso).toContainText('Quarto bloqueado até a CCIH resolver o aviso: leito(s) B.');
    await expect(aviso).toContainText('ocupado(s) por outro paciente, para a CCIH remanejar: C.');
    await expect(page.getByTestId('iso-aviso-90')).toContainText('Crítica');
    await expect(page.getByTestId('iso-aviso-bloqueio-90')).toContainText('B');
    await semViolacaoAxe(page, '/internacao/controles/isolamento (aviso com quarto bloqueado)');

    // Resolver exige a providência (3 caracteres); resolvido, o quarto é liberado e o aviso sai da lista.
    await expect(page.getByTestId('iso-resolver-90')).toBeDisabled();
    await page.getByTestId('iso-providencia-90').fill('Coorte refeita e quarto conferido pela CCIH');
    await page.getByTestId('iso-resolver-90').click();
    await expect(aviso).toContainText('Aviso resolvido e quarto liberado: 1 leito(s).');
    await expect(page.getByTestId('iso-aviso-90')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
