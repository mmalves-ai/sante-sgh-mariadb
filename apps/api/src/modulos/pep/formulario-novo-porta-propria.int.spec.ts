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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { GravadorFormularioNovo } from './formulario-novo-porta.js';
import { PortaFormularioNovoPropria } from './formulario-novo-porta-propria.js';
import type { PassoFormularioNovo } from './tipos-pep.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const P = 'fn92';
const COD = 'FN92';
const HASH = 'c'.repeat(64);

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

  async function limpar(e: Escritor): Promise<void> {
    const dos = `IN (SELECT v.id FROM modelo_documento_versao v JOIN modelo_documento_clinico m
                       ON m.id = v.modelo_documento_clinico_id WHERE m.codigo LIKE '${COD}%')`;
    await e.executar(`DELETE FROM modelo_documento_caso_teste WHERE modelo_documento_versao_id ${dos}`);
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

  async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
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
      for (const l of ['autora', 'revisor', 'publicador']) await usuario(`${P}.${l}`);
      return { estabelecimento, servico: await usuario(`${P}.servico`), esp };
    });
    especialidade = m.esp;
    C = { cliente: CLIENTE, estabelecimento: m.estabelecimento, usuario: m.servico, correlacao: P };
    porta = new PortaFormularioNovoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    await nucleo?.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo?.encerrar?.();
  });

  const gravar = <T>(fn: (g: GravadorFormularioNovo) => Promise<T>) => porta.gravarSgh(C, TRILHA, fn);
  const novo = (codigo: string, extra: { baseadoEm?: number; id?: number; versaoEsperada?: string } = {}) =>
    gravar((g) =>
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
    );
  const mudar = (id: number, por: string, passo: PassoFormularioNovo, versaoEsperada: string | null = null) =>
    gravar((g) => g.mudar({ id, por: `${P}.${por}`, versaoEsperada, passo }));
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

  it('ciclo completo: salvar, revisar, quatro olhos, publicar, nova versão, substituir e aposentar', async () => {
    const codigo = `${COD}A`;
    const v1 = await novo(codigo);
    expect(v1).toMatchObject({ versao: 1, versaoLinha: '1' });
    expect((await porta.codigosEmUso(C)).has(codigo)).toBe(true);
    expect(await codigoDaRecusa(novo(codigo))).toBe('codigo-em-uso');

    let lida = await porta.versao(C, v1.id);
    expect(lida).toMatchObject({ codigo, estado: 'rascunho', autor: `${P}.autora`, tipoRegistro: 'evolucao' });
    expect(lida?.casos.map((x) => x.ordem)).toEqual([1, 2]);

    // Salvar no lugar: versão vista, código fixo; os casos que saem ficam excluídos (lógico).
    expect(await codigoDaRecusa(novo(codigo, { id: v1.id, versaoEsperada: '99' }))).toBe('versao-concorrente');
    expect(await codigoDaRecusa(novo(`${COD}Z`, { id: v1.id }))).toBe('codigo-mudou');
    const s2 = await gravar((g) =>
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
    );
    expect(s2.versaoLinha).not.toBe(v1.versaoLinha);
    lida = await porta.versao(C, v1.id);
    expect(lida).toMatchObject({ titulo: 'Título revisto', tipoRegistro: 'resumo-clinico', definicao: { codigo } });
    expect(lida?.casos).toEqual([{ ordem: 1, caso: { nome: 'só um' } }]);

    // Publicar sem passar pela revisão: estado inválido.
    expect(await codigoDaRecusa(mudar(v1.id, 'publicador', publicar))).toBe('estado-invalido');
    await mudar(v1.id, 'autora', { tipo: 'revisao' }, s2.versaoLinha);
    expect((await porta.versao(C, v1.id))?.estado).toBe('revisao');
    expect((await modelo(codigo))?.situacao).toBe('revisao');
    expect(await codigoDaRecusa(novo(codigo, { id: v1.id }))).toBe('estado-invalido');
    expect(await codigoDaRecusa(mudar(v1.id, 'publicador', publicar))).toBe('sem-aprovacao');
    expect(await codigoDaRecusa(mudar(v1.id, 'autora', { tipo: 'aprovado', parecer: 'Parecer sintético' }))).toBe(
      'aprovador-e-autor',
    );
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
    expect(await codigoDaRecusa(mudar(v2.id, 'publicador', { tipo: 'aposentado', motivo: 'Motivo sintético' }))).toBe(
      'estado-invalido',
    );
    await mudar(v2.id, 'autora', { tipo: 'revisao' });
    await mudar(v2.id, 'revisor', { tipo: 'devolvido', parecer: 'Ajustar o texto sintético' });
    expect(await porta.versao(C, v2.id)).toMatchObject({
      estado: 'rascunho',
      aprovadoPor: null,
      parecer: 'Ajustar o texto sintético',
      baseadoEm: v1.id,
    });
    // O revisor que salvou passa a ser autor: não aprova mais esta versão.
    await gravar((g) =>
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
    );
    await mudar(v2.id, 'revisor', { tipo: 'revisao' });
    expect(await codigoDaRecusa(mudar(v2.id, 'autora', { tipo: 'aprovado', parecer: 'Parecer sintético' }))).toBe(
      'aprovador-e-autor',
    );
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
    expect(await codigoDaRecusa(mudar(v2.id, 'publicador', { tipo: 'aposentado', motivo: 'De novo sintético' }))).toBe(
      'estado-invalido',
    );
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
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'falha-sintetica' } });
    expect((await porta.codigosEmUso(C)).has(codigo)).toBe(false);
    expect(await modelo(codigo)).toBeNull();
  });

  it('leituras de apoio: hoje, especialidades, banco de perguntas e plano', async () => {
    expect(await porta.hoje(C)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await porta.especialidades(C)).some((e) => e.codigo === especialidade)).toBe(true);
    const perguntas = await porta.buscarPerguntas(C, 'zz-termo-sintetico-sem-par', []);
    expect(perguntas).toEqual([]);
    const plano = await porta.dadosDoPlano(C, `${COD}A`, []);
    expect(plano.codigosExistentes.has(`${COD}A`)).toBe(false);
    expect(plano.respostasCadastradas).toEqual([]);
    expect(await porta.podeGravar(C, 'pep.publicarFormularioNovo')).toMatchObject({ pode: false });
  });
});
