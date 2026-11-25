// E2E @C2-048 (F3, 04-INT linha 70): plano previsto da pré-internação e fila de espera eletiva pelo caminho da tela
// (`/internacao/pre`). Na lista das pré-internações, "Plano" abre os procedimentos, os materiais e a equipe previstos
// da pré-internação do paciente: busca e adiciona o procedimento (o primeiro vira o principal, na guia TISS), o
// material com o fornecedor previsto (OPME, achado pela busca de fornecedores) e o profissional com a função; o repetido é avisado na hora, a quantidade inválida trava a gravação, e a
// gravação manda a lista inteira com a versão lida. Na fila de espera (pré-internações sem data, ordenadas pela
// prioridade clínica e pela data do pedido), a mudança de prioridade pede justificativa (o botão trava sem ela) e a
// fila volta reordenada. Os combos são SanteSelecao (nenhum <select> nativo). O plano e a fila só existem no banco do
// cliente (na fonte sintética a API responde 503): as respostas são simuladas pelo Playwright com massa SINTÉTICA, no
// contrato do servidor. O que fica no banco está no contrato de efeito
// (apps/api/src/modulos/adt/pre-internacao-plano-propria.int.spec.ts).
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo } from './combos.js';

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

const DIA = 86_400_000;

function simular(page: Page) {
  const st = { corpos: [] as { url: string; corpo: Record<string, unknown> }[] };
  const plano = {
    preInternacao: 701,
    numero: 'PI-0701',
    paciente: 9101,
    situacao: 'em_espera',
    prioridade: 'normal',
    editavel: true,
    versao: 1,
    procedimentoSus: null,
    procedimentos: [] as Record<string, unknown>[],
    materiais: [] as Record<string, unknown>[],
    equipe: [] as Record<string, unknown>[],
  };
  const espera = (id: number, paciente: number, nome: string, prioridade: string, dias: number) => ({
    preInternacao: id,
    numero: `PI-0${id}`,
    paciente,
    nome,
    prontuario: paciente,
    prioridade,
    solicitadoEm: new Date(Date.now() - dias * DIA).toISOString(),
    diasEspera: dias,
    posicao: 0,
    especialidade: 'Cirurgia geral',
    procedimentoPrincipal: null as string | null,
    procedimentos: 0,
    materiais: 0,
    equipe: 0,
    versao: 1,
  });
  let fila = [
    espera(702, 9102, 'Paciente Sintético Dois', 'normal', 30),
    espera(701, 9101, 'Paciente Sintético Um', 'normal', 5),
  ];
  const ordenar = () => {
    const peso: Record<string, number> = { urgente: 0, prioritaria: 1, normal: 2 };
    fila = [...fila]
      .sort((a, b) => peso[a.prioridade]! - peso[b.prioridade]! || b.diasEspera - a.diasEspera)
      .map((x, i) => ({ ...x, posicao: i + 1 }));
  };
  ordenar();
  const contagens = () => ({
    total: fila.length,
    urgente: fila.filter((x) => x.prioridade === 'urgente').length,
    prioritaria: fila.filter((x) => x.prioridade === 'prioritaria').length,
    normal: fila.filter((x) => x.prioridade === 'normal').length,
  });
  void page.route(/\/api\/internacoes\/pre(\?.*)?$/, (r) =>
    r.request().method() !== 'GET'
      ? r.fallback()
      : json(r, {
          itens: [
            {
              paciente: 9101,
              prontuario: 9101,
              nome: 'Paciente Sintético Um',
              dataPrevista: null,
              horaPrevista: '',
              situacao: 'pendente',
              problema: 'sem-data',
              convenio: { codigo: 1, nome: 'Convênio Sintético' },
              especialidade: { codigo: 2, nome: 'Cirurgia geral' },
              medico: 'Médico Sintético',
              acomodacao: null,
              procedimento: null,
              versao: 1,
            },
          ],
          cortada: false,
          contagens: { pendentes: 1, semData: 1, impossiveis: 0 },
        }),
  );
  const B = '/api/internacao/pre-internacao';
  void page.route(new RegExp(`${B}/apoio$`), (r) =>
    json(r, {
      funcoes: [
        { id: 11, descricao: 'Cirurgião' },
        { id: 12, descricao: 'Anestesista' },
      ],
      prioridades: ['urgente', 'prioritaria', 'normal'],
      viasAcesso: ['unica', 'mesma_via', 'diferente_via'],
    }),
  );
  void page.route(new RegExp(`${B}/busca/itens`), (r) =>
    json(r, [{ id: 301, codigo: '31009999', descricao: 'Colecistectomia sintética' }]),
  );
  void page.route(new RegExp(`${B}/busca/insumos`), (r) =>
    json(r, [{ id: 401, codigo: 'MAT-1', nome: 'Grampeador sintético', unidade: 'UN' }]),
  );
  void page.route(new RegExp(`${B}/busca/fornecedores`), (r) =>
    json(r, [{ id: 601, nome: 'Fornecedora Sintética Ltda', fantasia: 'OPME Sintética', opme: true }]),
  );
  void page.route(new RegExp(`${B}/busca/profissionais`), (r) =>
    json(r, [{ id: 501, nome: 'Cirurgiã Sintética' }]),
  );
  void page.route(new RegExp(`${B}/fila$`), (r) => json(r, { itens: fila, contagens: contagens() }));
  void page.route(new RegExp(`${B}/pacientes/\\d+/plano$`), (r) => json(r, { plano }));
  void page.route(new RegExp(`${B}/\\d+/plano$`), async (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: r.request().url(), corpo });
    plano.versao += 1;
    plano.procedimentos = (corpo['procedimentos'] as Record<string, unknown>[]).map((p) => ({
      ...p,
      codigo: '31009999',
      descricao: 'Colecistectomia sintética',
    }));
    plano.materiais = (corpo['materiais'] as Record<string, unknown>[]).map((m) => ({
      ...m,
      codigo: 'MAT-1',
      nome: 'Grampeador sintético',
      unidade: 'UN',
      fornecedorNome: m['fornecedor'] ? 'OPME Sintética' : null,
    }));
    plano.equipe = (corpo['equipe'] as Record<string, unknown>[]).map((e) => ({
      ...e,
      nome: 'Cirurgiã Sintética',
      funcaoDescricao: 'Cirurgião',
    }));
    fila = fila.map((x) =>
      x.preInternacao === 701
        ? {
            ...x,
            procedimentoPrincipal: 'Colecistectomia sintética',
            procedimentos: plano.procedimentos.length,
            materiais: plano.materiais.length,
            equipe: plano.equipe.length,
          }
        : x,
    );
    return json(r, { versao: plano.versao });
  });
  void page.route(new RegExp(`${B}/\\d+/prioridade$`), async (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>;
    st.corpos.push({ url: r.request().url(), corpo });
    const id = Number(/\/(\d+)\/prioridade$/.exec(r.request().url())![1]);
    fila = fila.map((x) =>
      x.preInternacao === id ? { ...x, prioridade: String(corpo['prioridade']), versao: x.versao + 1 } : x,
    );
    ordenar();
    return json(r, { versao: 2 });
  });
  return st;
}

