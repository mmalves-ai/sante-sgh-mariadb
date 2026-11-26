// Unidade da porta própria do prontuário, com dublê do Leitor: cliente da configuração, estabelecimento da sessão,
// exclusão lógica e confidencial fora de toda leitura, SQL parametrizado, datas no fuso do estabelecimento, texto
// simples embrulhado como texto formatado (lido pelo domínio) e paginação com "há mais".
import { rtfParaTexto } from '@sgh/dominio-pep';
import type { Leitor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  PortaProntuarioPropria,
  SELO_SEM_VERSAO,
  comoTextoFormatado,
  diaSeguinte,
  inicioDoDiaUtc,
  ordemDoCampo,
  valorDaResposta,
} from './prontuario-porta-propria.js';
import type { NucleoLeituraPep } from './registro-porta-propria.js';

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
  const nucleo: NucleoLeituraPep = {
    lerSomente: async (contexto, fn) => {
      contextos.push({ ...contexto });
      return fn(leitor);
    },
  };
  return { nucleo, chamadas, contextos };
}

const C = { rede: 'r', hospital: 'h1', cliente: 'c', estabelecimento: 7, usuario: null, correlacao: 't' };
const EST = { id: 7, fuso_horario: 'America/Sao_Paulo' };

const linhaRegistro = (id: number, extra: Record<string, unknown> = {}): Linha => ({
  id,
  paciente_id: 10,
  atendimento_id: 20,
  data_hora_clinica: new Date('2026-11-10T12:30:00Z'),
  data_hora_lancamento: new Date('2026-11-10T12:45:00Z'),
  modelo: 5,
  modelo_codigo: 'EVOL',
  modelo_nome: 'Evolução',
  autor_profissional_id: 3,
  profissional_nome: 'Profissional sintético',
  codigo_cbo: '225125',
  suspenso_em: null,
  justificativa_suspensao: null,
  corrige_registro_assistencial_id: null,
  justificativa_retroativo: null,
  supervisor: null,
  tem_texto: 1,
  ...extra,
});

