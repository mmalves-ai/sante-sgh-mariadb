// Contrato de efeito do agendador das entregas aos parceiros (08-INTG L134) sobre o MariaDB real (cliente f22_o5):
// o pacote agendado e revisado gera, na hora da agenda, o arquivo tratado na porta de arquivos (só os campos do pacote,
// o identificador pseudonimizado, nada do que o pacote não leva) e a entrega com período, volume, hash e arquivo; fora
// de produção o transporte é simulado (confirmada com protocolo SIMULADO); a segunda volta não repete o período; em
// produção o SFTP fica para o operador, o webhook sem ponto falha com o motivo e o webhook com ponto confirma com o
// recibo; a revisão vencida para tudo. Massa sintética em datas futuras (sem colisão), apagada no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { campoDaVisao, VISOES_EXPORTAVEIS } from '@sgh/dominio-integracao';
import { criarArmazemLocal, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  inserirSintetico,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import { LEITURA_DOS_CAMPOS, PortaEntregasAgendadasPropria } from './pacotes-parceiro-entrega-propria.js';
import { cicloEntregas } from './pacotes-parceiro-entrega.service.js';

const CHAVE = 'chave-sintetica-de-teste-c2037-0123456789';
// Agenda diária 02:00 no fuso de Brasília: 05:00 UTC. Datas de 2031 (nenhuma outra massa nelas).
const DIA1 = new Date('2031-03-10T06:00:00.000Z');
const DIA2 = new Date('2031-03-11T06:00:00.000Z');
const DIA3 = new Date('2031-03-12T06:00:00.000Z');
const DIA4 = new Date('2031-03-13T06:00:00.000Z');
const DIA6 = new Date('2031-03-15T06:00:00.000Z');

it('toda visão do catálogo tem leitura de cada campo (e nada além)', () => {
  for (const v of VISOES_EXPORTAVEIS)
    expect(Object.keys(LEITURA_DOS_CAMPOS[v.entidade] ?? {}).sort()).toEqual(
      v.campos.map((c) => c.nome).sort(),
    );
  expect(campoDaVisao('internacao', 'leito')?.tipo).toBe('codigo');
});

describe.skipIf(SEM_BANCO)('agendador das entregas aos parceiros sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let raiz = '';
  let porta: PortaEntregasAgendadasPropria;
  let est = 0;
  let parceiro = 0;
  let pacote = 0;
  let pf = 0;
  let pac = 0;
  let ponto = 0;
  const internacoes: number[] = [];

  const ler = (sql: string, p: unknown[] = []) =>
    escrever(nucleo, (e) => e.consultar<Record<string, unknown>>(sql, p));
  const entregas = () =>
    ler(
      `SELECT id, situacao, protocolo_confirmacao AS protocolo, mensagem_retorno AS msg, arquivo_id, quantidade_registros AS q,
              hash_sha256 AS h, tamanho_bytes AS t, periodo_inicio AS i, periodo_fim AS f, usuario_id AS u
         FROM entrega_pacote_parceiro WHERE pacote_parceiro_id = ? ORDER BY id`,
      [pacote],
    );

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const ps = await e.consultar<{ id: unknown }>(
        "SELECT p.id FROM pacote_parceiro p JOIN parceiro_dados d ON d.id = p.parceiro_dados_id WHERE d.codigo = 'c2037-par'",
      );
      for (const x of ps) {
        await e.executar('DELETE FROM entrega_pacote_parceiro WHERE pacote_parceiro_id = ?', [x.id]);
        await e.executar('DELETE FROM pacote_parceiro_campo WHERE pacote_parceiro_id = ?', [x.id]);
        await e.executar("DELETE FROM arquivo WHERE entidade = 'pacote_parceiro' AND entidade_id = ?", [
          x.id,
        ]);
        await e.executar('DELETE FROM pacote_parceiro WHERE id = ?', [x.id]);
      }
      await e.executar("DELETE FROM parceiro_dados WHERE codigo = 'c2037-par'");
      await e.executar("DELETE FROM ponto_integracao WHERE codigo = 'c2037-ponto'");
      await e.executar("DELETE FROM internacao WHERE numero LIKE 'C2037-%'");
      await e.executar('DELETE FROM paciente WHERE numero_prontuario BETWEEN 9370001 AND 9370003');
      await e.executar("DELETE FROM pessoa_fisica WHERE nome = 'Pessoa Sintética C2037'");
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    raiz = mkdtempSync(join(tmpdir(), 'c2037-arquivos-'));
    porta = new PortaEntregasAgendadasPropria(nucleo, CLIENTE, criarArmazemLocal(nucleo, { raiz }));
    est = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f537a'));
    await limpar();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      // Um paciente por internação (uma internação vigente por paciente).
      const internar = async (numero: string, entrada: string) => {
        pf = await inserirSintetico(e, 'pessoa_fisica', { nome: 'Pessoa Sintética C2037', criado_em: agora });
        pac = await inserirSintetico(e, 'paciente', {
          pessoa_fisica_id: pf,
          numero_prontuario: 9370001 + internacoes.length,
          criado_em: agora,
        });
        internacoes.push(
          await inserirSintetico(e, 'internacao', {
            estabelecimento_id: est,
            numero,
            paciente_id: pac,
            atendimento_id: 937_000_000 + internacoes.length,
            data_hora_entrada: new Date(entrada),
            leito_hospitalar_id: null,
            criado_em: agora,
          }),
        );
      };
      await internar('C2037-1', '2031-03-09T12:00:00.000Z');
      await internar('C2037-2', '2031-03-10T04:59:00.000Z');
      await internar('C2037-3', '2031-03-10T05:00:00.000Z'); // já é do dia seguinte
      parceiro = await inserirSintetico(e, 'parceiro_dados', {
        codigo: 'c2037-par',
        nome: 'Parceiro sintético C2037',
        tipo: 'arquivo',
        finalidade: 'Indicadores assistenciais sintéticos',
        base_legal: 'politicas-publicas',
        criado_em: agora,
      });
      pacote = await inserirSintetico(e, 'pacote_parceiro', {
        parceiro_dados_id: parceiro,
        codigo: 'c2037-int',
        nome: 'Internações do dia',
        conteudo: 'Internações com entrada no período',
        formato: 'csv',
        meio_entrega: 'sftp',
        periodicidade: 'diaria',
        agenda: '02:00',
        anonimizacao: 'pseudonimizada',
        revisado_em: agora,
        proxima_revisao_em: '2031-12-31',
        criado_em: agora,
      });
      const campo = (sequencia: number, c: string, tratamento: string) =>
        inserirSintetico(e, 'pacote_parceiro_campo', {
          pacote_parceiro_id: pacote,
          sequencia,
          entidade: 'internacao',
          campo: c,
          rotulo_saida: c === 'prontuario' ? 'paciente' : c,
          tratamento,
          dado_sensivel: false,
          justificativa: 'Indicador de internação do parceiro',
          criado_em: agora,
        });
      await campo(1, 'prontuario', 'pseudonimizado');
      await campo(2, 'entrada', 'original');
      await campo(3, 'numero', 'mascarado');
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });

  it('gera o arquivo tratado, registra a entrega e simula o envio fora de produção; não repete o período', async () => {
    const r = await cicloEntregas(porta, { ambiente: 'dev', chave: CHAVE }, DIA1);
    expect(r).toMatchObject({ geradas: 1, confirmadas: 1, falhas: 0, recusas: [] });
    const [x] = await entregas();
    expect(x).toMatchObject({ situacao: 'confirmada', u: null });
    expect(x!['protocolo']).toBe(`SIMULADO-${Number(x!['id'])}`);
    expect(x!['msg']).toMatch(/nada saiu/);
    expect(Number(x!['q'])).toBe(2);
    expect(new Date(x!['i'] as string).toISOString()).toBe('2031-03-09T05:00:00.000Z');
    expect(new Date(x!['f'] as string).toISOString()).toBe('2031-03-10T05:00:00.000Z');
    // O arquivo na porta de arquivos: o hash confere, só os campos do pacote, o identificador pseudonimizado.
    const arq = await criarArmazemLocal(nucleo, { raiz }).ler(
      { cliente: CLIENTE, estabelecimento: null, correlacao: 'c2037' } as never,
      Number(x!['arquivo_id']),
    );
    expect(createHash('sha256').update(arq.conteudo).digest('hex')).toBe(x!['h']);
    expect(arq.conteudo.length).toBe(Number(x!['t']));
    const linhas = arq.conteudo.toString('utf8').trim().split('\r\n');
    expect(linhas[0]).toBe('paciente;entrada;numero');
    expect(linhas).toHaveLength(3);
    for (const l of linhas.slice(1)) expect(l).toMatch(/^[0-9a-f]{20};2031-03-\d\dT[\d:.]+Z;\*{3}37-\d$/);
    expect(arq.conteudo.toString('utf8')).not.toMatch(/Sintética|9370001/);
    expect(arq.metadado).toMatchObject({
      entidade: 'pacote_parceiro',
      entidadeId: pacote,
      origem: 'integracao',
      // A guarda legal entra com a entrega, na mesma transação.
      retencaoAte: '2036-03-10',
    });
    // Segunda volta na mesma hora: nada devido.
    expect((await cicloEntregas(porta, { ambiente: 'dev', chave: CHAVE }, DIA1)).geradas).toBe(0);
    expect(await entregas()).toHaveLength(1);
  }, 120_000);

  it('produção: SFTP fica para o operador, webhook sem ponto falha, webhook com ponto confirma com o recibo', async () => {
    const r2 = await cicloEntregas(porta, { ambiente: 'producao', chave: CHAVE }, DIA2);
    expect(r2).toMatchObject({ geradas: 1, aguardandoOperador: 1 });
    expect((await entregas())[1]).toMatchObject({ situacao: 'gerada', protocolo: null });
    expect(Number((await entregas())[1]!['q'])).toBe(1);
    await escrever(nucleo, (e) =>
      e.executar("UPDATE pacote_parceiro SET meio_entrega = 'webhook' WHERE id = ?", [pacote]),
    );
    const r3 = await cicloEntregas(porta, { ambiente: 'producao', chave: CHAVE }, DIA3);
    expect(r3).toMatchObject({ geradas: 1, falhas: 1 });
    expect((await entregas())[2]).toMatchObject({ situacao: 'falhou' });
    expect((await entregas())[2]!['msg']).toMatch(/sem ponto/);
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      ponto = await inserirSintetico(e, 'ponto_integracao', {
        estabelecimento_id: est,
        codigo: 'c2037-ponto',
        nome: 'Ponto sintético C2037',
        endereco: 'http://127.0.0.1:9/pacotes',
        direcao: 'saida',
        transporte: 'http_rest',
        formato_conteudo: 'csv',
        ambiente: 'producao',
        ativo: true,
        criado_em: new Date(),
      });
      await e.executar('UPDATE pacote_parceiro SET ponto_integracao_id = ? WHERE id = ?', [ponto, pacote]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    const chamadas: { url: string; idem: string | null; sha: string | null }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      const h = new Headers(init.headers);
      chamadas.push({ url, idem: h.get('idempotency-key'), sha: h.get('x-conteudo-sha256') });
      return new Response('', { status: 202, headers: { 'x-recibo': 'REC-SINT-1' } });
    }) as unknown as typeof fetch;
    const r4 = await cicloEntregas(porta, { ambiente: 'producao', chave: CHAVE, http }, DIA4);
    expect(r4).toMatchObject({ geradas: 1, confirmadas: 1 });
    const e4 = (await entregas())[3]!;
    expect(e4).toMatchObject({ situacao: 'confirmada', protocolo: 'REC-SINT-1' });
    expect(chamadas).toEqual([
      {
        url: 'http://127.0.0.1:9/pacotes',
        idem: `pacote-${pacote}-entrega-${Number(e4['id'])}`,
        sha: e4['h'],
      },
    ]);
    // A falha não conta como entregue: o período da quarta volta começa no fim da segunda (gerada).
    expect(new Date(e4['i'] as string).toISOString()).toBe('2031-03-11T05:00:00.000Z');
  }, 120_000);

  it('revisão vencida e pacote inativo param a geração', async () => {
    await escrever(nucleo, (e) =>
      e.executar("UPDATE pacote_parceiro SET proxima_revisao_em = '2031-03-01' WHERE id = ?", [pacote]),
    );
    const dia5 = new Date('2031-03-14T06:00:00.000Z');
    expect((await cicloEntregas(porta, { ambiente: 'dev', chave: CHAVE }, dia5)).geradas).toBe(0);
    await escrever(nucleo, (e) =>
      e.executar("UPDATE pacote_parceiro SET proxima_revisao_em = '2031-12-31', ativo = FALSE WHERE id = ?", [
        pacote,
      ]),
    );
    expect((await cicloEntregas(porta, { ambiente: 'dev', chave: CHAVE }, dia5)).geradas).toBe(0);
    expect(await entregas()).toHaveLength(4);
  }, 120_000);
  const arquivosAtivos = async (id: number) =>
    Number(
      (
        await ler(
          "SELECT COUNT(*) AS n FROM arquivo WHERE entidade = 'pacote_parceiro' AND entidade_id = ? AND excluido_em IS NULL",
          [id],
        )
      )[0]!['n'],
    );

  it('pacote inativado entre a leitura e o registro, ou erro no registro: nenhum arquivo fica guardado', async () => {
    await escrever(nucleo, (e) =>
      e.executar('UPDATE pacote_parceiro SET ativo = TRUE WHERE id = ?', [pacote]),
    );
    const antes = await arquivosAtivos(pacote);
    // Outra sessão inativa o pacote depois de devidos() e antes de registrar().
    const corrida = Object.create(porta) as PortaEntregasAgendadasPropria;
    corrida.registrar = async (ref, p, a, agora) => {
      await escrever(nucleo, (e) =>
        e.executar('UPDATE pacote_parceiro SET ativo = FALSE WHERE id = ?', [p.id]),
      );
      return porta.registrar(ref, p, a, agora);
    };
    const r = await cicloEntregas(corrida, { ambiente: 'dev', chave: CHAVE }, DIA6);
    expect(r).toMatchObject({ devidos: 1, geradas: 0 });
    expect(await entregas()).toHaveLength(4);
    expect(await arquivosAtivos(pacote)).toBe(antes);
    // O registro falha depois de guardar: o arquivo é descartado (sem guarda legal, sem entrega).
    await escrever(nucleo, (e) =>
      e.executar('UPDATE pacote_parceiro SET ativo = TRUE WHERE id = ?', [pacote]),
    );
    const quebrada = new PortaEntregasAgendadasPropria(nucleo, CLIENTE, criarArmazemLocal(nucleo, { raiz }), {
      executar: () => Promise.reject(new Error('falha sintética')),
    } as never);
    const ref = (await quebrada.referencia(DIA6))!;
    const [p] = await quebrada.devidos(ref, DIA6);
    const conteudo = `sintetico;${Date.now()}`;
    await expect(
      quebrada.registrar(
        ref,
        p!,
        {
          conteudo,
          tipoMime: 'text/csv',
          extensao: 'csv',
          quantidadeRegistros: 0,
          tamanhoBytes: conteudo.length,
          hashSha256: createHash('sha256').update(conteudo).digest('hex'),
        },
        DIA6,
      ),
    ).rejects.toThrow(/falha sintética/);
    expect(await arquivosAtivos(pacote)).toBe(antes);
    expect(await entregas()).toHaveLength(4);
    await escrever(nucleo, (e) =>
      e.executar('UPDATE pacote_parceiro SET ativo = FALSE WHERE id = ?', [pacote]),
    );
  }, 120_000);

  it('o agendador confere o pacote contra o catálogo: identificador aberto e duas visões não geram', async () => {
    // Pacote gravado por fora (antes da trava do catálogo): pseudonimizado com o prontuário original e duas visões.
    const ruim = await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      const id = await inserirSintetico(e, 'pacote_parceiro', {
        parceiro_dados_id: parceiro,
        codigo: 'c2037-ruim',
        nome: 'Pacote fora da regra',
        conteudo: 'Internações com entrada no período',
        formato: 'csv',
        meio_entrega: 'sftp',
        periodicidade: 'diaria',
        agenda: '02:00',
        anonimizacao: 'pseudonimizada',
        revisado_em: agora,
        proxima_revisao_em: '2031-12-31',
        criado_em: agora,
      });
      const campo = (sequencia: number, entidade: string, c: string, tratamento: string) =>
        inserirSintetico(e, 'pacote_parceiro_campo', {
          pacote_parceiro_id: id,
          sequencia,
          entidade,
          campo: c,
          rotulo_saida: c,
          tratamento,
          dado_sensivel: false,
          justificativa: 'Massa sintética fora da regra',
          criado_em: agora,
        });
      await campo(1, 'internacao', 'prontuario', 'original');
      await campo(2, 'atendimento', 'entrada', 'original');
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      return id;
    });
    const r = await cicloEntregas(porta, { ambiente: 'dev', chave: CHAVE }, DIA6);
    expect(r).toMatchObject({ devidos: 1, geradas: 0 });
    expect(r.recusas).toEqual(expect.arrayContaining(['identificador-sem-tratamento', 'visoes-misturadas']));
    expect(
      Number(
        (
          await ler('SELECT COUNT(*) AS n FROM entrega_pacote_parceiro WHERE pacote_parceiro_id = ?', [ruim])
        )[0]!['n'],
      ),
    ).toBe(0);
    expect(await arquivosAtivos(ruim)).toBe(0);
  }, 120_000);
});
