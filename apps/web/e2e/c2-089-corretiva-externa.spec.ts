// E2E @C2-089 (04-HOT L135, manutenção corretiva com oficina e conserto externo): pelo menu, a chefia da manutenção
// cadastra uma oficina terceirizada (validação na hora: terceirizada sem fornecedor, alçada só do aprovador) e põe-se
// como aprovadora, com alçada, na oficina das OS; o setor abre a OS pelo QR, o técnico assume e registra o orçamento;
// a chefia aprova (nunca quem registrou); o técnico envia o equipamento ao fornecedor (termo, nota, CFOP 5.915) e a OS
// passa a aguardar o fornecedor; o equipamento aparece em "fora para conserto"; o retorno devolve a OS ao atendimento.
// Axe sem violação séria em cada estado. Sessão, oficina, fornecedor e equipamento SINTÉTICOS (nada vai à cópia).
import { expect, type Locator, type Page, test } from '@playwright/test';
import { itemDoMenu, semViolacaoAxe, vigiarExternas } from './ajuda.js';
import { escolher } from './combos.js';

const SENHA = 'Sintetico#2026';

// A oficina, o orçamento e a remessa (`/api/manutencao/oficinas`, `os/:id/corretiva-externa`, `os/:id/orcamentos`,
// `orcamentos/:id/decisao`, `os/:id/remessas`, `remessas/:id/retorno`, `remessas/abertas`) só existem no banco do
// cliente: na fonte sintética do E2E respondem 503 ("exigem o banco do cliente"). Como no c1-034, as rotas são
// simuladas com um estado em memória que segue a regra do servidor (quem registrou não decide; decisão só pelo
// aprovador da oficina dentro da alçada; remessa só com orçamento aprovado ou motivo da saída sem custo; a remessa põe
// a OS aguardando o terceiro e o retorno a devolve ao atendimento). O que fica no banco (oficina, membros, orçamento,
// remessa, OS e evento) é provado no contrato de efeito `oficina-orcamento-propria.int.spec.ts`; a OS, o QR, a sessão
// e os fornecedores continuam reais (fonte sintética).
interface Sim {
  login: string;
  numero: string;
  situacao: Map<number, string>;
}
const sim: Sim = { login: '', numero: '', situacao: new Map() };

