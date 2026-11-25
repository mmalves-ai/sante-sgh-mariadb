// C1-076 (03-PEP linha 90): painel de pacientes do profissional com filtros salvos no banco. Na estação A o médico
// escolhe a unidade, salva o filtro com nome, edita os recortes (setor, situação, leito da unidade) e a largura das
// colunas com a validação do domínio na hora (largura fora de 20 a 2000 pixels trava a gravação) e grava; a lista
// passa a vir recortada pela API. Na estação B (outro navegador, sem nada guardado), o mesmo usuário abre o painel já
// com o filtro padrão aplicado: os recortes e as larguras vêm do banco, não do navegador. Axe em cada passo.
// O E2E roda sem banco próprio (fonte sintética): as rotas do painel são simuladas no navegador com o formato da porta,
// e o "banco" simulado é um só para as duas estações. O que fica no banco (filtro, padrão único, colunas com largura) e
// o recorte do SQL do painel são provados pelos contratos de efeito painel-filtros-propria.int.spec.ts e
// documentos-propria-painel.int.spec.ts (apps/api/src/modulos/pep).
import { type Browser, expect, type Page, test } from '@playwright/test';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher, esperarValor } from './combos.js';

const SENHA = 'Sintetico#2026';
const UNIDADE = { id: 21, nome: 'Unidade sintética de internação' };
const SETOR = { id: 31, rotulo: 'Setor sintético' };
const LEITO = { id: 41, rotulo: 'L-SINT-1', unidade: UNIDADE.id };

const linha = (paciente: number, nome: string, leito: string | null) => ({
  paciente,
  nome,
  idade: '40 anos',
  sexo: null,
  prontuario: String(paciente),
  atendimento: paciente + 5000,
  registro: paciente + 5000,
  tipo: 'internacao',
  entrada: '2026-11-24T10:00:00',
  dias: 1,
  unidade: UNIDADE.nome,
  leito,
  convenio: null,
  medico: null,
  alergias: 'nao-avaliadas',
  alertas: [],
  favorito: false,
});
const PACIENTES = [
  linha(2001, 'PACIENTE SINTETICO UM', null),
  linha(2002, 'PACIENTE SINTETICO DOIS', 'L-SINT-1'),
];

interface Filtro {
  id: number;
  versao: number;
  nome: string;
  padrao: boolean;
  tipoAtendimento: string;
  unidade: number | null;
  setor: number | null;
  acomodacao: number | null;
  leito: number | null;
  especialidade: number | null;
  situacao: string | null;
  apenasMeusPacientes: boolean;
}

/** O "banco" simulado, comum às duas estações (o que a porta própria guardaria). */
function novoBanco() {
  return {
    filtros: [] as Filtro[],
    colunas: new Map<number, { coluna: string; largura: number | null }[]>(),
    consultas: [] as URLSearchParams[],
  };
}
type Banco = ReturnType<typeof novoBanco>;

async function simularApi(page: Page, banco: Banco): Promise<void> {
  await page.route('**/api/pep/painel**', async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    const corpo = (json: unknown, status = 200) =>
      rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    const caminho = url.pathname.replace(/.*\/api\/pep\/painel/, '');
    const metodo = req.method();
    if (caminho === '' && metodo === 'GET') {
      banco.consultas.push(url.searchParams);
      // O recorte do setor (o que o SQL do painel faz): só o paciente do setor.
      const pacientes = url.searchParams.get('setor')
        ? PACIENTES.filter((p) => p.paciente === 2002)
        : PACIENTES;
      return corpo({
        unidades: [UNIDADE],
        preferencias: { colunas: ['leito', 'paciente'], unidade: null, soFavoritos: false },
        pacientes,
        total: pacientes.length,
        teto: 300,
        configurar: true,
        limitado: false,
      });
    }
    if (caminho === '/acompanhados') return corpo({ itens: [] });
    if (caminho === '/colunas') return corpo({ colunas: ['leito', 'paciente', 'idade', 'dias'] });
    if (caminho === '/filtro-padrao') return corpo(metodo === 'GET' ? { unidade: null } : { id: 1 });
    if (caminho === '/filtros/opcoes')
      return corpo({ setores: [SETOR], acomodacoes: [], leitos: [LEITO], especialidades: [] });
    if (caminho === '/filtros' && metodo === 'GET') return corpo({ filtros: banco.filtros });
    if (caminho === '/filtros' && metodo === 'POST') {
      const b = req.postDataJSON() as Partial<Filtro> & { nome: string };
      const id = 70 + banco.filtros.length;
      banco.filtros.push({
        id,
        versao: 1,
        nome: b.nome,
        padrao: banco.filtros.length === 0,
        tipoAtendimento: b.tipoAtendimento ?? 'todos',
        unidade: b.unidade ?? null,
        setor: null,
        acomodacao: null,
        leito: null,
        especialidade: null,
        situacao: null,
        apenasMeusPacientes: b.apenasMeusPacientes ?? false,
      });
      return corpo({ id });
    }
    const m = /^\/filtros\/(\d+)(\/colunas)?$/.exec(caminho);
    if (m) {
      const id = Number(m[1]);
      const f = banco.filtros.find((x) => x.id === id);
      if (!f) return corpo({ title: 'Filtro não encontrado' }, 404);
      if (m[2] && metodo === 'GET') return corpo({ colunas: banco.colunas.get(id) ?? [] });
      if (m[2] && metodo === 'PUT') {
        const { colunas } = req.postDataJSON() as { colunas: { coluna: string; largura: number | null }[] };
        banco.colunas.set(id, colunas);
        return corpo({ colunas });
      }
      if (metodo === 'PUT') {
        const b = req.postDataJSON() as Filtro;
        if (b.versao !== f.versao) return corpo({ title: 'Versão desatualizada' }, 409);
        Object.assign(f, { ...b, id, padrao: f.padrao, versao: f.versao + 1 });
        return corpo({ id });
      }
    }
    return rota.fallback();
  });
}

