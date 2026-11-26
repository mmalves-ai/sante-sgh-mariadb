// E2E @C2-032 (09-AREA L84): o fluxo de tela da terminologia clínica, com a API simulada pelo Playwright (como o
// f35-catalogo-exames.spec.ts e os demais specs de tela sobre a fonte sintética: o servidor do E2E não tem o banco do
// cliente, então a API da terminologia e a do catálogo são simuladas e o teste confere o que a tela ENVIA). O que fica
// no MariaDB é provado no contrato de efeito apps/api/src/modulos/pep/terminologia-clinica-propria.int.spec.ts.
// 1) Diagnósticos do paciente: o atalho do prontuário leva à tela; o médico busca a CID-10, o conceito equivalente
//    principal já vem sugerido, registra como principal e vê na lista; troca o conceito e depois o tira (versão vista
//    em cada gravação; nada é apagado).
// 2) Regiões anatômicas na ficha do exame do catálogo do SADT: liga uma região como padrão e outra sem; "Tornar
//    padrão" faz UMA gravação (acao 'padrao', sem retirar e religar); retirar só tira da lista.
// Combos pelo e2e/combos.ts (nada de select nativo). Paciente e exames SINTÉTICOS. axe sem violação séria.
import { expect, test, type Page, type Route } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarSemSelectNativo, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';
const PACIENTE = 1001;
const ATENDIMENTO = 5001;
type Corpo = Record<string, unknown>;

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const json = (r: Route, corpo: unknown) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });

const CID = { id: 11, codigo: 'I219', descricao: 'Infarto agudo sintético' };
const CONCEITOS = [
  {
    id: 21,
    codigo: 'E2E-C1',
    descricao: 'Infarto sintético de parede anterior',
    descricaoCompleta: null,
    equivalencia: 'equivalente',
  },
  {
    id: 22,
    codigo: 'E2E-C2',
    descricao: 'Infarto sintético de parede inferior',
    descricaoCompleta: null,
    equivalencia: null,
  },
];
const REGIOES = [
  {
    id: 41,
    sistema: 'e2e',
    nivel: 'regiao',
    codigo: 'E2E-MAO',
    descricao: 'Mão sintética',
    superiorId: null,
  },
  {
    id: 42,
    sistema: 'e2e',
    nivel: 'localizacao_primaria',
    codigo: 'E2E-DEDO',
    descricao: 'Dedo sintético',
    superiorId: 41,
  },
];

/** A API da terminologia clínica simulada, com estado: guarda os corpos enviados e devolve o que ficou gravado. */
function simularTerminologia(page: Page) {
  const enviados: Record<string, Corpo[]> = {};
  const diagnosticos: Corpo[] = [];
  const ligadas = new Map<number, boolean>(); // região → padrão
  void page.route('**/api/pep/terminologia-clinica/**', async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace('/api/pep/terminologia-clinica', '');
    const q = (k: string) => url.searchParams.get(k) ?? '';
    if (req.method() === 'GET') {
      if (caminho === '/cids') return json(r, q('texto').length >= 2 ? [CID] : []);
      if (caminho === '/conceitos') return json(r, q('cid') === String(CID.id) ? CONCEITOS : []);
      if (caminho === `/paciente/${PACIENTE}/diagnosticos`) return json(r, { diagnosticos });
      if (caminho === '/regioes') {
        if (q('exame'))
          return json(
            r,
            REGIOES.filter((x) => ligadas.has(x.id)).map((x) => ({ ...x, padrao: ligadas.get(x.id) })),
          );
        return json(r, q('texto').length >= 2 ? REGIOES : []);
      }
      return json(r, []);
    }
    const corpo = (req.postDataJSON() ?? {}) as Corpo;
    (enviados[caminho] ??= []).push(corpo);
    if (caminho === '/diagnosticos') {
      if (corpo['acao'] === 'registrar') {
        diagnosticos.unshift({
          id: 31,
          versao: 1,
          atendimentoId: corpo['atendimento'],
          cid: { id: CID.id, codigo: CID.codigo, descricao: CID.descricao },
          conceito: termoDe(corpo['conceito']),
          tipo: corpo['tipo'],
          certeza: corpo['certeza'],
          escopo: corpo['escopo'],
          situacao: 'ativo',
          diagnosticadoEm: '2026-11-25T10:00:00.000Z',
          profissional: 'Médico sintético',
          observacao: corpo['observacao'] ?? null,
        });
        return json(r, { ok: true, resultado: { diagnostico: 31, versao: 1 }, repetida: false });
      }
      const d = diagnosticos.find((x) => x['id'] === corpo['diagnostico'])!;
      d['conceito'] = termoDe(corpo['conceito']);
      d['versao'] = Number(d['versao']) + 1;
      return json(r, { ok: true, resultado: { diagnostico: d['id'], versao: d['versao'] }, repetida: false });
    }
    if (caminho === '/exame-regioes') {
      const regiao = Number(corpo['regiao']);
      if (corpo['acao'] === 'retirar') ligadas.delete(regiao);
      else {
        const padrao = corpo['acao'] === 'padrao' || corpo['padrao'] === true;
        if (padrao) for (const k of ligadas.keys()) ligadas.set(k, false);
        ligadas.set(regiao, padrao || (ligadas.get(regiao) ?? false));
      }
      return json(r, { ok: true, resultado: { ligacao: regiao, ativo: corpo['acao'] !== 'retirar' } });
    }
    return json(r, { ok: true });
  });
  return { enviados };
}

