// Unidade da porta própria do construtor de formulários novos, com dublê do Leitor e do Executor: o cliente vem da
// configuração, o mapeamento da versão (situação, destino, vocabulário com hífen, datas no fuso), a ponte com outro
// sistema fechada e o banco de perguntas pelos tipos do construtor. As recusas do ciclo rodam contra o MariaDB no
// .int.spec.
import { ErroOperacao, type Executor, type Leitor, type Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  type NucleoFormularioNovo,
  OPERACAO_PONTE,
  PortaFormularioNovoPropria,
} from './formulario-novo-porta-propria.js';

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
  let executou = 0;
  const executor = {
    executar: async () => {
      executou++;
      return { resultado: { valor: 1 }, repetida: false, eventos: [], trilha: null };
    },
  } as unknown as Executor;
  const nucleo: NucleoFormularioNovo = {
    lerSomente: async (contexto, fn) => {
      contextos.push({ ...contexto });
      return fn(leitor);
    },
    criarExecutor: () => executor,
  };
  return { nucleo, chamadas, contextos, executou: () => executou };
}

const C = { cliente: 'c', estabelecimento: 7, usuario: 3, correlacao: 't' };

const LINHA_VERSAO: Linha = {
  id: 11,
  modelo_id: 5,
  codigo: 'EVOL_X',
  versao_modelo: 2,
  publicada_id: 11,
  numero_versao: 2,
  situacao: 'substituida',
  titulo: 'Evolução sintética',
  tipo_registro: 'resumo_clinico',
  formato: 'formulario-novo/1',
  dados: '{"codigo":"EVOL_X"}',
  hash_definicao: 'a'.repeat(64),
  destino_publicacao: 'so_sistema',
  baseado_em: 9,
  autor: 'autora',
  aprovador: 'revisor',
  aprovada_em: new Date('2026-11-20T13:00:00Z'),
  parecer: 'Parecer sintético da comissão',
  publicador: 'publicador',
  publicada_em: new Date('2026-11-20T14:30:00Z'),
  aposentador: null,
  aposentada_em: null,
  motivo_aposentadoria: null,
  versao: 6,
  atualizado_em: new Date('2026-11-20T14:30:00Z'),
};

