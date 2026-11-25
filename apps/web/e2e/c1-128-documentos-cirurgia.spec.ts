// E2E @C1-128 (F8, 04-CC linha 104): documentos obrigatórios antes da cirurgia, com bloqueio do início, pela tela. As
// rotas `/api/cirurgia/agendamentos/:id/documentos` e `/api/cirurgia/documentos-exigidos` só existem no banco do
// cliente (na fonte sintética respondem 503), então este E2E simula essas rotas com um estado em memória que segue a
// regra do servidor (cada registro é uma linha nova; o mais recente vale; o consentimento não se dispensa na
// eletiva). O agendamento 701 e o resto da tela vêm da fonte sintética de dev. O que fica no banco e a recusa da
// confirmação e da entrada no bloco estão no contrato de efeito
// apps/api/src/modulos/cirurgia/documentos-cirurgia-propria.int.spec.ts. Aqui se prova o fluxo: o que falta para
// confirmar e para começar aparece na cirurgia, a validação vem na hora, um passo registra o termo com o digitalizado
// do paciente, o histórico fica; na configuração, o consentimento já vem bloqueando e a regra desativada fica na
// lista. Axe nas duas telas. Massa SINTÉTICA.
import { expect, type Page, type Route, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

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

const TIPOS = [
  { id: 1, codigo: 'TCLE-FIC', descricao: 'TERMO FICTICIO', categoria: 'consentimento', ativo: true },
  { id: 2, codigo: 'EXA-FIC', descricao: 'EXAME FICTICIO', categoria: 'exame', ativo: true },
];
const EXIGIDOS = [
  { tipo: 1, validadeDias: null, bloqueia: true, geraPendencia: false },
  { tipo: 2, validadeDias: 30, bloqueia: false, geraPendencia: true },
];

interface Registro {
  id: number;
  sequencia: number;
  tipo: number;
  situacao: string;
  apresentadoEm: string | null;
  validoAte: string | null;
  arquivo: number | null;
  observacao: string | null;
  conferidoEm: string;
  conferente: string;
}

function simular(page: Page) {
  const regs: Registro[] = [];
  const corpos: Record<string, unknown>[] = [];
  const regras: Record<string, unknown>[] = [];
  const tipos = TIPOS.map((t) => ({
    ...t,
    versao: 1,
    obrigatorio: false,
    validadeDias: null as number | null,
    geraPendencia: true,
  }));
  const vigente = (tipo: number) =>
    regs.filter((r) => r.tipo === tipo).sort((a, b) => b.sequencia - a.sequencia)[0] ?? null;
  const leitura = () => ({
    agendamento: AG,
    numero: 'CC-FIC-1',
    situacao: 'agendado',
    natureza: 'eletiva',
    dataCirurgia: '2030-03-10',
    documentos: EXIGIDOS.map((e) => {
      const t = TIPOS.find((x) => x.id === e.tipo)!;
      const v = vigente(e.tipo);
      return {
        ...e,
        codigo: t.codigo,
        descricao: t.descricao,
        categoria: t.categoria,
        estado: v ? v.situacao : 'pendente',
        vigente: v,
      };
    }),
    historico: regs,
    tipos: TIPOS.map(({ id, codigo, descricao, categoria }) => ({ id, codigo, descricao, categoria })),
    digitalizados: [{ id: 55, descricao: 'TERMO DIGITALIZADO FICTICIO', data: '2030-03-01', tipo: 'Termo' }],
  });
  const configuracao = () => ({
    tipos,
    regras,
    opcoes: {
      procedimentos: [{ id: 9, rotulo: 'PROC-FIC · PROCEDIMENTO FICTICIO' }],
      fontes: [{ id: 3, rotulo: 'FP-FIC · FONTE FICTICIA' }],
      faixas: [],
    },
  });
  return {
    corpos,
    async ligar() {
      await page.route(`**/api/cirurgia/agendamentos/${AG}/documentos`, async (rota) => {
        if (rota.request().method() === 'GET') return json(rota, leitura());
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        regs.push({
          id: 500 + regs.length,
          sequencia: regs.length + 1,
          tipo: Number(c['tipo']),
          situacao: String(c['situacao']),
          apresentadoEm: (c['apresentadoEm'] as string | null) ?? null,
          validoAte: (c['validoAte'] as string | null) ?? null,
          arquivo: c['digitalizado'] ? 77 : null,
          observacao: (c['observacao'] as string | null) ?? null,
          conferidoEm: '2030-03-05 10:00',
          conferente: 'SINT.ADMIN',
        });
        return json(rota, { id: 500 + regs.length - 1, agendamento: AG });
      });
      await page.route('**/api/cirurgia/documentos-exigidos', (rota) => json(rota, configuracao()));
      await page.route('**/api/cirurgia/documentos-exigidos/tipos', async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        tipos.push({
          id: 10 + tipos.length,
          codigo: String(c['codigo']),
          descricao: String(c['descricao']),
          categoria: String(c['categoria']),
          versao: 1,
          ativo: true,
          obrigatorio: false,
          validadeDias: (c['validadeDias'] as number | null) ?? null,
          geraPendencia: true,
        });
        return json(rota, { id: 10 + tipos.length - 1 });
      });
      await page.route('**/api/cirurgia/documentos-exigidos/tipos/*/ativo', async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        const id = Number(rota.request().url().split('/').at(-2));
        const t = tipos.find((x) => x.id === id)!;
        t.ativo = Boolean(c['ativo']);
        t.versao += 1;
        return json(rota, { id });
      });
      await page.route('**/api/cirurgia/documentos-exigidos/regras', async (rota) => {
        const c = rota.request().postDataJSON() as Record<string, unknown>;
        corpos.push(c);
        const t = tipos.find((x) => x.id === c['tipo'])!;
        regras.push({
          id: 70 + regras.length,
          versao: 1,
          tipo: t.id,
          tipoDescricao: t.descricao,
          procedimento: c['procedimento'] ?? null,
          procedimentoDescricao: c['procedimento'] ? 'PROCEDIMENTO FICTICIO' : null,
          fontePagadora: null,
          fonteNome: null,
          faixaEtaria: null,
          faixaDescricao: null,
          validadeDias: c['validadeDias'] ?? null,
          bloqueiaEntradaSala: Boolean(c['bloqueiaEntradaSala']),
          geraPendencia: Boolean(c['geraPendencia']),
          ativo: true,
        });
        return json(rota, { id: 70 + regras.length - 1 });
      });
      await page.route('**/api/cirurgia/documentos-exigidos/regras/*/ativo', async (rota) => {
        const id = Number(rota.request().url().split('/regras/')[1]!.split('/')[0]);
        const c = rota.request().postDataJSON() as { versao: number; ativo: boolean };
        corpos.push(c);
        const r = regras.find((x) => x['id'] === id)!;
        r['ativo'] = c.ativo;
        r['versao'] = Number(r['versao']) + 1;
        return json(rota, { id });
      });
    },
  };
}

