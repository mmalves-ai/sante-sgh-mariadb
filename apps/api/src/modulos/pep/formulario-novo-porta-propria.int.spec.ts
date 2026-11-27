// Integração da porta própria do construtor de formulários novos contra o MariaDB real (cliente de teste f22_o1). O
// ciclo inteiro pelo Executor (trilha e idempotência na mesma transação), com as recusas da porta de memória: código
// nunca repetido, versão vista, rascunho só no lugar, publicado imutável, quatro olhos, versão aberta única e aposentar
// só o publicado; a publicação põe a versão em uso no modelo e a anterior fica substituída. Massa SINTÉTICA com o
// prefixo do lote (fn92/FN92), cadastros garantidos e os formulários apagados no início e no fim. A migração
// 06_PEP/92_formulario (idempotente) é aplicada no beforeAll. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { esquemaDefinicaoFormularioNovo } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { GravadorFormularioNovo } from './formulario-novo-porta.js';
import { PortaFormularioNovoPropria } from './formulario-novo-porta-propria.js';
import { FORMATO_VERSAO_MIGRADA, type PassoFormularioNovo } from './tipos-pep.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const P = 'fn92';
const COD = 'FN92';
const HASH = 'c'.repeat(64);
/** Sufixo desta execução nas correlações conferidas na trilha (a trilha nunca é apagada). */
const RODADA = Date.now().toString(36);

const TRILHA: TrilhaDaGravacao = {
  estabelecimento: null,
  usuario: null,
  acao: 'operacao',
  entidade: 'modelo_documento_versao',
  entidadeId: null,
  correlacao: P,
};

async function codigoDaRecusa(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
}