function termoDe(id: unknown) {
  const c = CONCEITOS.find((x) => x.id === id);
  return c ? { id: c.id, codigo: c.codigo, descricao: c.descricao } : null;
}

/** A ficha do exame sintético no catálogo do SADT (só o que a tela precisa para abrir a ficha). */
function simularCatalogo(page: Page) {
  const exame = {
    id: 900,
    versao: 1,
    codigo: 'E2E-RX',
    sigla: 'RXS',
    nome: 'Radiografia sintética',
    tipoServico: 'imagem',
    ativo: true,
  };
  void page.route('**/api/sadt/catalogo/**', async (r) => {
    const req = r.request();
    const caminho = new URL(req.url()).pathname.replace('/api/sadt/catalogo', '');
    if (req.method() !== 'GET') return json(r, { id: 1, versao: 2 });
    if (caminho === '/opcoes')
      return json(r, {
        setores: [],
        materiais: [],
        recipientes: [],
        preparos: [],
        sexos: [],
        modalidades: [],
        metodos: [],
        especialidades: [],
        unidades: [],
        analitos: [],
        exames: [],
      });
    if (caminho === '/exames') return json(r, [exame]);
    if (caminho === '/exames/900')
      return json(r, {
        exame,
        setores: [],
        materiais: [],
        preparos: [],
        lateralidades: [],
        ligados: [],
        analitos: [],
        procedimentos: [],
      });
    return json(r, []);
  });
}

