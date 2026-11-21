// Integração da porta própria de cargos e salários contra o MariaDB real (cliente f22_o3, já criado pela obra da onda
// 3). Massa SINTÉTICA com códigos "L0303C" (nenhuma pessoa real): dois estabelecimentos, um usuário de serviço, dois
// CBO e dois conselhos sintéticos, tabelas salariais (vigente, rascunho, futura e a do outro estabelecimento), centros
// de custo, um colaborador e uma pessoa sintéticos com vínculos (ativo, afastado, desligado, transferido, excluído, no
// outro estabelecimento) e as referências ao cargo (função, trabalhador sem vínculo, histórico de cargo). Os catálogos
// oficiais (sexo, categoria, tipo de vínculo, tipo de rescisão) usam a linha que existir; só faltando, uma sintética. Contrato de efeito: a linha do cargo (código de negócio,
// versão, referências), a trilha da operação com a correção e o retrato, e as recusas (nome em uso, versão antiga,
// CBO/conselho fora do cadastro, cargo com vínculo, faixa e quadro sem modelo). A bateria do cargo roda na memória e no
// banco. No fim, a massa de negócio é apagada; ficam o estabelecimento e o usuário, que a trilha referencia.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import type { GravadorCargos, PortaCargos } from './porta-cargos.js';
import { PortaCargosMemoria } from './porta-cargos-memoria.js';
import { DEPENDENCIAS_CARGO, PortaCargosPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0303C';
const CBO = '990303';
const CBO2 = '990304';
const CONSELHO = 'ZZCARGO';
const CONSELHO2 = 'ZZCARGOB';
const MOTIVO = 'Correção sintética do teste de integração';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
const problema = (e: unknown) => (e instanceof ErroOperacao ? e.problema : null);
const codigoDe = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => problema(e)?.codigo ?? (e instanceof Error ? e.message : String(e)),
  );

const trilha =
  (ctx: ContextoNucleo, entidade: string) =>
  (r: unknown): TrilhaDaGravacao => ({
    estabelecimento: ctx.estabelecimento,
    usuario: ctx.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: typeof r === 'number' ? r : null,
    dadosDepois: { evento: 'teste-0303' },
    correlacao: ctx.correlacao,
  });

interface Fabrica {
  readonly nome: string;
  readonly porta: () => PortaCargos;
  readonly ctx: () => ContextoNucleo;
  /** O mesmo cliente, noutro estabelecimento. */
  readonly ctx2: () => ContextoNucleo;
  readonly cbo: string;
  readonly conselho: string;
}

let nucleo: NucleoProprio;
let propria: PortaCargosPropria;
const ids = {
  est: 0,
  est2: 0,
  usuario: 0,
  cbo: 0,
  cbo2: 0,
  conselho: 0,
  conselho2: 0,
  tabela: 0,
  rascunho: 0,
  futura: 0,
  tabela2: 0,
  cc1: 0,
  cc2: 0,
  ccB: 0,
  sexo: 0,
  categoria: 0,
  tipoVinculo: 0,
  rescisao: 0,
  colaborador: 0,
  pessoa: 0,
};
/** Catálogos que o teste precisou criar (só estes são apagados no fim). */
const criados: { tabela: string; id: number }[] = [];
const cargosCriados: number[] = [];
let ctxBanco: ContextoNucleo;
const memoria = new PortaCargosMemoria();
const ctxMemoria: ContextoNucleo = {
  cliente: 'sintetico',
  estabelecimento: 1,
  usuario: 7,
  correlacao: 'teste-0303',
};

const FABRICAS: readonly Fabrica[] = [
  {
    nome: 'memória',
    porta: () => memoria,
    ctx: () => ctxMemoria,
    ctx2: () => ({ ...ctxMemoria, estabelecimento: 2 }),
    cbo: '223505',
    conselho: 'COREN',
  },
  {
    nome: 'banco',
    porta: () => propria,
    ctx: () => ctxBanco,
    ctx2: () => ({ ...ctxBanco, estabelecimento: ids.est2 }),
    cbo: CBO,
    conselho: CONSELHO,
  },
];

/** Apaga as linhas sintéticas que referenciam o cargo (vínculos, histórico, função, trabalhador sem vínculo). */
async function limparReferencias(e: Escritor): Promise<void> {
  await e.executar(
    'DELETE FROM historico_cargo WHERE vinculo_trabalho_id IN (SELECT id FROM vinculo_trabalho WHERE colaborador_id = ?)',
    [ids.colaborador],
  );
  await e.executar('DELETE FROM vinculo_trabalho WHERE colaborador_id = ?', [ids.colaborador]);
  await e.executar('DELETE FROM trabalhador_sem_vinculo WHERE pessoa_fisica_id = ?', [ids.pessoa]);
  await e.executar('DELETE FROM funcao WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.est2]);
}

/** Inclui um cargo sintético pela porta própria. */
async function novoCargo(prefixo: string, cbo = CBO, conselho: string | null = null): Promise<number> {
  const id = await propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'cargo'), (g) =>
    g.incluirCargo({
      nome: `${prefixo} ${Date.now() % 1_000_000}`,
      cbo,
      descricao: null,
      requisitos: null,
      conselho,
      por: 'x',
    }),
  );
  cargosCriados.push(id);
  return id;
}
const escrever = (fn: (e: Escritor) => Promise<unknown>) =>
  nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-03' }, async (e) => {
    await fn(e);
  });