describe.skipIf(SEM_BANCO)('PortaFormularioNovoPropria contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaFormularioNovoPropria;
  let C: { cliente: string; estabelecimento: number; usuario: number; correlacao: string };
  let especialidade: number;
  /** Id de cada conta sintética pelo login curto: a sessão de quem grava é a do próprio login. */
  let contas: Record<string, number>;

  async function limpar(e: Escritor): Promise<void> {
    const dos = `IN (SELECT v.id FROM modelo_documento_versao v JOIN modelo_documento_clinico m
                       ON m.id = v.modelo_documento_clinico_id WHERE m.codigo LIKE '${COD}%')`;
    await e.executar(`DELETE FROM modelo_documento_caso_teste WHERE modelo_documento_versao_id ${dos}`);
    await e.executar(
      `DELETE o FROM modelo_campo_opcao o JOIN modelo_campo c ON c.id = o.modelo_campo_id
        WHERE c.modelo_documento_versao_id ${dos}`,
    );
    await e.executar(
      `UPDATE modelo_campo SET pai_modelo_campo_id = NULL WHERE modelo_documento_versao_id ${dos}`,
    );
    await e.executar(`DELETE FROM modelo_campo WHERE modelo_documento_versao_id ${dos}`);
    await e.executar('DELETE FROM unidade_resposta WHERE codigo LIKE ?', [`${COD}%`]);
    await e.executar(`DELETE FROM modelo_documento_evento WHERE modelo_documento_versao_id ${dos}`);
    await e.executar(
      `UPDATE modelo_documento_clinico SET publicada_modelo_documento_versao_id = NULL, situacao = 'rascunho'
        WHERE codigo LIKE ?`,
      [`${COD}%`],
    );
    await e.executar(
      `UPDATE modelo_documento_versao v JOIN modelo_documento_clinico m ON m.id = v.modelo_documento_clinico_id
          SET v.origem_modelo_documento_versao_id = NULL WHERE m.codigo LIKE ?`,
      [`${COD}%`],
    );
    await e.executar(
      `DELETE v FROM modelo_documento_versao v JOIN modelo_documento_clinico m ON m.id = v.modelo_documento_clinico_id
        WHERE m.codigo LIKE ?`,
      [`${COD}%`],
    );
    await e.executar('DELETE FROM modelo_documento_clinico WHERE codigo LIKE ?', [`${COD}%`]);
  }

  async function garantir(
    e: Escritor,
    sel: string,
    p: unknown[],
    ins: string,
    pi: unknown[],
  ): Promise<number> {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  }

  beforeAll(async () => {
    const banco = `cliente_${CLIENTE}`;
    for (const arq of ['92_formulario_tabelas.sql', '92_formulario_chaves.sql'])
      execFileSync(resolve(RAIZ, 'tools/db/sql.sh'), [banco], {
        input: readFileSync(resolve(RAIZ, 'db/migracoes/06_PEP', arq), 'utf8'),
        encoding: 'utf8',
      });
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(banco);
    const m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = (login: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, ?, ?)',
          [login, `Conta sintética ${login}`, 'servico', agora],
        );
      const estabelecimento = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      for (const [sufixo, categoria] of [
        ['EVOL', 'evolucao'],
        ['SUM', 'sumario'],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM tipo_documento_clinico WHERE codigo = ?',
          [`${COD}_${sufixo}`],
          'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
          [`${COD}_${sufixo}`, `Tipo sintético ${categoria}`, categoria, agora],
        );
      const esp = await garantir(
        e,
        'SELECT id FROM especialidade_medica WHERE codigo = ?',
        [`${P}esp`],
        'INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}esp`, 'Especialidade sintética fn92', agora],
      );
      const ids: Record<string, number> = {};
      for (const l of ['autora', 'revisor', 'publicador', 'servico']) ids[l] = await usuario(`${P}.${l}`);
      return { estabelecimento, ids, esp };
    });
    especialidade = m.esp;
    contas = m.ids;
    C = { cliente: CLIENTE, estabelecimento: m.estabelecimento, usuario: m.ids['servico']!, correlacao: P };
    porta = new PortaFormularioNovoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    await nucleo?.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo?.encerrar?.();
  });

  const gravar = <T>(fn: (g: GravadorFormularioNovo) => Promise<T>, login: string, correlacao = P) =>
    porta.gravarSgh({ ...C, usuario: contas[login]!, correlacao }, TRILHA, fn);
  const novo = (
    codigo: string,
    extra: { baseadoEm?: number; id?: number; versaoEsperada?: string; correlacao?: string } = {},
  ) =>
    gravar(
      (g) =>
        g.salvar({
          id: extra.id ?? null,
          baseadoEm: extra.baseadoEm ?? null,
          codigo,
          titulo: `Evolução sintética ${codigo}`,
          tipoRegistro: 'evolucao',
          formato: 'formulario-novo/1',
          definicao: { codigo, perguntas: [{ id: 'q1' }] },
          casos: [
            { nome: 'caso 1', caso: { nome: 'caso 1', respostas: {} } },
            { nome: 'caso 2', caso: { nome: 'caso 2', respostas: {} } },
          ],
          autor: `${P}.autora`,
          versaoEsperada: extra.versaoEsperada ?? null,
        }),
      'autora',
      extra.correlacao,
    );
  const mudar = (id: number, por: string, passo: PassoFormularioNovo, versaoEsperada: string | null = null) =>
    gravar((g) => g.mudar({ id, por: `${P}.${por}`, versaoEsperada, passo }), por);
  const publicar: PassoFormularioNovo = {
    tipo: 'publicado',
    contentHash: HASH,
    ponte: 'so-sante',
    idModeloLegado: null,
    codModelo: null,
    ligacoes: null,
  };
  const modelo = (codigo: string) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
      l.uma<{ situacao: string; pub: number | null }>(
        'SELECT situacao, publicada_modelo_documento_versao_id AS pub FROM modelo_documento_clinico WHERE codigo = ?',
        [codigo],
      ),
    );

  /** Escritas em modelo_documento_caso_teste registradas na trilha da operação de uma correlação. */
  const escritasDosCasos = (correlacao: string) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, async (l) => {
      const linhas = await l.consultar('SELECT dados_depois FROM trilha_auditoria WHERE correlacao = ?', [
        correlacao,
      ]);
      expect(linhas).toHaveLength(1);
      const d = linhas[0]!['dados_depois'];
      const escritas = (typeof d === 'string' ? JSON.parse(d) : d).escritas as {
        acao: string;
        tabela: string;
        colunas: string[];
      }[];
      return escritas
        .filter((x) => x.tabela === 'modelo_documento_caso_teste')
        .map((x) => `${x.acao}:${x.colunas.join(',')}`);
    });
  const casosNoBanco = (versao: number) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, async (l) =>
      (
        await l.consultar(
          `SELECT ordem, excluido_em, excluido_por FROM modelo_documento_caso_teste
            WHERE modelo_documento_versao_id = ? ORDER BY ordem`,
          [versao],
        )
      ).map((x) => ({
        ordem: Number(x['ordem']),
        excluido: x['excluido_em'] !== null,
        por: x['excluido_por'] === null ? null : Number(x['excluido_por']),
      })),
    );

  it('ciclo completo: salvar, revisar, quatro olhos, publicar, nova versão, substituir e aposentar', async () => {
    const codigo = `${COD}A`;
    const v1 = await novo(codigo, { correlacao: `${P}-casos-1-${RODADA}` });
    expect(v1).toMatchObject({ versao: 1, versaoLinha: '1' });
    expect((await porta.codigosEmUso(C)).has(codigo)).toBe(true);
    expect(await codigoDaRecusa(novo(codigo))).toBe('codigo-em-uso');

    let lida = await porta.versao(C, v1.id);
    expect(lida).toMatchObject({
      codigo,
      estado: 'rascunho',
      autor: `${P}.autora`,
      tipoRegistro: 'evolucao',
    });
    expect(lida?.casos.map((x) => x.ordem)).toEqual([1, 2]);

    // Salvar no lugar: versão vista, código fixo; os casos que saem ficam excluídos (lógico).
    expect(await codigoDaRecusa(novo(codigo, { id: v1.id, versaoEsperada: '99' }))).toBe(
      'versao-concorrente',
    );
    expect(await codigoDaRecusa(novo(`${COD}Z`, { id: v1.id }))).toBe('codigo-mudou');
    const s2 = await gravar(
      (g) =>
        g.salvar({
          id: v1.id,
          baseadoEm: null,
          codigo,
          titulo: 'Título revisto',
          tipoRegistro: 'resumo-clinico',
          formato: 'formulario-novo/1',
          definicao: { codigo },
          casos: [{ nome: 'só um', caso: { nome: 'só um' } }],
          autor: `${P}.autora`,
          versaoEsperada: v1.versaoLinha,
        }),
      'autora',
      `${P}-casos-2-${RODADA}`,
    );
    expect(s2.versaoLinha).not.toBe(v1.versaoLinha);
    lida = await porta.versao(C, v1.id);
    expect(lida).toMatchObject({
      titulo: 'Título revisto',
      tipoRegistro: 'resumo-clinico',
      definicao: { codigo },
    });
    expect(lida?.casos).toEqual([{ ordem: 1, caso: { nome: 'só um' } }]);
    // Os casos de teste vão à trilha da operação como as outras escritas auditadas.
    const inclusaoDoCaso = 'inclusao:dados,modelo_documento_versao_id,nome,ordem';
    expect(await escritasDosCasos(`${P}-casos-1-${RODADA}`)).toEqual([inclusaoDoCaso, inclusaoDoCaso]);
    expect(await escritasDosCasos(`${P}-casos-2-${RODADA}`)).toEqual([
      'alteracao:dados,excluido_em,excluido_por,nome',
      'alteracao:excluido_em,excluido_por',
    ]);
    expect(await casosNoBanco(v1.id)).toEqual([
      { ordem: 1, excluido: false, por: null },
      { ordem: 2, excluido: true, por: contas['autora'] },
    ]);

    // Publicar sem passar pela revisão: estado inválido.
    expect(await codigoDaRecusa(mudar(v1.id, 'publicador', publicar))).toBe('estado-invalido');
    await mudar(v1.id, 'autora', { tipo: 'revisao' }, s2.versaoLinha);
    expect((await porta.versao(C, v1.id))?.estado).toBe('revisao');
    expect((await modelo(codigo))?.situacao).toBe('revisao');
    expect(await codigoDaRecusa(novo(codigo, { id: v1.id }))).toBe('estado-invalido');
    expect(await codigoDaRecusa(mudar(v1.id, 'publicador', publicar))).toBe('sem-aprovacao');
    expect(
      await codigoDaRecusa(mudar(v1.id, 'autora', { tipo: 'aprovado', parecer: 'Parecer sintético' })),
    ).toBe('aprovador-e-autor');
    await mudar(v1.id, 'revisor', { tipo: 'aprovado', parecer: 'Parecer sintético ok' });
    expect(await codigoDaRecusa(mudar(v1.id, 'autora', publicar))).toBe('publicador-e-autor');
    await mudar(v1.id, 'publicador', publicar);
    lida = await porta.versao(C, v1.id);
    expect(lida).toMatchObject({
      estado: 'publicado',
      contentHash: HASH,
      ponte: 'so-sante',
      aprovadoPor: `${P}.revisor`,
      publicadoPor: `${P}.publicador`,
      parecer: 'Parecer sintético ok',
    });
    expect(lida?.publicadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(await modelo(codigo)).toEqual({ situacao: 'publicado', pub: v1.id });
    expect(await codigoDaRecusa(novo(codigo, { id: v1.id }))).toBe('imutavel');
    expect(await codigoDaRecusa(mudar(v1.id, 'revisor', { tipo: 'revisao' }))).toBe('imutavel');
    expect((await porta.eventos(C, v1.id)).map((e) => `${e.tipo}:${e.por}`)).toEqual([
      `salvo:${P}.autora`,
      `salvo:${P}.autora`,
      `revisao:${P}.autora`,
      `aprovado:${P}.revisor`,
      `publicado:${P}.publicador`,
    ]);

    // Nova versão a partir da publicada: uma só aberta por vez; devolução volta ao rascunho com o parecer.
    expect(await codigoDaRecusa(novo(codigo, { baseadoEm: 999_999_999 }))).toBe('nao-encontrado');
    const v2 = await novo(codigo, { baseadoEm: v1.id });
    expect(v2.versao).toBe(2);
    expect(await codigoDaRecusa(novo(codigo, { baseadoEm: v1.id }))).toBe('versao-aberta');
    expect(await codigoDaRecusa(novo(`${COD}B`, { baseadoEm: v1.id }))).toBe('codigo-mudou');
    expect(
      await codigoDaRecusa(mudar(v2.id, 'publicador', { tipo: 'aposentado', motivo: 'Motivo sintético' })),
    ).toBe('estado-invalido');
    await mudar(v2.id, 'autora', { tipo: 'revisao' });
    await mudar(v2.id, 'revisor', { tipo: 'devolvido', parecer: 'Ajustar o texto sintético' });
    expect(await porta.versao(C, v2.id)).toMatchObject({
      estado: 'rascunho',
      aprovadoPor: null,
      parecer: 'Ajustar o texto sintético',
      baseadoEm: v1.id,
    });
    // O revisor que salvou passa a ser autor: não aprova mais esta versão.
    await gravar(
      (g) =>
        g.salvar({
          id: v2.id,
          baseadoEm: null,
          codigo,
          titulo: 'v2',
          tipoRegistro: 'evolucao',
          formato: 'formulario-novo/1',
          definicao: { codigo, v: 2 },
          casos: [],
          autor: `${P}.revisor`,
          versaoEsperada: null,
        }),
      'revisor',
    );
    await mudar(v2.id, 'revisor', { tipo: 'revisao' });
    expect(
      await codigoDaRecusa(mudar(v2.id, 'autora', { tipo: 'aprovado', parecer: 'Parecer sintético' })),
    ).toBe('aprovador-e-autor');
    await mudar(v2.id, 'publicador', { tipo: 'aprovado', parecer: 'Parecer sintético v2' });
    expect(await codigoDaRecusa(mudar(v2.id, 'revisor', publicar))).toBe('publicador-e-autor');
    expect(await modelo(codigo)).toEqual({ situacao: 'publicado', pub: v1.id });

    // Sem quem publique fora dos autores e do aprovador, publica-se com o aprovador da comissão (outra conta).
    await mudar(v2.id, 'servico', publicar);
    expect(await modelo(codigo)).toEqual({ situacao: 'publicado', pub: v2.id });
    const todas = (await porta.versoes(C)).filter((v) => v.codigo === codigo);
    expect(todas.map((v) => `${v.versao}:${v.estado}`)).toEqual(['2:publicado', '1:publicado']);

    // Aposentar a substituída não tira o modelo de uso; a em uso, sim.
    await mudar(v1.id, 'publicador', { tipo: 'aposentado', motivo: 'Motivo sintético v1' });
    expect(await porta.versao(C, v1.id)).toMatchObject({
      estado: 'aposentado',
      aposentadoPor: `${P}.publicador`,
      motivoAposentadoria: 'Motivo sintético v1',
    });
    expect((await modelo(codigo))?.situacao).toBe('publicado');
    await mudar(v2.id, 'publicador', { tipo: 'aposentado', motivo: 'Motivo sintético v2' });
    expect(await modelo(codigo)).toEqual({ situacao: 'aposentado', pub: v2.id });
    expect(
      await codigoDaRecusa(mudar(v2.id, 'publicador', { tipo: 'aposentado', motivo: 'De novo sintético' })),
    ).toBe('estado-invalido');
    // Da aposentada ainda sai uma versão nova.
    expect((await novo(codigo, { baseadoEm: v2.id })).versao).toBe(3);
  });

  it('a gravação é atômica: erro depois de salvar não deixa nada', async () => {
    const codigo = `${COD}R`;
    await expect(
      gravar(async (g) => {
        await g.salvar({
          id: null,
          baseadoEm: null,
          codigo,
          titulo: 't',
          tipoRegistro: 'evolucao',
          formato: 'formulario-novo/1',
          definicao: {},
          casos: [{ nome: 'c', caso: {} }],
          autor: `${P}.autora`,
          versaoEsperada: null,
        });
        throw new ErroOperacao(409, 'falha-sintetica', 'Falha', 'Falha sintética depois de salvar.');
      }, 'autora'),
    ).rejects.toMatchObject({ problema: { codigo: 'falha-sintetica' } });
    expect((await porta.codigosEmUso(C)).has(codigo)).toBe(false);
    expect(await modelo(codigo)).toBeNull();
  });

  it('a conta de quem grava é a da sessão: login desconhecido ou de outra conta recusa', async () => {
    const salvarComo = (autor: string, sessao: string) =>
      gravar(
        (g) =>
          g.salvar({
            id: null,
            baseadoEm: null,
            codigo: `${COD}U`,
            titulo: 't',
            tipoRegistro: 'evolucao',
            formato: 'formulario-novo/1',
            definicao: {},
            casos: [],
            autor,
            versaoEsperada: null,
          }),
        sessao,
      );
    expect(await codigoDaRecusa(salvarComo(`${P}.nao-existe`, 'servico'))).toBe('usuario-inexistente');
    // A sessão é a da conta de serviço, o login é o da autora: não grava em nome de outra conta.
    expect(await codigoDaRecusa(salvarComo(`${P}.autora`, 'servico'))).toBe('usuario-inexistente');
    expect(await modelo(`${COD}U`)).toBeNull();
  });

  it('leituras de apoio: hoje, especialidades e a ponte fechada', async () => {
    expect(await porta.hoje(C)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await porta.especialidades(C)).some((e) => e.codigo === especialidade)).toBe(true);
    expect(await porta.buscarPerguntas(C, 'zz-termo-sintetico-sem-par', [])).toEqual([]);
    const plano = await porta.dadosDoPlano(C, `${COD}A`, []);
    expect(plano.codigosExistentes.has(`${COD}A`)).toBe(false);
    expect(plano.banco).toEqual([]);
    expect(plano.respostasCadastradas).toEqual([]);
    expect(await porta.podeGravar(C, 'pep.publicarFormularioNovo')).toMatchObject({ pode: false });
  });

  it('banco de perguntas e plano: campos das versões publicadas, com tipo, opções na ordem, unidade e uso', async () => {
    const publicado = async (codigo: string) => {
      const v = await novo(codigo);
      await mudar(v.id, 'autora', { tipo: 'revisao' });
      await mudar(v.id, 'revisor', { tipo: 'aprovado', parecer: 'Parecer sintético' });
      await mudar(v.id, 'publicador', publicar);
      return v.id;
    };
    const q1 = await publicado(`${COD}Q1`);
    const q2 = await publicado(`${COD}Q2`);
    const ids = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: `preparo-${P}-perguntas` },
      async (e) => {
        const agora = new Date();
        const unidade = await e.inserir(
          'INSERT INTO unidade_resposta (codigo, descricao, sigla, criado_em) VALUES (?, ?, ?, ?)',
          [`${COD}UN`, 'Unidade sintética', 'un/fn92', agora],
        );
        const campo = (
          versao: number,
          seq: number,
          ident: string,
          titulo: string,
          tipo: string,
          un: number | null,
        ) =>
          e.inserir(
            `INSERT INTO modelo_campo (modelo_documento_versao_id, sequencia, identificador, titulo, tipo_campo,
             unidade_resposta_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [versao, seq, ident, titulo, tipo, un, agora],
          );
        const glic = await campo(q1, 1, 'fn92_glic', 'Glicemia fn92_q', 'decimal', unidade);
        const mob = await campo(q1, 2, 'fn92_mob', 'Mobilidade fn92xq', 'escolha', null);
        const mob2 = await campo(q2, 1, 'fn92_mob', 'Mobilidade fn92 outra', 'escolha', null);
        // Fora de ordem de inclusão, e uma inativa: a busca devolve as ativas pela sequência.
        for (const [seq, cod, rotulo, ativo] of [
          [2, 'deamb', 'Deambula sintético', true],
          [3, 'inat', 'Inativa sintética', false],
          [1, 'acam', 'Acamado sintético', true],
        ] as const)
          await e.inserir(
            `INSERT INTO modelo_campo_opcao (modelo_campo_id, sequencia, codigo, rotulo, ativo, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
            [mob, seq, cod, rotulo, ativo, agora],
          );
        return { glic, mob, mob2 };
      },
    );
    const glicemia = {
      id: ids.glic,
      descricao: 'Glicemia fn92_q',
      tipoperg: '6',
      unidade: 'un/fn92',
      ativo: true,
      opcoes: [],
      usoEmModelos: 1,
    };
    // O "_" do termo é literal (LIKE escapado): "fn92xq" não entra.
    expect(await porta.buscarPerguntas(C, 'fn92_q', [])).toEqual([glicemia]);
    expect(await porta.buscarPerguntas(C, 'fn92%q', [])).toEqual([]);
    expect(await porta.buscarPerguntas(C, 'fn92', ['6'])).toEqual([glicemia]);
    expect(await porta.buscarPerguntas(C, 'mobilidade fn92', ['13'])).toEqual([
      {
        id: ids.mob2,
        descricao: 'Mobilidade fn92 outra',
        tipoperg: '13',
        unidade: null,
        ativo: true,
        opcoes: [],
        usoEmModelos: 2,
      },
      {
        id: ids.mob,
        descricao: 'Mobilidade fn92xq',
        tipoperg: '13',
        unidade: null,
        ativo: true,
        opcoes: ['Acamado sintético', 'Deambula sintético'],
        usoEmModelos: 2,
      },
    ]);
    // Aposentado o modelo, o campo continua no banco, inativo.
    await mudar(q2, 'publicador', { tipo: 'aposentado', motivo: 'Motivo sintético' });
    expect((await porta.buscarPerguntas(C, 'fn92 outra', [])).map((x) => x.ativo)).toEqual([false]);
    const plano = await porta.dadosDoPlano(C, `${COD}Q1`, [ids.glic]);
    expect(plano.banco).toEqual([glicemia]);
    expect(plano.codigosExistentes.has(`${COD}Q2`)).toBe(true);
    expect(plano.codigosExistentes.has(`${COD}Q1`)).toBe(false);
  });

  /** Modelo migrado posto em uso pela carga (decisão 61): versão 1000 publicada sem formato, com campos; e uma histórica. */
  const migrado = (codigo: string) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}-${codigo}` }, async (e) => {
      const agora = new Date();
      const tipo = await e.uma<{ id: number }>('SELECT id FROM tipo_documento_clinico WHERE codigo = ?', [
        `${COD}_EVOL`,
      ]);
      const modeloId = await e.inserir(
        `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, situacao,
           origem, criado_em) VALUES (?, ?, ?, 'outro', 'rascunho', 'migracao', ?)`,
        [codigo, `Evolução migrada sintética ${codigo}`, Number(tipo!.id), agora],
      );
      const versao = (numero: number, situacao: string) =>
        e.inserir(
          `INSERT INTO modelo_documento_versao (modelo_documento_clinico_id, numero_versao, situacao, operacao, dados,
             ocorrido_em, usuario_id, publicada_em, publicacao_usuario_id, hash_definicao, criado_em)
           VALUES (?, ?, ?, 'inclusao', '{}', ?, ?, ?, ?, ?, ?)`,
          situacao === 'publicada'
            ? [
                modeloId,
                numero,
                situacao,
                agora,
                contas['servico'],
                agora,
                contas['servico'],
                'd'.repeat(64),
                agora,
              ]
            : [modeloId, numero, situacao, agora, contas['servico'], null, null, null, agora],
        );
      const historica = await versao(1, 'rascunho');
      const id = await versao(1000, 'publicada');
      await e.executar(
        "UPDATE modelo_documento_clinico SET publicada_modelo_documento_versao_id = ?, situacao = 'publicado' WHERE id = ?",
        [id, modeloId],
      );
      const campo = (seq: number, ident: string, tipoCampo: string, pai: number | null) =>
        e.inserir(
          `INSERT INTO modelo_campo (modelo_documento_versao_id, sequencia, pai_modelo_campo_id, identificador, titulo,
             tipo_campo, obrigatorio, valor_minimo, origem, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'migracao', ?)`,
          [
            id,
            seq,
            pai,
            ident,
            `Pergunta sintética ${ident}`,
            tipoCampo,
            seq === 2,
            seq === 2 ? 0 : null,
            agora,
          ],
        );
      const grupo = await campo(1, 'campo_1', 'grupo', null);
      await campo(2, 'campo_2', 'decimal', grupo);
      const escolha = await campo(3, 'campo_3', 'escolha', null);
      for (const [seq, cod, ativo] of [
        [1, 'sim', true],
        [2, 'nao', true],
        [3, 'velha', false],
      ] as const)
        await e.inserir(
          `INSERT INTO modelo_campo_opcao (modelo_campo_id, sequencia, codigo, rotulo, ativo, criado_em)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [escolha, seq, cod, `Opção sintética ${cod}`, ativo, agora],
        );
      return { id, historica };
    });
  const versaoNoBanco = (id: number) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
      l.uma<{ situacao: string; numero_versao: number; origem: number | null; formato: string | null }>(
        `SELECT situacao, numero_versao, origem_modelo_documento_versao_id AS origem, formato
           FROM modelo_documento_versao WHERE id = ?`,
        [id],
      ),
    );

  it('modelo migrado (decisão 61): a comissão o abre, parte dele numa nova versão que o substitui, mantendo o código', async () => {
    const codigo = `${COD}MIG`;
    const m = await migrado(codigo);
    const lista = (await porta.versoes(C)).filter((v) => v.codigo === codigo);
    // Só a versão posta em uso aparece; a histórica (rascunho sem formato) fica fora.
    expect(lista.map((v) => [v.id, v.versao, v.estado, v.formato])).toEqual([
      [m.id, 1000, 'publicado', FORMATO_VERSAO_MIGRADA],
    ]);
    expect(await porta.versao(C, m.historica)).toBeNull();
    const lida = await porta.versao(C, m.id);
    const def = esquemaDefinicaoFormularioNovo.parse(lida!.definicao);
    expect(def).toMatchObject({
      codigo,
      titulo: `Evolução migrada sintética ${codigo}`,
      tipoRegistro: 'evolucao',
    });
    expect(
      def.perguntas.map((p) => [p.linkId, p.tipo, p.itens.map((i) => [i.linkId, i.obrigatorio, i.minimo])]),
    ).toEqual([
      ['campo_1', 'secao', [['campo_2', true, 0]]],
      ['campo_3', 'escolha', []],
    ]);
    expect(def.perguntas[1]!.opcoes.map((o) => o.codigo)).toEqual(['sim', 'nao']);
    expect(lida!.contentHash).toBe('d'.repeat(64));
    // A versão migrada é imutável: corrigir é a nova versão a partir dela.
    expect(await codigoDaRecusa(novo(codigo, { id: m.id }))).toBe('imutavel');
    const v2 = await novo(codigo, { baseadoEm: m.id });
    expect(v2.versao).toBe(1001);
    expect(await versaoNoBanco(v2.id)).toEqual({
      situacao: 'rascunho',
      numero_versao: 1001,
      origem: m.id,
      formato: 'formulario-novo/1',
    });
    await mudar(v2.id, 'autora', { tipo: 'revisao' });
    await mudar(v2.id, 'revisor', { tipo: 'aprovado', parecer: 'Parecer sintético' });
    await mudar(v2.id, 'publicador', publicar);
    expect(await modelo(codigo)).toEqual({ situacao: 'publicado', pub: v2.id });
    expect((await versaoNoBanco(m.id))!.situacao).toBe('substituida');
    expect((await porta.versao(C, m.id))!.estado).toBe('publicado');
  });

  it('modelo migrado (decisão 61): a comissão aposenta a versão migrada em uso e o modelo sai de uso', async () => {
    const codigo = `${COD}MAP`;
    const m = await migrado(codigo);
    await mudar(m.id, 'publicador', { tipo: 'aposentado', motivo: 'Revisão da comissão sintética' });
    expect(await versaoNoBanco(m.id)).toMatchObject({ situacao: 'aposentada', formato: null });
    expect(await modelo(codigo)).toEqual({ situacao: 'aposentado', pub: m.id });
    const lida = await porta.versao(C, m.id);
    expect([lida!.estado, lida!.motivoAposentadoria, lida!.aposentadoPor]).toEqual([
      'aposentado',
      'Revisão da comissão sintética',
      `${P}.publicador`,
    ]);
    expect((await porta.eventos(C, m.id)).map((e) => e.tipo)).toEqual(['aposentado']);
  });
});
