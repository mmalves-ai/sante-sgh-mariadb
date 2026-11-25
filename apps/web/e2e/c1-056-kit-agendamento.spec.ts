// E2E @C1-056 (F3.6, 05-SUP linha 13): o kit padrão no agendamento cirúrgico, pela tela. As rotas
// `/api/cirurgia/agendamentos/:id/kit-padrao` e `.../materiais/:material/retirar` só existem no banco do cliente (na
// fonte sintética respondem 503), então este E2E simula essas rotas com um estado em memória que segue a regra do
// servidor (o kit que já está na lista não entra de novo; a linha retirada sai da lista e o kit volta a ser sugerido).
// O agendamento 701 e o resto da tela vêm da fonte sintética de dev. O que fica no banco (linha de natureza kit, trilha,
// marca de exclusão, corrida e lista fechada) está no contrato de efeito
// apps/api/src/modulos/cirurgia/kit-agendamento-propria.int.spec.ts. Aqui se prova o fluxo: os kits padrão chegam
// marcados, um clique leva o escolhido à lista, o já incluído fica travado, retirar devolve o kit à sugestão, e a
// lista fechada só mostra. Axe na tela. Massa SINTÉTICA.
// Quem entra é o usuário do bloco (SINT.BLOCO): a tela exige cirurgia.agenda.ler e incluir/retirar exige
// cirurgia.agenda.agendar, que são do bloco cirúrgico e não do administrador do sistema.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';

const SENHA = 'Sintetico#2026';
const AG = 701;

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

interface Material {
  id: number;
  versao: number;
  sequencia: number;
  kit: number;
  procedimentoAgendamento: number;
  nome: string;
  quantidade: number;
  excluido: boolean;
  natureza?: string;
}

const PADROES = [
  {
    procedimentoAgendamento: 11,
    procedimento: 501,
    procedimentoCodigo: 'CIR-FIC-1',
    procedimentoNome: 'ARTROPLASTIA FICTICIA',
    principal: true,
    kit: 91,
    codigo: 'KFIC1',
    nome: 'KIT FICTICIO JOELHO',
    quantidadeKits: 2,
    itens: [{ insumo: 5001, nome: 'LUVA FICTICIA', unidade: 'PAR', quantidade: 4 }],
  },
  {
    procedimentoAgendamento: 12,
    procedimento: 502,
    procedimentoCodigo: 'CIR-FIC-2',
    procedimentoNome: 'CURATIVO FICTICIO',
    principal: false,
    kit: 92,
    codigo: 'KFIC2',
    nome: 'KIT FICTICIO CURATIVO',
    quantidadeKits: 1,
    itens: [{ insumo: 5002, nome: 'GAZE FICTICIA', unidade: 'PCT', quantidade: 3 }],
  },
];

function simular(page: Page, aberta: () => boolean, iniciais: Material[] = []) {
  const materiais: Material[] = [...iniciais];
  const corpos: unknown[] = [];
  const vigentes = () => materiais.filter((m) => !m.excluido);
  const naLista = (p: (typeof PADROES)[number]) =>
    vigentes().some((m) => m.kit === p.kit && m.procedimentoAgendamento === p.procedimentoAgendamento);
  const sugestao = () => ({
    agendamento: AG,
    numero: 'CC-FIC-1',
    situacao: aberta() ? 'agendado' : 'realizado',
    aberta: aberta(),
    sugeridos: PADROES.map((p) => ({ ...p, jaNaLista: naLista(p) })),
    materiais: vigentes().map((m) => ({
      id: m.id,
      versao: m.versao,
      sequencia: m.sequencia,
      natureza: m.natureza ?? 'kit',
      insumo: null,
      kit: m.natureza && m.natureza !== 'kit' ? null : m.kit,
      procedimentoAgendamento: m.procedimentoAgendamento,
      nome: m.nome,
      quantidade: m.quantidade,
      retiravel: (m.natureza ?? 'kit') === 'kit',
    })),
  });
  return {
    corpos,
    async ligar() {
      await page.route(`**/api/cirurgia/agendamentos/${AG}/kit-padrao`, async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, sugestao());
        const corpo = rota.request().postDataJSON() as {
          kits: { kit: number; procedimentoAgendamento: number }[];
        };
        corpos.push(corpo);
        let incluidos = 0;
        for (const k of corpo.kits) {
          const p = PADROES.find(
            (x) => x.kit === k.kit && x.procedimentoAgendamento === k.procedimentoAgendamento,
          );
          if (!p || naLista(p)) continue;
          materiais.push({
            id: 900 + materiais.length,
            versao: 1,
            sequencia: materiais.length + 1,
            kit: p.kit,
            procedimentoAgendamento: p.procedimentoAgendamento,
            nome: p.nome,
            quantidade: p.quantidadeKits,
            excluido: false,
          });
          incluidos += 1;
        }
        return json(rota, { id: null, agendamento: AG, incluidos, jaNaLista: corpo.kits.length - incluidos });
      });
      await page.route(`**/api/cirurgia/agendamentos/${AG}/materiais/*/retirar`, async (rota) => {
        const id = Number(rota.request().url().split('/materiais/')[1]!.split('/')[0]);
        const m = materiais.find((x) => x.id === id && !x.excluido);
        if (!m) return json(rota, { status: 404, codigo: 'registro-inexistente' }, 404);
        if ((m.natureza ?? 'kit') !== 'kit') return json(rota, { status: 422, codigo: 'regra-violada' }, 422);
        m.excluido = true;
        m.versao += 1;
        return json(rota, { id, agendamento: AG });
      });
    },
  };
}