test.describe('internação: plano da pré-internação e fila de espera @C2-048 @F3', () => {
  test.setTimeout(180_000);

  test('monta o plano previsto com validação na hora e reordena a fila pela prioridade justificada; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const st = simular(page);
    await entrar(page, 'SINT.ADMIN');
    await page.goto('/internacao/pre');
    const tela = page.getByTestId('tela-pre-internacao');
    await expect(tela).toBeVisible();

    // A fila de espera: a mais antiga primeiro, na mesma prioridade.
    const filaTela = page.getByTestId('pre-fila');
    await expect(page.getByTestId('pre-fila-contagem')).toContainText('2 na fila');
    await expect(page.getByTestId('tabela-pre-fila').locator('tbody tr').first()).toContainText(
      'Paciente Sintético Dois',
    );
    await esperarSemSelectNativo(tela);
    await semViolacaoAxe(page, 'pré-internação: lista e fila');

    // O plano, aberto pela lista: procedimento (vira o principal), material e equipe.
    await page.getByTestId('pre-plano-abrir-9101').click();
    const plano = page.getByTestId('pre-plano');
    await expect(plano).toContainText('PI-0701');
    await page.getByTestId('pre-plano-termo-item').fill('colecist');
    await page.getByTestId('pre-plano-buscar-item').click();
    await escolher(page.getByTestId('pre-plano-item'), { rotulo: '31009999 · Colecistectomia sintética' });
    await page.getByTestId('pre-plano-adicionar-item').click();
    await expect(page.getByTestId('pre-plano-principal-301')).toBeChecked();
    // O mesmo procedimento de novo: aviso na hora, sem duplicar.
    await escolher(page.getByTestId('pre-plano-item'), { rotulo: '31009999 · Colecistectomia sintética' });
    await page.getByTestId('pre-plano-adicionar-item').click();
    await expect(page.getByTestId('pre-plano-aviso')).toContainText('Já está no plano');
    await expect(page.getByTestId('pre-plano-procedimentos').locator('li')).toHaveCount(1);

    await page.getByTestId('pre-plano-termo-insumo').fill('grampe');
    await page.getByTestId('pre-plano-buscar-insumo').click();
    await escolher(page.getByTestId('pre-plano-insumo'), { rotulo: 'MAT-1 · Grampeador sintético (UN)' });
    await page.getByTestId('pre-plano-adicionar-insumo').click();
    await expect(page.getByTestId('pre-plano-mat-401')).toBeVisible();
    // O fornecedor previsto do material (consignado ou OPME): busca e escolhe na linha do material.
    await page.getByTestId('pre-plano-termo-fornecedor').fill('opme');
    await page.getByTestId('pre-plano-buscar-fornecedor').click();
    await expect(page.getByTestId('pre-plano-fornecedores-achados')).toContainText('1 fornecedor');
    await escolher(page.getByTestId('pre-plano-mat-fornecedor-401'), { rotulo: 'OPME Sintética · OPME' });

    await page.getByTestId('pre-plano-termo-prof').fill('cirurg');
    await page.getByTestId('pre-plano-buscar-prof').click();
    await escolher(page.getByTestId('pre-plano-prof'), { rotulo: 'Cirurgiã Sintética' });
    await escolher(page.getByTestId('pre-plano-funcao'), { rotulo: 'Cirurgião' });
    await page.getByTestId('pre-plano-adicionar-prof').click();
    await expect(page.getByTestId('pre-plano-equipe')).toContainText('Cirurgiã Sintética · Cirurgião');

    // Quantidade inválida trava a gravação; corrigida, grava a lista inteira com a versão lida.
    const qtd = page.getByTestId('pre-plano-proc-qtd-301');
    await qtd.fill('0');
    await expect(page.getByTestId('pre-plano-gravar')).toBeDisabled();
    await qtd.fill('1');
    await esperarSemSelectNativo(plano);
    await semViolacaoAxe(page, 'pré-internação: plano preenchido');
    await page.getByTestId('pre-plano-gravar').click();
    await expect(page.getByTestId('pre-plano-mensagem')).toContainText('Plano gravado');
    expect(st.corpos.at(-1)?.corpo).toEqual({
      versao: 1,
      procedimentos: [{ item: 301, quantidade: 1, principal: true, viaAcesso: null, incluirNaGuia: true }],
      materiais: [{ insumo: 401, quantidade: 1, fornecedor: 601, observacao: null }],
      equipe: [{ profissional: 501, funcao: 11 }],
    });
    await expect(page.getByTestId('pre-fila-701')).toContainText('1 proc. · 1 mat. · 1 equipe');

    // Prioridade: sem justificativa o botão trava; com ela, a fila volta reordenada.
    await page.getByTestId('pre-fila-mudar-701').click();
    await escolher(filaTela.getByTestId('pre-fila-nova-prioridade'), { rotulo: 'Urgente' });
    const confirmar = page.getByTestId('pre-fila-confirmar');
    await page.getByTestId('pre-fila-justificativa').fill('piora');
    await expect(confirmar).toBeDisabled();
    await page.getByTestId('pre-fila-justificativa').fill('Piora clínica relatada pelo cirurgião');
    await confirmar.click();
    await expect(page.getByTestId('pre-fila-mensagem')).toContainText('Prioridade alterada');
    expect(st.corpos.at(-1)?.corpo).toEqual({
      versao: 1,
      prioridade: 'urgente',
      justificativa: 'Piora clínica relatada pelo cirurgião',
    });
    await expect(page.getByTestId('pre-fila-prioridade-701')).toContainText('Urgente');
    await expect(page.getByTestId('tabela-pre-fila').locator('tbody tr').first()).toContainText(
      'Paciente Sintético Um',
    );
    expect(externas).toEqual([]);
  });
});
