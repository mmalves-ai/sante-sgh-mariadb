// E2E @C2-056 (03-PEP L93): prontuário de acesso restrito, no que a fonte sintética permite. A fila e a visão por
// paciente moram só no banco do cliente; para provar o fluxo da tela (pedir com validação na hora, aprovar pela senha
// do paciente, abrir com a contagem e a recusa 403 acima do limite) a API é simulada por page.route com dados
// SINTÉTICOS. O que fica no banco (pedido, decisão com alçada, autorização, senha só em resumo, contagem, revogação,
// 403) é provado no contrato de efeito apps/api/src/modulos/pep/prontuario-restrito-propria.int.spec.ts e a regra em
// packages/dominio-pep/src/prontuario-restrito.spec.ts. Sessão real sobre a fonte sintética de dev. axe sem violação séria.
import { expect, test, type Page, type Route } from '@playwright/test';
import { escolher } from './combos.js';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const configuracao = {
  autorizador: 'medico_responsavel',
  papelId: null,
  validadeHoras: 24,
  exigeSenhaPaciente: false,
  limiteAcessos: 1,
  exigeMotivo: true,
  avisaResponsavel: true,
  daUnidade: true,
  versao: 1,
};
const pedido = {
  id: 71,
  versao: 1,
  paciente: PACIENTE,
  prontuario: '900001',
  solicitante: 'SINT.OUTRO',
  doUsuario: false,
  motivo: 'Interconsulta (sintético)',
  justificativa: 'Interconsulta pedida pela equipe sintética',
  tipo: 'regular',
  situacao: 'pendente',
  solicitadoEm: '2026-11-25T09:00:00',
  decididoEm: null,
  motivoDecisao: null,
  acessoFim: null,
};

function painel(estado: { aprovado: boolean; aberturas: number }) {
  return {
    paciente: PACIENTE,
    prontuario: '900001',
    restricao: {
      id: 5,
      versao: 1,
      modo: 'restrito',
      categoria: 'caso_sensivel',
      motivo: 'Caso sensível sintético',
      desde: '2026-11-25T08:00:00',
      permiteEmergencial: true,
    },
    configuracao,
    senha: { definida: true, bloqueada: false },
    minha: estado.aprovado
      ? {
          permitido: estado.aberturas < 1,
          mensagem: estado.aberturas < 1 ? null : 'Limite atingido.',
          restantes: 0,
        }
      : {
          permitido: false,
          mensagem: 'Prontuário restrito: peça o acesso e aguarde a autorização.',
          restantes: null,
        },
    podeDecidir: true,
    pedidos: [{ ...pedido, situacao: estado.aprovado ? 'aprovado' : 'pendente' }],
    autorizacoes: estado.aprovado
      ? [
          {
            id: 81,
            versao: 1,
            autorizado: 'SINT.OUTRO',
            concedidaPor: 'paciente',
            senhaConferida: true,
            tipo: 'consulta',
            inicio: '2026-11-25T09:10:00',
            fim: '2026-11-26T09:10:00',
            revogadaEm: null,
            motivoRevogacao: null,
            acessos: estado.aberturas,
            limite: 1,
            vigente: true,
          },
        ]
      : [],
    motivos: [{ id: 3, descricao: 'Interconsulta (sintético)', textoPadrao: null, exigeComplemento: false }],
  };
}

