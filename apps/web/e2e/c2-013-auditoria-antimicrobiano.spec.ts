// E2E @C2-013 (F7, 03-PEP linha 110): auditoria da ficha de antimicrobiano pela CCIH pelo caminho da tela. O controlador
// de infecção chega à fila pela navegação da CCIH, vê a ficha pendente agrupada pelo paciente (antimicrobiano,
// finalidade, período previsto), abre a auditoria na linha: droga, dose, tempo e via já vêm adequadas; o tipo
// "suspender" sugere o parecer suspenso e, sem a recomendação, o que falta aparece na hora e o botão fica travado;
// com a recomendação a gravação sai com o corpo certo (versão vista da ficha) e a tela mostra a ficha suspensa e o
// histórico do paciente. As rotas /api/qualidade/ccih/auditoria-antimicrobiano exigem o banco próprio e o E2E roda com
// a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco está nos
// contratos apps/api/src/modulos/qualidade/auditoria-antimicrobiano.int.spec.ts (auditoria e parecer na ficha) e
// apps/api/src/modulos/pep/prescricao-propria-gravacao.int.spec.ts (a ficha gravada junto da prescrição).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 7601;
const FICHA = 8801;
const TIPO_SUSPENDER = 3;

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

function ficha(avaliacao: string) {
  return {
    id: FICHA,
    versao: avaliacao === 'pendente' ? 1 : 2,
    paciente: PACIENTE,
    nome: 'PACIENTE SINTETICO AUDITORIA',
    atendimento: 4401,
    item: 991,
    antimicrobiano: 'ANTIMICROBIANO SINTETICO',
    finalidade: 'Empírica',
    finalidadeCodigo: 'empirica',
    sitio: 'Pulmonar',
    indicacaoClinica: 'Indicação sintética',
    culturaColetada: true,
    inicio: '2026-11-20',
    fimPrevisto: '2026-11-26',
    diasPrevistos: 7,
    prescritor: 'PRESCRITOR SINTETICO',
    avaliacao,
    avaliadaEm: avaliacao === 'pendente' ? null : '2026-11-25T10:00:00',
    ultimoParecer: avaliacao === 'pendente' ? null : 'suspenso',
  };
}

const cadastro = {
  tipos: [
    { id: 1, codigo: 'manter', descricao: 'Manter', acao: 'manter', padrao: true, ativo: true },
    {
      id: TIPO_SUSPENDER,
      codigo: 'suspender',
      descricao: 'Suspender',
      acao: 'suspender',
      padrao: false,
      ativo: true,
    },
  ],
  pareceres: [
    {
      id: 5,
      codigo: 'prorroga',
      descricao: 'Aprovado com prorrogação',
      permiteProrrogacao: true,
      antimicrobiano: null,
      ativo: true,
    },
  ],
};

test.describe('Auditoria da ficha de antimicrobiano @C2-013 @fase7', () => {
  test.setTimeout(180_000);
  test('fila por paciente, tipo sugere o parecer, falta na hora, corpo certo, ficha suspensa e histórico; axe', async ({
    page,
  }) => {
    const pedidos: { caminho: string; corpo: Record<string, unknown> }[] = [];
    let auditada = false;
    await page.route('**/api/qualidade/ccih/auditoria-antimicrobiano**', (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace(
        /^\/api\/qualidade\/ccih\/auditoria-antimicrobiano\/?/,
        '',
      );
      if (req.method() === 'GET') {
        if (caminho === '') return json(rota, [ficha(auditada ? 'suspensa' : 'pendente')]);
        if (caminho === 'cadastro') return json(rota, cadastro);
        if (caminho === 'historico')
          return json(
            rota,
            auditada
              ? [
                  {
                    id: 61,
                    ficha: FICHA,
                    item: 991,
                    paciente: PACIENTE,
                    auditadaEm: '2026-11-25T10:00:00',
                    auditor: 'SINT.CCIH',
                    avaliavel: true,
                    droga: 'adequada',
                    dose: 'adequada',
                    tempo: 'inadequada',
                    via: 'adequada',
                    indicacao: 'empirico',
                    parecer: 'suspenso',
                    permiteProrrogacao: false,
                    recomendacao: 'Suspender: tempo excedido',
                    situacao: 'ativa',
                    tipo: 'Suspender',
                    parecerPadrao: null,
                    versao: 1,
                  },
                ]
              : [],
          );
        return rota.fallback();
      }
      pedidos.push({ caminho, corpo: (req.postDataJSON() ?? {}) as Record<string, unknown> });
      if (caminho === `fichas/${FICHA}`) {
        auditada = true;
        return json(rota, { id: 61, ficha: FICHA, avaliacao: 'suspensa', encerradas: 0 }, 201);
      }
      return json(rota, { codigo: 'nao-simulado' }, 500);
    });

    await entrar(page, 'SINT.CCIH');
    await page.goto('/qualidade/ccih/iras');
    await page.getByTestId('nav-ccih-auditoriaAntimicrobiano').click();
    await expect(page).toHaveURL(/\/qualidade\/ccih\/auditoria-antimicrobiano$/);
    await expect(page.getByTestId('tela-ccih-auditoria-am')).toBeVisible();
    const grupo = page.getByTestId(`auditoria-paciente-${PACIENTE}`);
    await expect(grupo.getByTestId(`auditoria-situacao-${FICHA}`)).toContainText('Pendente');
    await semViolacaoAxe(page, '/qualidade/ccih/auditoria-antimicrobiano (fila)');

    await grupo.getByTestId(`auditoria-auditar-${FICHA}`).click();
    const form = page.getByTestId('form-auditoria');
    await expect(form).toBeVisible();
    await escolher(form.getByTestId('auditoria-tempo'), { rotulo: 'Inadequada' });
    await escolher(form.getByTestId('auditoria-tipo'), { rotulo: 'Suspender' });
    await expect(page.getByTestId('auditoria-falta')).toContainText('recomendação');
    await expect(form.getByTestId('auditoria-gravar')).toBeDisabled();
    await form
      .getByTestId('auditoria-recomendacao')
      .locator('textarea, input')
      .first()
      .fill('Suspender: tempo excedido');
    await expect(page.getByTestId('auditoria-falta')).toHaveCount(0);
    expect(pedidos).toHaveLength(0);
    await form.getByTestId('auditoria-gravar').click();

    await expect(page.getByTestId('auditoria-aviso')).toContainText('Suspensa');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({
      caminho: `fichas/${FICHA}`,
      corpo: {
        versaoFicha: 1,
        avaliavel: true,
        droga: 'adequada',
        tempo: 'inadequada',
        parecer: 'suspenso',
        tipo: TIPO_SUSPENDER,
        recomendacao: 'Suspender: tempo excedido',
      },
    });
    await page.getByTestId('auditoria-so-pendentes').uncheck();
    await expect(grupo.getByTestId(`auditoria-situacao-${FICHA}`)).toContainText('Suspensa');
    await grupo.getByTestId(`auditoria-ver-historico-${PACIENTE}`).click();
    await expect(page.getByTestId('auditoria-61')).toContainText('Suspenso');
    await semViolacaoAxe(page, '/qualidade/ccih/auditoria-antimicrobiano (histórico do paciente)');
  });
});