test.describe('Documentos obrigatórios antes da cirurgia @C1-128', () => {
  test('o que falta aparece na cirurgia, o termo é registrado em um passo e a configuração bloqueia o consentimento; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const api = simular(page);
    await api.ligar();
    await entrar(page, 'SINT.ADMIN');

    await page.goto(`/cirurgia/agendamentos/${AG}`);
    const painel = page.getByTestId('documentos-cirurgia');
    await expect(painel).toBeVisible();
    await expect(page.getByTestId('documentos-bloqueio-inicio')).toContainText('1 documento(s)');
    await expect(page.getByTestId('documentos-bloqueio-confirmacao')).toContainText('1 documento(s)');
    await expect(page.getByTestId('documento-estado-TCLE-FIC')).toHaveAttribute('data-estado', 'pendente');

    // Dispensar o termo na eletiva: a regra recusa na hora e o botão fica desligado.
    await page.getByTestId('documento-registrar-TCLE-FIC').click();
    await escolher(page.getByTestId('documento-situacao'), 'dispensado');
    await page
      .getByTestId('documento-observacao')
      .locator('input, textarea')
      .first()
      .fill('Paciente sem acompanhante');
    await expect(page.getByTestId('documento-problema')).toContainText('urgência');
    await expect(page.getByTestId('documento-gravar')).toBeDisabled();

    // Apresentado: a data de hoje já vem; o digitalizado do paciente vai junto; um clique grava.
    await escolher(page.getByTestId('documento-situacao'), 'apresentado');
    await escolher(page.getByTestId('documento-digitalizado'), '55');
    await expect(page.getByTestId('documento-problema')).toHaveCount(0);
    await page.getByTestId('documento-gravar').click();
    await expect(page.getByTestId('documentos-mensagem')).toContainText('registrado');
    expect(api.corpos[0]).toMatchObject({ tipo: 1, situacao: 'apresentado', digitalizado: 55 });
    await expect(page.getByTestId('documento-estado-TCLE-FIC')).toHaveAttribute('data-estado', 'apresentado');
    await expect(page.getByTestId('documentos-bloqueio-inicio')).toHaveCount(0);
    await expect(page.getByTestId('documentos-bloqueio-confirmacao')).toBeVisible();

    // O exame é dispensado com justificativa: tudo em dia; o histórico mostra os dois registros.
    await page.getByTestId('documento-registrar-EXA-FIC').click();
    await escolher(page.getByTestId('documento-situacao'), 'dispensado');
    await page
      .getByTestId('documento-observacao')
      .locator('input, textarea')
      .first()
      .fill('Exame dispensado pelo cirurgião');
    await page.getByTestId('documento-gravar').click();
    await expect(page.getByTestId('documentos-pronta')).toBeVisible();
    await expect(page.getByTestId('documentos-historico')).toContainText('(2)');
    await semViolacaoAxe(page, `/cirurgia/agendamentos/${AG}`);

    // Configuração: o consentimento já vem bloqueando o início e o bloqueio não se desmarca.
    await page.goto('/cirurgia/documentos-exigidos');
    await expect(page.getByTestId('documentos-exigidos')).toBeVisible();
    await page.getByTestId('tipo-codigo').locator('input').fill('a b');
    await expect(page.getByTestId('tipo-problema').first()).toContainText('código');
    await expect(page.getByTestId('tipo-gravar')).toBeDisabled();
    await page.getByTestId('tipo-codigo').locator('input').fill('APA-FIC');
    await page.getByTestId('tipo-descricao').locator('input').fill('AVALIACAO FICTICIA');
    await escolher(page.getByTestId('tipo-categoria'), 'avaliacao');
    await page.getByTestId('tipo-gravar').click();
    await expect(page.getByTestId('tipo-APA-FIC')).toBeVisible();
    // O tipo entra sem a exigência geral (ela é a regra do estabelecimento sem procedimento).
    await expect(page.getByTestId('tipo-dica-geral')).toBeVisible();
    expect(api.corpos.at(-1)).not.toHaveProperty('obrigatorio');
    // Desativar o tipo: fica na lista, inativo, pela versão; reativar volta.
    await page.getByTestId('tipo-alternar-APA-FIC').click();
    await expect(page.getByTestId('tipo-APA-FIC')).toHaveAttribute('data-ativo', 'false');
    expect(api.corpos.at(-1)).toEqual({ versao: 1, ativo: false });
    await page.getByTestId('tipo-alternar-APA-FIC').click();
    await expect(page.getByTestId('tipo-APA-FIC')).toHaveAttribute('data-ativo', 'true');
    expect(api.corpos.at(-1)).toEqual({ versao: 2, ativo: true });

    await escolher(page.getByTestId('regra-tipo'), '1');
    await expect(page.getByTestId('regra-bloqueia')).toBeChecked();
    await expect(page.getByTestId('regra-bloqueia')).toBeDisabled();
    await escolher(page.getByTestId('regra-procedimento'), '9');
    await page.getByTestId('regra-gravar').click();
    await expect(page.getByTestId('regra-70')).toContainText('bloqueia o início');
    expect(api.corpos.at(-1)).toMatchObject({ tipo: 1, procedimento: 9, bloqueiaEntradaSala: true });

    // Desativar a regra: ela fica na lista, inativa.
    await page.getByTestId('regra-alternar-70').click();
    await expect(page.getByTestId('regra-70')).toHaveAttribute('data-ativa', 'false');
    await expect(page.getByTestId('regra-70')).toContainText('inativa');
    expect(api.corpos.at(-1)).toEqual({ versao: 1, ativo: false });
    await semViolacaoAxe(page, '/cirurgia/documentos-exigidos');
    expect(externas).toEqual([]);
  });
});