test.describe('Terminologia clínica: diagnósticos e regiões do exame @C2-032 @fase8', () => {
  test.setTimeout(120_000);

  test('diagnóstico: busca a CID, conceito sugerido, registra, troca e tira o conceito; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simularTerminologia(page);
    await entrar(page, 'SINT.MEDICO');

    // O atalho do cabeçalho do prontuário leva à tela dos diagnósticos do paciente.
    await page.goto(`/pep/paciente/${PACIENTE}/linha-do-tempo`);
    await expect(page.getByTestId('tela-prontuario-paciente')).toBeVisible();
    await page.getByTestId('atalho-diagnosticos').click();
    await expect(page).toHaveURL(new RegExp(`/pep/paciente/${PACIENTE}/diagnosticos(\\?|$)`));
    await expect(page.getByTestId('diagnosticos-tela')).toBeVisible();

    // Com o atendimento em curso, o formulário do registro aparece.
    await page.goto(`/pep/paciente/${PACIENTE}/diagnosticos?atendimento=${ATENDIMENTO}`);
    const tela = page.getByTestId('diagnosticos-tela');
    await expect(tela.getByTestId('diagnosticos-nenhum')).toBeVisible();
    const form = tela.getByTestId('diagnosticos-novo');
    await expect(form.getByTestId('diagnosticos-registrar')).toBeDisabled();

    await form.getByTestId('diagnosticos-busca-cid').fill('i21.9');
    await escolher(form.getByTestId('diagnosticos-cid'), String(CID.id));
    // A equivalência principal da CID já vem marcada como conceito (sem segunda busca).
    await esperarValor(form.getByTestId('diagnosticos-conceito'), '21');
    await escolher(form.getByTestId('diagnosticos-tipo'), 'principal');
    await form.getByTestId('diagnosticos-observacao').fill('Parede anterior, sintético');
    await expect(form.getByTestId('diagnosticos-registrar')).toBeEnabled();
    await form.getByTestId('diagnosticos-registrar').click();

    await expect(tela.getByTestId('diagnosticos-ok')).toBeVisible();
    expect(api.enviados['/diagnosticos']?.[0]).toMatchObject({
      acao: 'registrar',
      paciente: PACIENTE,
      atendimento: ATENDIMENTO,
      cid: CID.id,
      conceito: 21,
      tipo: 'principal',
      certeza: 'confirmado',
      escopo: 'atendimento',
      observacao: 'Parede anterior, sintético',
    });
    const linha = tela.getByTestId('diagnostico-31');
    await expect(linha).toContainText('I219');
    await expect(linha.getByTestId('diagnostico-conceito-31')).toContainText('E2E-C1');

    // Troca do conceito na própria linha, com a versão vista.
    await linha.getByTestId('trocar-conceito-31').click();
    await escolher(linha.getByTestId('troca-conceito-31'), '22');
    await linha.getByTestId('troca-gravar-31').click();
    await expect(linha.getByTestId('diagnostico-conceito-31')).toContainText('E2E-C2');
    expect(api.enviados['/diagnosticos']?.[1]).toEqual({
      acao: 'conceito',
      diagnostico: 31,
      versao: 1,
      conceito: 22,
    });

    // Tirar o conceito: a CID fica, o conceito sai (versão 2 vista).
    await linha.getByTestId('tirar-conceito-31').click();
    await expect(linha.getByTestId('diagnostico-conceito-31')).toContainText('Sem conceito clínico');
    await expect(linha).toContainText('I219');
    expect(api.enviados['/diagnosticos']?.[2]).toEqual({
      acao: 'conceito',
      diagnostico: 31,
      versao: 2,
      conceito: null,
    });
    expect(api.enviados['/diagnosticos']).toHaveLength(3);

    await esperarSemSelectNativo(tela);
    await semViolacaoAxe(page, '/pep/paciente/:id/diagnosticos');
    expect(externas).toEqual([]);
  });

  test('regiões do exame: liga com a padrão, torna padrão numa gravação só e retira; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simularTerminologia(page);
    simularCatalogo(page);
    await entrar(page, 'SINT.LABORATORIO');

    await page.goto('/sadt/catalogo');
    const catalogo = page.getByTestId('catalogo-exames');
    await expect(catalogo).toBeVisible();
    await catalogo.locator('aside form input').first().fill('RXS');
    await catalogo.locator('aside form input').first().press('Enter');
    await catalogo.getByRole('button', { name: 'RXS · Radiografia sintética' }).click();

    const secao = page.getByTestId('secao-regioes-anatomicas');
    await expect(secao.getByTestId('regioes-nenhuma')).toBeVisible();
    await expect(secao.getByTestId('regioes-ligar-botao')).toBeDisabled();

    // Liga a mão como padrão.
    await secao.getByTestId('regioes-busca').fill('sintétic');
    await escolher(secao.getByTestId('regioes-escolha'), '41');
    await secao.getByTestId('regioes-padrao').check();
    await secao.getByTestId('regioes-ligar-botao').click();
    await expect(secao.getByTestId('regiao-marca-padrao-E2E-MAO')).toContainText('padrão');
    expect(api.enviados['/exame-regioes']?.[0]).toEqual({
      exame: 900,
      acao: 'ligar',
      regiao: 41,
      padrao: true,
    });

    // Liga o dedo sem padrão (a mão, já ligada, sai da busca).
    await secao.getByTestId('regioes-busca').fill('sintétic');
    await escolher(secao.getByTestId('regioes-escolha'), '42');
    await secao.getByTestId('regioes-ligar-botao').click();
    await expect(secao.getByTestId('regiao-exame-E2E-DEDO')).toBeVisible();
    await expect(secao.getByTestId('regiao-marca-padrao-E2E-DEDO')).toHaveCount(0);
    expect(api.enviados['/exame-regioes']?.[1]).toEqual({
      exame: 900,
      acao: 'ligar',
      regiao: 42,
      padrao: false,
    });

    // Tornar padrão o dedo: UMA gravação, sem retirar e religar; a mão deixa de ser a padrão.
    await secao.getByTestId('regiao-padrao-E2E-DEDO').click();
    await expect(secao.getByTestId('regiao-marca-padrao-E2E-DEDO')).toContainText('padrão');
    await expect(secao.getByTestId('regiao-marca-padrao-E2E-MAO')).toHaveCount(0);
    expect(api.enviados['/exame-regioes']?.[2]).toEqual({ exame: 900, acao: 'padrao', regiao: 42 });
    expect(api.enviados['/exame-regioes']).toHaveLength(3);

    // Retirar a mão: some da lista (no banco a ligação só é desativada).
    await secao.getByTestId('regiao-retirar-E2E-MAO').click();
    await expect(secao.getByTestId('regiao-exame-E2E-MAO')).toHaveCount(0);
    await expect(secao.getByTestId('regiao-exame-E2E-DEDO')).toBeVisible();
    expect(api.enviados['/exame-regioes']?.[3]).toEqual({ exame: 900, acao: 'retirar', regiao: 41 });

    await esperarSemSelectNativo(secao);
    await semViolacaoAxe(page, '/sadt/catalogo (regiões anatômicas do exame)');
    expect(externas).toEqual([]);
  });
});