async function simularCorretiva(page: Page): Promise<void> {
  type J = Record<string, unknown>;
  const agora = () => new Date().toISOString().slice(0, 16);
  const fornecedorNome = (codigo: unknown) =>
    codigo === 7002 ? 'Climatização Sintética' : 'Engenharia Clínica Sintética';
  let seq = 100;
  const servicos = [{ id: 11, codigo: 'SRV-FONTE', nome: 'Troca de fonte de alimentação' }];
  const oficinas: J[] = [
    {
      id: 1,
      versao: 1,
      codigo: 'OF-CENTRAL',
      nome: 'Oficina central sintética',
      terceirizada: false,
      fornecedor: null,
      fornecedorNome: null,
      especialidade: null,
      especialidadeNome: null,
      email: null,
      telefone: null,
      ramal: null,
      notificaPorEmail: false,
      exigeAvaliacao: false,
      ativo: true,
      ordensAbertas: 1,
      membros: [],
      servicos: [],
    },
  ];
  const orcamentos: J[] = [];
  const remessas: J[] = [];
  const json = (status: number, corpo: unknown) => ({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: JSON.stringify(corpo),
  });
  const recusa = (codigo: string, detail: string) =>
    json(409, { type: 'recusa-de-negocio', title: 'Operação recusada', status: 409, detail, codigo });
  const semDetalhe = (o: J): J =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'membros' && k !== 'servicos'));
  const membrosDe = (b: J) =>
    ((b['membros'] as J[]) ?? []).map((m, i) => ({
      id: i + 1,
      usuario: i + 1,
      login: m['login'],
      nome: m['login'],
      funcao: m['funcao'],
      alcada: m['alcada'] ?? null,
      vigenciaInicio: m['vigenciaInicio'],
      vigenciaFim: m['vigenciaFim'] ?? null,
      ativo: true,
    }));
  const servicosDe = (b: J) =>
    ((b['servicos'] as J[]) ?? []).map((s) => {
      const x = servicos.find((v) => v.id === s['servico']);
      return {
        servico: s['servico'],
        codigo: x?.codigo ?? '',
        nome: x?.nome ?? '',
        tempoPadraoMinutos: s['tempoPadraoMinutos'] ?? null,
        ativo: true,
      };
    });
  const corretiva = (os: number) => ({
    os,
    versaoOs: 1,
    situacaoOs: sim.situacao.get(os) === 'aguardandoTerceiro' ? 'aguardando_terceiro' : 'em_atendimento',
    oficina: 1,
    oficinaNome: 'Oficina central sintética',
    equipamento: 1,
    orcamentos: orcamentos.filter((o) => o['os'] === os),
    remessas: remessas.filter((r) => r['os'] === os),
  });

  await page.route(
    /\/api\/manutencao\/(oficinas|os\/\d+\/(corretiva-externa|orcamentos|remessas)|orcamentos\/\d+\/decisao|remessas\/(\d+\/retorno|abertas))(\?.*)?$/,
    async (rota) => {
      const req = rota.request();
      const caminho = new URL(req.url()).pathname.replace('/api/manutencao/', '');
      const b = (req.method() === 'GET' ? {} : (req.postDataJSON() as J)) ?? {};
      let m: RegExpMatchArray | null;
      if (caminho === 'oficinas' && req.method() === 'GET')
        return rota.fulfill(
          json(
            200,
            [...oficinas].sort((x, y) => String(x['nome']).localeCompare(String(y['nome']))).map(semDetalhe),
          ),
        );
      if (caminho === 'oficinas/opcoes') return rota.fulfill(json(200, { especialidades: [], servicos }));
      if ((m = caminho.match(/^oficinas\/(\d+)$/)) && req.method() === 'GET') {
        const o = oficinas.find((x) => x['id'] === Number(m![1]));
        return rota.fulfill(o ? json(200, o) : json(404, { title: 'Não encontrada', status: 404 }));
      }
      if (caminho === 'oficinas' || (m = caminho.match(/^oficinas\/(\d+)$/))) {
        const dados = {
          ...b,
          fornecedorNome: b['fornecedor'] ? fornecedorNome(b['fornecedor']) : null,
          especialidadeNome: null,
          ordensAbertas: 0,
          membros: membrosDe(b),
          servicos: servicosDe(b),
        };
        let o = m ? oficinas.find((x) => x['id'] === Number(m![1])) : undefined;
        if (o) Object.assign(o, dados, { versao: Number(o['versao']) + 1 });
        else oficinas.push((o = { ...dados, id: ++seq, versao: 1 }));
        return rota.fulfill(
          json(m ? 200 : 201, { ok: true, id: o['id'], versao: o['versao'], mensagem: 'Oficina gravada.' }),
        );
      }
      if ((m = caminho.match(/^os\/(\d+)\/corretiva-externa$/)))
        return rota.fulfill(json(200, corretiva(Number(m[1]))));
      if ((m = caminho.match(/^os\/(\d+)\/orcamentos$/))) {
        const os = Number(m[1]);
        for (const o of orcamentos)
          if (o['os'] === os && o['situacao'] === 'pendente') o['situacao'] = 'substituido';
        const o: J = {
          id: ++seq,
          os,
          versao: 1,
          fornecedor: b['fornecedor'] ?? null,
          fornecedorNome: b['fornecedor'] ? fornecedorNome(b['fornecedor']) : null,
          descricao: b['descricao'],
          valor: b['valor'],
          prazoDias: b['prazoDias'] ?? null,
          validade: b['validade'] ?? null,
          situacao: 'pendente',
          registradoPor: 0,
          registradoPorNome: sim.login,
          registradoEm: agora(),
          decididoPorNome: null,
          decididoEm: null,
          justificativa: null,
        };
        orcamentos.push(o);
        return rota.fulfill(
          json(201, { ok: true, id: o['id'], mensagem: 'Orçamento registrado; aguarda a aprovação.' }),
        );
      }
      if ((m = caminho.match(/^orcamentos\/(\d+)\/decisao$/))) {
        const o = orcamentos.find((x) => x['id'] === Number(m![1]))!;
        if (o['registradoPorNome'] === sim.login)
          return rota.fulfill(
            recusa(
              'mesmo-autor',
              'Quem registrou o orçamento não o aprova nem reprova (segregação de funções).',
            ),
          );
        const aprovador = (oficinas[0]!['membros'] as J[]).find(
          (x) =>
            x['login'] === sim.login &&
            x['funcao'] === 'aprovador' &&
            Number(x['alcada'] ?? 0) >= Number(o['valor']),
        );
        if (!aprovador)
          return rota.fulfill(recusa('fora-da-alcada', 'Sem alçada para decidir este orçamento.'));
        Object.assign(o, {
          situacao: b['decisao'],
          versao: Number(o['versao']) + 1,
          decididoPorNome: sim.login,
          decididoEm: agora(),
          justificativa: b['justificativa'] ?? null,
        });
        return rota.fulfill(
          json(200, { ok: true, id: o['id'], versao: o['versao'], mensagem: 'Orçamento aprovado.' }),
        );
      }
      if ((m = caminho.match(/^os\/(\d+)\/remessas$/))) {
        const os = Number(m[1]);
        const aprovado = orcamentos.find((x) => x['os'] === os && x['situacao'] === 'aprovado');
        const semOrc = b['semOrcamento'] as J | null;
        if (!aprovado && !semOrc)
          return rota.fulfill(recusa('sem-orcamento', 'A remessa exige orçamento aprovado.'));
        const r: J = {
          id: ++seq,
          os,
          versao: 1,
          fornecedor: b['fornecedor'],
          fornecedorNome: fornecedorNome(b['fornecedor']),
          orcamento: aprovado?.['id'] ?? null,
          motivoSemOrcamento: semOrc?.['motivo'] ?? null,
          justificativaSemOrcamento: semOrc?.['justificativa'] ?? null,
          termoSaida: b['termo'],
          notaFiscalRemessa: b['notaFiscal'] ?? null,
          cfop: b['cfop'] ?? null,
          enviadoEm: agora(),
          enviadoPorNome: sim.login,
          previsaoRetorno: b['previsaoRetorno'] ?? null,
          situacao: 'enviado',
          retornadoEm: null,
          notaFiscalRetorno: null,
          resultado: null,
          observacaoRetorno: null,
          atrasada: false,
        };
        remessas.push(r);
        sim.situacao.set(os, 'aguardandoTerceiro');
        return rota.fulfill(
          json(201, {
            ok: true,
            id: r['id'],
            versaoOs: 2,
            mensagem: 'Equipamento enviado; a OS aguarda o fornecedor.',
          }),
        );
      }
      if ((m = caminho.match(/^remessas\/(\d+)\/retorno$/))) {
        const r = remessas.find((x) => x['id'] === Number(m![1]))!;
        Object.assign(r, {
          situacao: 'retornado',
          versao: 2,
          retornadoEm: b['retornadoEm'] ?? agora(),
          notaFiscalRetorno: b['notaFiscal'] ?? null,
          resultado: b['resultado'],
          observacaoRetorno: b['observacao'] ?? null,
        });
        sim.situacao.set(Number(r['os']), 'emAtendimento');
        return rota.fulfill(
          json(200, {
            ok: true,
            id: r['id'],
            versaoOs: 3,
            mensagem: 'Retorno registrado; a OS voltou ao atendimento.',
          }),
        );
      }
      // remessas/abertas
      return rota.fulfill(
        json(
          200,
          remessas
            .filter((r) => r['situacao'] === 'enviado')
            .map((r) => ({
              os: r['os'],
              numero: sim.numero,
              equipamento: 'EQ-CC-001',
              fornecedor: r['fornecedorNome'],
              enviadoEm: r['enviadoEm'],
              previsaoRetorno: r['previsaoRetorno'],
              atrasada: false,
            })),
        ),
      );
    },
  );
  // A situação da OS vem da fonte sintética; a remessa e o retorno simulados a mudam como o servidor faria.
  await page.route(/\/api\/manutencao\/os\/\d+(\?.*)?$/, async (rota) => {
    const id = Number(new URL(rota.request().url()).pathname.split('/').pop());
    const r = await rota.fetch();
    const s = sim.situacao.get(id);
    if (rota.request().method() !== 'GET' || !r.ok() || !s) return rota.fulfill({ response: r });
    const corpo = (await r.json()) as J;
    return rota.fulfill({ response: r, json: { ...corpo, situacao: s } });
  });
}