async function abrirEstacao(browser: Browser, banco: Banco): Promise<Page> {
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  await simularApi(page, banco);
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill('SINT.ADMIN');
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
  await page.goto('/pep/pacientes');
  await expect(page.getByTestId('tela-meus-pacientes')).toBeVisible();
  return page;
}

test.describe('prontuário: painel de pacientes com filtros salvos e troca de estação @C1-076', () => {
  test('recortes e larguras gravados na estação A e aplicados na estação B; axe', async ({ browser }) => {
    const banco = novoBanco();
    const a = await abrirEstacao(browser, banco);
    const externas = vigiarExternas(a);
    await expect(a.getByTestId('painel-paciente-2001')).toBeVisible();
    await semViolacaoAxe(a, '/pep/pacientes (estação A, abertura)');

    // Unidade e nome: o primeiro filtro nasce padrão.
    await escolher(a.getByTestId('painel-unidade'), String(UNIDADE.id));
    await a.getByTestId('painel-filtro-nome').fill('Minha enfermaria');
    await a.getByTestId('painel-filtro-salvar').click();
    await expect(a.getByTestId('painel-filtro-aviso')).toContainText('Minha enfermaria');

    // Recortes e largura, com a regra do domínio conferida na hora.
    await a.getByTestId('painel-filtro-editar').click();
    const edicao = a.getByTestId('painel-filtro-recortes');
    await expect(edicao).toBeVisible();
    await escolher(a.getByTestId('painel-recorte-setor'), String(SETOR.id));
    await escolher(a.getByTestId('painel-recorte-situacao'), 'aguardando');
    await escolher(a.getByTestId('painel-recorte-leito'), String(LEITO.id));
    await a.getByTestId('painel-largura-paciente').fill('5');
    await expect(a.getByTestId('painel-filtro-erros')).toContainText('Largura entre 20 e 2000');
    await expect(a.getByTestId('painel-filtro-gravar')).toBeDisabled();
    await semViolacaoAxe(a, '/pep/pacientes (estação A, edição com erro)');
    await a.getByTestId('painel-largura-paciente').fill('240');
    await expect(a.getByTestId('painel-filtro-erros')).toHaveCount(0);
    await a.getByTestId('painel-filtro-gravar').click();
    await expect(a.getByTestId('painel-filtro-aviso')).toContainText('gravado');

    // A lista vem recortada pela API: só o paciente do setor.
    await expect(a.getByTestId('painel-paciente-2002')).toBeVisible();
    await expect(a.getByTestId('painel-paciente-2001')).toHaveCount(0);
    const ultima = banco.consultas.at(-1);
    expect(ultima?.get('setor')).toBe(String(SETOR.id));
    expect(ultima?.get('leito')).toBe(String(LEITO.id));
    expect(ultima?.get('situacao')).toBe('aguardando');
    expect(banco.filtros[0]).toMatchObject({
      setor: SETOR.id,
      leito: LEITO.id,
      situacao: 'aguardando',
      versao: 2,
    });
    expect(banco.colunas.get(banco.filtros[0]!.id)).toContainEqual({ coluna: 'paciente', largura: 240 });
    expect(externas).toEqual([]);

    // Estação B: outro navegador, nada guardado nele; o filtro padrão vem do banco já aplicado.
    const b = await abrirEstacao(browser, banco);
    await esperarValor(b.getByTestId('painel-filtro-salvo'), String(banco.filtros[0]!.id));
    await expect(b.getByTestId('painel-paciente-2002')).toBeVisible();
    await expect(b.getByTestId('painel-paciente-2001')).toHaveCount(0);
    expect(banco.consultas.at(-1)?.get('setor')).toBe(String(SETOR.id));
    await expect(b.getByRole('columnheader', { name: /paciente/i })).toHaveAttribute('style', /width: 240px/);
    await b.getByTestId('painel-filtro-editar').click();
    await esperarValor(b.getByTestId('painel-recorte-setor'), String(SETOR.id));
    await esperarValor(b.getByTestId('painel-recorte-situacao'), 'aguardando');
    await expect(b.getByTestId('painel-largura-paciente')).toHaveValue('240');
    await semViolacaoAxe(b, '/pep/pacientes (estação B, filtro do banco)');
  });
});
