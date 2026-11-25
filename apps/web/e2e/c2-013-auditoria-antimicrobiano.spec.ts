// E2E @C2-013 (F7, 03-PEP linha 110): auditoria da ficha de antimicrobiano pela CCIH pelo caminho da tela. O controlador
// de infecção chega à fila pela navegação da CCIH, vê a ficha pendente agrupada pelo paciente (antimicrobiano,
// finalidade, período previsto), abre a auditoria na linha: droga, dose, tempo e via já vêm adequadas; o tipo
// "suspender" sugere o parecer suspenso e, sem a recomendação, o que falta aparece na hora e o botão fica travado;
// com a recomendação a gravação sai com o corpo certo (versão vista da ficha) e a tela mostra a ficha suspensa e o
// histórico do paciente. As rotas /api/qualidade/ccih/auditoria-antimicrobiano exigem o banco próprio e o E2E roda com
// a fonte sintética: as respostas são simuladas pelo Playwright com massa SINTÉTICA. O efeito no banco está nos
// contratos apps/api/src/modulos/qualidade/auditoria-antimicrobiano.int.spec.ts (auditoria e parecer na ficha) e
// apps/api/src/modulos/pep/prescricao-propria-gravacao.int.spec.ts (a ficha gravada junto da prescrição).
// O segundo teste faz o caminho inteiro pela tela: o médico prescreve o antimicrobiano com a ficha preenchida no
// editor, a gravação sai com a ficha no item e volta 201 (nada da recusa 501 antiga), a farmácia clínica vê a ficha
// ligada à prescrição (porta da prescrição em memória, fonte sintética) e a CCIH a encontra pendente na fila da
// auditoria (a fila é simulada com a ficha que a prescrição acabou de enviar).
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

  test('prescrição → ficha → fila: a ficha vai junto do item ao prescrever (201) e cai pendente na auditoria', async ({
    page,
  }) => {
    const PACIENTE_PRESC = 1003;
    const INDICACAO = 'Pneumonia sintética comunitária';
    const SITIO = 'Pulmão';
    await entrar(page, 'SINT.MEDICO');
    await page.goto(`/pep/paciente/${PACIENTE_PRESC}/prescricao/nova?periodo=seguinte`);
    await expect(page.getByTestId('tela-prescricao-editor')).toBeVisible();
    await page.getByTestId('aba-medicamentos').click();
    const editor = page.getByTestId('editor-medicamentos');
    await editor.getByTestId('busca-produto').fill('ceftriaxona');
    await editor.getByTestId('buscar-produto').click();
    await editor.getByTestId('produto-502').click();
    await editor.getByTestId('dose').fill('1');
    await escolher(editor.getByTestId('unidade'), 'G');
    await escolher(editor.getByTestId('via'), 'EV');
    await escolher(editor.getByTestId('frequencia'), { rotulo: '12/12' });
    // Sem a indicação e o sítio o item não entra: o que falta aparece na hora.
    await editor.getByTestId('incluir-item').click();
    await expect(page.getByTestId('item-incompleto')).toBeVisible();
    const fichaTela = editor.getByTestId('ficha-antimicrobiano');
    await fichaTela.getByTestId('ficha-indicacao').fill(INDICACAO);
    await fichaTela.getByTestId('ficha-sitio').fill(SITIO);
    await fichaTela.getByRole('checkbox').check();
    await editor.getByTestId('incluir-item').click();
    await expect(page.getByTestId('itens-prescricao').locator('tbody tr')).toHaveCount(1);
    await page.getByTestId('verificar-prescricao').click();
    await expect(page.getByTestId('painel-alertas')).toBeVisible();

    const ehGravacao = (u: string, metodo: string) =>
      metodo === 'POST' && new URL(u).pathname === `/api/pep/prescricao/${PACIENTE_PRESC}/prescrever`;
    const pedido = page.waitForRequest((r) => ehGravacao(r.url(), r.method()));
    const resposta = page.waitForResponse((r) => ehGravacao(r.url(), r.request().method()));
    await page.getByTestId('assinar-prescricao').click();
    const corpo = (await pedido).postDataJSON() as { itens: Record<string, unknown>[] };
    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]).toMatchObject({
      detalhe: { tipo: 'medicamento', item: { produto: 502 } },
      antimicrobiano: { indicacao: INDICACAO, sitio: SITIO, culturaColhida: true, diaTratamento: 1 },
    });
    expect((await resposta).status()).toBe(201);
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE_PRESC}/prescricao/\\d+\\?assinada=`));
    await semViolacaoAxe(page, 'prescrição assinada com a ficha de antimicrobiano');

    // A farmácia clínica vê a ficha gravada com a prescrição (origem: o novo), ligada ao paciente.
    await entrar(page, 'SINT.FARMACIA');
    await page.goto('/farmacia-clinica/antimicrobianos');
    await expect(page.getByTestId('tela-antimicrobianos')).toBeVisible();
    await page.getByTestId('atm-paciente').fill(String(PACIENTE_PRESC));
    await page.getByTestId('atm-paciente').press('Enter');
    await expect(page.getByTestId('lista-fichas')).toContainText(INDICACAO);
    await expect(page.getByTestId('lista-fichas')).toContainText('CEFTRIAXONA');

    // A CCIH acha a ficha pendente na fila da auditoria, pelo item do menu.
    const FICHA_NOVA = 8802;
    await page.route('**/api/qualidade/ccih/auditoria-antimicrobiano**', (rota) => {
      const req = rota.request();
      if (req.method() !== 'GET') return json(rota, { codigo: 'nao-simulado' }, 500);
      const caminho = new URL(req.url()).pathname.replace(
        /^\/api\/qualidade\/ccih\/auditoria-antimicrobiano\/?/,
        '',
      );
      if (caminho === '')
        return json(rota, [
          {
            ...ficha('pendente'),
            id: FICHA_NOVA,
            paciente: PACIENTE_PRESC,
            nome: 'PACIENTE SINTETICO PRESCRICAO',
            antimicrobiano: 'CEFTRIAXONA SINTETICO 1 G',
            indicacaoClinica: (corpo.itens[0]!.antimicrobiano as { indicacao: string }).indicacao,
            sitio: SITIO,
          },
        ]);
      if (caminho === 'cadastro') return json(rota, cadastro);
      if (caminho === 'historico') return json(rota, []);
      return rota.fallback();
    });
    await entrar(page, 'SINT.CCIH');
    await page.goto('/qualidade/ccih/auditoria-antimicrobiano');
    await expect(page.getByTestId('tela-ccih-auditoria-am')).toBeVisible();
    const grupo = page.getByTestId(`auditoria-paciente-${PACIENTE_PRESC}`);
    await expect(grupo.getByTestId(`auditoria-situacao-${FICHA_NOVA}`)).toContainText('Pendente');
    await expect(grupo).toContainText('CEFTRIAXONA');
    await expect(grupo).toContainText(INDICACAO);
    await expect(grupo.getByTestId(`auditoria-auditar-${FICHA_NOVA}`)).toBeEnabled();
  });
});
