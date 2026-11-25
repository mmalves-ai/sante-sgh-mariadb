// Contrato de efeito da regra comercial de conta ligada à entrada e à rotina diária (F8, 06-FAT linha 13), contra o
// MariaDB real. Massa SINTÉTICA com códigos "F862" (nenhuma pessoa real), num estabelecimento só dela:
// - criação: a regra "criar_conta" que vale para a origem da entrada abre a conta da entrada na fonte pagadora de
//   destino (e não na do atendimento); a exceção da regra afasta e a conta fica na fonte do atendimento; a segunda
//   chamada devolve a mesma conta (nada em dobro);
// - quebra: a rotina diária (faturamento.apurar-lancamentos-do-dia) quebra a conta de internação aberta pela regra
//   "quebrar_conta" semanal: um trecho por semana até a de hoje, a conta de cada trecho vencido com fim_em no último
//   instante do domingo local, as seguintes com tipo de cobrança "parcial", conta_pai_id na original, mesma fonte, tipo
//   e acomodação, competência do novo início, número seguinte do atendimento e vínculo atendimento_conta; rodar de novo
//   não quebra nada (idempotente); a conta de outra fonte (sem regra que valha) não é tocada. No fim, a massa é apagada.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { instanteParaDataHora } from '@sgh/contratos';
import { competenciaDaConta, trechosDaQuebra } from '@sgh/dominio-faturamento';
import { type ContextoOperacao, definirOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { abrirContaDaEntrada, apurarLancamentosDoDia, TABELAS_CONTA_ENTRADA } from './conta-entrada.js';
import { ServicoRegrasComerciais } from './regras-comerciais.controller.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'F862';
const FUSO = 'America/Sao_Paulo';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

// Abre a conta da entrada numa transação do executor. O tipo de conta da natureza é global no cliente e outras massas
// cadastram os seus: o desta massa fica inativo e, dentro da MESMA transação, só ele fica ativo durante a abertura; os
// outros voltam a ser como eram antes do commit (ninguém de fora vê a troca).
const opAbrirTeste = definirOperacao({
  nome: 'teste.f862.abrir-conta-entrada',
  tabelas: [...TABELAS_CONTA_ENTRADA, 'tipo_conta'],
  entrada: z.object({ atendimento: z.number().int(), tipo: z.number().int() }),
  gravar: (tx, e) => gravarTeste(tx, e),
  alvo: (_e, r) => ({ tabela: 'conta_hospitalar', id: Number(r['conta']) }),
});
async function gravarTeste(
  tx: Parameters<typeof abrirContaDaEntrada>[0],
  e: { atendimento: number; tipo: number },
) {
  {
    const est = tx.contexto.estabelecimento as number;
    const outros = await tx.consultarParaAtualizar<{ id: number }>(
      "SELECT id FROM tipo_conta WHERE natureza = 'internacao' AND ativo = TRUE AND id <> ?",
      [e.tipo],
    );
    const ids = outros.map((x) => Number(x.id));
    const lista = ids.map(() => '?').join(', ');
    if (ids.length) await tx.executar(`UPDATE tipo_conta SET ativo = FALSE WHERE id IN (${lista})`, ids);
    await tx.executar('UPDATE tipo_conta SET ativo = TRUE WHERE id = ?', [e.tipo]);
    const r = await abrirContaDaEntrada(tx, est, e.atendimento);
    await tx.executar('UPDATE tipo_conta SET ativo = FALSE WHERE id = ?', [e.tipo]);
    if (ids.length) await tx.executar(`UPDATE tipo_conta SET ativo = TRUE WHERE id IN (${lista})`, ids);
    return { conta: r.conta ?? 0, pendencia: r.pendencia?.codigo ?? '' };
  }
}

describe.skipIf(SEM_BANCO)('regra de conta na entrada e na rotina de quebra (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let s: ServicoRegrasComerciais;
  const ids: Record<string, number> = {};
  const op = (): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: ids['est'] as number,
    usuario: ids['usuario'] as number,
    correlacao: 'teste-f862',
    chaveIdempotencia: `f862-${randomUUID()}`,
    reautenticadoEm: Date.now(),
  });
  const escrever = <T>(fn: (e: Escritor) => Promise<T>) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-f862' }, fn);
  const linhas = (sql: string, p: unknown[]) => escrever((e) => e.consultar<Record<string, unknown>>(sql, p));
  const abrir = async (atendimento: number) =>
    (
      await nucleo
        .criarExecutor({})
        .executar(opAbrirTeste, CLIENTE, { atendimento, tipo: ids['tipoConta'] }, op())
    ).resultado;
  const rotina = async () =>
    (await nucleo.criarExecutor({}).executar(apurarLancamentosDoDia, CLIENTE, {}, op())).resultado;

  const limpar = async (e: Escritor) => {
    const est = ids['est'];
    await e.executar(
      'DELETE ac FROM atendimento_conta ac JOIN atendimento a ON a.id = ac.atendimento_id WHERE a.estabelecimento_id = ?',
      [est],
    );
    await e.executar(
      'UPDATE conta_hospitalar SET conta_pai_id = NULL, tipo_cobranca = ? WHERE estabelecimento_id = ?',
      ['total', est],
    );
    await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', [est]);
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [est]);
    await e.executar(
      'DELETE x FROM regra_criacao_conta_excecao x JOIN regra_criacao_conta r ON r.id = x.regra_criacao_conta_id WHERE r.estabelecimento_id = ?',
      [est],
    );
    await e.executar('DELETE FROM regra_criacao_conta WHERE estabelecimento_id = ?', [est]);
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await escrever(async (e) => {
      const agora = new Date();
      const cat = (tabela: string, codigo: string, extraCol = '', extraVal: unknown[] = []) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, descricao${extraCol}, criado_em) VALUES (?, ?${extraVal.map(() => ', ?').join('')}, ?)`,
          [codigo, `${tabela.toUpperCase()} SINTETICO ${codigo}`, ...extraVal, agora],
        );
      ids['est'] = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em) VALUES (?, ?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, FUSO, agora],
      );
      ids['usuario'] = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['f862.sintetico'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['f862.sintetico', `USUARIO SINTETICO ${P}`, agora],
      );
      await limpar(e);
      const fonte = (c: string) =>
        garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [c],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'operadora', ?)",
          [c, `OPERADORA SINTETICA ${c}`, agora],
        );
      ids['fonteA'] = await fonte(`${P}FA`);
      ids['fonteB'] = await fonte(`${P}FB`);
      ids['fonteC'] = await fonte(`${P}FC`);
      const pp = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        "INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, '1975-03-10', ?)",
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      ids['paciente'] = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pp, 886_201, agora],
      );
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PROFISSIONAL SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PROFISSIONAL SINTETICO ${P}`, agora],
      );
      ids['prof'] = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      ids['categoria'] = await cat('categoria_atendimento', P, ', tipo_base', ['internacao']);
      ids['carater'] = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['F6'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('F6', ?, 'teste', ?)",
        [`CARATER SINTETICO ${P}`, agora],
      );
      ids['tipoConta'] = await cat('tipo_conta', P, ', natureza, ativo', ['internacao', 0]);
      ids['origemRegra'] = await cat('origem_entrada_atendimento', `${P}O1`);
      ids['origemOutra'] = await cat('origem_entrada_atendimento', `${P}O2`);
      ids['acomodacao'] = await cat('categoria_acomodacao', `${P}AC`, ', tipo', ['enfermaria']);
      const atendimento = (sufixo: string, origem: number, fonte: number, entrada: string) =>
        e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, origem_entrada_atendimento_id, fonte_pagadora_id, profissional_id, situacao,
             entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
          [
            ids['est'],
            `${P}-${sufixo}`,
            ids['paciente'],
            ids['categoria'],
            ids['carater'],
            origem,
            fonte,
            ids['prof'],
            entrada,
            agora,
          ],
        );
      ids['atRegra'] = await atendimento(
        '1',
        ids['origemRegra'] as number,
        ids['fonteA'] as number,
        '2026-01-20 11:00:00',
      );
      ids['atExcecao'] = await atendimento(
        '5',
        ids['origemRegra'] as number,
        ids['fonteA'] as number,
        '2026-01-21 11:00:00',
      );
      ids['atOutra'] = await atendimento(
        '2',
        ids['origemOutra'] as number,
        ids['fonteA'] as number,
        '2026-01-20 11:00:00',
      );
      // A internação longa: começa 20 dias atrás às 10h (UTC 13h); a conta de internação já aberta na fonte C.
      const inicio = new Date(Date.now() - 20 * 86_400_000);
      inicio.setUTCHours(13, 0, 0, 0);
      ids['inicioMs'] = inicio.getTime();
      ids['atLonga'] = await atendimento(
        '3',
        ids['origemOutra'] as number,
        ids['fonteC'] as number,
        inicio.toISOString().slice(0, 19).replace('T', ' '),
      );
      ids['atSemRegra'] = await atendimento(
        '4',
        ids['origemOutra'] as number,
        ids['fonteA'] as number,
        inicio.toISOString().slice(0, 19).replace('T', ' '),
      );
      const conta = (at: number, fonte: number, numero: string) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
             tipo_conta_id, categoria_acomodacao_id, natureza, competencia, inicio_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'internacao', ?, ?, ?)`,
          [
            ids['est'],
            numero,
            at,
            ids['paciente'],
            fonte,
            ids['tipoConta'],
            ids['acomodacao'],
            `${instanteParaDataHora(inicio.toISOString(), FUSO).data.slice(0, 7)}-01`,
            inicio,
            agora,
          ],
        );
      ids['contaLonga'] = await conta(ids['atLonga'] as number, ids['fonteC'] as number, `${P}-3-1`);
      ids['contaSemRegra'] = await conta(ids['atSemRegra'] as number, ids['fonteA'] as number, `${P}-4-1`);
    });
    s = new ServicoRegrasComerciais(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids['est'] as number] });
    });
    await nucleo.encerrar();
  });

  it('criação: a regra da origem abre a conta da entrada na fonte de destino; a exceção e a outra origem não', async () => {
    const regra = await s.gravar('salvar-regra-conta', op(), {
      acao: 'criar_conta',
      origemEntradaId: ids['origemRegra'],
      fonteDestinoId: ids['fonteB'],
      vigenciaInicio: '2026-01-01',
    });
    expect(regra['id']).toBeGreaterThan(0);
    const a = await abrir(ids['atRegra'] as number);
    expect(a['pendencia']).toBe('');
    const [c] = await linhas(
      'SELECT fonte_pagadora_id, plano_fonte_pagadora_id, situacao, tipo_cobranca, natureza FROM conta_hospitalar WHERE id = ?',
      [a['conta']],
    );
    expect(c).toMatchObject({ situacao: 'aberta', tipo_cobranca: 'total', natureza: 'internacao' });
    expect(Number(c?.['fonte_pagadora_id'])).toBe(ids['fonteB']);
    expect(c?.['plano_fonte_pagadora_id']).toBeNull();
    // A segunda chamada devolve a mesma conta (na fonte de destino), sem abrir outra.
    expect((await abrir(ids['atRegra'] as number))['conta']).toBe(a['conta']);
    const [qtd] = await linhas('SELECT COUNT(*) AS n FROM conta_hospitalar WHERE atendimento_id = ?', [
      ids['atRegra'],
    ]);
    expect(Number(qtd?.['n'])).toBe(1);
    const [vinc] = await linhas(
      'SELECT COUNT(*) AS n FROM atendimento_conta WHERE atendimento_id = ? AND conta_hospitalar_id = ?',
      [ids['atRegra'], a['conta']],
    );
    expect(Number(vinc?.['n'])).toBe(1);
    // Outra origem: nenhuma regra vale e a conta fica na fonte do atendimento.
    const b = await abrir(ids['atOutra'] as number);
    const [cb] = await linhas('SELECT fonte_pagadora_id FROM conta_hospitalar WHERE id = ?', [b['conta']]);
    expect(Number(cb?.['fonte_pagadora_id'])).toBe(ids['fonteA']);
    // A exceção da regra (a categoria do atendimento) afasta-a: a regra editada não decide mais a conta nova.
    await s.gravar('salvar-regra-conta', op(), {
      id: regra['id'],
      versao: 1,
      acao: 'criar_conta',
      origemEntradaId: ids['origemRegra'],
      fonteDestinoId: ids['fonteB'],
      vigenciaInicio: '2026-01-01',
      excecoes: [{ categoriaAtendimentoId: ids['categoria'] }],
    });
    const x = await abrir(ids['atExcecao'] as number);
    const [cx] = await linhas('SELECT fonte_pagadora_id FROM conta_hospitalar WHERE id = ?', [x['conta']]);
    expect(Number(cx?.['fonte_pagadora_id'])).toBe(ids['fonteA']);
  });

  it('quebra: a rotina diária quebra a conta de internação por semana até hoje, idempotente', async () => {
    await s.gravar('salvar-regra-conta', op(), {
      acao: 'quebrar_conta',
      fonteOrigemId: ids['fonteC'],
      periodicidade: 'semanal',
      vigenciaInicio: '2020-01-01',
    });
    const r = await rotina();
    const inicio = instanteParaDataHora(new Date(ids['inicioMs'] as number).toISOString(), FUSO).data;
    const hoje = instanteParaDataHora(new Date().toISOString(), FUSO).data;
    const trechos = trechosDaQuebra('semanal', inicio, hoje);
    expect(trechos.length).toBeGreaterThanOrEqual(3);
    expect(r['quebradas']).toBe(trechos.length - 1);
    expect(r['abertasPelaQuebra']).toBe(trechos.length - 1);
    const contas = await linhas(
      `SELECT id, numero, fonte_pagadora_id, tipo_conta_id, categoria_acomodacao_id, conta_pai_id, tipo_cobranca,
              situacao, DATE_FORMAT(competencia, '%Y-%m-%d') AS competencia, inicio_em, fim_em
         FROM conta_hospitalar WHERE atendimento_id = ? ORDER BY id`,
      [ids['atLonga']],
    );
    expect(contas).toHaveLength(trechos.length);
    contas.forEach((c, k) => {
      const t = trechos[k]!;
      const ini = instanteParaDataHora(new Date(c['inicio_em'] as Date).toISOString(), FUSO);
      expect(ini.data).toBe(t.inicio);
      if (k > 0) {
        expect(ini.hora.slice(0, 5)).toBe('00:00');
        expect(c).toMatchObject({
          tipo_cobranca: 'parcial',
          situacao: 'aberta',
          competencia: competenciaDaConta(t.inicio),
        });
        expect(Number(c['conta_pai_id'])).toBe(ids['contaLonga']);
        expect(String(c['numero'])).toBe(`${P}-3-${k + 1}`);
      }
      expect(Number(c['fonte_pagadora_id'])).toBe(ids['fonteC']);
      expect(Number(c['tipo_conta_id'])).toBe(ids['tipoConta']);
      expect(Number(c['categoria_acomodacao_id'])).toBe(ids['acomodacao']);
      if (k < trechos.length - 1) {
        const fim = instanteParaDataHora(new Date(c['fim_em'] as Date).toISOString(), FUSO);
        expect(fim.data).toBe(t.fim);
        expect(fim.hora.slice(0, 5)).toBe('23:59');
      } else expect(c['fim_em']).toBeNull();
    });
    const [vinc] = await linhas('SELECT COUNT(*) AS n FROM atendimento_conta WHERE atendimento_id = ?', [
      ids['atLonga'],
    ]);
    expect(Number(vinc?.['n'])).toBe(trechos.length - 1);
    // A conta da fonte sem regra de quebra não é tocada.
    const [semRegra] = await linhas(
      'SELECT fim_em, (SELECT COUNT(*) FROM conta_hospitalar WHERE atendimento_id = ?) AS n FROM conta_hospitalar WHERE id = ?',
      [ids['atSemRegra'], ids['contaSemRegra']],
    );
    expect(semRegra).toMatchObject({ fim_em: null });
    expect(Number(semRegra?.['n'])).toBe(1);
    // Idempotente: rodar de novo não quebra nem abre nada.
    const r2 = await rotina();
    expect(r2['quebradas']).toBe(0);
    expect(r2['abertasPelaQuebra']).toBe(0);
    const [qtd] = await linhas('SELECT COUNT(*) AS n FROM conta_hospitalar WHERE atendimento_id = ?', [
      ids['atLonga'],
    ]);
    expect(Number(qtd?.['n'])).toBe(trechos.length);
    // A trilha registra cada execução da rotina (autoria na mesma transação).
    const [trilha] = await linhas(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'estabelecimento' AND entidade_id = ?",
      [ids['est'], ids['est']],
    );
    expect(Number(trilha?.['n'])).toBeGreaterThanOrEqual(1);
  });
});