describe('PortaProntuarioPropria (dublê)', () => {
  it('usa o cliente da sessão (ou o da configuração) e resolve o estabelecimento pelo código, sem excluídos', async () => {
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : []));
    const p = new PortaProntuarioPropria(d.nucleo, 'cliente_x');
    await p.listar(C, 10, {}, 1, 50);
    await p.resumo({ ...C, cliente: '' }, 10);
    expect(d.contextos[0]).toEqual({ cliente: 'c', correlacao: 'pep.prontuario.listar' });
    expect(d.contextos[1]?.cliente).toBe('cliente_x');
    expect(d.chamadas[0]?.sql).toMatch(/codigo = \? AND excluido_em IS NULL/);
  });

  it('estabelecimento inexistente: 404, nada lido do prontuário', async () => {
    const d = duble(() => []);
    await expect(new PortaProntuarioPropria(d.nucleo, 'x').listar(C, 10, {}, 1, 50)).rejects.toMatchObject({
      problema: { status: 404 },
    });
    expect(d.chamadas).toHaveLength(1);
  });

  it('lista: filtra estabelecimento, exclusão lógica e confidencial; parametriza; pagina com "há mais"', async () => {
    const d = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [EST]
        : sql.includes('FROM registro_assistencial')
          ? [linhaRegistro(3), linhaRegistro(2, { tem_texto: 0 }), linhaRegistro(1)]
          : [],
    );
    const r = await new PortaProntuarioPropria(d.nucleo, 'x').listar(
      C,
      10,
      {
        de: '2026-11-01',
        ate: '2026-11-10',
        modelo: 5,
        profissional: 3,
        cboIncluir: ['225'],
        cboExcluir: ['2515'],
      },
      2,
      2,
    );
    expect(d.chamadas[1]?.sql).toMatch(/FROM restricao_prontuario/); // a restrição do prontuário vem antes da leitura
    const q = d.chamadas[2]!;
    expect(q.sql).toMatch(
      /r\.estabelecimento_id = \? AND r\.excluido_em IS NULL AND r\.confidencial = FALSE/,
    );
    expect(q.sql).toMatch(/LIMIT 3 OFFSET 2/);
    // O filtro por categoria usa o CBO do registro e, na falta dele (importado), o do autor no cadastro.
    expect(q.sql).toMatch(
      /COALESCE\(o\.codigo_cbo,[\s\S]*profissional_ocupacao[\s\S]*inscricao_conselho[\s\S]*\) IS NULL OR NOT/,
    );
    expect(q.sql).toMatch(/AS codigo_cbo/);
    expect(q.sql).not.toMatch(/[^(]o\.codigo_cbo LIKE/);
    expect(q.parametros).toEqual([
      10,
      7,
      new Date('2026-11-01T03:00:00Z'),
      new Date('2026-11-11T03:00:00Z'),
      5,
      3,
      '225%',
      '2515%',
    ]);
    expect(r.haMais).toBe(true);
    expect(r.registros.map((x) => x.id)).toEqual([3, 2]);
    expect(r.registros[0]).toMatchObject({
      idHtPaciente: 10,
      idHtAtendimento: 20,
      dataHora: '2026-11-10T09:30:00',
      lancadoEm: '2026-11-10T09:45:00',
      modeloCodigo: 'EVOL',
      cbo: '225125',
      registroProfissional: null,
    });
    expect(r.fontes.get(3)).toEqual({
      temConteudo: true,
      temXml: false,
      temDocumento: false,
      situacoes: [],
      tiposDocumento: [],
    });
    expect(r.fontes.get(2)?.temConteudo).toBe(false);
  });

  it('data de filtro fora do formato: 400', async () => {
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : []));
    await expect(
      new PortaProntuarioPropria(d.nucleo, 'x').listar(C, 10, { de: '01/11/2026' }, 1, 10),
    ).rejects.toMatchObject({ problema: { status: 400 } });
  });

  it('registro de outro paciente ou invisível: null', async () => {
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : []));
    expect(await new PortaProntuarioPropria(d.nucleo, 'x').registro(C, 10, 99)).toBeNull();
    expect(d.chamadas[1]?.sql).toMatch(/FROM restricao_prontuario/);
    expect(d.chamadas[2]?.parametros).toEqual([99, 10, 7]);
  });

  it('conteúdo: texto simples vira texto formatado legível pelo domínio; formatado passa intacto', async () => {
    const d = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [EST]
        : [{ texto_consolidado: 'Paciente estável.\nConduta: {manter}' }],
    );
    const x = await new PortaProntuarioPropria(d.nucleo, 'x').conteudo(C, 1, { rtf: true, xml: true });
    expect(x?.xml).toBeNull();
    const t = rtfParaTexto(x!.rtf!);
    expect(t.paragrafos.map((p) => p.trechos.map((s) => s.texto).join(''))).toEqual([
      'Paciente estável.',
      'Conduta: {manter}',
    ]);
    expect(comoTextoFormatado('{\\rtf1 abc}')).toBe('{\\rtf1 abc}');
  });

  it('conteúdo ausente: null', async () => {
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : [{ texto_consolidado: null }]));
    expect(
      await new PortaProntuarioPropria(d.nucleo, 'x').conteudo(C, 1, { rtf: true, xml: false }),
    ).toBeNull();
  });

  it('textos da busca: teto + 1 para o truncado, só do estabelecimento', async () => {
    const d = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [EST]
        : [1, 2, 3].map((id) => ({
            id,
            data_hora_clinica: new Date('2026-01-01T12:00:00Z'),
            modelo_codigo: 'E',
            codigo_cbo: null,
            texto_consolidado: id === 2 ? null : 'dor',
          })),
    );
    const t = await new PortaProntuarioPropria(d.nucleo, 'x').textos(C, 10, {}, 2);
    expect(d.chamadas[1]?.sql).toMatch(/FROM restricao_prontuario/);
    expect(d.chamadas[2]?.sql).toMatch(/LIMIT 3$/);
    expect(t.truncado).toBe(true);
    expect(t.registros.map((r) => [r.id, r.rtf === null])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('exceções: só contagens, dobradas no mês local', async () => {
    const d = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [EST]
        : [
            { modelo: 5, codigo: 'E', titulo: 'Ev', hora: '2026-11-01T02:00:00Z', n: 2 },
            { modelo: 5, codigo: 'E', titulo: 'Ev', hora: '2026-10-15T10:00:00Z', n: 3 },
          ],
    );
    const e = await new PortaProntuarioPropria(d.nucleo, 'x').excecoes(C);
    expect(e).toEqual([
      { tipo: 'sem-conteudo', modelo: 5, codigo: 'E', nome: 'Ev', mes: '2026-10', registros: 5 },
    ]);
  });

  it('acessos: eventos de leitura do estabelecimento, filtros parametrizados, origem do suporte', async () => {
    const d = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [EST]
        : [
            {
              id: 9,
              ocorrido_em: new Date('2026-11-10T12:00:00Z'),
              entidade: 'paciente',
              entidade_id: 10,
              login: 'ana',
              evento: 'pep.prontuario.lido',
              estacao: 'E1',
              paciente: '10',
              chave: null,
              resultado: 'sucesso',
              como: 'suporte',
            },
          ],
    );
    const r = await new PortaProntuarioPropria(d.nucleo, 'x').acessos(
      C,
      { paciente: 10, usuario: 'ana', soAlertas: true },
      1,
      10,
    );
    expect(d.chamadas[1]?.parametros).toEqual([7, 'auditoria.leitura.alertada', '10', 'ana']);
    expect(r.itens[0]).toEqual({
      id: '9',
      em: '2026-11-10T09:00:00',
      usuario: 'ana',
      evento: 'pep.prontuario.lido',
      estacao: 'E1',
      paciente: 10,
      tabela: 'paciente',
      alvo: '10',
      chave: null,
      resultado: 'sucesso',
      origem: 'SUPORTE:suporte',
    });
    expect(r.haMais).toBe(false);
  });

  it('selo sem versão publicada não falha; documento emitido e representação gravada ficam vazios', async () => {
    const d = duble((sql) => (sql.includes('FROM estabelecimento') ? [EST] : [{ numero_versao: null }]));
    const p = new PortaProntuarioPropria(d.nucleo, 'x');
    expect(await p.seloDoModelo(C, 5)).toBe(SELO_SEM_VERSAO);
    expect(await p.eventosDocumento()).toEqual([]);
    expect(await p.documentoXml()).toBeNull();
    expect(await p.representacaoGravada()).toBeNull();
  });
});