test.describe('Prontuário de acesso restrito @C2-056 @fase8', () => {
  test.setTimeout(120_000);
  test('pedido com validação na hora, aprovação pela senha do paciente, abertura contada e 403 no limite; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const estado = { aprovado: false, aberturas: 0 };
    const posts: { url: string; corpo: Record<string, unknown> }[] = [];
    // O médico com conselho (perfil assistencial-com-conselho) lê, pede e autoriza; o administrador do sistema só
    // configura (pep.prontuarioRestrito.configurar) e não abre a fila nem o pedido.
    await entrar(page, 'SINT.MEDICO');
    await page.route('**/api/pep/prontuario-restrito**', async (route: Route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'GET' && url.includes(`/paciente/${PACIENTE}`))
        return route.fulfill({ json: painel(estado) });
      if (req.method() === 'GET')
        return route.fulfill({ json: { pedidos: [pedido], configuracao, papeis: [] } });
      const corpo = req.postDataJSON() as Record<string, unknown>;
      posts.push({ url, corpo });
      if (url.endsWith('/pedidos/decidir')) {
        if (corpo['senhaPaciente'] !== '482915')
          return route.fulfill({
            status: 403,
            contentType: 'application/problem+json',
            json: {
              type: 'about:blank',
              title: 'Senha do paciente',
              status: 403,
              detail: 'A senha do paciente não confere.',
              codigo: 'senha-recusada',
            },
          });
        estado.aprovado = true;
        return route.fulfill({ json: { ok: true, mensagem: 'Acesso autorizado.' } });
      }
      if (url.endsWith('/abrir')) {
        if (estado.aberturas >= 1)
          return route.fulfill({
            status: 403,
            contentType: 'application/problem+json',
            json: {
              type: 'about:blank',
              title: 'Prontuário restrito',
              status: 403,
              detail: 'O limite de 1 aberturas desta autorização foi atingido: peça novo acesso.',
              codigo: 'limite-atingido',
            },
          });
        estado.aberturas += 1;
        return route.fulfill({
          json: { ok: true, resultado: { numero: 1, restantes: 0 }, mensagem: 'Abertura registrada.' },
        });
      }
      return route.fulfill({ json: { ok: true, mensagem: 'Pedido de acesso enviado.' } });
    });

    // Fila da unidade: o pedido pendente leva à visão do paciente.
    await page.goto('/pep/prontuario-restrito');
    await expect(page.getByTestId('restrito-tela')).toBeVisible();
    await expect(page.getByTestId(`restrito-fila-${pedido.id}`)).toBeVisible();
    await page.getByTestId(`restrito-fila-${pedido.id}`).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/prontuario-restrito$`));
    await expect(page.getByTestId('restrito-marca')).toBeVisible();

    // Pedir: o botão só libera com motivo e justificativa longa o bastante.
    await escolher(page.getByTestId('restrito-motivo'), '3');
    await page.getByTestId('restrito-justificativa').fill('curta');
    await expect(page.getByTestId('restrito-enviar')).toBeDisabled();
    await page.getByTestId('restrito-justificativa').fill('Revisão do caso para a interconsulta');
    await expect(page.getByTestId('restrito-enviar')).toBeEnabled();
    await page.getByTestId('restrito-enviar').click();
    await expect(page.getByTestId('restrito-ok')).toBeVisible();

    // Aprovar pelo paciente: senha errada recusa (403), a certa aprova.
    await page.getByTestId(`restrito-pelopaciente-${pedido.id}`).check();
    await page.getByTestId(`restrito-senha-${pedido.id}`).fill('000001');
    await page.getByTestId(`restrito-aprovar-${pedido.id}`).click();
    await expect(page.getByTestId('mensagem-erro').first()).toContainText('não confere');
    await page.getByTestId(`restrito-senha-${pedido.id}`).fill('482915');
    await page.getByTestId(`restrito-aprovar-${pedido.id}`).click();
    await expect(page.getByTestId('restrito-autorizacao-81')).toContainText('0 de 1');

    // Abrir: a primeira conta; a segunda passa do limite e o servidor responde 403.
    await page.getByTestId('restrito-abrir').click();
    await expect(page.getByTestId('restrito-autorizacao-81')).toContainText('1 de 1');
    await expect(page.getByTestId('restrito-abrir')).toHaveCount(0);
    // A abertura contada leva direto à leitura do prontuário (liberada pela janela da abertura).
    await expect(page.getByTestId('restrito-ler-prontuario')).toHaveAttribute(
      'href',
      `/pep/prontuario/${PACIENTE}`,
    );

    expect(posts.map((x) => new URL(x.url).pathname.replace('/api/pep/prontuario-restrito/', ''))).toEqual([
      'pedidos',
      'pedidos/decidir',
      'pedidos/decidir',
      'abrir',
    ]);
    await semViolacaoAxe(page, '/pep/paciente/:id/prontuario-restrito');
    expect(externas).toEqual([]);
  });
});