test.describe('Kit padrão no agendamento cirúrgico @C1-056', () => {
  test('sugere o kit de cada procedimento, inclui com um clique, não repete, retira sem apagar; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    let aberta = true;
    const api = simular(page, () => aberta);
    await api.ligar();
    await entrar(page, 'SINT.BLOCO');

    await page.goto(`/cirurgia/agendamentos/${AG}`);
    await expect(page.getByTestId('tela-agendamento-cirurgico')).toBeVisible();
    const painel = page.getByTestId('kit-agendamento');
    await expect(painel).toBeVisible();
    await expect(page.getByTestId('kit-agendamento-sugerido-KFIC1')).toContainText('KIT FICTICIO JOELHO');
    await expect(page.getByTestId('kit-agendamento-sugerido-KFIC1')).toContainText('LUVA FICTICIA');
    await expect(page.getByTestId('kit-agendamento-lista-vazia')).toBeVisible();

    // Os dois chegam marcados; desmarcados os dois, o botão desliga e o aviso aparece na hora.
    await expect(page.getByTestId('kit-agendamento-marca-KFIC1')).toBeChecked();
    await expect(page.getByTestId('kit-agendamento-marca-KFIC2')).toBeChecked();
    await page.getByTestId('kit-agendamento-marca-KFIC1').uncheck();
    await page.getByTestId('kit-agendamento-marca-KFIC2').uncheck();
    await expect(page.getByTestId('kit-agendamento-incluir')).toBeDisabled();
    await expect(page.getByTestId('kit-agendamento-nenhum-marcado')).toBeVisible();

    // Só o do joelho vai à lista, com os 2 kits do vínculo; ele fica travado como "já na lista".
    await page.getByTestId('kit-agendamento-marca-KFIC1').check();
    await page.getByTestId('kit-agendamento-incluir').click();
    await expect(page.getByTestId('kit-agendamento-mensagem')).toContainText('1 kit(s) incluído(s)');
    expect(api.corpos[0]).toEqual({ kits: [{ kit: 91, procedimentoAgendamento: 11 }] });
    await expect(page.getByTestId('kit-agendamento-material-1')).toContainText('KIT FICTICIO JOELHO');
    await expect(page.getByTestId('kit-agendamento-material-1')).toContainText('2');
    await expect(page.getByTestId('kit-agendamento-marca-KFIC1')).toBeDisabled();
    await expect(page.getByTestId('kit-agendamento-sugerido-KFIC1')).toContainText('já na lista');

    // O do curativo vem marcado de novo (ainda fora da lista) e entra sem repetir o do joelho.
    await expect(page.getByTestId('kit-agendamento-marca-KFIC2')).toBeChecked();
    await page.getByTestId('kit-agendamento-incluir').click();
    expect(api.corpos[1]).toEqual({ kits: [{ kit: 92, procedimentoAgendamento: 12 }] });
    await expect(page.locator('[data-testid^="kit-agendamento-material-"]')).toHaveCount(2);
    await expect(page.getByTestId('kit-agendamento-incluir')).toBeDisabled();
    await semViolacaoAxe(page, `/cirurgia/agendamentos/${AG}`);

    // Retirar o do joelho: sai da lista e volta a ser sugerido, marcado.
    await page.getByTestId('kit-agendamento-retirar-1').click();
    await expect(page.getByTestId('kit-agendamento-mensagem')).toContainText('retirado');
    await expect(page.locator('[data-testid^="kit-agendamento-material-"]')).toHaveCount(1);
    await expect(page.getByTestId('kit-agendamento-marca-KFIC1')).toBeEnabled();
    await expect(page.getByTestId('kit-agendamento-marca-KFIC1')).toBeChecked();

    // Com a lista fechada (cirurgia realizada), só a leitura: sem incluir nem retirar.
    aberta = false;
    await page.reload();
    await expect(page.getByTestId('kit-agendamento-fechada')).toBeVisible();
    await expect(page.getByTestId('kit-agendamento-incluir')).toHaveCount(0);
    await expect(page.locator('[data-testid^="kit-agendamento-retirar-"]')).toHaveCount(0);
    expect(externas).toEqual([]);
  });

  test('linha de material especial (OPME) na lista não tem o botão de retirar; a de kit tem', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const opme: Material = {
      id: 950,
      versao: 1,
      sequencia: 1,
      kit: 0,
      procedimentoAgendamento: 11,
      nome: 'PROTESE FICTICIA',
      quantidade: 1,
      excluido: false,
      natureza: 'opme',
    };
    const api = simular(page, () => true, [opme]);
    await api.ligar();
    await entrar(page, 'SINT.BLOCO');
    await page.goto(`/cirurgia/agendamentos/${AG}`);
    await expect(page.getByTestId('kit-agendamento-material-1')).toContainText('PROTESE FICTICIA');
    await expect(page.getByTestId('kit-agendamento-retirar-1')).toHaveCount(0);
    await page.getByTestId('kit-agendamento-incluir').click();
    await expect(page.locator('[data-testid^="kit-agendamento-material-"]')).toHaveCount(3);
    await expect(page.getByTestId('kit-agendamento-retirar-2')).toBeVisible();
    await expect(page.getByTestId('kit-agendamento-retirar-1')).toHaveCount(0);
    expect(externas).toEqual([]);
  });
});