describe.skipIf(SEM_BANCO)('porta própria de cargos e salários (MariaDB, cliente f22_o3)', () => {
  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-03' }, async (e) => {
      const agora = new Date();
      const estab = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await estab(P);
      ids.est2 = await estab(`${P}B`);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0303c.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0303c.teste', 'USUARIO SINTETICO L0303C', agora],
      );
      const cbo = (codigo: string, descricao: string) =>
        garantir(
          e,
          'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
          [codigo],
          'INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES (?, ?, TRUE, ?)',
          [codigo, descricao, agora],
        );
      ids.cbo = await cbo(CBO, 'OCUPACAO SINTETICA L0303C');
      ids.cbo2 = await cbo(CBO2, 'OCUPACAO SINTETICA L0303C DOIS');
      await e.executar('UPDATE ocupacao_cbo SET ativo = TRUE WHERE id IN (?, ?)', [ids.cbo, ids.cbo2]);
      const conselho = (sigla: string, tiss: string) =>
        garantir(
          e,
          'SELECT id FROM conselho_classe WHERE sigla = ?',
          [sigla],
          'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)',
          [tiss, sigla, `CONSELHO SINTETICO ${sigla}`, agora],
        );
      ids.conselho = await conselho(CONSELHO, 'Z3');
      ids.conselho2 = await conselho(CONSELHO2, 'Z4');
      await e.executar('UPDATE conselho_classe SET ativo = TRUE WHERE id IN (?, ?)', [
        ids.conselho,
        ids.conselho2,
      ]);
      const tabela = (est: number, codigo: string, inicio: string, situacao: string) =>
        garantir(
          e,
          'SELECT id FROM tabela_salarial WHERE estabelecimento_id = ? AND codigo = ?',
          [est, codigo],
          "INSERT INTO tabela_salarial (estabelecimento_id, codigo, descricao, vigencia_inicio, situacao, criado_em) VALUES (?, ?, 'TABELA SINTETICA', ?, ?, ?)",
          [est, codigo, inicio, situacao, agora],
        );
      ids.tabela = await tabela(ids.est, `${P}-TS`, '2026-01-01', 'vigente');
      ids.rascunho = await tabela(ids.est, `${P}-TR`, '2026-01-01', 'rascunho');
      ids.futura = await tabela(ids.est, `${P}-TF`, '2099-01-01', 'vigente');
      ids.tabela2 = await tabela(ids.est2, `${P}-TB`, '2026-01-01', 'vigente');
      const centro = (est: number, codigo: string) =>
        garantir(
          e,
          'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?',
          [est, codigo],
          "INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, criado_em) VALUES (?, ?, 'CENTRO SINTETICO', '2020-01-01', ?)",
          [est, codigo, agora],
        );
      ids.cc1 = await centro(ids.est, `${P}-CC1`);
      ids.cc2 = await centro(ids.est, `${P}-CC2`);
      ids.ccB = await centro(ids.est2, `${P}-CCB`);
      // Catálogos oficiais: a linha que existir; só faltando, uma sintética (apagada no fim).
      const catalogo = async (tabela: string, sel: string, ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, []);
        if (l) return Number(l.id);
        const id = await e.inserir(ins, pi);
        criados.push({ tabela, id });
        return id;
      };
      ids.sexo = await catalogo(
        'sexo',
        'SELECT id FROM sexo ORDER BY id LIMIT 1',
        "INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES (?, 'SEXO SINTETICO', 'Z', ?)",
        [P, agora],
      );
      ids.categoria = await catalogo(
        'categoria_trabalhador',
        'SELECT id FROM categoria_trabalhador ORDER BY id LIMIT 1',
        "INSERT INTO categoria_trabalhador (codigo_esocial, descricao, grupo, criado_em) VALUES ('Z03', 'CATEGORIA SINTETICA', 'empregado', ?)",
        [agora],
      );
      ids.tipoVinculo = await catalogo(
        'tipo_vinculo_trabalho',
        "SELECT id FROM tipo_vinculo_trabalho WHERE nivel = 'vinculo' ORDER BY id LIMIT 1",
        "INSERT INTO tipo_vinculo_trabalho (codigo_cnes, nivel, codigo_vinculo, descricao, criado_em) VALUES ('Z0303', 'vinculo', 'Z3', 'VINCULO SINTETICO', ?)",
        [agora],
      );
      ids.rescisao = await catalogo(
        'tipo_rescisao',
        'SELECT id FROM tipo_rescisao ORDER BY id LIMIT 1',
        "INSERT INTO tipo_rescisao (codigo, descricao, iniciativa, criado_em) VALUES (?, 'RESCISAO SINTETICA', 'outro', ?)",
        [P, agora],
      );
      ids.colaborador = await garantir(
        e,
        'SELECT id FROM colaborador WHERE cpf = ?',
        ['99030300001'],
        "INSERT INTO colaborador (nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES ('COLABORADOR SINTETICO L0303C', '99030300001', '1990-01-01', ?, '07', ?)",
        [ids.sexo, agora],
      );
      ids.pessoa = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE cpf = ?',
        ['99030300002'],
        "INSERT INTO pessoa_fisica (nome, cpf, criado_em) VALUES ('PESSOA SINTETICA L0303C', '99030300002', ?)",
        [agora],
      );
      // Sobra de uma execução interrompida.
      await limparReferencias(e);
    });
    ctxBanco = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: 'teste-03-03',
    };
    propria = new PortaCargosPropria(nucleo);
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-03-03' }, async (e) => {
      await limparReferencias(e);
      const ests = [ids.est, ids.est2];
      const faixasDosEsts =
        'tabela_salarial_id IN (SELECT id FROM tabela_salarial WHERE estabelecimento_id IN (?, ?))';
      await e.executar(
        `UPDATE faixa_salarial SET faixa_salarial_anterior_id = NULL WHERE ${faixasDosEsts}`,
        ests,
      );
      await e.executar(`DELETE FROM faixa_salarial WHERE ${faixasDosEsts}`, ests);
      await e.executar(
        'UPDATE quadro_vaga SET quadro_vaga_anterior_id = NULL WHERE estabelecimento_id IN (?, ?)',
        ests,
      );
      await e.executar('DELETE FROM quadro_vaga WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('DELETE FROM tabela_salarial WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('DELETE FROM cargo WHERE ocupacao_cbo_id IN (?, ?)', [ids.cbo, ids.cbo2]);
      await e.executar('DELETE FROM colaborador WHERE id = ?', [ids.colaborador]);
      await e.executar('DELETE FROM pessoa_fisica WHERE id = ?', [ids.pessoa]);
      await e.executar('DELETE FROM centro_custo WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar('DELETE FROM conselho_classe WHERE id IN (?, ?)', [ids.conselho, ids.conselho2]);
      await e.executar('DELETE FROM ocupacao_cbo WHERE id IN (?, ?)', [ids.cbo, ids.cbo2]);
      for (const c of [...criados].reverse())
        await e.executar(`DELETE FROM ${c.tabela} WHERE id = ?`, [c.id]);
    });
    await nucleo.encerrar();
  });

  describe.each(FABRICAS)('bateria do cargo ($nome)', (f) => {
    const dados = (nome: string) => ({
      nome,
      cbo: f.cbo,
      descricao: 'Descrição sintética',
      requisitos: null,
      conselho: f.conselho,
      por: 'l0303c.teste',
    });
    const gravar = <T>(entidade: string, fn: Parameters<PortaCargos['gravarSgh']>[2]) =>
      f.porta().gravarSgh(f.ctx(), trilha(f.ctx(), entidade), fn) as Promise<T>;
    const sufixo = () => `${f.nome === 'banco' ? 'B' : 'M'}${Date.now() % 1_000_000}`;

    it('inclui, altera com a correção no histórico, inativa com motivo e recusa versão antiga e nome em uso', async () => {
      const nome = `CARGO SINTETICO ${sufixo()}`;
      const id = await gravar<number>('cargo', (g) => g.incluirCargo(dados(nome)));
      if (f.nome === 'banco') cargosCriados.push(id);
      const c0 = await f.porta().cargo(f.ctx(), id);
      expect(c0).toMatchObject({ id, nome, cbo: f.cbo, conselho: f.conselho, ativo: true });
      expect(await codigoDe(gravar('cargo', (g) => g.incluirCargo(dados(nome))))).toBe('cargo-nome-em-uso');

      await gravar('cargo', async (g) => {
        await g.alterarCargo({ ...dados(`${nome} UTI`), id, versao: c0!.versao });
        await g.registrarCorrecao({
          tabela: 'cargo',
          registro: id,
          operacao: 'cargo.alterado',
          antes: { nome },
          depois: { nome: `${nome} UTI` },
          motivo: MOTIVO,
          por: 'l0303c.teste',
        });
        return id;
      });
      const c1 = await f.porta().cargo(f.ctx(), id);
      expect(c1).toMatchObject({ nome: `${nome} UTI`, versao: c0!.versao + 1 });
      const corr = await f.porta().correcoes(f.ctx(), 'cargo', [id]);
      expect(corr).toHaveLength(1);
      expect(corr[0]).toMatchObject({
        operacao: 'cargo.alterado',
        motivo: MOTIVO,
        registro: id,
        antes: { nome },
      });

      const velha = gravar('cargo', (g) => g.alterarCargo({ ...dados(`${nome} X`), id, versao: c0!.versao }));
      const pv = await velha.then(
        () => null,
        (e: unknown) => problema(e),
      );
      expect(pv).toMatchObject({ status: 409, codigo: 'desatualizado' });
      // Nada mudou: o nome e a versão continuam os da última gravação.
      expect(await f.porta().cargo(f.ctx(), id)).toMatchObject({ nome: `${nome} UTI`, versao: c1!.versao });

      await gravar('cargo', async (g) => {
        await g.situacao({ tabela: 'cargo', id, versao: c1!.versao, ativo: false, motivo: MOTIVO, por: 'x' });
        await g.registrarCorrecao({
          tabela: 'cargo',
          registro: id,
          operacao: 'cargo.inativado',
          antes: { ativo: true },
          depois: { ativo: false },
          motivo: MOTIVO,
          por: 'x',
        });
        return id;
      });
      expect(await f.porta().cargo(f.ctx(), id)).toMatchObject({ ativo: false, motivoSituacao: MOTIVO });
      expect((await f.porta().cargos(f.ctx())).some((x) => x.id === id)).toBe(true);
    });

    it('o cargo é da rede: visto nos dois estabelecimentos do cliente, e o nome repetido noutro é recusado', async () => {
      const nome = `CARGO REDE ${sufixo()}`;
      const id = await gravar<number>('cargo', (g) => g.incluirCargo(dados(nome)));
      if (f.nome === 'banco') cargosCriados.push(id);
      expect(await f.porta().cargo(f.ctx2(), id)).toMatchObject({ id, nome });
      expect((await f.porta().cargos(f.ctx2())).some((x) => x.id === id)).toBe(true);
      const outro = f
        .porta()
        .gravarSgh(f.ctx2(), trilha(f.ctx2(), 'cargo'), (g) => g.incluirCargo(dados(nome.toLowerCase())));
      expect(await codigoDe(outro)).toBe('cargo-nome-em-uso');
    });

    it('exclui o cargo nunca usado (sai das leituras)', async () => {
      const id = await gravar<number>('cargo', (g) => g.incluirCargo(dados(`CARGO EXCLUIR ${sufixo()}`)));
      if (f.nome === 'banco') cargosCriados.push(id);
      const c = await f.porta().cargo(f.ctx(), id);
      await gravar('cargo', (g) =>
        g.excluir({ tabela: 'cargo', id, versao: c!.versao, motivo: MOTIVO, por: 'x' }).then(() => id),
      );
      expect(await f.porta().cargo(f.ctx(), id)).toBeNull();
      expect((await f.porta().cargos(f.ctx())).some((x) => x.id === id)).toBe(false);
    });
  });

  describe('só no banco', () => {
    it('contrato de efeito da inclusão: código de negócio, referências, versão e a trilha da operação', async () => {
      const nome = `CARGO EFEITO ${Date.now() % 1_000_000}`;
      const id = await propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'cargo'), (g) =>
        g.incluirCargo({ nome, cbo: CBO, descricao: null, requisitos: null, conselho: CONSELHO, por: 'x' }),
      );
      cargosCriados.push(id);
      const linha = await nucleo.lerSomente(
        { cliente: CLIENTE, correlacao: 'conferencia-03-03' },
        async (l) => ({
          cargo: await l.uma(
            'SELECT codigo, ocupacao_cbo_id, conselho_classe_id, exige_registro_conselho, profissional_saude, versao, criado_por FROM cargo WHERE id = ?',
            [id],
          ),
          trilha: await l.uma(
            "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'cargo' AND entidade_id = ? AND JSON_VALUE(dados_depois, '$.operacao') = 'pessoas.cargos.gravacao'",
            [id],
          ),
        }),
      );
      expect(String(linha.cargo?.['codigo'])).toMatch(/^CG-\d+$/);
      expect(Number(linha.cargo?.['ocupacao_cbo_id'])).toBe(ids.cbo);
      expect(Number(linha.cargo?.['conselho_classe_id'])).toBe(ids.conselho);
      expect(Number(linha.cargo?.['exige_registro_conselho'])).toBe(1);
      expect(Number(linha.cargo?.['profissional_saude'])).toBe(1);
      expect(Number(linha.cargo?.['versao'])).toBe(1);
      expect(Number(linha.cargo?.['criado_por'])).toBe(ids.usuario);
      expect(Number(linha.trilha?.['n'])).toBe(1);
      const c = await propria.cargo(ctxBanco, id);
      expect(c?.criadoPor).toBe('l0303c.teste');
    });

    it('a exclusão é lógica e guarda o retrato na trilha', async () => {
      const id = await propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'cargo'), (g) =>
        g.incluirCargo({
          nome: `CARGO RETRATO ${Date.now() % 1_000_000}`,
          cbo: CBO,
          descricao: null,
          requisitos: null,
          conselho: null,
          por: 'x',
        }),
      );
      cargosCriados.push(id);
      const c = await propria.cargo(ctxBanco, id);
      expect(c?.conselho).toBeNull();
      await propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'cargo'), (g) =>
        g.excluir({ tabela: 'cargo', id, versao: c!.versao, motivo: MOTIVO, por: 'x' }).then(() => id),
      );
      const r = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-03-03' }, async (l) => ({
        cargo: await l.uma('SELECT excluido_em, excluido_por FROM cargo WHERE id = ?', [id]),
        retrato: await l.uma(
          "SELECT motivo, JSON_VALUE(dados_depois, '$.dados.retrato.nome') AS nome FROM trilha_auditoria WHERE entidade = 'cargo' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
          [id],
        ),
      }));
      expect(r.cargo?.['excluido_em']).not.toBeNull();
      expect(Number(r.cargo?.['excluido_por'])).toBe(ids.usuario);
      expect(r.retrato?.['motivo']).toBe(MOTIVO);
      expect(String(r.retrato?.['nome'])).toContain('CARGO RETRATO');
    });

    it('faixas do estabelecimento: só a tabela vigente já começada conta; rascunho, futura e o outro estabelecimento não', async () => {
      const id = await novoCargo('CARGO FAIXA');
      const faixa = (tabela: number, degrau: number) => async (e: Escritor) =>
        e.inserir(
          "INSERT INTO faixa_salarial (tabela_salarial_id, sequencia, cargo_id, nivel, degrau, valor, criado_em) VALUES (?, ?, ?, 'A', ?, 3200.50, ?)",
          [tabela, (id * 4 + degrau) % 60_000, id, degrau, new Date()],
        );
      let idB = 0;
      await escrever(async (e) => {
        await faixa(ids.tabela, 1)(e);
        await faixa(ids.rascunho, 2)(e);
        await faixa(ids.futura, 3)(e);
        idB = await faixa(ids.tabela2, 1)(e);
      });
      const fs = await propria.faixas(ctxBanco, id);
      expect(fs.map((x) => [x.nivel, x.desde, x.ativo])).toEqual([
        ['1', '2026-01-01', true],
        ['2', '2026-01-01', false],
        ['3', '2099-01-01', false],
      ]);
      expect(fs[0]).toMatchObject({ cargo: id, faixa: 'A', valor: 320_050, ate: null });
      expect(await propria.faixa(ctxBanco, fs[0]!.id)).toMatchObject({ id: fs[0]!.id, ativo: true });
      expect(await propria.faixa(ctxBanco, idB)).toBeNull();
      expect((await propria.faixas(ctxBanco, null)).some((x) => x.id === idB)).toBe(false);
      const ctxB = { ...ctxBanco, estabelecimento: ids.est2 };
      expect((await propria.faixas(ctxB, id)).map((x) => x.id)).toEqual([idB]);
      // O cargo é da rede: as quatro faixas (nos dois estabelecimentos) barram a exclusão.
      expect(await propria.dependencias(ctxBanco, 'cargo', id)).toEqual([
        { grupo: 'Faixas da tabela salarial', tabela: 'faixa_salarial', coluna: 'cargo_id', quantidade: 4 },
      ]);
      const c = await propria.cargo(ctxBanco, id);
      expect(
        await codigoDe(
          propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'cargo'), (g) =>
            g.excluir({ tabela: 'cargo', id, versao: c!.versao, motivo: MOTIVO, por: 'x' }),
          ),
        ),
      ).toBe('cargo-com-vinculos');
      expect(await propria.cargo(ctxBanco, id)).toMatchObject({ versao: c!.versao });
    });

    it('as dependências cobrem todas as chaves estrangeiras para cargo(id) do modelo', async () => {
      const fks = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-03-03' }, (l) =>
        l.consultar(
          `SELECT DISTINCT TABLE_NAME AS t FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'cargo' AND REFERENCED_COLUMN_NAME = 'id'
              AND COLUMN_NAME = 'cargo_id'`,
          [],
        ),
      );
      expect(fks.map((r) => String(r['t'])).sort()).toEqual(DEPENDENCIAS_CARGO.map((d) => d.tabela).sort());
    });

    it('cargo só com função (excluída não conta) ou só com trabalhador sem vínculo noutro estabelecimento: recusa', async () => {
      const comFuncao = await novoCargo('CARGO FUNCAO');
      let funcao = 0;
      await escrever(async (e) => {
        funcao = await e.inserir(
          "INSERT INTO funcao (estabelecimento_id, codigo, nome, cargo_id, criado_em) VALUES (?, ?, 'FUNCAO SINTETICA', ?, ?)",
          [ids.est, `${P}-F${comFuncao}`, comFuncao, new Date()],
        );
      });
      expect(await propria.dependencias(ctxBanco, 'cargo', comFuncao)).toEqual([
        { grupo: 'Funções do cargo', tabela: 'funcao', coluna: 'cargo_id', quantidade: 1 },
      ]);
      const excluir = async (id: number) => {
        const c = await propria.cargo(ctxBanco, id);
        return codigoDe(
          propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'cargo'), (g) =>
            g.excluir({ tabela: 'cargo', id, versao: c!.versao, motivo: MOTIVO, por: 'x' }).then(() => id),
          ),
        );
      };
      expect(await excluir(comFuncao)).toBe('cargo-com-vinculos');
      await escrever((e) =>
        e.executar('UPDATE funcao SET excluido_em = ? WHERE id = ?', [new Date(), funcao]),
      );
      expect(await propria.dependencias(ctxBanco, 'cargo', comFuncao)).toEqual([]);

      const comTerceiro = await novoCargo('CARGO TERCEIRO');
      await escrever((e) =>
        e.inserir(
          'INSERT INTO trabalhador_sem_vinculo (estabelecimento_id, pessoa_fisica_id, categoria_trabalhador_id, cargo_id, data_inicio, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [ids.est2, ids.pessoa, ids.categoria, comTerceiro, '2026-01-01', new Date()],
        ),
      );
      expect(await propria.dependencias(ctxBanco, 'cargo', comTerceiro)).toEqual([
        {
          grupo: 'Trabalhadores sem vínculo no cargo',
          tabela: 'trabalhador_sem_vinculo',
          coluna: 'cargo_id',
          quantidade: 1,
        },
      ]);
      expect(await excluir(comTerceiro)).toBe('cargo-com-vinculos');
      expect(await propria.cargo(ctxBanco, comTerceiro)).not.toBeNull();
    });

    it('ocupação do estabelecimento por centro de custo: sem desligado, transferido, excluído nem outro estabelecimento', async () => {
      const id = await novoCargo('CARGO OCUPACAO');
      await escrever(async (e) => {
        const vinculo = async (
          est: number,
          k: number,
          cc: number | null,
          situacao: string,
          extra: { desligamento?: string; excluido?: boolean } = {},
        ) =>
          e.inserir(
            `INSERT INTO vinculo_trabalho (estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id,
               categoria_trabalhador_id, cargo_id, centro_custo_id, data_admissao, salario_base, situacao,
               data_desligamento, tipo_rescisao_id, excluido_em, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1000, ?, ?, ?, ?, ?)`,
            [
              est,
              ids.colaborador,
              `${P}-${id}-${k}`,
              ids.tipoVinculo,
              ids.categoria,
              id,
              cc,
              `2020-01-${String(k).padStart(2, '0')}`,
              situacao,
              extra.desligamento ?? null,
              extra.desligamento ? ids.rescisao : null,
              extra.excluido ? new Date() : null,
              new Date(),
            ],
          );
        const ativo = await vinculo(ids.est, 1, ids.cc1, 'ativo');
        await vinculo(ids.est, 2, ids.cc1, 'afastado');
        await vinculo(ids.est, 3, ids.cc2, 'ativo');
        await vinculo(ids.est, 4, null, 'ativo');
        await vinculo(ids.est, 5, ids.cc1, 'desligado', { desligamento: '2021-01-01' });
        await vinculo(ids.est, 6, ids.cc1, 'transferido', { desligamento: '2021-01-01' });
        await vinculo(ids.est, 7, ids.cc1, 'ativo', { excluido: true });
        await vinculo(ids.est2, 8, ids.ccB, 'ativo');
        await e.inserir(
          "INSERT INTO historico_cargo (vinculo_trabalho_id, cargo_id, data_inicio, motivo, operacao, ocorrido_em, criado_em) VALUES (?, ?, '2020-01-01', 'admissao', 'inclusao', ?, ?)",
          [ativo, id, new Date(), new Date()],
        );
      });
      const oc = (await propria.ocupacao(ctxBanco)).filter((x) => x.cargo === id);
      const porCentro = Object.fromEntries(oc.map((x) => [String(x.centroCusto), x.ocupadas]));
      expect(porCentro).toEqual({ [String(ids.cc1)]: 2, [String(ids.cc2)]: 1, null: 1 });
      const ocB = (await propria.ocupacao({ ...ctxBanco, estabelecimento: ids.est2 })).filter(
        (x) => x.cargo === id,
      );
      expect(ocB).toEqual([{ cargo: id, centroCusto: ids.ccB, ocupadas: 1 }]);
      // Dependências da rede: sete vínculos não excluídos (nos dois estabelecimentos) e o histórico.
      expect(await propria.dependencias(ctxBanco, 'cargo', id)).toEqual([
        { grupo: 'Colaboradores no cargo', tabela: 'vinculo_trabalho', coluna: 'cargo_id', quantidade: 7 },
        {
          grupo: 'Histórico de cargo dos vínculos',
          tabela: 'historico_cargo',
          coluna: 'cargo_id',
          quantidade: 1,
        },
      ]);
    });

    it('renomear cargo com CBO e conselho desativados depois: aceita e não recalcula o que veio da origem', async () => {
      const id = await novoCargo('CARGO CBO INATIVO', CBO2, CONSELHO2);
      await escrever(async (e) => {
        await e.executar('UPDATE cargo SET profissional_saude = FALSE WHERE id = ?', [id]);
        await e.executar('UPDATE ocupacao_cbo SET ativo = FALSE WHERE id = ?', [ids.cbo2]);
        await e.executar('UPDATE conselho_classe SET ativo = FALSE WHERE id = ?', [ids.conselho2]);
      });
      try {
        const c = await propria.cargo(ctxBanco, id);
        await propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'cargo'), (g) =>
          g.alterarCargo({
            id,
            versao: c!.versao,
            nome: `${c!.nome} NOVO`,
            cbo: CBO2,
            descricao: 'Nova',
            requisitos: null,
            conselho: CONSELHO2,
            por: 'x',
          }),
        );
        const linha = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-03-03' }, (l) =>
          l.uma(
            'SELECT nome, ocupacao_cbo_id, conselho_classe_id, profissional_saude, exige_registro_conselho, versao FROM cargo WHERE id = ?',
            [id],
          ),
        );
        expect(String(linha?.['nome'])).toBe(`${c!.nome} NOVO`);
        expect(Number(linha?.['ocupacao_cbo_id'])).toBe(ids.cbo2);
        expect(Number(linha?.['conselho_classe_id'])).toBe(ids.conselho2);
        expect(Number(linha?.['profissional_saude'])).toBe(0);
        expect(Number(linha?.['exige_registro_conselho'])).toBe(1);
        expect(Number(linha?.['versao'])).toBe(c!.versao + 1);
        // A troca para um valor novo continua exigindo o cadastro ativo.
        const c2 = await propria.cargo(ctxBanco, id);
        const trocar = (cbo: string, conselho: string | null) =>
          codigoDe(
            propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'cargo'), (g) =>
              g.alterarCargo({
                id,
                versao: c2!.versao,
                nome: c2!.nome,
                cbo,
                descricao: null,
                requisitos: null,
                conselho,
                por: 'x',
              }),
            ),
          );
        expect(await trocar('000001', CONSELHO2)).toBe('cbo-inexistente');
        expect(await trocar(CBO2, 'NAOEXISTE')).toBe('conselho-inexistente');
      } finally {
        await escrever(async (e) => {
          await e.executar('UPDATE ocupacao_cbo SET ativo = TRUE WHERE id = ?', [ids.cbo2]);
          await e.executar('UPDATE conselho_classe SET ativo = TRUE WHERE id = ?', [ids.conselho2]);
        });
      }
    });

    it('recusas: CBO e conselho fora do cadastro; nível da faixa não numérico e centro de custo de outro estabelecimento', async () => {
      const incluir = (cbo: string, conselho: string | null) =>
        codigoDe(
          propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'cargo'), (g) =>
            g.incluirCargo({
              nome: `CARGO RECUSA ${Date.now()}`,
              cbo,
              descricao: null,
              requisitos: null,
              conselho,
              por: 'x',
            }),
          ),
        );
      expect(await incluir('000001', null)).toBe('cbo-inexistente');
      expect(await incluir(CBO, 'NAOEXISTE')).toBe('conselho-inexistente');
      const cargo = await novoCargo('CARGO RECUSA FAIXA');
      const faixa = (nivel: string, desde = '2026-02-01') =>
        codigoDe(
          propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'faixa_salarial'), (g) =>
            g.incluirFaixa({ cargo, faixa: 'R', nivel, valor: 1000, desde, por: 'x' }),
          ),
        );
      expect(await faixa('I')).toBe('faixa-nivel-invalido');
      expect(await faixa('1', '2020-01-01')).toBe('tabela-salarial-ausente');
      // A tabela futura (vigente a partir de 2099) e o rascunho não recebem faixa: ela vai para a vigente já começada e
      // volta ativa, senão a versão, a situação e a duplicidade do serviço não a enxergariam.
      const futura = await propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'faixa_salarial'), (g) =>
        g.incluirFaixa({ cargo, faixa: 'R', nivel: '7', valor: 1000, desde: '2099-02-01', por: 'x' }),
      );
      expect(await propria.faixa(ctxBanco, futura)).toMatchObject({ desde: '2099-02-01', ativo: true });
      const tabFutura = await nucleo.lerSomente(ctxBanco, (l) =>
        l.uma('SELECT tabela_salarial_id FROM faixa_salarial WHERE id = ?', [futura]),
      );
      expect(Number(tabFutura?.['tabela_salarial_id'])).toBe(ids.tabela);
      await escrever((e) => e.executar('DELETE FROM faixa_salarial WHERE id = ?', [futura]));
      expect(
        await codigoDe(
          propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'quadro_vaga'), (g) =>
            g.incluirVaga({ cargo, centroCusto: ids.ccB, quantidade: 1, desde: '2026-01-01', por: 'x' }),
          ),
        ),
      ).toBe('centro-custo-inexistente');
      expect((await propria.faixas(ctxBanco, cargo)).length).toBe(0);
      expect(await propria.vagas(ctxBanco, cargo)).toEqual([]);
    });

    it('faixa salarial: inclui na tabela vigente, versiona (a anterior acaba na véspera), inativa e exclui só sem versão ligada', async () => {
      const cargo = await novoCargo('CARGO VERSAO FAIXA');
      const gravar = <T>(fn: (g: GravadorCargos) => Promise<T>) =>
        propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'faixa_salarial'), fn);
      const id = await gravar((g) =>
        g.incluirFaixa({ cargo, faixa: 'V', nivel: '2', valor: 450_075, desde: '2026-03-01', por: 'x' }),
      );
      const f1 = await propria.faixa(ctxBanco, id);
      expect(f1).toMatchObject({
        cargo,
        faixa: 'V',
        nivel: '2',
        valor: 450_075,
        desde: '2026-03-01',
        ate: null,
      });
      expect(f1).toMatchObject({ anterior: null, ativo: true });
      const tab = await nucleo.lerSomente(ctxBanco, (l) =>
        l.uma('SELECT tabela_salarial_id FROM faixa_salarial WHERE id = ?', [id]),
      );
      expect(Number(tab?.['tabela_salarial_id'])).toBe(ids.tabela);
      expect(
        await codigoDe(
          gravar((g) =>
            g.incluirFaixa({ cargo, faixa: 'V', nivel: '2', valor: 1, desde: '2026-03-01', por: 'x' }),
          ),
        ),
      ).toBe('faixa-ja-existe');
      const id2 = await gravar((g) =>
        g.versionarFaixa({ anterior: f1!, valor: 500_000, desde: '2026-06-01', motivo: MOTIVO, por: 'x' }),
      );
      expect(await propria.faixa(ctxBanco, id)).toMatchObject({ ate: '2026-05-31', versao: f1!.versao + 1 });
      expect(await propria.faixa(ctxBanco, id2)).toMatchObject({
        anterior: id,
        motivo: MOTIVO,
        valor: 500_000,
        desde: '2026-06-01',
        ate: null,
      });
      // A versão antiga lida antes não versiona de novo (já tem sucessora).
      expect(
        await codigoDe(
          gravar((g) =>
            g.versionarFaixa({ anterior: f1!, valor: 1, desde: '2026-07-01', motivo: MOTIVO, por: 'x' }),
          ),
        ),
      ).toBe('desatualizado');
      expect(await propria.dependencias(ctxBanco, 'salario-faixa', id)).toEqual([
        {
          grupo: 'Versão posterior da faixa',
          tabela: 'faixa_salarial',
          coluna: 'faixa_salarial_anterior_id',
          quantidade: 1,
        },
      ]);
      const f2 = await propria.faixa(ctxBanco, id2);
      expect(
        await codigoDe(
          gravar((g) =>
            g.excluir({ tabela: 'faixa_salarial', id: id2, versao: f2!.versao, motivo: MOTIVO, por: 'x' }),
          ),
        ),
      ).toBe('salario-faixa-com-vinculos');
      await gravar((g) =>
        g.situacao({
          tabela: 'faixa_salarial',
          id: id2,
          versao: f2!.versao,
          ativo: false,
          motivo: MOTIVO,
          por: 'x',
        }),
      );
      expect(await propria.faixa(ctxBanco, id2)).toMatchObject({ ativo: false, motivoSituacao: MOTIVO });
      // Outro estabelecimento não vê nem grava a faixa.
      const ctxB = { ...ctxBanco, estabelecimento: ids.est2 };
      expect(await propria.faixa(ctxB, id2)).toBeNull();
    });

    it('quadro de vagas: inclui por cargo e centro de custo, versiona, recusa repetida e exclui a versão solta', async () => {
      const cargo = await novoCargo('CARGO QUADRO');
      const gravar = <T>(fn: (g: GravadorCargos) => Promise<T>) =>
        propria.gravarSgh(ctxBanco, trilha(ctxBanco, 'quadro_vaga'), fn);
      const id = await gravar((g) =>
        g.incluirVaga({ cargo, centroCusto: ids.cc1, quantidade: 3, desde: '2026-01-01', por: 'x' }),
      );
      const v1 = await propria.vaga(ctxBanco, id);
      expect(v1).toMatchObject({
        cargo,
        centroCusto: ids.cc1,
        quantidade: 3,
        desde: '2026-01-01',
        ate: null,
      });
      expect(
        await codigoDe(
          gravar((g) =>
            g.incluirVaga({ cargo, centroCusto: ids.cc1, quantidade: 1, desde: '2026-01-01', por: 'x' }),
          ),
        ),
      ).toBe('vaga-ja-existe');
      const id2 = await gravar((g) =>
        g.versionarVaga({ anterior: v1!, quantidade: 5, desde: '2026-04-01', motivo: MOTIVO, por: 'x' }),
      );
      const vs = await propria.vagas(ctxBanco, cargo);
      expect(vs.map((v) => [v.id, v.quantidade, v.desde, v.ate, v.anterior])).toEqual([
        [id, 3, '2026-01-01', '2026-03-31', null],
        [id2, 5, '2026-04-01', null, id],
      ]);
      expect(await propria.vagas({ ...ctxBanco, estabelecimento: ids.est2 }, cargo)).toEqual([]);
      const solta = await gravar((g) =>
        g.incluirVaga({ cargo, centroCusto: ids.cc2, quantidade: 1, desde: '2026-01-01', por: 'x' }),
      );
      const vs2 = await propria.vaga(ctxBanco, solta);
      await gravar((g) =>
        g.excluir({ tabela: 'quadro_vaga', id: solta, versao: vs2!.versao, motivo: MOTIVO, por: 'x' }),
      );
      expect(await propria.vaga(ctxBanco, solta)).toBeNull();
      // O cargo com quadro não se exclui.
      expect((await propria.dependencias(ctxBanco, 'cargo', cargo)).map((d) => d.tabela)).toContain(
        'quadro_vaga',
      );
    });

    it('CBO e conselhos do cadastro oficial; ocupação exige o estabelecimento da sessão', async () => {
      expect((await propria.buscarCbo(ctxBanco, CBO.slice(0, 4))).map((x) => x.codigo)).toContain(CBO);
      expect((await propria.buscarCbo(ctxBanco, 'sintetica l0303')).map((x) => x.codigo)).toContain(CBO);
      expect(await propria.buscarCbo(ctxBanco, '%')).toEqual([]);
      expect((await propria.cboPorCodigo(ctxBanco, [CBO, '000001'])).get(CBO)).toBe(
        'OCUPACAO SINTETICA L0303C',
      );
      expect((await propria.conselhos(ctxBanco)).map((x) => x.codigo)).toContain(CONSELHO);
      expect(await codigoDe(propria.ocupacao({ ...ctxBanco, estabelecimento: null }))).toBe(
        'sem-estabelecimento',
      );
    });
  });
});