describe('PortaFormularioNovoPropria (dublê)', () => {
  it('lê as versões do construtor no fuso do estabelecimento, com o vocabulário neutro', async () => {
    const d = duble((sql) => {
      if (sql.includes('FROM estabelecimento')) return [{ fuso_horario: 'America/Sao_Paulo' }];
      if (sql.includes('FROM modelo_documento_caso_teste'))
        return [{ v: 11, ordem: 1, dados: '{"nome":"caso"}' }];
      if (sql.includes('FROM modelo_documento_versao')) return [LINHA_VERSAO];
      return [];
    });
    const [v] = await new PortaFormularioNovoPropria(d.nucleo, 'cfg').versoes(C);
    expect(d.contextos[0]).toEqual({ cliente: 'c', correlacao: 'pep.formularioNovo.versoes' });
    expect(v).toMatchObject({
      id: 11,
      codigo: 'EVOL_X',
      versao: 2,
      estado: 'publicado',
      tipoRegistro: 'resumo-clinico',
      ponte: 'so-sante',
      baseadoEm: 9,
      definicao: { codigo: 'EVOL_X' },
      aprovadoEm: '2026-11-20T10:00:00',
      publicadoEm: '2026-11-20T11:30:00',
      idModeloLegado: null,
      codModelo: null,
      versaoLinha: '6',
      casos: [{ ordem: 1, caso: { nome: 'caso' } }],
    });
    const sql = d.chamadas.find((x) => x.sql.includes('FROM modelo_documento_versao'))!.sql;
    expect(sql).toMatch(/v\.formato IS NOT NULL AND v\.situacao <> 'descartada' AND m\.excluido_em IS NULL/);
  });

  it('usa o cliente da configuração quando a sessão não traz, e o fuso padrão sem estabelecimento', async () => {
    const d = duble((sql) =>
      sql.includes('UTC_TIMESTAMP') ? [{ agora: new Date('2026-11-21T01:30:00Z') }] : [],
    );
    const hoje = await new PortaFormularioNovoPropria(d.nucleo, 'cfg').hoje({
      ...C,
      cliente: '',
      estabelecimento: null,
    });
    expect(d.contextos[0]?.cliente).toBe('cfg');
    expect(hoje).toBe('2026-11-20');
    expect(d.chamadas.some((x) => x.sql.includes('FROM estabelecimento'))).toBe(false);
  });

  it('a ponte com outro sistema fica fechada; sem estabelecimento não grava', async () => {
    const d = duble(() => []);
    const porta = new PortaFormularioNovoPropria(d.nucleo, 'cfg');
    expect(await porta.podeGravar(C, OPERACAO_PONTE)).toMatchObject({
      pode: false,
      codigo: 'operacao-indisponivel',
    });
    expect(await porta.podeGravar(C, 'pep.salvarFormularioNovo')).toEqual({
      pode: true,
      codigo: null,
      motivo: null,
    });
    expect((await porta.podeGravar({ ...C, estabelecimento: null }, 'x')).codigo).toBe('sem-estabelecimento');
    await expect(porta.executar()).rejects.toBeInstanceOf(ErroOperacao);
    await expect(
      porta.gravarSgh(
        { ...C, estabelecimento: null },
        { acao: 'operacao', entidade: 'x', entidadeId: null } as never,
        async () => 1,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'sem-estabelecimento' } });
    expect(d.executou()).toBe(0);
    expect(
      await porta.gravarSgh(C, { acao: 'operacao', entidade: 'x', entidadeId: null } as never, async () => 1),
    ).toBe(1);
    expect(d.executou()).toBe(1);
  });

  it('banco de perguntas: tipos do construtor viram tipos de campo, termo escapado, opções e uso', async () => {
    const d = duble((sql) =>
      sql.includes('FROM modelo_campo c')
        ? [
            {
              id: 40,
              titulo: 'Mobilidade',
              tipo_campo: 'escolha',
              sigla: null,
              situacao: 'publicado',
              opcoes: '["Acamado","Deambula"]',
              uso: 3,
            },
          ]
        : [],
    );
    const porta = new PortaFormularioNovoPropria(d.nucleo, 'cfg');
    const r = await porta.buscarPerguntas(C, ' mob_% ', ['13', '4']);
    expect(r).toEqual([
      {
        id: 40,
        descricao: 'Mobilidade',
        tipoperg: '13',
        unidade: null,
        ativo: true,
        opcoes: ['Acamado', 'Deambula'],
        usoEmModelos: 3,
      },
    ]);
    const q = d.chamadas.find((x) => x.sql.includes('FROM modelo_campo c'))!;
    expect(q.parametros).toEqual(['escolha', 'booleano', 'MOB\\_\\%']);
    // Tipo que o construtor não conhece: nada a buscar.
    const antes = d.chamadas.length;
    expect(await porta.buscarPerguntas(C, '', ['99'])).toEqual([]);
    expect(d.chamadas.filter((x) => x.sql.includes('FROM modelo_campo')).length).toBe(1);
    expect(d.chamadas.length).toBe(antes + 1);
  });

  it('códigos em uso: todos os do cliente, em maiúsculas; o plano tira o próprio código', async () => {
    const d = duble((sql) =>
      sql.includes('SELECT codigo FROM modelo_documento_clinico')
        ? [{ codigo: 'ENF02' }, { codigo: 'evol_x' }]
        : [],
    );
    const porta = new PortaFormularioNovoPropria(d.nucleo, 'cfg');
    expect([...(await porta.codigosEmUso(C))].sort()).toEqual(['ENF02', 'EVOL_X']);
    const plano = await porta.dadosDoPlano(C, 'evol_x', []);
    expect([...plano.codigosExistentes]).toEqual(['ENF02']);
    expect(plano.banco).toEqual([]);
    expect(plano.respostasCadastradas).toEqual([]);
  });
});