describe('auxiliares', () => {
  it('início do dia civil em UTC, inclusive fuso sem horário de verão e dia seguinte na virada do mês', () => {
    expect(inicioDoDiaUtc('2026-11-01', 'America/Sao_Paulo').toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(inicioDoDiaUtc('2026-07-01', 'Europe/Lisbon').toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(diaSeguinte('2026-02-28')).toBe('2026-03-01');
  });

  it('ordem do campo com tamanho ímpar (raiz no leitor) e ordenada pela sequência', () => {
    expect(ordemDoCampo(3, 42)).toHaveLength(15);
    expect(ordemDoCampo(2, 900) < ordemDoCampo(10, 1)).toBe(true);
  });

  it('valor da resposta pela coluna do tipo, sem sentinela', () => {
    const f = 'America/Sao_Paulo';
    expect(valorDaResposta({ tipo_valor: 'numero', valor_numero: '36.5000' }, f)).toBe('36,5');
    expect(valorDaResposta({ tipo_valor: 'data', valor_data: '2026-11-10' }, f)).toBe('10/11/2026');
    expect(valorDaResposta({ tipo_valor: 'hora', valor_hora: '08:30:00' }, f)).toBe('08:30');
    expect(valorDaResposta({ tipo_valor: 'booleano', valor_booleano: 0 }, f)).toBe('Não');
    expect(valorDaResposta({ tipo_valor: 'opcao', opcao_rotulo: 'Sim', valor_texto: null }, f)).toBe('Sim');
    expect(valorDaResposta({ tipo_valor: 'cid', codigo_cid10: 'I200' }, f)).toBe('I200');
    expect(valorDaResposta({ tipo_valor: 'multipla', valor_estruturado: ['a', 'b'] }, f)).toBe('["a","b"]');
    expect(valorDaResposta({ tipo_valor: 'texto', valor_texto: null }, f)).toBeNull();
  });
});
