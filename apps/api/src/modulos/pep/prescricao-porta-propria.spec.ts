// Unidade da porta própria da prescrição, com dublê do Leitor: o cliente vem da configuração, toda leitura filtra o
// estabelecimento da sessão e a exclusão lógica, o SQL é parametrizado, o mapeamento segue a forma da porta de memória
// (especificação) e o que não tem adaptador recusa com 501 sem ler nada.
import type { Leitor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { PortaPrescricaoMemoria } from './prescricao-porta-memoria.js';
import type { PortaPrescricao } from './prescricao-porta.js';
import { BASE_PLANO_PROPRIO, PortaPrescricaoPropria } from './prescricao-porta-propria.js';
import type { NucleoRegistroGravacao } from './registro-propria-gravacao.js';

interface Chamada {
  readonly sql: string;
  readonly parametros: readonly unknown[];
}

function duble(respostas: (sql: string) => Linha[]) {
  const chamadas: Chamada[] = [];
  const contextos: { cliente: string; correlacao: string }[] = [];
  const leitor: Leitor = {
    cliente: 'x',
    async consultar<T extends Linha = Linha>(sql: string, parametros: readonly unknown[] = []) {
      chamadas.push({ sql, parametros });
      return respostas(sql) as T[];
    },
    async uma<T extends Linha = Linha>(sql: string, parametros: readonly unknown[] = []) {
      chamadas.push({ sql, parametros });
      return (respostas(sql)[0] as T | undefined) ?? null;
    },
  };
  const nucleo: NucleoRegistroGravacao = {
    criarExecutor: () => {
      throw new Error('o dublê de leitura não grava');
    },
    lerSomente: async (contexto, fn) => {
      contextos.push({ ...contexto });
      return fn(leitor);
    },
  };
  return { nucleo, chamadas, contextos };
}

const C = {
  rede: 'rede-a',
  hospital: 'h1',
  cliente: 'c',
  estabelecimento: 7,
  usuario: null,
  correlacao: 't',
};
const EST = { id: 7, fuso_horario: 'America/Sao_Paulo' };
const cab = (o: Record<string, unknown> = {}) => ({
  id: 50,
  atendimento_id: 30,
  paciente_id: 20,
  prescrito_em: new Date('2026-11-23T13:00:00Z'),
  vigencia_inicio_em: new Date('2026-11-23T13:00:00Z'),
  vigencia_fim_em: new Date('2026-11-24T13:00:00Z'),
  criado_em: new Date('2026-11-23T13:01:00Z'),
  suspensa_em: null,
  motivo_suspensao: null,
  codigo_cbo: '225125',
  prescritor: 'medico',
  suspensao_por: null,
  itens: 2,
  ...o,
});

describe('PortaPrescricaoPropria (dublê)', () => {
  it('cumpre a mesma interface que a porta de memória (todo método dela existe na própria)', () => {
    const propria = new PortaPrescricaoPropria(duble(() => []).nucleo, 'cx') as unknown as Record<
      string,
      unknown
    >;
    const memoria = new PortaPrescricaoMemoria() as unknown as Record<string, unknown>;
    const daInterface: (keyof PortaPrescricao)[] = [
      'prescricoes',
      'cabecalho',
      'itens',
      'suspenderPrescricao',
    ];
    const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(memoria)).filter(
      (m) => m !== 'constructor' && typeof memoria[m] === 'function' && typeof propria[m] !== 'undefined',
    );
    for (const m of daInterface) expect(metodos, m).toContain(m);
    expect(metodos.length).toBeGreaterThanOrEqual(45);
    for (const m of metodos) expect(typeof propria[m], m).toBe('function');
    expect(propria['destino']).toBe('proprio');
  });

  it('cliente da sessão (ou da configuração), estabelecimento pelo código e prescrições do atendimento filtradas', async () => {
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : [cab()]));
    const porta = new PortaPrescricaoPropria(d.nucleo, 'cliente_x');
    const r = await porta.prescricoes(C, 30);
    expect(d.contextos[0]).toEqual({ cliente: 'c', correlacao: 'pep.prescricao.prescricoes' });
    await porta.cabecalho({ ...C, cliente: '' }, 50);
    expect(d.contextos[1]?.cliente).toBe('cliente_x');
    expect(d.chamadas[0]?.parametros).toEqual(['h1']);
    expect(d.chamadas[1]?.sql).toMatch(/p\.estabelecimento_id = \? AND p\.excluido_em IS NULL/);
    expect(d.chamadas[1]?.sql).toMatch(/i\.excluido_em IS NULL/);
    expect(d.chamadas[1]?.parametros).toEqual([7, 30]);
    expect(r).toEqual([
      {
        id: 50,
        atendimento: 30,
        htPaciente: 20,
        htAtendimento: 30,
        dataHora: '2026-11-23T10:00:00',
        inicio: '2026-11-23T10:00:00',
        fim: '2026-11-24T10:00:00',
        cbo: 225125,
        prescritor: 'medico',
        suspensaoEm: null,
        suspensaoPor: null,
        suspensaoJustificativa: null,
        gravacao: '2026-11-23T10:01:00',
        itens: 2,
      },
    ]);
  });

  it('cabeçalho suspenso traz quem, quando e o motivo; inexistente é null', async () => {
    const suspensa = cab({
      suspensa_em: new Date('2026-11-23T15:00:00Z'),
      suspensao_por: 'medica2',
      motivo_suspensao: 'Troca de conduta',
      codigo_cbo: null,
    });
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : [suspensa]));
    const c = await new PortaPrescricaoPropria(d.nucleo, 'x').cabecalho(C, 50);
    expect(c).toMatchObject({
      suspensaoEm: '2026-11-23T12:00:00',
      suspensaoPor: 'medica2',
      suspensaoJustificativa: 'Troca de conduta',
      cbo: 0,
    });
    const vazio = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : []));
    expect(await new PortaPrescricaoPropria(vazio.nucleo, 'x').cabecalho(C, 51)).toBeNull();
  });

  it('cancelada chega encerrada (evento de cancelamento: quando, quem, motivo); rascunho fica fora do SQL', async () => {
    const cancelada = cab({
      situacao: 'cancelada',
      cancelada_em: new Date('2026-11-23T16:00:00Z'),
      cancelada_por: 'medica3',
      motivo_cancelamento: 'Paciente errado',
    });
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : [cancelada]));
    const c = await new PortaPrescricaoPropria(d.nucleo, 'x').cabecalho(C, 50);
    expect(c).toMatchObject({
      suspensaoEm: '2026-11-23T13:00:00',
      suspensaoPor: 'medica3',
      suspensaoJustificativa: 'Prescrição cancelada: Paciente errado',
    });
    expect(d.chamadas[1]?.sql).toContain("p.situacao <> 'rascunho'");
    const semEvento = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [EST]
        : [cab({ situacao: 'cancelada', alterado_em: new Date('2026-11-23T17:00:00Z') })],
    );
    expect(await new PortaPrescricaoPropria(semEvento.nucleo, 'x').cabecalho(C, 50)).toMatchObject({
      suspensaoEm: '2026-11-23T14:00:00',
      suspensaoPor: null,
      suspensaoJustificativa: 'Prescrição cancelada',
    });
  });

  it('prescritores pelo vínculo vigente do login (principal primeiro); dados clínicos pela aferição e pela pessoa', async () => {
    const d = duble((sql) => {
      if (sql.includes('FROM estabelecimento')) return [EST];
      if (sql.includes('FROM usuario u'))
        return [
          { codigo_cbo: '225125', nome_exibicao: 'Dra. Sintética' },
          { codigo_cbo: '223115', nome_exibicao: 'Dra. Sintética' },
        ];
      if (sql.includes('FROM afericao a'))
        return [{ valor_numerico: '72.500', aferido_em: new Date('2026-11-20T13:00:00Z') }];
      if (sql.includes('FROM paciente pc')) return [{ nascimento: '1958-03-14', sigla: 'M' }];
      return [];
    });
    const porta = new PortaPrescricaoPropria(d.nucleo, 'x');
    expect(await porta.prescritores(C, 'medica1')).toEqual([
      { cbo: 225125, ocupacao: '225125', nome: 'Dra. Sintética' },
      { cbo: 223115, ocupacao: '223115', nome: 'Dra. Sintética' },
    ]);
    expect(d.chamadas[1]?.parametros).toEqual(['medica1']);
    expect(await porta.dadosClinicos(C, 9)).toEqual({
      pesoKg: 72.5,
      alturaCm: 72.5,
      dataPeso: '2026-11-20',
      sexo: 'M',
      nascimento: '1958-03-14',
      creatinina: null,
      dataCreatinina: null,
    });
    expect(d.chamadas.filter((x) => x.sql.includes('FROM afericao a')).map((x) => x.parametros)).toEqual([
      [9, 7, 'peso'],
      [9, 7, 'altura'],
    ]);
    const vazio = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : []));
    const p2 = new PortaPrescricaoPropria(vazio.nucleo, 'x');
    expect(await p2.prescritores(C, 'ninguem')).toEqual([]);
    expect(await p2.dadosClinicos(C, 9)).toEqual({
      pesoKg: null,
      alturaCm: null,
      dataPeso: null,
      sexo: null,
      nascimento: null,
      creatinina: null,
      dataCreatinina: null,
    });
  });

  it('itens: medicamento com dose e princípio, outro tipo sem detalhe; horários pela situação da checagem', async () => {
    const d = duble((sql) => {
      if (sql.includes('FROM estabelecimento')) return [EST];
      if (sql.includes('FROM horario_administracao'))
        return [
          {
            id: 900,
            prescricao_item_id: 1,
            previsto_em: new Date('2026-11-23T14:00:00Z'),
            suspenso: 0,
            codigo: 'X',
            categoria: 'pendente',
          },
          {
            id: 901,
            prescricao_item_id: 1,
            previsto_em: new Date('2026-11-23T20:00:00Z'),
            suspenso: 1,
            codigo: 'X',
            categoria: 'pendente',
          },
          {
            id: 902,
            prescricao_item_id: 2,
            previsto_em: new Date('2026-11-23T14:00:00Z'),
            suspenso: 0,
            codigo: 'ADM',
            categoria: 'administrado',
          },
        ];
      const base = {
        prescricao_id: 50,
        doses_por_dia: 4,
        frequencia_administracao_id: 3,
        frequencia_nome: '6/6 h',
        observacao_enfermagem: null,
        codigo_cbo: '225125',
        criado_em: new Date('2026-11-23T13:00:00Z'),
        liberada_em: new Date('2026-11-23T13:00:30Z'),
        alterado_em: null,
        situacao: 'ativo',
        suspenso_em: null,
      };
      return [
        {
          ...base,
          id: 1,
          tipo_item_prescricao_id: 2,
          categoria: 'medicamento',
          tipo_nome: 'Medicamento',
          via: 'EV',
          med_id: 11,
          produto: 400,
          produto_nome: 'Dipirona sintética',
          principio_ativo_id: 16,
          dose: '1.0000',
          unidade: 'g',
          iniciar_agora: 1,
          nao_ajustar_horario: 0,
          justificativa_nao_padronizado: null,
          justificativa_alergia: null,
        },
        {
          ...base,
          id: 2,
          tipo_item_prescricao_id: 9,
          categoria: 'cuidado',
          tipo_nome: 'Cuidado',
          via: null,
          med_id: null,
          produto: null,
          produto_nome: null,
          principio_ativo_id: null,
          dose: null,
          unidade: null,
          iniciar_agora: null,
          nao_ajustar_horario: null,
          justificativa_nao_padronizado: null,
          justificativa_alergia: null,
          criado_em: new Date('2026-11-23T16:00:00Z'),
          situacao: 'suspenso_correcao',
          suspenso_em: new Date('2026-11-23T17:00:00Z'),
        },
      ];
    });
    const itens = await new PortaPrescricaoPropria(d.nucleo, 'x').itens(C, 50);
    const sqlItens = d.chamadas.find((x) => x.sql.includes('FROM prescricao_item i'))!;
    expect(sqlItens.parametros).toEqual([50, 7]);
    expect(sqlItens.sql).toMatch(/p\.estabelecimento_id = \?/);
    expect(itens[0]).toMatchObject({
      id: 1,
      plano: 6,
      planoNome: 'Medicamento',
      numDoses: 4,
      via: 'EV',
      cboLancamento: 225125,
      incluidoEm: null,
      corrigidoEm: null,
      detalhe: {
        tipo: 'medicamento',
        id: 11,
        produto: 400,
        dose: 1,
        unidade: 'g',
        agora: true,
        principios: [16],
      },
      horarios: [
        { id: 900, dataHora: '2026-11-23T11:00:00', situacao: 'P', acessoria: false },
        { id: 901, dataHora: '2026-11-23T17:00:00', situacao: 'S', acessoria: false },
      ],
    });
    expect(itens[1]).toMatchObject({
      id: 2,
      plano: BASE_PLANO_PROPRIO + 9,
      detalhe: { tipo: 'outro', id: null },
      incluidoEm: '2026-11-23T13:00:00',
      corrigidoEm: '2026-11-23T14:00:00',
      horarios: [{ id: 902, situacao: 'ADM' }],
    });
  });

  it('itens de prescrição inexistente: lista vazia sem ler horários', async () => {
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : []));
    expect(await new PortaPrescricaoPropria(d.nucleo, 'x').itens(C, 99)).toEqual([]);
    expect(d.chamadas.some((x) => x.sql.includes('horario_administracao'))).toBe(false);
  });

  it('atendimento: internação é I, os demais E; em curso pela situação; de outro estabelecimento é null', async () => {
    const linha = {
      id: 30,
      numero: '000777',
      paciente_id: 20,
      tipo_base: 'internacao',
      situacao: 'aberto',
      alta_medica_em: null,
      saida_em: null,
      unidade_assistencial_id: 4,
      fonte_pagadora_id: 8,
    };
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : [linha]));
    const porta = new PortaPrescricaoPropria(d.nucleo, 'x');
    expect(await porta.atendimento(C, 30)).toEqual({
      id: 30,
      numero: 777,
      paciente: 20,
      tipo: 'I',
      aberto: true,
      bloco: null,
      unidade: 4,
      convenio: 8,
    });
    expect(d.chamadas[1]?.parametros).toEqual([30, 7]);
    const pa = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [EST]
        : [{ ...linha, tipo_base: 'pronto_atendimento', situacao: 'encerrado', numero: 'A-1' }],
    );
    expect(await new PortaPrescricaoPropria(pa.nucleo, 'x').atendimento(C, 30)).toMatchObject({
      tipo: 'E',
      aberto: false,
      numero: null,
    });
    const nada = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : []));
    expect(await new PortaPrescricaoPropria(nada.nucleo, 'x').atendimento(C, 30)).toBeNull();
  });

  it('marcas e decisões: só do estabelecimento; lista vazia não consulta', async () => {
    const d = duble((sql) => {
      if (sql.includes('FROM estabelecimento')) return [EST];
      if (sql.includes('FROM decisao_alerta'))
        return [
          {
            prescricao_item_id: 1,
            sequencia: 2,
            processo: 'interacao',
            decisao: 'justificou',
            justificativa: 'Benefício',
            regra_alerta_id: 5,
            versao_regra: 3,
          },
          {
            prescricao_item_id: 2,
            processo: 'dose',
            decisao: 'cancelou_item',
            justificativa: null,
            regra_alerta_id: null,
            versao_regra: null,
          },
        ];
      return [
        { id: 50, origem: 'sistema' },
        { id: 51, origem: 'migracao' },
      ];
    });
    const porta = new PortaPrescricaoPropria(d.nucleo, 'x');
    const m = await porta.marcas(C, [50, 51, 50]);
    expect(m.get(50)).toEqual({ feitaNoNovo: true, coassinaturaPendente: false });
    expect(m.get(51)).toEqual({ feitaNoNovo: false, coassinaturaPendente: false });
    expect(d.chamadas[1]?.parametros).toEqual([7, 50, 51]);
    // Forma da porta de memória: decisão no vocabulário do contrato (mantido/retirado), versão da regra.
    expect(await porta.decisoes(C, 50)).toEqual([
      {
        item: 1,
        chave: '1',
        tipo: 'interacao',
        decisao: 'mantido',
        justificativa: 'Benefício',
        regra: '5',
        versao: 3,
      },
      { item: 2, chave: '2', tipo: 'dose', decisao: 'retirado', justificativa: null, regra: '', versao: 0 },
    ]);
    expect(d.chamadas.at(-1)?.sql).toContain("situacao <> 'rascunho'");
    const n = d.chamadas.length;
    expect((await porta.marcas(C, [])).size).toBe(0);
    expect(d.chamadas.length).toBe(n);
  });

  it('estabelecimento inexistente: 404', async () => {
    const d = duble(() => []);
    await expect(new PortaPrescricaoPropria(d.nucleo, 'x').prescricoes(C, 1)).rejects.toMatchObject({
      problema: { status: 404 },
    });
  });

  it('sem cadeia de hash nesta etapa; regra de alerta e ficha de antimicrobiano ainda recusam 501 sem ler', async () => {
    const d = duble(() => []);
    const porta = new PortaPrescricaoPropria(d.nucleo, 'x');
    expect(await porta.hashAtual()).toBe('');
    for (const m of ['gravarRegra', 'registrarFicha'] as const)
      await expect(porta[m]()).rejects.toMatchObject({
        problema: { status: 501, codigo: 'pendente-modelo-proprio' },
      });
    expect(d.chamadas).toEqual([]);
  });
});
