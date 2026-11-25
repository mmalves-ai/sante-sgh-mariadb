// E2E @C1-071 (08-SGO linha 93, F7): o cadastro complementar de cada operadora da instalação. O administrador liga a
// operadora e os beneficiários para as pessoas do teste → o gestor da operadora cadastra duas operadoras sintéticas pela
// API → na tela "Beneficiários, planos e contratos" escolhe a segunda no combo Operadora e abre a aba "Responsáveis,
// setores e parâmetros" → o aviso lista os papéis únicos sem titular → registra a auditoria independente pelo CNPJ (a
// pessoa achada aparece antes de gravar) → cria o setor de autorização e o de regulação abaixo dele; o setor com e-mail
// inválido mostra o problema na hora e não deixa gravar → altera o prazo da cobertura parcial temporária: 30 meses é
// recusado na hora (faixa 1 a 24); 18 grava e a linha deixa de ser "padrão" → a primeira operadora continua sem nada
// (escopo por operadora) → recolher; axe sem violação séria em cada estado. Sessão real sobre a fonte sintética de dev;
// documentos SINTÉTICOS. Nenhuma saída externa (vigiarExternas).
// As rotas `/api/operadora/complementar/**` só existem no banco do cliente (na fonte sintética, sem o núcleo, respondem
// 503), então este E2E as simula com um estado em memória por operadora que aplica as mesmas regras do domínio que a
// porta própria aplica (planoResponsavel, problemasDoDepartamento, valorDoParametro, o catálogo PARAMETROS_OPERADORA).
// O que fica no banco (encerramento na véspera, hierarquia, vigência do parâmetro, trilha) está no contrato de efeito
// cadastro-complementar.int.spec.ts. O cadastro das duas operadoras e a liberação seguem pela API real.
import { expect, test, type Page, type Route } from '@playwright/test';
import {
  PARAMETROS_OPERADORA,
  planoResponsavel,
  problemasDoDepartamento,
  valorDoParametro,
  type ChaveParametroOperadora,
  type ProblemaCadastro,
  type TipoResponsavelOperadora,
} from '@sgh/dominio-operadora';
import { semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';
const PESSOAS = ['SINT.OPERADORA'];
const CHAVES = ['operadora', 'operadora.beneficiarios'];

async function entrar(page: Page, login: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}
async function csrf(page: Page): Promise<string> {
  return (await page.context().cookies()).find((c) => c.name === 'sgh_csrf')?.value ?? '';
}
const cabecalhos = async (page: Page, k: string) => ({
  'x-csrf': await csrf(page),
  'idempotency-key': `e2e-c1-071-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
});
async function chave(page: Page, nome: string, ligar: boolean): Promise<void> {
  const r = await page.request.post('/api/administracao/liberacao', {
    headers: await cabecalhos(page, `${nome}-${ligar}`),
    data: {
      chave: nome,
      tipo: 'recurso',
      escopo: 'pessoa',
      valores: PESSOAS,
      ligar,
      justificativa: 'Cadastro complementar sintético (E2E do C1-071)',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}
async function prerequisito(page: Page, recurso: string, tipo: string): Promise<void> {
  const r = await page.request.put('/api/administracao/liberacao/prerequisitos', {
    headers: await cabecalhos(page, `pre-${recurso}`),
    data: {
      recurso,
      tipo,
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'pré-requisito sintético do E2E',
      senha: SENHA,
    },
  });
  expect(r.status(), await r.text()).toBe(200);
}
function dv11(base: string, pesos: readonly number[]): number {
  let s = 0;
  pesos.forEach((p, i) => (s += Number(base[i]) * p));
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}
const cnpj = (b12: string) => {
  const d1 = dv11(b12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${b12}${d1}${dv11(`${b12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
};
async function empresa(page: Page, registro: string, doc: string, nome: string): Promise<number> {
  const r = await page.request.post('/api/operadora/empresas', {
    headers: await cabecalhos(page, `empresa-${registro}`),
    data: { registroAns: registro, cnpj: doc, razaoSocial: nome, modalidade: 'medicinaGrupo' },
  });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { id: number }).id;
}

interface Resp {
  id: number;
  sequencia: number;
  tipo: string;
  natureza: string;
  pessoa: number;
  nome: string | null;
  numeroRegistro: string | null;
  inicio: string;
  fim: string | null;
}
interface Dep {
  id: number;
  versao: number;
  codigo: string;
  descricao: string;
  tipo: string;
  email: string | null;
  emailsCopia: string[];
  superior: number | null;
  visivelPortal: boolean;
  ativo: boolean;
}
interface EstadoOp {
  responsaveis: Resp[];
  departamentos: Dep[];
  parametros: Map<string, { valor: string; desde: string }>;
}
const hoje = () => new Date().toISOString().slice(0, 10);
const json = (rota: Route, corpo: unknown, status = 200) =>
  rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
const recusa = (rota: Route, problemas: readonly ProblemaCadastro[]) =>
  rota.fulfill({
    status: 422,
    contentType: 'application/problem+json',
    body: JSON.stringify({
      type: 'urn:sgh:problema:recusa-de-negocio',
      title: problemas[0]?.detalhe ?? 'Recusado',
      status: 422,
      detail: problemas.map((x) => x.detalhe).join(' '),
      codigo: problemas[0]?.codigo,
    }),
  });
const vespera = (iso: string) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Simula as rotas do cadastro complementar com as regras do domínio; `pessoas` é o achado pelo documento exato. */
async function simularComplementar(
  page: Page,
  pessoas: ReadonlyMap<string, { id: number; natureza: 'fisica' | 'juridica'; nome: string }>,
): Promise<Map<number, EstadoOp>> {
  const estados = new Map<number, EstadoOp>();
  const de = (op: number) => {
    let e = estados.get(op);
    if (!e) estados.set(op, (e = { responsaveis: [], departamentos: [], parametros: new Map() }));
    return e;
  };
  let seq = 900;
  await page.route('**/api/operadora/complementar/**', async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/complementar/pessoas'))
      return json(rota, { pessoa: pessoas.get(url.searchParams.get('documento') ?? '') ?? null });
    const m = /\/complementar\/empresas\/(\d+)\/(responsaveis|departamentos|parametros)$/.exec(url.pathname);
    if (!m) return rota.fulfill({ status: 404, body: '' });
    const e = de(Number(m[1]));
    const recurso = m[2];
    const post = req.method() === 'POST';
    const b = post ? (req.postDataJSON() as Record<string, unknown>) : {};
    if (recurso === 'responsaveis') {
      if (!post)
        return json(
          rota,
          e.responsaveis.map((r) => ({ ...r, vigente: r.fim === null || r.fim >= hoje() })),
        );
      const novo = b as unknown as Omit<Resp, 'id' | 'sequencia' | 'nome' | 'natureza'> & {
        natureza: 'fisica' | 'juridica';
      };
      const plano = planoResponsavel(
        novo,
        e.responsaveis.map((r) => ({
          id: r.id,
          tipo: r.tipo as TipoResponsavelOperadora,
          inicio: r.inicio,
          fim: r.fim,
        })),
      );
      if (plano.problemas.length) return recusa(rota, plano.problemas);
      for (const x of plano.encerrar) {
        const r = e.responsaveis.find((y) => y.id === x.id);
        if (r) r.fim = x.fim;
      }
      const nome = [...pessoas.values()].find((p) => p.id === novo.pessoa)?.nome ?? null;
      const id = ++seq;
      e.responsaveis.push({ ...novo, id, sequencia: e.responsaveis.length + 1, nome });
      return json(rota, { id }, 201);
    }
    if (recurso === 'departamentos') {
      if (!post)
        return json(
          rota,
          [...e.departamentos].sort((a, c) => a.descricao.localeCompare(c.descricao)),
        );
      const {
        id: dep,
        versao,
        ...dados
      } = b as unknown as Dep & { id: number | null; versao: number | null };
      const mapa = new Map(e.departamentos.map((d) => [d.id, d.superior]));
      if (dados.superior !== null && !mapa.has(dados.superior))
        return recusa(rota, [
          {
            codigo: 'superior-inexistente',
            campo: 'superior',
            detalhe: 'O setor superior não é desta operadora.',
          },
        ]);
      const problemas = problemasDoDepartamento({ ...dados, id: dep }, mapa);
      if (problemas.length) return recusa(rota, problemas);
      if (dep === null) {
        const id = ++seq;
        e.departamentos.push({ ...dados, id, versao: 1 });
        return json(rota, { id }, 201);
      }
      const atual = e.departamentos.find((d) => d.id === dep);
      if (!atual) return rota.fulfill({ status: 404, body: '' });
      Object.assign(atual, dados, { versao: (versao ?? atual.versao) + 1 });
      return json(rota, { id: dep }, 201);
    }
    if (!post)
      return json(
        rota,
        (Object.keys(PARAMETROS_OPERADORA) as ChaveParametroOperadora[]).map((k) => {
          const v = e.parametros.get(k);
          const def = PARAMETROS_OPERADORA[k];
          const valor = v ? (def.tipo === 'booleano' ? v.valor === 'true' : Number(v.valor)) : def.padrao;
          return { chave: k, descricao: def.descricao, valor, padrao: !v, desde: v?.desde ?? null };
        }),
      );
    const r = valorDoParametro(String(b['chave']), b['valor']);
    if ('problema' in r) return recusa(rota, [r.problema]);
    const desde = (b['inicio'] as string | null) ?? hoje();
    e.parametros.set(String(b['chave']), { valor: r.valor, desde });
    return json(rota, { id: ++seq, anteriorEncerradoEm: vespera(desde) }, 201);
  });
  return estados;
}

test.describe('operadora: responsáveis, setores e parâmetros por operadora @C1-071', () => {
  test.setTimeout(240_000);

  test('ligar → duas operadoras → responsável pelo CNPJ → setores com hierarquia e validação na hora → parâmetro por faixa → escopo por operadora → recolher; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    const sufixo = String(Date.now() % 100_000).padStart(5, '0');
    const docB = cnpj(`8${sufixo}000002`.slice(0, 12));

    await entrar(page, 'SINT.ADMIN');
    await prerequisito(page, 'operadora', 'credenciamento');
    for (const c of CHAVES) await chave(page, c, true);

    try {
      await entrar(page, 'SINT.OPERADORA');
      const opA = await empresa(
        page,
        `8${sufixo}`,
        cnpj(`8${sufixo}000001`.slice(0, 12)),
        `Operadora A ${sufixo}`,
      );
      const opB = await empresa(page, `7${sufixo}`, docB, `Operadora B ${sufixo}`);
      expect(opB).not.toBe(opA);
      // A empresa criada gera a pessoa jurídica com o CNPJ (porta própria); a busca exata a acha por ele.
      const estados = await simularComplementar(
        page,
        new Map([[docB, { id: 7001, natureza: 'juridica' as const, nome: `Operadora B ${sufixo}` }]]),
      );

      await page.goto('/operadora/beneficiarios');
      await escolher(page.getByTestId('operadora-ativa'), { rotulo: new RegExp(`\\(7${sufixo}\\)`) });
      await page.getByTestId('aba-complementar').click({ timeout: 30_000 });
      const compl = page.getByTestId('operadora-complementar');
      await expect(compl).toBeVisible();
      await expect(compl.getByTestId('compl-papeis-sem-titular')).toContainText('Responsável técnico');
      await semViolacaoAxe(page, 'operadora: cadastro complementar');

      // Responsável: auditoria independente achada pelo CNPJ da própria empresa sintética.
      await compl.getByTestId('compl-resp-novo').click();
      const fr = compl.getByTestId('form-responsavel');
      await escolher(fr.getByTestId('compl-resp-papel'), { rotulo: 'Auditoria independente' });
      await fr.getByLabel('CPF ou CNPJ').fill(docB);
      await fr.getByTestId('compl-resp-buscar').click();
      await expect(fr.getByTestId('compl-resp-pessoa')).toContainText(`Operadora B ${sufixo}`);
      await semViolacaoAxe(page, 'operadora: cadastro complementar');
      await fr.getByTestId('compl-resp-gravar').click();
      await expect(compl.getByTestId('compl-mensagem')).toContainText('Responsável registrado');
      await expect(compl.getByTestId('tabela-responsaveis')).toContainText('Auditoria independente');
      await expect(compl.getByTestId('tabela-responsaveis')).toContainText(`Operadora B ${sufixo}`);

      // Setores: o e-mail inválido trava o botão na hora; a regulação fica abaixo da autorização.
      await compl.getByTestId('compl-dep-novo').click();
      let fd = compl.getByTestId('form-departamento');
      await fd.getByLabel('Código').fill('AUT');
      await fd.getByLabel('Descrição').fill('Autorização');
      await escolher(fd.getByTestId('compl-dep-tipo'), { rotulo: 'Autorização' });
      await fd.getByLabel('E-mail do setor').fill('sem-arroba');
      await expect(fd.getByTestId('compl-dep-problemas')).toContainText('E-mail do setor inválido');
      await expect(fd.getByTestId('compl-dep-gravar').locator('button')).toBeDisabled();
      await fd.getByLabel('E-mail do setor').fill('autorizacao@exemplo.invalid');
      await fd.getByTestId('compl-dep-gravar').click();
      await expect(compl.getByTestId('compl-mensagem')).toContainText('Setor gravado');
      await compl.getByTestId('compl-dep-novo').click();
      fd = compl.getByTestId('form-departamento');
      await fd.getByLabel('Código').fill('REG');
      await fd.getByLabel('Descrição').fill('Regulação');
      await escolher(fd.getByTestId('compl-dep-tipo'), { rotulo: 'Regulação' });
      await escolher(fd.getByTestId('compl-dep-superior'), { rotulo: /Autorização \(AUT\)/ });
      await fd.getByTestId('compl-dep-gravar').click();
      await expect(compl.getByTestId('departamento-REG')).toContainText('Autorização');
      await semViolacaoAxe(page, 'operadora: cadastro complementar');

      // Parâmetro: fora da faixa recusado na hora; 18 grava e deixa de ser o padrão.
      await compl.getByTestId('compl-par-alterar-prazo_cpt_meses').click();
      const fp = compl.getByTestId('form-parametro');
      await fp.getByLabel('Novo valor').fill('30');
      await expect(fp.getByTestId('compl-par-problema')).toContainText('de 1 a 24');
      await fp.getByLabel('Novo valor').fill('18');
      await fp.getByLabel('Justificativa').fill('Revisão sintética do contrato (E2E)');
      await fp.getByTestId('compl-par-gravar').click();
      await expect(compl.getByTestId('compl-mensagem')).toContainText('valor anterior fica no histórico');
      await expect(compl.getByTestId('parametro-prazo_cpt_meses')).toContainText('18');
      await expect(compl.getByTestId('parametro-prazo_cpt_meses')).not.toContainText('padrão');

      // Escopo por operadora: o que foi gravado na B não aparece na A (nas gravações que a tela enviou e na tela).
      expect(
        estados
          .get(opB)
          ?.departamentos.map((d) => d.codigo)
          .sort(),
      ).toEqual(['AUT', 'REG']);
      expect(estados.get(opA)?.departamentos ?? []).toEqual([]);
      expect(estados.get(opA)?.responsaveis ?? []).toEqual([]);
      await escolher(page.getByTestId('operadora-ativa'), { rotulo: new RegExp(`\\(8${sufixo}\\)`) });
      await expect(page.getByTestId('compl-departamentos')).toContainText('Nenhum setor cadastrado');
    } finally {
      await entrar(page, 'SINT.ADMIN');
      for (const c of [...CHAVES].reverse()) await chave(page, c, false);
    }
    expect(externas).toEqual([]);
  });
});