async function entrar(page: Page, login: string): Promise<void> {
  sim.login = login;
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByTestId('campo-login').fill(login);
  await page.getByTestId('campo-senha').fill(SENHA);
  await page.getByTestId('botao-entrar').click();
  await expect(page).toHaveURL(/\/inicio/);
}

const campo = (l: Locator) =>
  l.locator('xpath=self::input | self::textarea | .//input | .//textarea').first();

async function abrirOs(page: Page, id: number): Promise<Locator> {
  await page.goto(`/manutencao/os?os=${id}`);
  const d = page.getByTestId('os-detalhe');
  await expect(d).toBeVisible({ timeout: 30_000 });
  return d;
}

test.describe('manutenção corretiva: oficina, orçamento e conserto externo @C2-089', () => {
  test.setTimeout(300_000);

  test('oficina com aprovador e alçada → orçamento → aprovação → remessa ao fornecedor → retorno; axe', async ({
    page,
  }) => {
    const externas = vigiarExternas(page);
    await simularCorretiva(page);
    const sufixo = Date.now().toString(36).toUpperCase().slice(-5);

    // 1. A chefia chega às oficinas pelo menu e cadastra a terceirizada (a regra do domínio confere na hora).
    await entrar(page, 'SINT.MANUTENCAO');
    await (await itemDoMenu(page, 'Oficinas e conserto externo')).click();
    await expect(page).toHaveURL(/\/manutencao\/oficinas$/);
    const tela = page.getByTestId('tela-manutencao-oficinas');
    await expect(tela.getByTestId('oficina-lista')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/oficinas');

    await tela.getByTestId('oficina-nova').click();
    const form = tela.getByTestId('oficina-form');
    await campo(form.getByTestId('oficina-codigo')).fill(`EXT-${sufixo}`);
    await campo(form.getByTestId('oficina-nome')).fill(`Oficina externa sintética ${sufixo}`);
    await form.getByTestId('oficina-terceirizada').check();
    await expect(form.getByTestId('oficina-problemas')).toContainText('exige a empresa fornecedora');
    await expect(form.getByTestId('oficina-gravar')).toBeDisabled();
    await campo(form.getByTestId('oficina-termo-fornecedor')).fill('SINT');
    await form.getByTestId('oficina-buscar-fornecedor').click();
    await escolher(form.getByTestId('oficina-fornecedor'), { indice: 1 });
    await form.getByTestId('oficina-membro-incluir').click();
    await campo(form.getByTestId('oficina-membro-login-0')).fill('SINT.MANUTENCAO');
    await escolher(form.getByTestId('oficina-membro-funcao-0'), { rotulo: 'Aprovador de orçamento' });
    await campo(form.getByTestId('oficina-membro-alcada-0')).fill('5.000,00');
    await form.getByTestId('oficina-servico-incluir').click();
    await escolher(form.getByTestId('oficina-servico-0'), { indice: 1 });
    await expect(form.getByTestId('oficina-problemas')).toHaveCount(0);
    await semViolacaoAxe(page, '/manutencao/oficinas (cadastro)');
    await form.getByTestId('oficina-gravar').click();
    await expect(tela.getByTestId('oficina-mensagem')).toContainText('Oficina gravada', { timeout: 30_000 });
    await expect(tela.getByTestId(`oficina-EXT-${sufixo}`)).toBeVisible();

    // A chefia também é aprovadora (alçada de R$ 5.000) na oficina que recebe as OS (a primeira da lista ativa).
    await tela.locator('[data-testid^="oficina-editar-"]').first().click();
    await expect(form).toBeVisible();
    await form.getByTestId('oficina-membro-incluir').click();
    const ultimo = form.locator('[data-testid^="oficina-membro-login-"]').last();
    await campo(ultimo).fill('SINT.MANUTENCAO');
    const funcoes = form.locator('[data-testid^="oficina-membro-funcao-"]');
    await escolher(funcoes.last(), { rotulo: 'Aprovador de orçamento' });
    await campo(form.locator('[data-testid^="oficina-membro-alcada-"]').last()).fill('5000');
    await form.getByTestId('oficina-gravar').click();
    await expect(tela.getByTestId('oficina-mensagem')).toContainText('Oficina gravada', { timeout: 30_000 });

    // 2. O setor abre a OS pelo QR e o técnico assume.
    await entrar(page, 'SINT.MANUTENCAO.SETOR');
    await page.goto('/manutencao/os?abrir=EQ-CC-001');
    const abrir = page.getByTestId('os-form-abrir');
    await expect(abrir).toBeVisible({ timeout: 30_000 });
    await campo(abrir.getByTestId('os-abrir-descricao')).fill('Tela do monitor apagando durante o uso.');
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/manutencao/os') && r.request().method() === 'POST'),
      abrir.getByTestId('os-abrir-gravar').click(),
    ]);
    expect(resposta.status()).toBe(201);
    const aberta = (await resposta.json()) as { id: number; numero: string };
    sim.numero = aberta.numero;

    await entrar(page, 'SINT.MANUTENCAO.TECNICO');
    let d = await abrirOs(page, aberta.id);
    await d.getByTestId('os-acao-assumir').click();
    await d.getByTestId('os-acao-gravar').click();
    await expect(d.getByTestId('os-situacao')).toContainText('Em atendimento', { timeout: 30_000 });

    // 3. Sem orçamento aprovado, a remessa pede o motivo da saída sem custo (conferido na hora).
    let c = d.getByTestId('os-corretiva');
    await expect(c).toBeVisible();
    await c.getByTestId('os-corretiva-nova-remessa').click();
    await expect(c.getByTestId('os-remessa-sem-orcamento-ajuda')).toBeVisible();
    await campo(c.getByTestId('os-remessa-termo')).fill('Com cabo de força.');
    await c.getByTestId('os-corretiva-gravar').click();
    await expect(c.getByTestId('os-corretiva-problemas')).toContainText('sem custo');
    await escolher(c.getByTestId('os-remessa-motivo-sem-orcamento'), { rotulo: 'Comodato' });
    await c.getByTestId('os-corretiva-gravar').click();
    await expect(c.getByTestId('os-corretiva-problemas')).toContainText('pelo menos 10 caracteres');
    await c.getByRole('button', { name: 'Cancelar' }).click();

    // O técnico registra o orçamento do fornecedor (valor conferido na hora).
    await c.getByTestId('os-corretiva-novo-orcamento').click();
    let f = c.getByTestId('os-corretiva-form-orcamento');
    await campo(f.getByTestId('os-orcamento-descricao')).fill(
      'Troca da fonte de alimentação e teste funcional.',
    );
    await campo(f.getByTestId('os-orcamento-valor')).fill('0');
    await c.getByTestId('os-corretiva-gravar').click();
    await expect(c.getByTestId('os-corretiva-problemas')).toContainText('maior que zero');
    await campo(f.getByTestId('os-orcamento-valor')).fill('1.250,00');
    await campo(f.getByTestId('os-corretiva-termo-fornecedor')).fill('SINT');
    await f.getByTestId('os-corretiva-buscar-fornecedor').click();
    await escolher(f.getByTestId('os-corretiva-fornecedor'), { indice: 1 });
    await semViolacaoAxe(page, '/manutencao/os (orçamento)');
    await c.getByTestId('os-corretiva-gravar').click();
    await expect(c.getByTestId('os-orcamento-pendente')).toBeVisible({ timeout: 30_000 });
    // Quem registrou não aprova (segregação): a recusa vem do servidor com o texto da aplicação.
    await c.getByTestId('os-orcamento-aprovar').click();
    await expect(c.getByTestId('recusa-manutencao')).toBeVisible({ timeout: 30_000 });

    // 4. A chefia, aprovadora com alçada, aprova; a reprovação sem justificativa é recusada na hora.
    await entrar(page, 'SINT.MANUTENCAO');
    d = await abrirOs(page, aberta.id);
    c = d.getByTestId('os-corretiva');
    await c.getByTestId('os-orcamento-reprovar').click();
    await expect(c.getByTestId('os-corretiva-problemas')).toContainText('pelo menos 10 caracteres');
    await c.getByTestId('os-orcamento-aprovar').click();
    await expect(c.getByTestId('os-orcamento-aprovado')).toBeVisible({ timeout: 30_000 });
    await semViolacaoAxe(page, '/manutencao/os (orçamento aprovado)');

    // 5. O técnico envia o equipamento ao fornecedor: termo, nota e CFOP de remessa para conserto.
    await entrar(page, 'SINT.MANUTENCAO.TECNICO');
    d = await abrirOs(page, aberta.id);
    c = d.getByTestId('os-corretiva');
    await c.getByTestId('os-corretiva-nova-remessa').click();
    f = c.getByTestId('os-corretiva-form-remessa');
    await campo(f.getByTestId('os-remessa-termo')).fill(
      'Monitor com cabo de força, sem sensores; retirado pelo motorista.',
    );
    await campo(f.getByTestId('os-remessa-nota')).fill('900123');
    await escolher(f.getByTestId('os-remessa-cfop'), { rotulo: /5\.915/ });
    await semViolacaoAxe(page, '/manutencao/os (remessa)');
    await c.getByTestId('os-corretiva-gravar').click();
    await expect(c.getByTestId('os-remessa-enviado')).toBeVisible({ timeout: 30_000 });
    await expect(d.getByTestId('os-situacao')).toContainText(/fornecedor|terceiro/i);

    // 6. O equipamento aparece entre os que estão fora para conserto.
    await page.goto('/manutencao/oficinas');
    await expect(page.getByTestId('oficina-fora')).toContainText(aberta.numero, { timeout: 30_000 });

    // 7. O retorno: sem conserto exige observação; consertado devolve a OS ao atendimento.
    d = await abrirOs(page, aberta.id);
    c = d.getByTestId('os-corretiva');
    const r = c.getByTestId('os-corretiva-retorno');
    await escolher(r.getByTestId('os-retorno-resultado'), { rotulo: 'Sem conserto' });
    await r.getByTestId('os-retorno-gravar').click();
    await expect(c.getByTestId('os-corretiva-problemas')).toContainText('pelo menos 10 caracteres');
    await escolher(r.getByTestId('os-retorno-resultado'), { rotulo: 'Consertado' });
    await campo(r.getByTestId('os-retorno-nota')).fill('900456');
    await r.getByTestId('os-retorno-gravar').click();
    await expect(c.getByTestId('os-remessa-retornado')).toBeVisible({ timeout: 30_000 });
    await expect(d.getByTestId('os-situacao')).toContainText('Em atendimento');
    await semViolacaoAxe(page, '/manutencao/os (retorno do conserto)');

    expect(externas).toEqual([]);
  });
});
